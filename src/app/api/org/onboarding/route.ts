import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError } from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { onboardingDraftSchema } from '@/lib/schemas'
import { toColumns, OnboardingPatchError } from '@/lib/onboarding-server'
import { rateLimit, limitKey } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/**
 * Start an onboarding draft.
 *
 * Nothing is created in `auth.users` here — a draft is org-side paperwork about
 * a person who does not have an account yet, and will not until the wizard's
 * final step. The row is written with the USER-SCOPED client so the RLS
 * `WITH CHECK` proves the tenant, rather than this handler asserting it.
 */
async function handlePOST(request: NextRequest) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  // Drafts are cheap but not free — one abandoned row per keystroke would be a
  // denial-of-wallet on the org's own list.
  const limited = await rateLimit(limitKey('onboarding-draft', ctx.userId), 60, 60 * 60 * 1000)
  if (!limited.ok) {
    return jsonError('You have started a lot of onboardings recently. Please try again later.', 429)
  }

  const input = await parseBody(request, onboardingDraftSchema)

  let patch: Record<string, unknown>
  try {
    patch = toColumns(input)
  } catch (err) {
    if (err instanceof OnboardingPatchError) return jsonError(err.message, err.status)
    throw err
  }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('employee_onboarding')
    .insert({
      ...patch,
      tenant_id: ctx.tenantId,
      created_by: ctx.userId,
      status: 'draft',
    })
    .select('id')
    .single()

  if (error) return jsonError(friendlyDbError(error), 400)

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'onboarding.draft_started',
    entity: 'employee_onboarding',
    entityId: data.id,
    request,
  })

  return jsonOk({ id: data.id }, 201)
}

export const POST = withErrorHandler(handlePOST)
