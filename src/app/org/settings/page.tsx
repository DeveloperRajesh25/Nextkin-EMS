import type { Metadata } from 'next'
import Link from 'next/link'
import { CalendarDays } from 'lucide-react'
import { requireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/patterns'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { SettingsForm } from './settings-form'
import { DepartmentManager } from './department-manager'

export const metadata: Metadata = { title: 'Settings' }
export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const ctx = await requireOrg()
  const supabase = await createSupabaseServerClient()

  const { data: departments } = await supabase
    .from('departments')
    .select('id, name')
    .order('name')

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Branding, working hours and departments for your workspace."
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <SettingsForm
          tenant={{
            name: ctx.tenant.name,
            primaryColor: ctx.tenant.primaryColor,
            timezone: ctx.tenant.timezone,
            workStartTime: ctx.tenant.workStartTime,
            logoUrl: ctx.tenant.logoUrl,
          }}
        />

        <div className="space-y-5">
          <DepartmentManager departments={departments ?? []} />

          <Card>
            <CardHeader>
              <CardTitle>Integrations</CardTitle>
              <CardDescription>Connect Google Calendar for two-way meeting sync.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="secondary">
                <Link href="/org/settings/integrations">
                  <CalendarDays />
                  Manage integrations
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
