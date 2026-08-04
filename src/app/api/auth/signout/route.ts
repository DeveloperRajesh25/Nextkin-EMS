import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { withErrorHandler } from '@/lib/api'
import { appUrl } from '@/lib/env'

export const dynamic = 'force-dynamic'

/**
 * Sign out. POST only — a GET would let any page log a user out with an <img>
 * tag, which is CSRF with a shrug.
 */
async function handlePOST(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  await supabase.auth.signOut()

  // The sidebar posts a plain <form>, so answer with a redirect rather than JSON.
  const wantsJson = request.headers.get('accept')?.includes('application/json')
  if (wantsJson) return NextResponse.json({ ok: true })

  const base = new URL(request.url).origin || appUrl()
  return NextResponse.redirect(`${base}/login`, { status: 303 })
}

export const POST = withErrorHandler(handlePOST)
