import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError } from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { boardColumnSchema } from '@/lib/schemas'
import { audit } from '@/lib/audit'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const createSchema = boardColumnSchema.extend({ boardId: z.string().uuid() })

async function handlePOST(request: NextRequest) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const input = await parseBody(request, createSchema)
  const supabase = await createSupabaseServerClient()

  const { data: board } = await supabase
    .from('boards')
    .select('id')
    .eq('id', input.boardId)
    .maybeSingle()
  if (!board) return jsonError('That board was not found.', 404)

  const { data: last } = await supabase
    .from('board_columns')
    .select('position')
    .eq('board_id', input.boardId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data, error } = await supabase
    .from('board_columns')
    .insert({
      tenant_id: ctx.tenantId,
      board_id: input.boardId,
      name: input.name,
      position: (last?.position ?? -1) + 1,
    })
    .select('id, name, position')
    .single()

  if (error) return jsonError(friendlyDbError(error), 400)

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'board_column.created',
    entity: 'board_columns',
    entityId: data.id,
    meta: { name: data.name },
    request,
  })

  return jsonOk(data, 201)
}

export const POST = withErrorHandler(handlePOST)
