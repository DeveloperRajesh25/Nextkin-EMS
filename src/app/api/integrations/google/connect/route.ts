import { NextRequest, NextResponse } from 'next/server'
import { randomUUID, createHash } from 'crypto'
import { withErrorHandler, jsonError } from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { buildAuthUrl, isCalendarConfigured } from '@/lib/google-calendar'
import { isEncryptionConfigured } from '@/lib/crypto'

export const dynamic = 'force-dynamic'

export const STATE_COOKIE = 'gcal_oauth_state'

/**
 * Start the Google OAuth flow.
 *
 * THE STATE COOKIE IS CSRF PROTECTION, not decoration. Without it, an attacker
 * can send an org owner a crafted `/callback?code=…` link carrying a code for
 * the ATTACKER'S Google account — the org would end up syncing its meetings into
 * a calendar someone else controls. The random state is stored httpOnly here and
 * must match on the way back, so a callback the browser did not initiate is
 * rejected.
 *
 * The tenant id is bound into the state too: the callback then knows which
 * workspace consented without trusting a query parameter.
 */
async function handleGET(request: NextRequest) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  if (!isCalendarConfigured()) {
    // Fail BEFORE sending the user to Google. Discovering a broken encryption
    // key after they have already granted access means a confusing dead end and
    // a stray authorization on their account.
    const reason = !isEncryptionConfigured()
      ? 'the token encryption key is missing or malformed'
      : 'the Google client credentials are not set'
    return jsonError(`Google Calendar is not configured: ${reason}.`, 503)
  }

  const nonce = randomUUID()
  // The state Google echoes back carries the tenant; the cookie holds only a
  // digest of the nonce, so the value in transit is not the value at rest.
  const state = Buffer.from(JSON.stringify({ n: nonce, t: ctx.tenantId })).toString('base64url')
  const digest = createHash('sha256').update(nonce).digest('base64url')

  const response = NextResponse.redirect(buildAuthUrl(state))
  response.cookies.set(STATE_COOKIE, digest, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax', // must survive the top-level redirect back from Google
    path: '/',
    maxAge: 600, // 10 minutes is ample for a consent screen
  })

  return response
}

export const GET = withErrorHandler(handleGET)
