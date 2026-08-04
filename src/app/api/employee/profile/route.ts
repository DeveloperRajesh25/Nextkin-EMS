import { NextRequest } from 'next/server'
import { z } from 'zod'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError } from '@/lib/api'
import { apiRequireTenantUser } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { keyBelongsToTenant } from '@/lib/r2'
import { isValidTimezone } from '@/lib/time'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/**
 * Self-service profile fields, and ONLY these.
 *
 * The schema is the first gate; `tg_profiles_guard` in 002_rls.sql is the real
 * one — it raises if a self-update touches role, is_active, department,
 * designation, employee code, joining date, or tenant. So even a request crafted
 * outside this schema cannot escalate anything.
 */
const schema = z.object({
  fullName: z.string().trim().min(2, 'Enter your name').max(120),
  phone: z.string().trim().max(32).optional(),
  photoKey: z.string().trim().max(300).optional(),
  timezone: z.string().trim().min(3).max(64),
})

async function handlePATCH(request: NextRequest) {
  const gate = await apiRequireTenantUser()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const input = await parseBody(request, schema)

  if (!isValidTimezone(input.timezone)) {
    return jsonError('That is not a recognised timezone.', 400)
  }
  if (input.photoKey && !keyBelongsToTenant(input.photoKey, ctx.tenantId)) {
    return jsonError('That file does not belong to this workspace.', 403)
  }

  const supabase = await createSupabaseServerClient()

  const { error } = await supabase
    .from('profiles')
    .update({
      full_name: input.fullName,
      phone: input.phone ?? null,
      photo_url: input.photoKey ?? null,
      timezone: input.timezone,
    })
    .eq('id', ctx.userId)

  if (error) return jsonError(friendlyDbError(error), 400)

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'profile.updated',
    entity: 'profiles',
    entityId: ctx.userId,
    request,
  })

  return jsonOk({ ok: true })
}

export const PATCH = withErrorHandler(handlePATCH)
