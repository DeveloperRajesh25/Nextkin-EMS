import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError, uuidSchema } from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { boardColumnSchema } from '@/lib/schemas'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

async function handlePATCH(request: NextRequest, { params }: Params) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const id = uuidSchema.parse((await params).id)
  const input = await parseBody(request, boardColumnSchema)
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('board_columns')
    .update({ name: input.name })
    .eq('id', id)
    .select('id')
    .maybeSingle()

  if (error) return jsonError(friendlyDbError(error), 400)
  if (!data) return jsonError('That column was not found.', 404)

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'board_column.renamed',
    entity: 'board_columns',
    entityId: id,
    meta: { name: input.name },
    request,
  })

  return jsonOk({ ok: true })
}

/**
 * Delete a column.
 *
 * Refused while it still holds tasks. `tasks.column_id` cascades on delete, so
 * removing a populated column would silently destroy the work in it — an
 * outcome nobody intends from a "remove column" click. Move the cards first.
 */
async function handleDELETE(request: NextRequest, { params }: Params) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const id = uuidSchema.parse((await params).id)
  const supabase = await createSupabaseServerClient()

  const { count } = await supabase
    .from('tasks')
    .select('id', { count: 'exact', head: true })
    .eq('column_id', id)

  if (count && count > 0) {
    return jsonError(
      `Move the ${count} ${count === 1 ? 'task' : 'tasks'} out of this column before deleting it.`,
      409
    )
  }

  const { error } = await supabase.from('board_columns').delete().eq('id', id)
  if (error) return jsonError(friendlyDbError(error), 400)

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'board_column.deleted',
    entity: 'board_columns',
    entityId: id,
    request,
  })

  return jsonOk({ ok: true })
}

export const PATCH = withErrorHandler(handlePATCH)
export const DELETE = withErrorHandler(handleDELETE)
