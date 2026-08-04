import type { Metadata } from 'next'
import { requireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/patterns'
import { LeaveQueue } from './leave-queue'

export const metadata: Metadata = { title: 'Leaves' }
export const dynamic = 'force-dynamic'

export default async function LeavesPage() {
  const ctx = await requireOrg()
  const supabase = await createSupabaseServerClient()

  const { data: leaves } = await supabase
    .from('leaves')
    .select(
      'id, employee_id, start_date, end_date, days, reason, status, decision_note, decided_at, created_at'
    )
    .order('created_at', { ascending: false })
    .limit(300)

  const employeeIds = Array.from(new Set((leaves ?? []).map((l) => l.employee_id)))
  const people = new Map<string, { name: string; photo: string | null }>()

  if (employeeIds.length) {
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, email, photo_url')
      .in('id', employeeIds)
    for (const p of data ?? []) {
      people.set(p.id, { name: p.full_name || p.email || 'Employee', photo: p.photo_url })
    }
  }

  const rows = (leaves ?? []).map((leave) => ({
    ...leave,
    employeeName: people.get(leave.employee_id)?.name ?? 'Employee',
    employeePhoto: people.get(leave.employee_id)?.photo ?? null,
  }))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leaves"
        description="Approve or decline requests from your team."
      />
      <LeaveQueue leaves={rows} timezone={ctx.tenant.timezone} />
    </div>
  )
}
