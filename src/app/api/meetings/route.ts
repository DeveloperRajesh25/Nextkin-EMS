import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError } from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { meetingSchema } from '@/lib/schemas'
import { getAccessToken, createEvent, meetingToEvent } from '@/lib/google-calendar'
import { audit } from '@/lib/audit'
import type { Connection } from '@/lib/google-calendar'

export const dynamic = 'force-dynamic'

/**
 * Create a meeting, and mirror it to Google when the tenant is connected.
 *
 * ORDER: our row first, Google second. If Google is down, slow, or the token has
 * expired, the meeting still exists in this product and simply syncs on the next
 * pass. Doing it the other way round would make an outage at Google an outage
 * here — and could leave an event on their calendar that we have no record of.
 */
async function handlePOST(request: NextRequest) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const input = await parseBody(request, meetingSchema)
  const supabase = await createSupabaseServerClient()

  const { data: meeting, error } = await supabase
    .from('meetings')
    .insert({
      tenant_id: ctx.tenantId,
      title: input.title,
      description: input.description,
      location: input.location,
      start_time: input.startTime,
      end_time: input.endTime,
      attendees: input.attendees,
      organizer_id: ctx.userId,
      source: 'app',
      read_only: false,
    })
    .select('id, title, description, location, start_time, end_time')
    .single()

  if (error) return jsonError(friendlyDbError(error), 400)

  const googleEventId = await pushToGoogle(ctx.tenantId, {
    ...meeting,
    attendees: input.attendees,
  })

  if (googleEventId) {
    await supabase.from('meetings').update({ google_event_id: googleEventId }).eq('id', meeting.id)
  }

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'meeting.created',
    entity: 'meetings',
    entityId: meeting.id,
    meta: { syncedToGoogle: !!googleEventId },
    request,
  })

  return jsonOk({ id: meeting.id, syncedToGoogle: !!googleEventId }, 201)
}

/**
 * Push a new meeting to Google. Returns the event id, or null when the tenant is
 * not connected or the call failed — never throws into the create path.
 */
async function pushToGoogle(
  tenantId: string,
  meeting: {
    title: string
    description: string | null
    location: string | null
    start_time: string
    end_time: string
    attendees: Array<{ email: string; name?: string }>
  }
): Promise<string | null> {
  try {
    const admin = createAdminClient()
    const { data } = await admin
      .from('calendar_connections')
      .select(
        'id, tenant_id, google_refresh_token_enc, google_channel_id, google_resource_id, channel_expires_at, sync_token, status'
      )
      .eq('tenant_id', tenantId)
      .eq('status', 'connected')
      .maybeSingle()

    if (!data) return null

    const accessToken = await getAccessToken(admin, data as Connection)
    if (!accessToken) return null

    const result = await createEvent(accessToken, meetingToEvent(meeting))
    if (!result.ok) {
      console.warn('[meetings] Google create failed', result.status, result.detail)
      return null
    }
    return result.data.id ?? null
  } catch (err) {
    console.warn('[meetings] Google push failed; meeting saved locally', err)
    return null
  }
}

export const POST = withErrorHandler(handlePOST)
