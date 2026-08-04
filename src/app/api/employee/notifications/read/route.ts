import { NextRequest } from 'next/server'
import { z } from 'zod'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError } from '@/lib/api'
import { apiRequireTenantUser } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const schema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
})

/**
 * Record read receipts.
 *
 * Upsert rather than insert: `notification_reads` is keyed on
 * `(notification_id, user_id)`, so a second click (or two tabs) resolves to the
 * same row instead of a unique-violation the user would see as an error.
 *
 * `user_id` comes from the SESSION, never the body — the RLS `WITH CHECK`
 * enforces the same thing, so marking someone else's notifications read is not
 * expressible.
 */
async function handlePOST(request: NextRequest) {
  const gate = await apiRequireTenantUser()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const { ids } = await parseBody(request, schema)
  const supabase = await createSupabaseServerClient()

  // Only notifications this user can actually SELECT survive the policy, so a
  // foreign id silently drops out rather than creating a stray receipt.
  const { data: visible } = await supabase.from('notifications').select('id').in('id', ids)

  const rows = (visible ?? []).map((n) => ({
    notification_id: n.id,
    user_id: ctx.userId,
    tenant_id: ctx.tenantId,
  }))

  if (!rows.length) return jsonOk({ marked: 0 })

  const { error } = await supabase
    .from('notification_reads')
    .upsert(rows, { onConflict: 'notification_id,user_id', ignoreDuplicates: true })

  if (error) return jsonError(friendlyDbError(error), 400)

  return jsonOk({ marked: rows.length })
}

export const POST = withErrorHandler(handlePOST)
