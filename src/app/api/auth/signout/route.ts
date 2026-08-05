import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { withErrorHandler } from '@/lib/api'
import { appUrl } from '@/lib/env'
import { EMPLOYEE_LOGIN_PATH, ORG_LOGIN_PATH } from '@/lib/routes'

export const dynamic = 'force-dynamic'

/**
 * Sign out. POST only — a GET would let any page log a user out with an <img>
 * tag, which is CSRF with a shrug.
 */
async function handlePOST(request: NextRequest) {
  const supabase = await createSupabaseServerClient()

  // Ask who is leaving BEFORE the session is destroyed, so they land back on the
  // door they came in through. An employee returned to the admin sign-in would
  // find their own password refused there.
  let signInPath: string = ORG_LOGIN_PATH
  try {
    const { data: profileRows } = await supabase.rpc('current_profile')
    const profile = Array.isArray(profileRows) ? profileRows[0] : profileRows
    if (profile?.role === 'employee') signInPath = EMPLOYEE_LOGIN_PATH
  } catch {
    // Signing out must never fail on account of a cosmetic lookup.
  }

  await supabase.auth.signOut()

  // The sidebar posts a plain <form>, so answer with a redirect rather than JSON.
  const wantsJson = request.headers.get('accept')?.includes('application/json')
  if (wantsJson) return NextResponse.json({ ok: true, signInPath })

  const base = new URL(request.url).origin || appUrl()
  return NextResponse.redirect(`${base}${signInPath}`, { status: 303 })
}

export const POST = withErrorHandler(handlePOST)
