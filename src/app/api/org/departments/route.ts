import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError } from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { departmentSchema } from '@/lib/schemas'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/**
 * Create a department.
 *
 * Written with the USER-SCOPED client, so the RLS `WITH CHECK` on
 * `departments_write` is what proves the tenant_id is the caller's own — the
 * value below is taken from the verified session, never from the request.
 */
async function handlePOST(request: NextRequest) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const input = await parseBody(request, departmentSchema)
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('departments')
    .insert({ tenant_id: ctx.tenantId, name: input.name })
    .select('id, name')
    .single()

  if (error) {
    if (error.code === '23505') {
      return jsonError('You already have a department with that name.', 409)
    }
    return jsonError(friendlyDbError(error), 400)
  }

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'department.created',
    entity: 'departments',
    entityId: data.id,
    meta: { name: data.name },
    request,
  })

  return jsonOk(data, 201)
}

export const POST = withErrorHandler(handlePOST)
