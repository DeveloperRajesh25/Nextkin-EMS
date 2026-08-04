import 'server-only'

/**
 * Durable rate limiting + an enumeration-safe login lockout.
 *
 * Backed by the `rate_limits` table and its SECURITY DEFINER RPCs (001_schema).
 * Deliberately NOT in-memory: Vercel runs many isolated lambdas, so an in-memory
 * counter would let an attacker get `limit × instances` attempts. The RPCs are
 * called with the SERVICE ROLE, which is why `anon`/`authenticated` have no
 * privilege on them at all (002_rls.sql) — a limiter an attacker can write to is
 * not a limiter.
 *
 * Failure policy: FAIL OPEN. If the store is unreachable we allow the request
 * rather than lock every user out of the product over an infrastructure blip.
 * The one exception is the login lockout counter, where an unreachable store
 * simply means no lockout is applied (the per-IP limit still stands).
 */
import { createHash } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'

export interface RateLimitResult {
  ok: boolean
  retryAfterSeconds: number
}

const ok = (): RateLimitResult => ({ ok: true, retryAfterSeconds: 0 })

/**
 * Hash any identifier that could be personal data (an email) before it becomes a
 * limiter key. The table then holds no addresses — only opaque digests.
 */
export function limitKey(namespace: string, identifier: string): string {
  const digest = createHash('sha256')
    .update(identifier.trim().toLowerCase())
    .digest('base64url')
    .slice(0, 32)
  return `${namespace}:${digest}`
}

/** Record a hit and report whether the caller is still within budget. */
export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<RateLimitResult> {
  try {
    const admin = createAdminClient()
    const { data, error } = await admin.rpc('rate_limit_hit', {
      p_key: key,
      p_limit: limit,
      p_window_ms: windowMs,
    })
    if (error) throw error
    return data === true ? ok() : { ok: false, retryAfterSeconds: Math.ceil(windowMs / 1000) }
  } catch (err) {
    console.warn('[rate-limit] store unavailable; allowing request (fail open)', err)
    return ok()
  }
}

/** Count hits in the window WITHOUT recording one. Backs the lockout check. */
export async function countHits(key: string, windowMs: number): Promise<number> {
  try {
    const admin = createAdminClient()
    const { data, error } = await admin.rpc('rate_limit_count', {
      p_key: key,
      p_window_ms: windowMs,
    })
    if (error) throw error
    return typeof data === 'number' ? data : 0
  } catch (err) {
    console.warn('[rate-limit] count unavailable; treating as 0', err)
    return 0
  }
}

/** Clear a bucket — called after a SUCCESSFUL login so failures do not accrue. */
export async function resetKey(key: string): Promise<void> {
  try {
    const admin = createAdminClient()
    await admin.rpc('rate_limit_reset', { p_key: key })
  } catch (err) {
    console.warn('[rate-limit] reset unavailable; ignoring', err)
  }
}

/** The client IP, trusting Vercel's proxy headers and falling back safely. */
export function getClientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  return req.headers.get('x-real-ip') || req.headers.get('cf-connecting-ip') || 'unknown'
}

// ---------------------------------------------------------------------------
// Auth-endpoint policy (§3)
// ---------------------------------------------------------------------------

const LOCKOUT_MAX = 10
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000

/**
 * Per-IP throttle for the auth endpoints. Applied FIRST, before any account
 * lookup, so a bot cannot use response timing to learn anything.
 */
export async function limitAuthByIp(req: Request, action: string): Promise<RateLimitResult> {
  return rateLimit(limitKey(`auth-ip:${action}`, getClientIp(req)), 20, 15 * 60 * 1000)
}

/**
 * Enumeration-safe login lockout: 10 failures per 15 minutes PER EMAIL, counted
 * whether or not the address belongs to a real account.
 *
 * The "whether or not" is the whole point. A lockout that only applies to
 * existing accounts is an oracle — "this address locked out, therefore it is
 * registered". Because the key is a salt-free hash of the address and we never
 * check existence first, both cases behave identically from outside.
 */
export async function isLoginLocked(email: string): Promise<boolean> {
  const hits = await countHits(limitKey('login-fail', email), LOCKOUT_WINDOW_MS)
  return hits >= LOCKOUT_MAX
}

/** Record ONE failed login for the lockout counter. */
export async function recordLoginFailure(email: string): Promise<void> {
  await rateLimit(limitKey('login-fail', email), Number.MAX_SAFE_INTEGER, LOCKOUT_WINDOW_MS)
}

/** Wipe the lockout counter after a successful sign-in. */
export async function clearLoginFailures(email: string): Promise<void> {
  await resetKey(limitKey('login-fail', email))
}

export const LOCKOUT = { max: LOCKOUT_MAX, windowMs: LOCKOUT_WINDOW_MS }
