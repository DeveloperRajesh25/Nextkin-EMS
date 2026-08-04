import 'server-only'

/**
 * Append-only audit trail.
 *
 * Written with the ADMIN client on purpose: the `audit_logs` INSERT policy also
 * permits authenticated writes, but a cron job or a rollback path has no user
 * session and still has to leave a record. There is no update or delete path
 * anywhere in the product — 002_rls.sql creates no such policy and revokes the
 * privileges outright, so the trail is tamper-resistant even against a future
 * policy mistake.
 *
 * Auditing NEVER fails the operation it is describing. A logging outage must not
 * roll back a payroll upload; failures are swallowed and reported to the server
 * log.
 */
import { createAdminClient } from '@/lib/supabase/admin'
import { getClientIp } from '@/lib/rate-limit'

export interface AuditEntry {
  tenantId?: string | null
  actorId?: string | null
  actorEmail?: string | null
  action: string
  entity?: string | null
  entityId?: string | null
  meta?: Record<string, unknown>
  request?: Request
}

/** Keys whose values must never reach the audit table. */
const REDACTED = new Set([
  'password',
  'new_password',
  'newPassword',
  'temp_password',
  'tempPassword',
  'token',
  'refresh_token',
  'access_token',
  'secret',
  'authorization',
])

function scrub(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(meta)) {
    if (REDACTED.has(key) || REDACTED.has(key.toLowerCase())) {
      out[key] = '[redacted]'
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = scrub(value as Record<string, unknown>)
    } else {
      out[key] = value
    }
  }
  return out
}

export async function audit(entry: AuditEntry): Promise<void> {
  try {
    const admin = createAdminClient()
    await admin.from('audit_logs').insert({
      tenant_id: entry.tenantId ?? null,
      actor_id: entry.actorId ?? null,
      actor_email: entry.actorEmail ?? null,
      action: entry.action,
      entity: entry.entity ?? null,
      entity_id: entry.entityId ?? null,
      ip: entry.request ? getClientIp(entry.request) : null,
      meta: scrub(entry.meta ?? {}),
    })
  } catch (err) {
    console.error('[audit] failed to record', entry.action, err)
  }
}

/** Record a cron run's outcome so a silently-failing job is visible (§8). */
export async function recordCronRun(
  job: string,
  ok: boolean,
  durationMs: number,
  detail: Record<string, unknown> = {}
): Promise<void> {
  try {
    const admin = createAdminClient()
    await admin.from('cron_runs').insert({ job, ok, duration_ms: durationMs, detail })
  } catch (err) {
    console.error('[cron] failed to record run', job, err)
  }
}
