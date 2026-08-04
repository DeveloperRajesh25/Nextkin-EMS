import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError, uuidSchema } from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { workAuthSchema } from '@/lib/schemas'
import { keyBelongsToTenant } from '@/lib/r2'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

async function handlePATCH(request: NextRequest, { params }: Params) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const id = uuidSchema.parse((await params).id)
  const input = await parseBody(request, workAuthSchema)

  if (input.documentKey && !keyBelongsToTenant(input.documentKey, ctx.tenantId)) {
    return jsonError('That file does not belong to this workspace.', 403)
  }

  const supabase = await createSupabaseServerClient()

  const { data: existing } = await supabase
    .from('work_authorizations')
    .select('id, expiry_date')
    .eq('id', id)
    .maybeSingle()
  if (!existing) return jsonError('That record was not found.', 404)

  const { error } = await supabase
    .from('work_authorizations')
    .update({
      visa_type: input.visaType,
      visa_number: input.visaNumber,
      start_date: input.startDate ?? null,
      expiry_date: input.expiryDate,
      document_url: input.documentKey,
      notes: input.notes,
    })
    .eq('id', id)

  if (error) return jsonError(friendlyDbError(error), 400)

  /*
   * An extended visa clears its reminder ledger.
   *
   * `visa_reminder_logs` is what makes the cron idempotent — a milestone already
   * logged is never sent again, forever. That is exactly right while the expiry
   * date is unchanged, and exactly wrong once it moves: an H-1B extended by two
   * years would otherwise never trigger its 90/30/7/0 reminders again, because
   * the old rows still say "already sent". Clearing them on a date change is
   * what keeps the ledger a record of THIS expiry rather than of the row's whole
   * history. It is written with the same user-scoped client, so RLS still
   * confines it to this tenant.
   */
  if (existing.expiry_date !== input.expiryDate) {
    const { error: clearError } = await supabase
      .from('visa_reminder_logs')
      .delete()
      .eq('work_auth_id', id)
    if (clearError) {
      console.error('[visa] could not reset reminder ledger', clearError.message)
    }
  }

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'work_auth.updated',
    entity: 'work_authorizations',
    entityId: id,
    meta: {
      expiryDate: input.expiryDate,
      remindersReset: existing.expiry_date !== input.expiryDate,
    },
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

  const { error } = await supabase.from('work_authorizations').delete().eq('id', id)
  if (error) return jsonError(friendlyDbError(error), 400)

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'work_auth.deleted',
    entity: 'work_authorizations',
    entityId: id,
    request,
  })

  return jsonOk({ ok: true })
}

export const PATCH = withErrorHandler(handlePATCH)
export const DELETE = withErrorHandler(handleDELETE)
