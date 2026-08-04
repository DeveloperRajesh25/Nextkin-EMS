import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient, type CookieOptions } from '@supabase/ssr'

/** The shape `setAll` receives. Annotated because the `cookies` option is a union. */
type CookieToSet = { name: string; value: string; options: CookieOptions }

/**
 * Session refresh + role-based routing.
 *
 * SCOPE: this is ROUTING ONLY. It reads the session cookie and trusts it, which
 * is fine for deciding where to send a browser — the worst case is an
 * unnecessary redirect. It is NOT an authorization boundary. Every Route Handler
 * and Server Action re-verifies with `getUser()` through the gate helpers in
 * src/lib/auth/guards.ts, and RLS is underneath all of it.
 *
 * The role comes from the `user_role` claim minted by the access-token hook, so
 * routing costs no database round-trip.
 */

const PUBLIC_PATHS = [
  '/login',
  '/signup',
  '/forgot-password',
  '/auth/confirm',
  '/api/auth/login',
  '/api/auth/signup',
  '/api/auth/forgot-password',
  '/api/auth/signout',
  '/api/cron',
  '/api/integrations/google/webhook',
]

/** Routes a signed-in user may visit regardless of role. */
const ROLE_NEUTRAL = [
  '/change-password',
  '/reset-password',
  '/account-inactive',
  '/workspace-suspended',
  '/api/',
  '/auth/',
]

const ROLE_HOME: Record<string, string> = {
  super_admin: '/super',
  org: '/org',
  employee: '/employee',
}

const ROLE_PREFIX: Record<string, string> = {
  super_admin: '/super',
  org: '/org',
  employee: '/employee',
}

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

function isRoleNeutral(pathname: string): boolean {
  return ROLE_NEUTRAL.some((p) => pathname === p || pathname.startsWith(p))
}

/**
 * Read the `user_role` claim without verifying the signature.
 *
 * Deliberate: a forged claim can only send someone to the wrong dashboard, where
 * the real gate rejects them. Verifying here would mean a network round-trip on
 * every navigation for no security gain.
 */
function roleFromToken(accessToken: string | undefined): string | null {
  if (!accessToken) return null
  try {
    const payload = accessToken.split('.')[1]
    if (!payload) return null
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    const claims = JSON.parse(json) as { user_role?: string }
    return claims.user_role ?? null
  } catch {
    return null
  }
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Refreshes the access token and writes the rotated cookies onto `response`.
  const {
    data: { session },
  } = await supabase.auth.getSession()

  const { pathname } = request.nextUrl

  // --- Not signed in -------------------------------------------------------
  if (!session) {
    if (isPublic(pathname)) return response
    const redirectUrl = new URL('/login', request.url)
    // Preserve the destination so sign-in can return the user to it.
    if (pathname !== '/') redirectUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(redirectUrl)
  }

  const role = roleFromToken(session.access_token)
  const home = (role && ROLE_HOME[role]) || '/employee'

  // --- Signed in, on an auth page -> go home -------------------------------
  if (pathname === '/' || pathname === '/login' || pathname === '/signup') {
    return NextResponse.redirect(new URL(home, request.url))
  }

  if (isRoleNeutral(pathname)) return response

  // --- Cross-role access is blocked ---------------------------------------
  if (role) {
    const allowedPrefix = ROLE_PREFIX[role]
    const inOwnArea = pathname === allowedPrefix || pathname.startsWith(`${allowedPrefix}/`)
    const inSomeoneElsesArea = Object.entries(ROLE_PREFIX).some(
      ([r, prefix]) => r !== role && (pathname === prefix || pathname.startsWith(`${prefix}/`))
    )
    if (inSomeoneElsesArea && !inOwnArea) {
      return NextResponse.redirect(new URL(home, request.url))
    }
  }

  return response
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and image files. Auth cookies must be
     * refreshed on real navigations, not on every icon request.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
