import { NextRequest } from 'next/server'
import { withErrorHandler, jsonOk, jsonError, friendlyDbError, uuidSchema } from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { deleteObject } from '@/lib/r2'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

async function handleDELETE(request: NextRequest, { params }: Params) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const id = uuidSchema.parse((await params).id)
  const supabase = await createSupabaseServerClient()

  const { data: payslip } = await supabase
    .from('payslips')
    .select('id, file_url, employee_id, month, year')
    .eq('id', id)
    .maybeSingle()

  if (!payslip) return jsonError('That payslip was not found.', 404)

  const { error } = await supabase.from('payslips').delete().eq('id', id)
  if (error) return jsonError(friendlyDbError(error), 400)

  // Row first, then the object: if the delete of the object fails we are left
  // with an orphan (harmless, invisible), whereas the reverse order could leave
  // a row pointing at nothing the employee can open.
  await deleteObject(payslip.file_url)

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'payslip.deleted',
    entity: 'payslips',
    entityId: id,
    meta: { employeeId: payslip.employee_id, month: payslip.month, year: payslip.year },
    request,
  })

  return jsonOk({ ok: true })
}

export const DELETE = withErrorHandler(handleDELETE)
