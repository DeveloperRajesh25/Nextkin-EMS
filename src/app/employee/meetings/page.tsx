import type { Metadata } from 'next'
import { CalendarDays, Video } from 'lucide-react'
import { requireEmployee } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PageHeader, EmptyState } from '@/components/ui/patterns'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { formatLocal } from '@/lib/time'

export const metadata: Metadata = { title: 'Meetings' }
export const dynamic = 'force-dynamic'

export default async function EmployeeMeetingsPage() {
  const ctx = await requireEmployee()
  const supabase = await createSupabaseServerClient()

  // Employees have SELECT on meetings within their tenant, and no write policy —
  // so this page is read-only by construction, not by hiding buttons.
  const { data: meetings } = await supabase
    .from('meetings')
    .select('id, title, description, location, meet_link, start_time, end_time, attendees, source')
    .gte('end_time', new Date().toISOString())
    .order('start_time', { ascending: true })
    .limit(100)

  const rows = meetings ?? []
  const tz = ctx.tenant.timezone

  return (
    <div className="space-y-6">
      <PageHeader
        title="Meetings"
        description={`Upcoming meetings on the workspace calendar, in ${tz}.`}
      />

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={CalendarDays}
            title="Nothing scheduled"
            description="Meetings your organization schedules will appear here."
          />
        </Card>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((meeting) => (
            <li key={meeting.id}>
              <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                <span className="tabular grid w-14 shrink-0 rounded-lg bg-page py-2 text-center">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
                    {formatLocal(meeting.start_time, tz, 'MMM')}
                  </span>
                  <span className="text-lg font-bold leading-tight">
                    {formatLocal(meeting.start_time, tz, 'd')}
                  </span>
                </span>

                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{meeting.title}</p>
                  <p className="tabular mt-0.5 text-[13px] text-ink-muted">
                    {formatLocal(meeting.start_time, tz, 'EEE d MMM, HH:mm')} –{' '}
                    {formatLocal(meeting.end_time, tz, 'HH:mm')}
                  </p>
                  {meeting.location ? (
                    <p className="mt-0.5 truncate text-[13px] text-ink-muted">{meeting.location}</p>
                  ) : null}
                  {meeting.description ? (
                    <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-ink-muted">
                      {meeting.description}
                    </p>
                  ) : null}
                </div>

                {meeting.meet_link ? (
                  <Button asChild size="sm" variant="secondary" className="shrink-0">
                    <a href={meeting.meet_link} target="_blank" rel="noopener noreferrer">
                      <Video />
                      Join
                    </a>
                  </Button>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
