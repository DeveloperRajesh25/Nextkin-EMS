import { NextRequest } from 'next/server'
import { withErrorHandler, jsonOk } from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { decryptToken } from '@/lib/crypto'
import { getAccessToken, stopChannel, revokeToken } from '@/lib/google-calendar'
import { audit } from '@/lib/audit'
import type { Connection } from '@/lib/google-calendar'

export const dynamic = 'force-dynamic'

/**
 * Disconnect the tenant's Google Calendar.
 *
 * Best-effort cleanup ON GOOGLE'S SIDE first (stop the push channel, revoke the
 * grant), then delete the local record — but a failure at Google never blocks
 * the disconnect. Leaving an org unable to disconnect because a remote call
 * timed out would be the worse outcome; a stale channel simply stops resolving
 * to a connection and its notifications are ignored.
 *
 * Meetings already pulled from Google are KEPT. They are real entries in the
 * org's calendar; disconnecting an integration should not delete their history.
 */
async function handlePOST(request: NextRequest) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const admin = createAdminClient()

  const { data } = await admin
    .from('calendar_connections')
    .select(
      'id, tenant_id, google_refresh_token_enc, google_channel_id, google_resource_id, channel_expires_at, sync_token, status'
    )
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle()

  if (data) {
    const connection = data as Connection

    try {
      const accessToken = await getAccessToken(admin, connection)
      const [channelId] = (connection.google_channel_id ?? '').split(':')

      if (accessToken && channelId && connection.google_resource_id) {
        await stopChannel(accessToken, channelId, connection.google_resource_id)
      }
      // Revoking the REFRESH token invalidates the whole grant, so the org sees
      // the app disappear from their Google permissions too.
      await revokeToken(decryptToken(connection.google_refresh_token_enc))
    } catch (err) {
      console.warn('[google/disconnect] remote cleanup failed; disconnecting anyway', err)
    }

    await admin.from('calendar_connections').delete().eq('tenant_id', ctx.tenantId)
  }

  // The events stay, but nothing pushes them any more, so drop the link that
  // would otherwise make them look synced.
  await admin
    .from('meetings')
    .update({ google_event_id: null, read_only: false })
    .eq('tenant_id', ctx.tenantId)
    .not('google_event_id', 'is', null)

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'calendar.disconnected',
    entity: 'calendar_connections',
    request,
  })

  return jsonOk({ ok: true })
}

export const POST = withErrorHandler(handlePOST)
