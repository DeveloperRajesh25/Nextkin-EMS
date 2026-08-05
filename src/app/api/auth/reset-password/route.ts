import { NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resetPasswordSchema } from '@/lib/schemas'
import { withErrorHandler, parseBody, jsonOk, jsonError } from '@/lib/api'
import { rateLimit, limitKey, getClientIp } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'
import { EMPLOYEE_LOGIN_PATH, ORG_LOGIN_PATH } from '@/lib/routes'

export const dynamic = 'force-dynamic'

/**
 * Complete a password reset.
 *
 * Reached only with the short-lived session that `/auth/confirm?type=recovery`
 * established after verifying the emailed token server-side. No current password
 * is asked for — proving control of the mailbox IS the proof here, and demanding
 * the forgotten password would defeat the point of the flow.
 *
 * The session is torn down afterwards so the user signs in fresh with the new
 * password, and any other device holding an old session is not silently left
 * usable in the same browser profile.
 */
async function handlePOST(request: NextRequest) {
  const limited = await rateLimit(limitKey('reset-password', getClientIp(request)), 10, 15 * 60 * 1000)
  if (!limited.ok) return jsonError('Too many attempts. Please wait a few minutes.', 429)

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return jsonError(
      'Your reset link has expired. Please request a new one from the sign-in page.',
      401
    )
  }

  const { password } = await parseBody(request, resetPasswordSchema)

  // Read the role while the recovery session is still alive — it decides which
  // sign-in page to send them back to, and sending an employee to the admin door
  // means their brand-new password is refused on first use.
  const { data: profileRows } = await supabase.rpc('current_profile')
  const profileRow = Array.isArray(profileRows) ? profileRows[0] : profileRows
  const signInPath = profileRow?.role === 'employee' ? EMPLOYEE_LOGIN_PATH : ORG_LOGIN_PATH

  const { error } = await supabase.auth.updateUser({ password })
  if (error) {
    console.error('[reset-password] update failed', error.message)
    return jsonError('We could not update your password. Please request a new link.', 400)
  }

  // A reset also satisfies a pending forced change — they are the same act.
  try {
    const admin = createAdminClient()
    await admin.from('profiles').update({ must_change_password: false }).eq('id', user.id)
  } catch (err) {
    console.error('[reset-password] failed to clear forced-change flag', err)
  }

  await audit({
    actorId: user.id,
    actorEmail: user.email ?? null,
    action: 'auth.password_reset',
    entity: 'auth.users',
    entityId: user.id,
    request,
  })

  await supabase.auth.signOut()

  return jsonOk({
    message: 'Your password has been updated. Please sign in.',
    signInPath,
  })
}

export const POST = withErrorHandler(handlePOST)
