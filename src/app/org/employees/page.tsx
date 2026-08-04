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

export default async function EmployeesPage() {
  const ctx = await requireOrg()
  const supabase = await createSupabaseServerClient()

  const [{ data: employees }, { data: departments }] = await Promise.all([
    supabase
      .from('profiles')
      .select(
        'id, full_name, email, phone, photo_url, employee_code, designation, department_id, is_active, created_at'
      )
      .eq('role', 'employee')
      .order('created_at', { ascending: false }),
    supabase.from('departments').select('id, name').order('name'),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Employees"
        description="Everyone on your team, and the accounts they sign in with."
        actions={
          <Button asChild>
            <Link href="/org/employees/new">
              <UserPlus />
              Add employee
            </Link>
          </Button>
        }
      />
      <EmployeeList
        employees={employees ?? []}
        departments={departments ?? []}
        timezone={ctx.tenant.timezone}
      />
    </div>
  )
}
