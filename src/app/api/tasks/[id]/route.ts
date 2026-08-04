import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError, uuidSchema } from '@/lib/api'
import { apiRequireOrg, apiRequireTenantUser } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { moveTaskSchema } from '@/lib/schemas'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * Move a task (drag-drop persist).
 *
 * ROLE RULE, ENFORCED TWICE: the org may move any card, an employee only cards
 * assigned to them. The UI hides what it should — but the binding constraint is
 * the `tasks_update` policy, which calls `app.is_task_assignee(id)`. This route
 * does not re-implement that check; it lets the update return no rows and reads
 * that as "not allowed", so there is exactly one definition of the rule.
 *
 * `position` is fractional. Dropping between two cards writes the average of
 * their positions, so ONE row changes instead of renumbering the column — which
 * matters both for latency and for how much Realtime traffic a drag produces.
 */
async function handlePATCH(request: NextRequest, { params }: Params) {
  const gate = await apiRequireTenantUser()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const id = uuidSchema.parse((await params).id)
  const input = await parseBody(request, moveTaskSchema)
  const supabase = await createSupabaseServerClient()

  const { data: column } = await supabase
    .from('board_columns')
    .select('id')
    .eq('id', input.columnId)
    .maybeSingle()
  if (!column) return jsonError('That column was not found.', 404)

  const { data, error } = await supabase
    .from('tasks')
    .update({ column_id: input.columnId, position: input.position })
    .eq('id', id)
    .select('id')
    .maybeSingle()

  if (error) return jsonError(friendlyDbError(error), 400)
  // No row came back: either it does not exist, or the policy refused. Both are
  // a 403 from the caller's point of view — distinguishing them would leak
  // whether a task id is real.
  if (!data) {
    return jsonError('You can only move tasks that are assigned to you.', 403)
  }

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'task.moved',
    entity: 'tasks',
    entityId: id,
    meta: { columnId: input.columnId },
    request,
  })

  return jsonOk({ ok: true })
}

async function handleDELETE(request: NextRequest, { params }: Params) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const id = uuidSchema.parse((await params).id)
  const supabase = await createSupabaseServerClient()

  const { error } = await supabase.from('tasks').delete().eq('id', id)
  if (error) return jsonError(friendlyDbError(error), 400)

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'task.deleted',
    entity: 'tasks',
    entityId: id,
    request,
  })

  return jsonOk({ ok: true })
}

export const PATCH = withErrorHandler(handlePATCH)
export const DELETE = withErrorHandler(handleDELETE)
