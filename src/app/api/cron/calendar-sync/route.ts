import { NextRequest } from 'next/server'
import { randomUUID } from 'crypto'
import { withErrorHandler, jsonOk } from '@/lib/api'
import { requireCron } from '@/lib/auth/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadSyncableConnections, syncTenantCalendar } from '@/lib/calendar-sync'
import { getAccessToken, watchCalendar, isCalendarConfigured } from '@/lib/google-calendar'
import { recordCronRun } from '@/lib/audit'
import { appUrl } from '@/lib/env'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Renew a push channel this many hours before it lapses. */
const RENEW_WITHIN_HOURS = 24

/**
 * The calendar sync fallback. Runs every 15 minutes.
 *
 * This is NOT an optimisation — it is what makes the integration reliable.
 * Google push channels expire (a week at most), a deploy can drop a
 * notification, and a webhook that 500s repeatedly gets its channel torn down.
 * Any of those means changes silently stop arriving, with nothing to indicate a
 * problem. The periodic incremental pull closes that gap, and re-arms channels
 * that are about to lapse.
 */
async function handlePOST(request: NextRequest) {
  const denied = await requireCron(request, 'calendar-sync')
  if (denied) return denied

  const startedAt = Date.now()

  if (!isCalendarConfigured()) {
    // Not an error — this deployment simply has no Calendar integration.
    await recordCronRun('calendar-sync', true, Date.now() - startedAt, { skipped: 'not configured' })
    return jsonOk({ ok: true, skipped: 'Google Calendar is not configured' })
  }

  const summary = {
    connections: 0,
    synced: 0,
    applied: 0,
    deleted: 0,
    fullResyncs: 0,
    needsReauth: 0,
    channelsRenewed: 0,
    errors: [] as string[],
  }

  try {
    const connections = await loadSyncableConnections()
    summary.connections = connections.length

    const admin = createAdminClient()

    for (const connection of connections) {
      const result = await syncTenantCalendar(connection)

      if (result.status === 'needs_reauth') {
        summary.needsReauth += 1
        // Nothing more to do for this tenant — the org must reconnect. The UI
        // surfaces the state on the integrations page.
        continue
      }
      if (result.status === 'error') {
        summary.errors.push(`${result.tenantId}: ${result.error}`)
        continue
      }
      if (result.status === 'skipped') continue

      summary.synced += 1
      summary.applied += result.applied
      summary.deleted += result.deleted
      if (result.fullResync) summary.fullResyncs += 1

      // --- Re-arm a channel that is close to expiring ----------------------
      const expiresAt = connection.channel_expires_at
        ? new Date(connection.channel_expires_at).getTime()
        : 0
      const dueForRenewal =
        !connection.google_channel_id ||
        !expiresAt ||
        expiresAt - Date.now() < RENEW_WITHIN_HOURS * 3_600_000

      if (dueForRenewal) {
        const accessToken = await getAccessToken(admin, connection)
        if (!accessToken) continue

        const channelId = randomUUID()
        const channelToken = randomUUID()
        const watch = await watchCalendar(
          accessToken,
          channelId,
          `${appUrl()}/api/integrations/google/webhook`,
          channelToken
        )

        if (watch) {
          await admin
            .from('calendar_connections')
            .update({
              // `<channelId>:<channelToken>` — the webhook splits this to verify
              // the callback it receives.
              google_channel_id: `${channelId}:${channelToken}`,
              google_resource_id: watch.resourceId,
              channel_expires_at: watch.expiration,
            })
            .eq('tenant_id', connection.tenant_id)
          summary.channelsRenewed += 1
        }
      }
    }

    const durationMs = Date.now() - startedAt
    await recordCronRun('calendar-sync', summary.errors.length === 0, durationMs, summary)

    return jsonOk({ ok: true, durationMs, ...summary })
  } catch (err) {
    const durationMs = Date.now() - startedAt
    const message = err instanceof Error ? err.message : 'unknown error'
    await recordCronRun('calendar-sync', false, durationMs, { fatal: message })
    console.error('[cron/calendar-sync] fatal', err)

    // 500 so `curl -fsS` fails the scheduler loudly (§8).
    return Response.json({ error: 'Calendar sync run failed', detail: message }, { status: 500 })
  }
}

export const POST = withErrorHandler(handlePOST)
export const GET = withErrorHandler(handlePOST)
