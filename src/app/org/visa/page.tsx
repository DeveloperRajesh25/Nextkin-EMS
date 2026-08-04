import type { Metadata } from 'next'
import { requireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/patterns'
import { VisaManager } from './visa-manager'

export const metadata: Metadata = { title: 'Work authorization' }
export const dynamic = 'force-dynamic'

export default async function VisaPage() {
  const ctx = await requireOrg()
  const supabase = await createSupabaseServerClient()

  const [{ data: records }, { data: employees }, { data: reminders }] = await Promise.all([
    // Soonest expiry first — the whole point of this screen is what is coming up.
    supabase
      .from('work_authorizations')
      .select('id, employee_id, visa_type, visa_number, start_date, expiry_date, document_url, notes')
      .order('expiry_date', { ascending: true }),
    supabase
      .from('profiles')
      .select('id, full_name, email, photo_url')
      .eq('role', 'employee')
      .eq('is_active', true)
      .order('full_name'),
    supabase.from('visa_reminder_logs').select('work_auth_id, milestone, sent_at'),
  ])

  const remindersByAuth = new Map<string, number[]>()
  for (const log of reminders ?? []) {
    const list = remindersByAuth.get(log.work_auth_id) ?? []
    list.push(log.milestone)
    remindersByAuth.set(log.work_auth_id, list)
  }

  const rows = (records ?? []).map((record) => ({
    ...record,
    sentMilestones: (remindersByAuth.get(record.id) ?? []).sort((a, b) => b - a),
  }))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Work authorization"
        description="H-1B records and the reminders already sent. Each milestone is sent once and never repeats."
      />
      <VisaManager
        records={rows}
        employees={employees ?? []}
        timezone={ctx.tenant.timezone}
      />
    </div>
  )
}
