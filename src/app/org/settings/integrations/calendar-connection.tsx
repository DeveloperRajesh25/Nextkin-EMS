'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { CalendarDays, RefreshCw, Unplug } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { StatusChip } from '@/components/ui/patterns'
import { FormError, FormSuccess } from '@/components/ui/form-field'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/primitives'
import { apiPost, ApiClientError } from '@/lib/fetcher'
import { formatLocal } from '@/lib/time'
import type { CalendarStatus } from '@/types/db'

interface ConnectionRow {
  id: string
  google_email: string | null
  status: CalendarStatus
  last_synced_at: string | null
  channel_expires_at: string | null
  created_at: string
}

export function CalendarConnection({
  connection, configured, timezone, notice,
}: {
  connection: ConnectionRow | null
  configured: boolean
  timezone: string
  notice: { connected: boolean; error?: string; warning?: string }
}) {
  const router = useRouter()
  const [confirming, setConfirming] = React.useState(false)
  const [busy, setBusy] = React.useState(false)

  async function onDisconnect() {
    setBusy(true)
    try {
      await apiPost('/api/integrations/google/disconnect')
      toast.success('Google Calendar disconnected')
      setConfirming(false)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  const needsReauth = connection?.status === 'needs_reauth'

  return (
    <>
      <Card className="max-w-2xl">
        <CardHeader className="flex-row items-start gap-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600">
            <CalendarDays className="size-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <CardTitle>Google Calendar</CardTitle>
            <CardDescription>
              Two-way sync. Meetings created here appear in Google, and changes made in
              Google flow back automatically.
            </CardDescription>
          </div>
          {connection ? <StatusChip status={connection.status} /> : null}
        </CardHeader>

        <CardContent className="space-y-4">
          {notice.connected ? <FormSuccess message="Google Calendar is connected." /> : null}
          {notice.error ? <FormError message={notice.error} /> : null}
          {notice.warning ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm text-amber-800">
              {notice.warning}
            </p>
          ) : null}

          {!configured ? (
            <p className="rounded-lg bg-page px-4 py-3.5 text-sm leading-relaxed text-ink-muted">
              This deployment does not have Google Calendar configured. An administrator needs to
              set <code className="font-mono text-xs">GOOGLE_CLIENT_ID</code>,{' '}
              <code className="font-mono text-xs">GOOGLE_CLIENT_SECRET</code>,{' '}
              <code className="font-mono text-xs">GOOGLE_REDIRECT_URI</code> and a valid{' '}
              <code className="font-mono text-xs">GOOGLE_TOKEN_ENCRYPTION_KEY</code>.
            </p>
          ) : connection ? (
            <dl className="grid gap-3 rounded-lg bg-page p-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wider text-ink-muted">
                  Account
                </dt>
                <dd className="mt-0.5 truncate">{connection.google_email || 'Connected'}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wider text-ink-muted">
                  Last synced
                </dt>
                <dd className="mt-0.5">
                  {connection.last_synced_at
                    ? formatLocal(connection.last_synced_at, timezone, 'd MMM, HH:mm')
                    : 'Not yet'}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wider text-ink-muted">
                  Live updates
                </dt>
                <dd className="mt-0.5">
                  {connection.channel_expires_at
                    ? `Active until ${formatLocal(connection.channel_expires_at, timezone, 'd MMM')}`
                    : 'Polling every 15 minutes'}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wider text-ink-muted">
                  Connected
                </dt>
                <dd className="mt-0.5">{formatLocal(connection.created_at, timezone, 'd MMM yyyy')}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm leading-relaxed text-ink-muted">
              We ask only for permission to read and write calendar events — not to create,
              share or delete your calendars. Your access is stored encrypted and can be
              revoked here at any time.
            </p>
          )}

          {needsReauth ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm leading-relaxed text-amber-800">
              Google is no longer accepting our stored access — usually because the permission was
              revoked in the Google account. Reconnect to resume syncing.
            </p>
          ) : null}
        </CardContent>

        {configured ? (
          <CardFooter>
            {connection && !needsReauth ? (
              <>
                <Button variant="secondary" asChild>
                  <a href="/api/integrations/google/connect">
                    <RefreshCw />
                    Reconnect
                  </a>
                </Button>
                <Button variant="ghost" onClick={() => setConfirming(true)}>
                  <Unplug />
                  Disconnect
                </Button>
              </>
            ) : (
              <Button asChild>
                <a href="/api/integrations/google/connect">
                  <CalendarDays />
                  {needsReauth ? 'Reconnect Google Calendar' : 'Connect Google Calendar'}
                </a>
              </Button>
            )}
          </CardFooter>
        ) : null}
      </Card>

      <Dialog open={confirming} onOpenChange={(open) => !open && setConfirming(false)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Disconnect Google Calendar?</DialogTitle>
            <DialogDescription>
              Meetings already synced are kept — they stay in your workspace. New changes will
              stop flowing in either direction.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirming(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" loading={busy} onClick={onDisconnect}>
              Disconnect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
