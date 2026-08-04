import type { Metadata } from 'next'
import Link from 'next/link'
import { KeyRound } from 'lucide-react'
import { requireEmployee } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/patterns'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ProfileForm } from './profile-form'

export const metadata: Metadata = { title: 'My profile' }
export const dynamic = 'force-dynamic'

export default async function EmployeeProfilePage() {
  const ctx = await requireEmployee()
  const supabase = await createSupabaseServerClient()

  const { data: profile } = await supabase
    .from('profiles')
    .select(
      'id, full_name, email, phone, photo_url, employee_code, designation, department_id, date_of_joining, timezone'
    )
    .eq('id', ctx.userId)
    .single()

  const { data: department } = profile?.department_id
    ? await supabase.from('departments').select('name').eq('id', profile.department_id).maybeSingle()
    : { data: null }

  return (
    <div className="space-y-6">
      <PageHeader title="My profile" description="Your details and how to reach you." />

      <div className="grid gap-5 lg:grid-cols-2">
        <ProfileForm
          profile={{
            fullName: profile?.full_name ?? '',
            phone: profile?.phone ?? '',
            photoUrl: profile?.photo_url ?? null,
            timezone: profile?.timezone ?? ctx.tenant.timezone,
          }}
        />

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Work details</CardTitle>
              <CardDescription>
                Set by your organization. Ask your manager if something is wrong.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-4 sm:grid-cols-2">
                {[
                  ['Email', profile?.email ?? '—'],
                  ['Employee code', profile?.employee_code ?? '—'],
                  ['Designation', profile?.designation ?? '—'],
                  ['Department', department?.name ?? '—'],
                  ['Date of joining', profile?.date_of_joining ?? '—'],
                  ['Organization', ctx.tenant.name],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-xs font-medium uppercase tracking-wider text-ink-muted">
                      {label}
                    </dt>
                    <dd className="mt-0.5 break-words text-sm">{value}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Security</CardTitle>
              <CardDescription>Change the password you sign in with.</CardDescription>
            </CardHeader>
            <CardFooter>
              <Button asChild variant="secondary">
                <Link href="/change-password">
                  <KeyRound />
                  Change password
                </Link>
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>
    </div>
  )
}
