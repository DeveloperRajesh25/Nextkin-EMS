import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError } from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { taskSchema } from '@/lib/schemas'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/** Create a task. Org only — employees move and update, they do not create. */
async function handlePOST(request: NextRequest) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const input = await parseBody(request, taskSchema)
  const supabase = await createSupabaseServerClient()

  // Board and column ids arrive from the client. RLS makes a foreign id resolve
  // to nothing, so these lookups double as the tenant check.
  const { data: column } = await supabase
    .from('board_columns')
    .select('id, board_id')
    .eq('id', input.columnId)
    .eq('board_id', input.boardId)
    .maybeSingle()

  if (!column) return jsonError('That column was not found.', 404)

  // New tasks go to the BOTTOM of the column: read the current largest position
  // and add a gap. Positions are fractional, so inserts and drags never need a
  // renumbering pass over the whole column.
  const { data: last } = await supabase
    .from('tasks')
    .select('position')
    .eq('column_id', input.columnId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()

  const position = (last?.position ?? 0) + 1000

  const { data: task, error } = await supabase
    .from('tasks')
    .insert({
      tenant_id: ctx.tenantId,
      board_id: input.boardId,
      column_id: input.columnId,
      title: input.title,
      description: input.description,
      position,
      priority: input.priority,
      due_date: input.dueDate ?? null,
      created_by: ctx.userId,
    })
    .select('id')
    .single()

  if (error) return jsonError(friendlyDbError(error), 400)

  if (input.assigneeIds.length) {
    // Only real members of THIS tenant can be assigned. RLS filters the select,
    // so anything that survives is legitimately assignable.
    const { data: members } = await supabase
      .from('profiles')
      .select('id')
      .in('id', input.assigneeIds)
      .eq('is_active', true)

    const rows = (members ?? []).map((m) => ({
      task_id: task.id,
      profile_id: m.id,
      tenant_id: ctx.tenantId,
    }))

    if (rows.length) {
      const { error: assignError } = await supabase.from('task_assignees').insert(rows)
      if (assignError) console.error('[tasks] assignment failed', assignError.message)
    }
  }

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'task.created',
    entity: 'tasks',
    entityId: task.id,
    meta: { assignees: input.assigneeIds.length },
    request,
  })

  return jsonOk({ id: task.id }, 201)
}

export const POST = withErrorHandler(handlePOST)
