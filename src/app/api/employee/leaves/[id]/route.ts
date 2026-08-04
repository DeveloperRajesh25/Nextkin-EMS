import { NextRequest } from 'next/server'
import { withErrorHandler, jsonOk, jsonError, friendlyDbError, uuidSchema } from '@/lib/api'
import { apiRequireEmployee } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * Withdraw a leave request.
 *
 * Employees get DELETE rather than UPDATE on `leaves`, and the policy limits it
 * to their own rows with `status = 'pending'`. That is deliberate: giving them
 * UPDATE would open a path to writing `status = 'approved'` themselves, and no
 * WITH CHECK expression can distinguish "withdrawing" from "self-approving" once
 * the verb is the same. Withdraw-by-delete has no such ambiguity.
 */
async function handleDELETE(request: NextRequest, { params }: Params) {
  const gate = await apiRequireEmployee()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const id = uuidSchema.parse((await params).id)
  const supabase = await createSupabaseServerClient()

  const { data: leave } = await supabase
    .from('leaves')
    .select('id, status, start_date, end_date')
    .eq('id', id)
    .eq('employee_id', ctx.userId)
    .maybeSingle()

  if (!leave) return jsonError('That request was not found.', 404)
  if (leave.status !== 'pending') {
    return jsonError('That request has already been decided and cannot be withdrawn.', 409)
  }

  const { error } = await supabase.from('leaves').delete().eq('id', id)
  if (error) return jsonError(friendlyDbError(error), 400)

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'leave.withdrawn',
    entity: 'leaves',
    entityId: id,
    meta: { startDate: leave.start_date, endDate: leave.end_date },
    request,
  })

  return jsonOk({ ok: true })
}

export const DELETE = withErrorHandler(handleDELETE)
