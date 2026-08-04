import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { syncTenantCalendar } from '@/lib/calendar-sync'
import { safeEqual } from '@/lib/crypto'
import { rateLimit, limitKey, getClientIp } from '@/lib/rate-limit'
import type { Connection } from '@/lib/google-calendar'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Google Calendar push notification receiver.
 *
 * This endpoint is PUBLIC — Google will not send a bearer token, and it does not
 * sign the request. Authentication is therefore the channel token we chose when
 * subscribing, echoed back in `X-Goog-Channel-Token`, compared in constant time
 * against what we stored. Anyone can POST here; only a request carrying the
 * right token for a known channel causes work.
 *
 * The notification body carries NO event data by design (Google tells you
 * "something changed", not what). So the handler ignores the body entirely and
 * runs an incremental sync using the stored sync token.
 */
export async function POST(request: NextRequest) {
  // Always answer 200 quickly. A non-2xx makes Google retry with backoff and,
  // after enough failures, drop the channel entirely — losing live updates for
  // that org until the next reconnect.
  const ok = () => new NextResponse(null, { status: 200 })

  try {
    const channelHeader = request.headers.get('x-goog-channel-id')
    const tokenHeader = request.headers.get('x-goog-channel-token')
    const resourceState = request.headers.get('x-goog-resource-state')

    if (!channelHeader || !tokenHeader) return ok()

    // The handshake Google sends right after a watch call. Nothing has changed.
    if (resourceState === 'sync') return ok()

    // The endpoint is unauthenticated, so throttle it before touching the DB.
    const limited = await rateLimit(
      limitKey('gcal-webhook', getClientIp(request)),
      120,
      60 * 1000
    )
    if (!limited.ok) return ok()

    const admin = createAdminClient()

    // The channel id column stores `<channelId>:<channelToken>` — one lookup
    // finds the connection and the expected token together.
    const { data: connections, error } = await admin
      .from('calendar_connections')
      .select(
        'id, tenant_id, google_refresh_token_enc, google_channel_id, google_resource_id, channel_expires_at, sync_token, status'
      )
      .like('google_channel_id', `${channelHeader}%`)
      .limit(1)

    if (error || !connections?.length) return ok()

    const connection = connections[0] as Connection
    const [storedChannel, storedToken] = (connection.google_channel_id ?? '').split(':')

    if (storedChannel !== channelHeader || !storedToken || !safeEqual(tokenHeader, storedToken)) {
      // Wrong token for a real channel id — someone is guessing. Say nothing.
      console.warn('[gcal-webhook] channel token mismatch', channelHeader)
      return ok()
    }

    const result = await syncTenantCalendar(connection)
    if (result.status === 'error') {
      console.error('[gcal-webhook] sync error', result.tenantId, result.error)
    }

    return ok()
  } catch (err) {
    // Swallow: an exception here must not turn into a 500 that costs the org
    // its push channel.
    console.error('[gcal-webhook] unhandled', err)
    return ok()
  }
}
