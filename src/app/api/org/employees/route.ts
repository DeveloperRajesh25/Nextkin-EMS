import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError } from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createAdminClient, assertTenantScope } from '@/lib/supabase/admin'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createEmployeeSchema } from '@/lib/schemas'
import { generateTempPassword } from '@/lib/crypto'
import { sendEmployeeCredentials, isEmailConfigured } from '@/lib/email'
import { rateLimit, limitKey } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'
import { keyBelongsToTenant } from '@/lib/r2'

export const dynamic = 'force-dynamic'

/**
 * Create an employee account.
 *
 * Employees cannot sign up (§4c) — there is no public path to an account inside
 * someone's workspace. The org creates it here, and the Admin API is the only
 * way to mint a pre-confirmed auth user with a chosen password.
 *
 * THE ROLLBACK IS THE POINT
 * -------------------------
 * Creating an employee is two writes across two systems: an `auth.users` row,
 * then the profile detail. If the second fails, the first has already happened —
 * leaving an auth user with no usable profile. That account can sign in, has no
 * tenant, matches no RLS policy, and blocks the address from ever being used
 * again. So every failure path after `createUser` deletes the auth user before
 * returning. The operation either completes or leaves nothing behind.
 */
async function handlePOST(request: NextRequest) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate
  const tenantId = assertTenantScope(ctx.tenantId)

  // Account creation sends email and consumes auth quota — throttle it.
  const limited = await rateLimit(limitKey('create-employee', ctx.userId), 30, 60 * 60 * 1000)
  if (!limited.ok) {
    return jsonError('You have added a lot of accounts recently. Please try again later.', 429)
  }

  const input = await parseBody(request, createEmployeeSchema)

  // Any storage key that came from the client must be re-proved as ours.
  for (const key of [input.photoKey, ...input.documents.map((d) => d.key)]) {
    if (key && !keyBelongsToTenant(key, tenantId)) {
      return jsonError('One of those files does not belong to this workspace.', 403)
    }
  }

  const supabase = await createSupabaseServerClient()

  // A department id arrives from the request body, so confirm it is ours. RLS
  // makes this read tenant-safe: a foreign id simply returns no row.
  if (input.departmentId) {
    const { data: dept } = await supabase
      .from('departments')
      .select('id')
      .eq('id', input.departmentId)
      .maybeSingle()
    if (!dept) return jsonError('That department was not found.', 400)
  }

  const admin = createAdminClient()
  const tempPassword = generateTempPassword()

  // --- 1. The auth user ----------------------------------------------------
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: input.email,
    password: tempPassword,
    // Pre-confirmed: the org vouches for the address, and there is no signup
    // link for the teammate to click.
    email_confirm: true,
    // TRUSTED metadata. handle_new_user() reads role and tenant from HERE and
    // nowhere else, which is why a self-signup cannot forge either.
    app_metadata: {
      app_role: 'employee',
      tenant_id: tenantId,
      must_change_password: true,
    },
    user_metadata: {
      full_name: input.fullName,
    },
  })

  if (createError || !created.user) {
    const message = (createError?.message || '').toLowerCase()
    if (message.includes('already') || message.includes('registered')) {
      return jsonError('Someone already has an account with that email address.', 409)
    }
    console.error('[employees] createUser failed', createError)
    return jsonError('We could not create that account. Please try again.', 400)
  }

  const userId = created.user.id

  /** Undo the auth user, then answer. Keeps every failure path a single line. */
  const rollback = async (message: string, status: number) => {
    try {
      await admin.auth.admin.deleteUser(userId)
    } catch (err) {
      // Worth shouting about: this is the state the rollback exists to prevent.
      console.error('[employees] ROLLBACK FAILED — orphaned auth user', userId, err)
    }
    return jsonError(message, status)
  }

  // --- 2. The profile detail ----------------------------------------------
  // handle_new_user() already inserted the row with tenant, role and the forced
  // password flag; this fills in the rest. Re-filtering on tenant_id is
  // mandatory on the admin client — it bypasses RLS entirely.
  const { error: profileError } = await admin
    .from('profiles')
    .update({
      full_name: input.fullName,
      email: input.email,
      phone: input.phone,
      employee_code: input.employeeCode,
      designation: input.designation,
      department_id: input.departmentId ?? null,
      date_of_joining: input.dateOfJoining ?? null,
      photo_url: input.photoKey,
      timezone: input.timezone,
      is_active: true,
    })
    .eq('id', userId)
    .eq('tenant_id', tenantId)

  if (profileError) {
    return rollback(friendlyDbError(profileError), 400)
  }

  // --- 3. Wizard step 3 documents -----------------------------------------
  if (input.documents.length) {
    const { error: docError } = await admin.from('documents').update({ employee_id: userId })
      .in('file_url', input.documents.map((d) => d.key))
      .eq('tenant_id', tenantId)

    if (docError) {
      // Not fatal: the account is real and usable, the files are merely
      // unattached and still visible under Documents. Rolling back a working
      // account over a link-up failure would be the worse outcome.
      console.error('[employees] failed to attach documents', docError.message)
    }
  }

  // --- 4. Deliver the credentials -----------------------------------------
  let emailSent = false
  if (input.sendCredentialsEmail && isEmailConfigured()) {
    const result = await sendEmployeeCredentials({
      to: input.email,
      fullName: input.fullName,
      tempPassword,
      orgName: ctx.tenant.name,
      brandColor: ctx.tenant.primaryColor,
    })
    emailSent = result.ok
  }

  await audit({
    tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'employee.created',
    entity: 'profiles',
    entityId: userId,
    // generateTempPassword's output is never persisted or logged; the audit
    // scrubber would redact it anyway if a future edit passed it in.
    meta: { email: input.email, emailSent, documents: input.documents.length },
    request,
  })

  return jsonOk(
    {
      id: userId,
      email: input.email,
      // Returned ONCE so the org can pass it on in person. It is not stored
      // anywhere and cannot be retrieved again.
      tempPassword,
      emailSent,
    },
    201
  )
}

export const POST = withErrorHandler(handlePOST)
