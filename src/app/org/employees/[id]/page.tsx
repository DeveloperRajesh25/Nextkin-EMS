import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Download, FileText } from 'lucide-react'
import { requireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PageHeader, StatCard, StatusChip, EmptyState } from '@/components/ui/patterns'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/primitives'
import { formatLocal, todayIn } from '@/lib/time'
import { initials, formatHours } from '@/lib/utils'
import { EmployeeEditForm } from './employee-edit-form'

export const metadata: Metadata = { title: 'Employee' }
export const dynamic = 'force-dynamic'

export default async function EmployeeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const ctx = await requireOrg()
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const tz = ctx.tenant.timezone

  // RLS scopes this to the tenant, so an id from another workspace is simply a
  // 404 — the isolation is the lookup, not an extra branch.
  const { data: employee } = await supabase
    .from('profiles')
    .select(
      'id, full_name, email, phone, photo_url, employee_code, designation, department_id, date_of_joining, timezone, is_active, must_change_password, created_at'
    )
    .eq('id', id)
    .eq('role', 'employee')
    .maybeSingle()

  if (!employee) notFound()

  const monthStart = `${todayIn(tz).slice(0, 7)}-01`

  const [{ data: departments }, { data: attendance }, { data: leaves }, { data: documents }] =
    await Promise.all([
      supabase.from('departments').select('id, name').order('name'),
      supabase
        .from('attendance')
        .select('id, date, login_time, logout_time, total_hours, is_late')
        .eq('employee_id', id)
        .gte('date', monthStart)
        .order('date', { ascending: false }),
      supabase
        .from('leaves')
        .select('id, start_date, end_date, days, status, reason')
        .eq('employee_id', id)
        .order('created_at', { ascending: false })
        .limit(10),
      supabase
        .from('documents')
        .select('id, file_url, file_name, kind, created_at')
        .eq('employee_id', id)
        .order('created_at', { ascending: false }),
    ])

  const records = attendance ?? []
  const totalHours = records.reduce((sum, r) => sum + Number(r.total_hours ?? 0), 0)
  const lateCount = records.filter((r) => r.is_late).length

  return (
    <div className="space-y-6">
      <PageHeader
        title={employee.full_name || employee.email || 'Employee'}
        description={employee.designation || 'No designation set'}
        actions={
          <Button asChild variant="secondary">
            <Link href="/org/employees">
              <ArrowLeft />
              All employees
            </Link>
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-line bg-card p-5 shadow-sm">
        <Avatar className="size-16">
          {employee.photo_url ? (
            <AvatarImage
              src={`/api/files/view?key=${encodeURIComponent(employee.photo_url)}`}
              alt=""
            />
          ) : null}
          <AvatarFallback className="text-lg">
            {initials(employee.full_name, employee.email)}
          </AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[17px] font-semibold">{employee.full_name || 'Unnamed'}</p>
            <StatusChip status={employee.is_active ? 'active' : 'inactive'} />
            {employee.must_change_password ? (
              <StatusChip status="pending" label="Has not set a password yet" />
            ) : null}
          </div>
          <p className="mt-0.5 text-sm text-ink-muted">{employee.email}</p>
          <p className="tabular mt-0.5 text-sm text-ink-muted">
            {employee.employee_code ? `${employee.employee_code} · ` : ''}
            {employee.phone || 'No phone'}
          </p>
        </div>

        <div className="text-right text-sm text-ink-muted">
          <p>Joined {employee.date_of_joining || formatLocal(employee.created_at, tz, 'd MMM yyyy')}</p>
          <p className="mt-0.5">{employee.timezone}</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Days present this month" value={records.length} accent />
        <StatCard label="Hours this month" value={formatHours(totalHours)} />
        <StatCard label="Late logins" value={lateCount} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <EmployeeEditForm
          employee={{
            id: employee.id,
            fullName: employee.full_name ?? '',
            phone: employee.phone ?? '',
            employeeCode: employee.employee_code ?? '',
            designation: employee.designation ?? '',
            departmentId: employee.department_id ?? '',
            dateOfJoining: employee.date_of_joining ?? '',
            timezone: employee.timezone,
            isActive: employee.is_active,
          }}
          departments={departments ?? []}
        />

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Attendance this month</CardTitle>
            </CardHeader>
            {records.length === 0 ? (
              <EmptyState title="No attendance recorded" description="Nothing logged this month." />
            ) : (
              <ul className="scrollbar-thin max-h-72 divide-y divide-line overflow-y-auto">
                {records.map((record) => (
                  <li key={record.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                    <span className="tabular w-24 shrink-0">{record.date}</span>
                    <span className="tabular flex-1 text-ink-muted">
                      {formatLocal(record.login_time, tz, 'HH:mm')}
                      {record.logout_time
                        ? ` – ${formatLocal(record.logout_time, tz, 'HH:mm')}`
                        : ' – active'}
                    </span>
                    {record.is_late ? <StatusChip status="late" label="Late" /> : null}
                    <span className="tabular w-16 shrink-0 text-right font-medium">
                      {formatHours(record.total_hours)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent leave</CardTitle>
            </CardHeader>
            {(leaves ?? []).length === 0 ? (
              <EmptyState title="No leave requests" description="Nothing applied for yet." />
            ) : (
              <ul className="divide-y divide-line">
                {(leaves ?? []).map((leave) => (
                  <li key={leave.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                    <span className="tabular flex-1">
                      {leave.start_date} → {leave.end_date}
                    </span>
                    <span className="tabular text-ink-muted">{leave.days}d</span>
                    <StatusChip status={leave.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Documents</CardTitle>
            </CardHeader>
            {(documents ?? []).length === 0 ? (
              <EmptyState
                icon={FileText}
                title="No documents"
                description="Files uploaded for this person appear here."
              />
            ) : (
              <ul className="divide-y divide-line">
                {(documents ?? []).map((doc) => (
                  <li key={doc.id} className="flex items-center gap-3 px-5 py-2.5">
                    <FileText className="size-4 shrink-0 text-ink-muted" aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {doc.file_name || 'Untitled'}
                    </span>
                    <Button asChild size="icon" variant="ghost" aria-label="Download">
                      <a
                        href={`/api/files/view?key=${encodeURIComponent(doc.file_url)}&download=${encodeURIComponent(
                          doc.file_name || 'document'
                        )}`}
                      >
                        <Download />
                      </a>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
