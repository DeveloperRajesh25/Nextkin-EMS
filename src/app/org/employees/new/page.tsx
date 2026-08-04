import type { Metadata } from 'next'
import { requireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/patterns'
import { EmployeeWizard } from './employee-wizard'

export const metadata: Metadata = { title: 'Add employee' }
export const dynamic = 'force-dynamic'

export default async function NewEmployeePage() {
  const ctx = await requireOrg()
  const supabase = await createSupabaseServerClient()
  const { data: departments } = await supabase.from('departments').select('id, name').order('name')

  return (
    <div className="space-y-6">
      <PageHeader
        title="Add employee"
        description="Create an account and we will issue their sign-in details."
      />
      <EmployeeWizard
        departments={departments ?? []}
        defaultTimezone={ctx.tenant.timezone}
      />
    </div>
  )
}
