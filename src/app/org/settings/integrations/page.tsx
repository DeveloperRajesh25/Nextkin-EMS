import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { requireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/patterns'
import { Button } from '@/components/ui/button'
import { isCalendarConfigured } from '@/lib/google-calendar'
import { CalendarConnection } from './calendar-connection'

export const metadata: Metadata = { title: 'Integrations' }
export const dynamic = 'force-dynamic'

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string; warning?: string }>
}) {
  const ctx = await requireOrg()
  const supabase = await createSupabaseServerClient()
  const params = await searchParams

  /*
   * Explicit column list, not `select('*')`.
   *
   * `google_refresh_token_enc` is revoked from the `authenticated` role at the
   * COLUMN level (002_rls.sql), so a `select('*')` on this table fails outright
   * for a user-scoped client. That is deliberate: RLS controls which rows you
   * see, and only a column privilege can keep a ciphertext out of a client
   * query entirely.
   */
  const { data: connection } = await supabase
    .from('calendar_connections')
    .select('id, google_email, status, last_synced_at, channel_expires_at, created_at')
    .maybeSingle()

  return (
    <div className="space-y-6">
      <PageHeader
        title="Integrations"
        description="Connect the tools your team already uses."
        actions={
          <Button asChild variant="secondary">
            <Link href="/org/settings">
              <ArrowLeft />
              Back to settings
            </Link>
          </Button>
        }
      />

      <CalendarConnection
        connection={connection}
        configured={isCalendarConfigured()}
        timezone={ctx.tenant.timezone}
        notice={{
          connected: params.connected === '1',
          error: params.error,
          warning: params.warning,
        }}
      />
    </div>
  )
}
