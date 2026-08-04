import type { Metadata } from 'next'
import { requireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/patterns'
import { MeetingsWorkspace } from './meetings-workspace'
import type { Meeting } from '@/types/db'

export const metadata: Metadata = { title: 'Meetings' }
export const dynamic = 'force-dynamic'

export default async function MeetingsPage() {
  const ctx = await requireOrg()
  const supabase = await createSupabaseServerClient()

  // Explicit columns — the encrypted token column is not readable by the
  // `authenticated` role, so `select('*')` on this table would fail.
  const [{ data: meetings }, { data: connection }] = await Promise.all([
    supabase
      .from('meetings')
      .select('*')
      .order('start_time', { ascending: true })
      .gte('start_time', new Date(Date.now() - 30 * 86_400_000).toISOString())
      .limit(300),
    supabase.from('calendar_connections').select('id, status, google_email').maybeSingle(),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Meetings"
        description="Everything on the workspace calendar, in sync with Google both ways."
      />
      <MeetingsWorkspace
        meetings={(meetings ?? []) as Meeting[]}
        connected={connection?.status === 'connected'}
        timezone={ctx.tenant.timezone}
      />
    </div>
  )
}
