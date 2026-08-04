import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError, uuidSchema } from '@/lib/api'
import { apiRequireSuperAdmin } from '@/lib/auth/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { tenantStatusSchema } from '@/lib/schemas'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * Suspend or reactivate an organization.
 *
 * WHY THIS USES THE ADMIN CLIENT: the super admin's RLS bypass is READ-ONLY by
 * design (only SELECT policies mention `app.is_super_admin()`), so there is no
 * policy under which they can UPDATE a tenant. Writing through the service role,
 * behind `requireSuperAdmin()`, keeps that property intact — the read-only rule
 * is not weakened just to make one button work.
 *
 * Suspension bites IMMEDIATELY and for everyone in that workspace:
 * `app.is_active_member()` joins tenants and requires `status = 'active'`, and
 * it is evaluated live on every policy check. Nobody waits for a token to expire.
 */
async function handlePATCH(request: NextRequest, { params }: Params) {
  const gate = await apiRequireSuperAdmin()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const tenantId = uuidSchema.parse((await params).id)
  const input = await parseBody(request, tenantStatusSchema)

  const admin = createAdminClient()

  const { data: tenant } = await admin
    .from('tenants')
    .select('id, name, status')
    .eq('id', tenantId)
    .maybeSingle()

  if (!tenant) return jsonError('That organization was not found.', 404)
  if (tenant.status === input.status) {
    return jsonOk({ ok: true, unchanged: true })
  }

  const { error } = await admin
    .from('tenants')
    .update({ status: input.status })
    .eq('id', tenantId)

  if (error) return jsonError(friendlyDbError(error), 400)

  await audit({
    // A platform-level action against a specific tenant: recorded against that
    // tenant so its own audit view shows it too.
    tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: input.status === 'suspended' ? 'tenant.suspended' : 'tenant.reactivated',
    entity: 'tenants',
    entityId: tenantId,
    meta: { name: tenant.name, reason: input.reason },
    request,
  })

  return jsonOk({ ok: true })
}

export const PATCH = withErrorHandler(handlePATCH)
