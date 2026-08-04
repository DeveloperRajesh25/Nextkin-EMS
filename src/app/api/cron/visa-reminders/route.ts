import { NextRequest } from 'next/server'
import { withErrorHandler, jsonOk } from '@/lib/api'
import { requireCron } from '@/lib/auth/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendVisaReminder, isEmailConfigured } from '@/lib/email'
import { daysUntil, safeTimezone } from '@/lib/time'
import { recordCronRun } from '@/lib/audit'
import type { VisaMilestone } from '@/types/db'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MILESTONES: VisaMilestone[] = [90, 30, 7, 0]

/**
 * H-1B expiry reminders. Runs daily.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ONCE PER MILESTONE, FOREVER                                              │
 * │                                                                          │
 * │ The guarantee is not "we check whether we already sent it" — a check-     │
 * │ then-send is a race, and two overlapping cron runs (a retry, a slow       │
 * │ previous invocation, two schedulers) would both pass the check and both   │
 * │ send. The guarantee is UNIQUE(work_auth_id, milestone) on                 │
 * │ visa_reminder_logs.                                                      │
 * │                                                                          │
 * │ So the order below is: INSERT THE LEDGER ROW FIRST, and only send if the  │
 * │ insert succeeded. A duplicate loses the insert (23505), sends nothing,    │
 * │ and moves on. The database, not the application, is what makes this       │
 * │ idempotent — and it holds across restarts, retries and double-scheduling. │
 * │                                                                          │
 * │ Claiming before sending means a crash between the two can drop a          │
 * │ reminder. That is the right trade: this is a heads-up about a date months │
 * │ or weeks away, sent again at the next milestone, and a duplicate legal-   │
 * │ deadline alert erodes trust in every future one.                          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The day difference is computed in EACH TENANT'S timezone, so an org in
 * Asia/Kolkata and one in America/New_York both get their reminder on the day
 * that is "90 days out" where they are.
 */
async function handlePOST(request: NextRequest) {
  const denied = await requireCron(request, 'visa-reminders')
  if (denied) return denied

  const startedAt = Date.now()
  const admin = createAdminClient()

  const summary = {
    scanned: 0,
    matched: 0,
    sent: 0,
    alreadyLogged: 0,
    emailFailed: 0,
    errors: [] as string[],
  }

  try {
    // Cross-tenant by necessity — this is a platform job with no user session.
    // Every row carries its tenant, and every write below is scoped by it.
    const { data: tenants, error: tenantError } = await admin
      .from('tenants')
      .select('id, name, timezone, primary_color, status')
      .eq('status', 'active')

    if (tenantError) throw tenantError

    for (const tenant of tenants ?? []) {
      const tz = safeTimezone(tenant.timezone)

      // Only look at authorizations that could plausibly hit a milestone. The
      // 100-day window comfortably covers the 90-day one without scanning
      // every historical record.
      const horizon = new Date()
      horizon.setDate(horizon.getDate() + 100)

      const { data: auths, error: authError } = await admin
        .from('work_authorizations')
        .select('id, employee_id, visa_type, expiry_date, tenant_id')
        .eq('tenant_id', tenant.id)
        .lte('expiry_date', horizon.toISOString().slice(0, 10))
        .gte('expiry_date', new Date().toISOString().slice(0, 10))

      if (authError) {
        summary.errors.push(`tenant ${tenant.id}: ${authError.message}`)
        continue
      }

      summary.scanned += auths?.length ?? 0
      if (!auths?.length) continue

      // Who to tell: the org owners, plus the employee themselves.
      const { data: owners } = await admin
        .from('profiles')
        .select('email')
        .eq('tenant_id', tenant.id)
        .eq('role', 'org')
        .eq('is_active', true)

      const ownerEmails = (owners ?? []).map((o) => o.email).filter(Boolean) as string[]

      for (const auth of auths) {
        const remaining = daysUntil(auth.expiry_date, tz)
        const milestone = MILESTONES.find((m) => m === remaining)
        if (milestone === undefined) continue

        summary.matched += 1

        // --- CLAIM FIRST. The unique index is the concurrency control. ------
        const { error: claimError } = await admin.from('visa_reminder_logs').insert({
          tenant_id: auth.tenant_id,
          employee_id: auth.employee_id,
          work_auth_id: auth.id,
          milestone,
        })

        if (claimError) {
          // 23505 = this milestone is already logged. Correct and expected.
          if (claimError.code === '23505') {
            summary.alreadyLogged += 1
          } else {
            summary.errors.push(`claim ${auth.id}/${milestone}: ${claimError.message}`)
          }
          continue
        }

        const { data: employee } = await admin
          .from('profiles')
          .select('full_name, email')
          .eq('id', auth.employee_id)
          .eq('tenant_id', tenant.id) // service_role bypasses RLS — scope it here
          .maybeSingle()

        const employeeName = employee?.full_name || employee?.email || 'An employee'

        // In-app notification, addressed to the employee.
        const { error: notifyError } = await admin.from('notifications').insert({
          tenant_id: auth.tenant_id,
          title:
            remaining === 0
              ? `${auth.visa_type} expires today`
              : `${auth.visa_type} expires in ${remaining} day${remaining === 1 ? '' : 's'}`,
          description: `${employeeName}'s ${auth.visa_type} (expiry ${auth.expiry_date}) is approaching. Please start the renewal process.`,
          send_to_type: 'employee',
          target_id: auth.employee_id,
        })
        if (notifyError) {
          summary.errors.push(`notify ${auth.id}: ${notifyError.message}`)
        }

        if (isEmailConfigured()) {
          const recipients = [...ownerEmails]
          if (employee?.email) recipients.push(employee.email)

          if (recipients.length) {
            const result = await sendVisaReminder({
              to: recipients,
              employeeName,
              visaType: auth.visa_type,
              expiryDate: auth.expiry_date,
              daysRemaining: remaining,
              orgName: tenant.name,
              brandColor: tenant.primary_color,
            })
            if (result.ok) summary.sent += 1
            else summary.emailFailed += 1
          }
        }
      }
    }

    const durationMs = Date.now() - startedAt
    await recordCronRun('visa-reminders', summary.errors.length === 0, durationMs, summary)

    // A non-empty error list still answers 200: the run DID work, partially, and
    // failing the whole job would make a scheduler retry everything. The failure
    // is visible in cron_runs and in the response body.
    return jsonOk({ ok: true, durationMs, ...summary })
  } catch (err) {
    const durationMs = Date.now() - startedAt
    const message = err instanceof Error ? err.message : 'unknown error'
    await recordCronRun('visa-reminders', false, durationMs, { fatal: message })
    console.error('[cron/visa-reminders] fatal', err)

    // 500 on purpose. `curl -fsS` turns this into a loud, red scheduler failure
    // instead of a silently-green job that has not worked for a month (§8).
    return Response.json({ error: 'Visa reminder run failed', detail: message }, { status: 500 })
  }
}

export const POST = withErrorHandler(handlePOST)
/** GET is accepted so Vercel Cron (which issues GETs) can drive the same job. */
export const GET = withErrorHandler(handlePOST)
