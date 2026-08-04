import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError } from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { tenantSettingsSchema, onboardingSchema } from '@/lib/schemas'
import { isValidTimezone } from '@/lib/time'
import { keyBelongsToTenant } from '@/lib/r2'
import { audit } from '@/lib/audit'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const patchSchema = tenantSettingsSchema.extend({
  logoKey: z.string().trim().max(300).nullable().optional(),
})

/** Update workspace settings: name, branding, timezone, shift start. */
async function handlePATCH(request: NextRequest) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const input = await parseBody(request, patchSchema)

  // An invalid IANA zone would silently corrupt every attendance day boundary
  // and the visa day-diff, so it is rejected here rather than trusted.
  if (!isValidTimezone(input.timezone)) {
    return jsonError('That is not a recognised timezone.', 400)
  }
  if (input.logoKey && !keyBelongsToTenant(input.logoKey, ctx.tenantId)) {
    return jsonError('That file does not belong to this workspace.', 403)
  }

  const supabase = await createSupabaseServerClient()

  const patch: Record<string, unknown> = {
    name: input.name,
    primary_color: input.primaryColor,
    timezone: input.timezone,
    work_start_time: input.workStartTime,
  }
  if (input.logoKey !== undefined) patch.logo_url = input.logoKey

  // RLS restricts this to `id = app.current_tenant_id()`; the filter mirrors it
  // so the intent is legible at the call site too.
  const { error } = await supabase.from('tenants').update(patch).eq('id', ctx.tenantId)
  if (error) return jsonError(friendlyDbError(error), 400)

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'tenant.settings_updated',
    entity: 'tenants',
    entityId: ctx.tenantId,
    meta: { timezone: input.timezone, workStartTime: input.workStartTime },
    request,
  })

  return jsonOk({ ok: true })
}

/** Complete first-run onboarding: branding, timezone, first department. */
async function handlePOST(request: NextRequest) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const input = await parseBody(request, onboardingSchema)
  if (!isValidTimezone(input.timezone)) {
    return jsonError('That is not a recognised timezone.', 400)
  }

  const supabase = await createSupabaseServerClient()

  const { error } = await supabase
    .from('tenants')
    .update({
      primary_color: input.primaryColor,
      timezone: input.timezone,
      onboarded_at: new Date().toISOString(),
    })
    .eq('id', ctx.tenantId)

  if (error) return jsonError(friendlyDbError(error), 400)

  // Best effort — a duplicate name should not block finishing onboarding.
  const { error: deptError } = await supabase
    .from('departments')
    .insert({ tenant_id: ctx.tenantId, name: input.departmentName })
  if (deptError && deptError.code !== '23505') {
    console.error('[onboarding] department insert failed', deptError.message)
  }

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'tenant.onboarded',
    entity: 'tenants',
    entityId: ctx.tenantId,
    request,
  })

  return jsonOk({ ok: true })
}

export const PATCH = withErrorHandler(handlePATCH)
export const POST = withErrorHandler(handlePOST)
