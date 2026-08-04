import { NextRequest, NextResponse } from 'next/server'
import { withErrorHandler, jsonError } from '@/lib/api'
import { apiRequireUser } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { keyBelongsToTenant, presignGet } from '@/lib/r2'

export const dynamic = 'force-dynamic'

/**
 * The ONLY way a stored file is ever read.
 *
 * The bucket is private, so there is no URL anyone can share, bookmark or find.
 * This route re-verifies the caller, proves the object belongs to their tenant,
 * checks the row-level rule for that KIND of file, then 302s to a signed URL
 * that expires in minutes.
 *
 * Redirecting rather than streaming means the bytes go browser↔R2 directly — an
 * `<img src>` follows the redirect transparently, and a 25MB PDF never passes
 * through a lambda.
 *
 * `noindex` and `no-store` are belt and braces: the redirect target is
 * short-lived anyway, but a cached signed URL in a shared proxy would outlive
 * the authorization check that produced it.
 */
async function handleGET(request: NextRequest) {
  const gate = await apiRequireUser()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const key = new URL(request.url).searchParams.get('key')
  const download = new URL(request.url).searchParams.get('download')

  if (!key) return jsonError('Missing file reference', 400)

  /*
   * Tenant prefix check FIRST. This is the cheap, unbypassable half: a key that
   * does not start with the caller's own tenant uuid is rejected before any
   * query runs. It also kills traversal attempts, since `..` can never appear in
   * a key that literally begins with the caller's tenant id.
   *
   * A super admin has no tenant, and is deliberately NOT given a bypass here.
   * Platform oversight covers metrics and account state, not reading customers'
   * payslips and visa documents.
   */
  if (!ctx.tenantId || !keyBelongsToTenant(key, ctx.tenantId)) {
    return jsonError('Not found', 404)
  }

  // An org may read anything in its own tenant. An employee may read only files
  // that are theirs, so ask the database — under RLS — whether any row they can
  // see actually references this key.
  if (ctx.role !== 'org') {
    const allowed = await employeeMayRead(key, ctx.userId)
    if (!allowed) return jsonError('Not found', 404)
  }

  const url = await presignGet(key, 15 * 60, download ? download : undefined)

  const response = NextResponse.redirect(url, { status: 302 })
  response.headers.set('Cache-Control', 'private, no-store, max-age=0')
  response.headers.set('X-Robots-Tag', 'noindex, nofollow')
  return response
}

/**
 * Does a row this employee is allowed to SELECT reference this key?
 *
 * Every query below runs through the USER-SCOPED client, so RLS answers the
 * question — this code never decides who owns what, it only asks. If the
 * policies say an employee sees only their own payslips, then a payslip key
 * belonging to a colleague simply returns no rows.
 */
async function employeeMayRead(key: string, userId: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient()

  const { data: profile } = await supabase
    .from('profiles')
    .select('photo_url')
    .eq('id', userId)
    .maybeSingle()
  if (profile?.photo_url === key) return true

  const { data: payslip } = await supabase
    .from('payslips')
    .select('id')
    .eq('file_url', key)
    .limit(1)
    .maybeSingle()
  if (payslip) return true

  const { data: document } = await supabase
    .from('documents')
    .select('id')
    .eq('file_url', key)
    .limit(1)
    .maybeSingle()
  if (document) return true

  const { data: workAuth } = await supabase
    .from('work_authorizations')
    .select('id')
    .eq('document_url', key)
    .limit(1)
    .maybeSingle()
  if (workAuth) return true

  // Branding is visible to everyone inside the workspace.
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id')
    .eq('logo_url', key)
    .limit(1)
    .maybeSingle()

  return !!tenant
}

export const GET = withErrorHandler(handleGET)
