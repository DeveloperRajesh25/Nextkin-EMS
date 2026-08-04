import type { Metadata } from 'next'
import { requireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/patterns'
import { PayrollManager } from './payroll-manager'

export const metadata: Metadata = { title: 'Payroll' }
export const dynamic = 'force-dynamic'

export default async function PayrollPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; year?: string }>
}) {
  await requireOrg()
  const supabase = await createSupabaseServerClient()

  const params = await searchParams
  const now = new Date()
  const month = Math.min(12, Math.max(1, parseInt(params.month ?? '', 10) || now.getMonth() + 1))
  const year = Math.min(2200, Math.max(2000, parseInt(params.year ?? '', 10) || now.getFullYear()))

  const [{ data: employees }, { data: payslips }] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, full_name, email, photo_url, employee_code, designation')
      .eq('role', 'employee')
      .eq('is_active', true)
      .order('full_name'),
    supabase
      .from('payslips')
      .select('id, employee_id, month, year, file_url, file_name, created_at')
      .eq('month', month)
      .eq('year', year),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payroll"
        description="Upload a monthly payslip for each employee. Only they can open theirs."
      />
      <PayrollManager
        employees={employees ?? []}
        payslips={payslips ?? []}
        month={month}
        year={year}
      />
    </div>
  )
}
