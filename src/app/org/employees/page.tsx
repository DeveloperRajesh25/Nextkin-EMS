import type { Metadata } from 'next'
import Link from 'next/link'
import { UserPlus } from 'lucide-react'
import { requireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/patterns'
import { Button } from '@/components/ui/button'
import { EmployeeList } from './employee-list'

export const metadata: Metadata = { title: 'Employees' }
export const dynamic = 'force-dynamic'

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const ctx = await requireOrg()
  const supabase = await createSupabaseServerClient()
  const { tab } = await searchParams

  const [{ data: employees }, { data: departments }, { data: drafts }] = await Promise.all([
    supabase
      .from('profiles')
      .select(
        'id, full_name, email, phone, photo_url, employee_code, designation, department_id, is_active, created_at'
      )
      .eq('role', 'employee')
      .order('created_at', { ascending: false }),
    supabase.from('departments').select('id, name').order('name'),
    // In-progress onboardings. Columns are named explicitly — `select('*')`
    // fails here by design, because the encrypted bank column is not readable
    // by a browser session (008_employee_onboarding.sql).
    supabase
      .from('employee_onboarding')
      .select(
        'id, first_name, last_name, personal_email, designation, current_step, completed_steps, created_at, updated_at'
      )
      .eq('status', 'draft')
      .order('updated_at', { ascending: false }),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Employees"
        description="Everyone on your team, and the accounts they sign in with."
        actions={
          <Button asChild>
            <Link href="/org/employees/onboard">
              <UserPlus />
              Add employee
            </Link>
          </Button>
        }
      />
      <EmployeeList
        employees={employees ?? []}
        departments={departments ?? []}
        drafts={drafts ?? []}
        initialTab={tab === 'drafts' ? 'drafts' : 'team'}
        timezone={ctx.tenant.timezone}
      />
    </div>
  )
}
