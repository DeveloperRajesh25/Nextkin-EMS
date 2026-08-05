import 'server-only'

/**
 * The one place the server learns who is calling.
 *
 * Two rules this module exists to enforce:
 *
 * 1. `getUser()`, never `getSession()`. `getSession()` decodes the cookie and
 *    trusts it. That is fine for a middleware redirect, and NOT fine for an
 *    authorization decision — `getUser()` round-trips to the auth server and
 *    verifies the token is genuine and unrevoked. Every Route Handler and
 *    Server Action goes through here, so every one of them re-verifies.
 *
 * 2. `is_active` is read from the database on every request, not from the JWT.
 *    A token lives for an hour; deactivation has to bite now (§3).
 */
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { UserRole, TenantStatus } from '@/types/db'

export interface AppContext {
  userId: string
  email: string
  role: UserRole
  tenantId: string | null
  fullName: string | null
  photoUrl: string | null
  departmentId: string | null
  isActive: boolean
  mustChangePassword: boolean
  tenant: {
    id: string
    name: string
    slug: string
    status: TenantStatus
    logoUrl: string | null
    primaryColor: string
    timezone: string
    workStartTime: string
    onboarded: boolean
  } | null
}

/**
 * Three outcomes, kept apart on purpose.
 *
 * `anonymous` and `orphaned` used to collapse into a single `null`, and that is
 * what produced the sign-in redirect loop: an orphaned user was sent to /login,
 * middleware saw a perfectly valid session cookie and sent them straight back to
 * their portal, forever. A session that exists but cannot be resolved to a
 * profile is its OWN failure and needs its own dead end — see /session-invalid.
 */
export type ContextResult =
  | { status: 'anonymous' }
  | { status: 'orphaned'; userId: string; reason: string }
  | { status: 'ok'; ctx: AppContext }

/**
 * Resolve the caller.
 *
 * Returns the context even for a DEACTIVATED user or a SUSPENDED tenant — the
 * callers below are what turn those states into the right redirect, and the UI
 * needs to know which of the two happened to explain itself.
 */
export async function resolveContext(): Promise<ContextResult> {
  const supabase = await createSupabaseServerClient()

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) return { status: 'anonymous' }

  const { data, error: rpcError } = await supabase.rpc('current_profile')
  const row = Array.isArray(data) ? data[0] : data

  if (rpcError || !row) {
    // Authenticated but not provisioned: the migrations have not been applied to
    // this database, or the profile trigger landed after this user signed up.
    // Never guess a role — an unresolvable session gets no access at all.
    console.warn('[auth] no profile row for user', user.id, rpcError?.message)
    return {
      status: 'orphaned',
      userId: user.id,
      reason: rpcError?.message ?? 'no profile row',
    }
  }

  const ctx: AppContext = {
    userId: row.id,
    email: row.email ?? user.email ?? '',
    role: row.role as UserRole,
    tenantId: row.tenant_id,
    fullName: row.full_name,
    photoUrl: row.photo_url,
    departmentId: row.department_id,
    isActive: !!row.is_active,
    mustChangePassword: !!row.must_change_password,
    tenant: row.tenant_id
      ? {
          id: row.tenant_id,
          name: row.tenant_name ?? 'Workspace',
          slug: row.tenant_slug ?? '',
          status: (row.tenant_status ?? 'active') as TenantStatus,
          logoUrl: row.tenant_logo_url,
          primaryColor: row.tenant_primary_color ?? '#C41E33',
          timezone: row.tenant_timezone ?? 'Asia/Kolkata',
          workStartTime: row.tenant_work_start_time ?? '09:30',
          onboarded: !!row.tenant_onboarded,
        }
      : null,
  }

  return { status: 'ok', ctx }
}

/**
 * Convenience wrapper for callers that only care whether there is a usable
 * caller. Prefer `resolveContext()` anywhere the answer decides a redirect —
 * `null` cannot tell "signed out" apart from "session with no profile".
 */
export async function loadContext(): Promise<AppContext | null> {
  const result = await resolveContext()
  return result.status === 'ok' ? result.ctx : null
}

/** The landing route for a role — the single source of truth for redirects. */
export function homeFor(role: UserRole): string {
  switch (role) {
    case 'super_admin':
      return '/super'
    case 'org':
      return '/org'
    default:
      return '/employee'
  }
}

/**
 * Is this context allowed to do real work right now? A deactivated profile or a
 * suspended tenant answers false, and the caller sends them somewhere that
 * explains why.
 */
export function isUsable(ctx: AppContext): boolean {
  if (!ctx.isActive) return false
  if (ctx.role !== 'super_admin' && ctx.tenant?.status !== 'active') return false
  return true
}
