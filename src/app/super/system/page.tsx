import type { Metadata } from 'next'
import { CheckCircle2, XCircle, Server, Database, Mail, HardDrive, CalendarDays } from 'lucide-react'
import { requireSuperAdmin } from '@/lib/auth/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { PageHeader, EmptyState, StatusChip } from '@/components/ui/patterns'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { formatLocal } from '@/lib/time'
import { isEmailConfigured } from '@/lib/email'
import { isR2Configured } from '@/lib/r2'
import { isCalendarConfigured } from '@/lib/google-calendar'
import { cn } from '@/lib/utils'

export const metadata: Metadata = { title: 'System health' }
export const dynamic = 'force-dynamic'

/**
 * The page that makes a silently-failing background job visible (§8).
 *
 * Every cron invocation writes to `cron_runs` whether it succeeded or not, so
 * "the visa engine has not run in six days" is a thing you can SEE here rather
 * than something you discover when a reminder does not arrive.
 */
export default async function SystemHealthPage() {
  await requireSuperAdmin()
  const admin = createAdminClient()

  const [{ data: runs }, { data: connections }] = await Promise.all([
    admin
      .from('cron_runs')
      .select('id, job, ok, duration_ms, detail, created_at')
      .order('created_at', { ascending: false })
      .limit(60),
    admin.from('calendar_connections').select('tenant_id, status, last_synced_at'),
  ])

  const allRuns = runs ?? []

  // The most recent run per job — the thing you actually want to know.
  const latest = new Map<string, (typeof allRuns)[number]>()
  for (const run of allRuns) {
    if (!latest.has(run.job)) latest.set(run.job, run)
  }

  const needsReauth = (connections ?? []).filter((c) => c.status === 'needs_reauth').length

  const integrations = [
    {
      label: 'Cloudflare R2 storage',
      icon: HardDrive,
      ok: isR2Configured(),
      detail: isR2Configured()
        ? 'Configured — uploads and signed downloads available'
        : 'Not configured — uploads and downloads will fail',
    },
    {
      label: 'Resend email',
      icon: Mail,
      ok: isEmailConfigured(),
      detail: isEmailConfigured()
        ? 'Configured — credentials, visa reminders and announcements can send'
        : 'Not configured — product email is skipped',
    },
    {
      label: 'Google Calendar',
      icon: CalendarDays,
      ok: isCalendarConfigured(),
      detail: isCalendarConfigured()
        ? `Configured${needsReauth ? ` — ${needsReauth} connection(s) need reauthorization` : ''}`
        : 'Not configured — OAuth credentials or the encryption key are missing',
    },
    {
      label: 'Cron authentication',
      icon: Server,
      ok: !!process.env.CRON_SECRET && process.env.CRON_SECRET.length >= 16,
      detail:
        process.env.CRON_SECRET && process.env.CRON_SECRET.length >= 16
          ? 'CRON_SECRET is set — scheduled jobs can authenticate'
          : 'CRON_SECRET missing or too short — cron endpoints answer 503',
    },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="System health"
        description="Integration configuration and the outcome of every scheduled job."
      />

      <Card>
        <CardHeader>
          <CardTitle>Integrations</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ul className="divide-y divide-line">
            {integrations.map((item) => (
              <li key={item.label} className="flex items-start gap-3.5 px-5 py-4">
                <span
                  className={cn(
                    'grid size-9 shrink-0 place-items-center rounded-lg',
                    item.ok ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'
                  )}
                >
                  <item.icon className="size-[18px]" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{item.label}</p>
                  <p className="mt-0.5 text-[13px] text-ink-muted">{item.detail}</p>
                </div>
                {item.ok ? (
                  <CheckCircle2 className="size-5 shrink-0 text-emerald-600" aria-label="Configured" />
                ) : (
                  <XCircle className="size-5 shrink-0 text-amber-500" aria-label="Not configured" />
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Scheduled jobs — latest run</CardTitle>
        </CardHeader>
        {latest.size === 0 ? (
          <EmptyState
            icon={Database}
            title="No runs recorded"
            description="Either the scheduler is not set up yet, or it has never reached the app. Check SETUP.md §7."
          />
        ) : (
          <ul className="divide-y divide-line">
            {Array.from(latest.values()).map((run) => (
              <li key={run.id} className="flex items-start gap-3.5 px-5 py-4">
                <span
                  className={cn(
                    'mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg',
                    run.ok ? 'bg-emerald-50 text-emerald-600' : 'bg-brand-50 text-brand-600'
                  )}
                >
                  {run.ok ? (
                    <CheckCircle2 className="size-4" aria-hidden />
                  ) : (
                    <XCircle className="size-4" aria-hidden />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="font-mono text-[13px] font-medium">{run.job}</code>
                    <StatusChip status={run.ok ? 'active' : 'rejected'} label={run.ok ? 'OK' : 'Failed'} />
                  </div>
                  <p className="tabular mt-1 text-xs text-ink-muted">
                    {formatLocal(run.created_at, 'UTC', 'd MMM yyyy, HH:mm:ss')} UTC
                    {run.duration_ms ? ` · ${run.duration_ms}ms` : ''}
                  </p>
                  {run.detail && Object.keys(run.detail).length ? (
                    <p className="mt-1.5 break-all font-mono text-[11px] leading-relaxed text-ink-muted">
                      {JSON.stringify(run.detail)}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Run history</CardTitle>
        </CardHeader>
        {allRuns.length === 0 ? (
          <EmptyState title="Nothing yet" description="Job outcomes appear here once the scheduler runs." />
        ) : (
          <ul className="scrollbar-thin max-h-96 divide-y divide-line overflow-y-auto">
            {allRuns.map((run) => (
              <li key={run.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                <span
                  className={cn(
                    'size-2 shrink-0 rounded-full',
                    run.ok ? 'bg-emerald-500' : 'bg-brand-600'
                  )}
                  aria-hidden
                />
                <code className="w-40 shrink-0 truncate font-mono text-xs">{run.job}</code>
                <span className="tabular flex-1 text-xs text-ink-muted">
                  {formatLocal(run.created_at, 'UTC', 'd MMM, HH:mm:ss')}
                </span>
                <span className="tabular shrink-0 text-xs text-ink-muted">
                  {run.duration_ms ? `${run.duration_ms}ms` : '—'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
