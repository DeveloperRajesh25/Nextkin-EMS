import type { Metadata } from 'next'
import { requireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/patterns'
import { todayIn, weekDates } from '@/lib/time'
import { AttendanceGrid } from './attendance-grid'

export const metadata: Metadata = { title: 'Attendance' }
export const dynamic = 'force-dynamic'

/**
 * The weekly attendance grid.
 *
 * The week is derived in the ORG's timezone, not the server's — the same rule
 * that governs which day a clock-in belongs to. A grid built from UTC dates
 * would put a 9am IST shift in the previous column.
 */
export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>
}) {
  const ctx = await requireOrg()
  const supabase = await createSupabaseServerClient()
  const tz = ctx.tenant.timezone

  const params = await searchParams
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(params.week ?? '') ? params.week! : todayIn(tz)
  const days = weekDates(anchor, tz)
  const [from, to] = [days[0], days[days.length - 1]]

  const [{ data: employees }, { data: records }] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, full_name, email, photo_url, employee_code, department_id')
      .eq('role', 'employee')
      .eq('is_active', true)
      .order('full_name'),
    supabase
      .from('attendance')
      .select('id, employee_id, date, login_time, logout_time, total_hours, is_late')
      .gte('date', from)
      .lte('date', to),
  ])

  const { data: departments } = await supabase.from('departments').select('id, name').order('name')

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attendance"
        description={`Week of ${days[0]} — shown in ${tz}.`}
      />
      <AttendanceGrid
        employees={employees ?? []}
        departments={departments ?? []}
        records={records ?? []}
        days={days}
        anchor={anchor}
        timezone={tz}
      />
    </div>
  )
}
