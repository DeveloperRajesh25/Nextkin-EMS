import type { Metadata } from 'next'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'

export const metadata: Metadata = { title: 'Account not set up' }

/**
 * The dead end for a session that authenticates but resolves to no profile row.
 *
 * It is deliberately GUARD-FREE and renders nothing but an explanation and a
 * sign-out button. Every other exit from that state is a redirect, and a
 * redirect is exactly what loops: /login bounces a cookie-holder back into the
 * app, and the app bounces them out again. The loop ends here, and the only way
 * forward is the POST that clears the cookie.
 */
export default function SessionInvalidPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-page px-4">
      <div className="card-surface w-full max-w-md p-8 text-center">
        <span className="mx-auto mb-5 grid size-14 place-items-center rounded-2xl bg-amber-50 text-amber-600">
          <AlertTriangle className="size-6" aria-hidden />
        </span>
        <h1 className="text-[22px] font-bold tracking-[-0.02em]">Your account is not set up</h1>
        <p className="mt-2.5 text-sm leading-relaxed text-ink-muted">
          You are signed in, but this account has no workspace profile attached to it, so there is
          nothing we can show you yet. Please contact your organization&apos;s administrator, or
          sign out and try again.
        </p>
        <form action="/api/auth/signout" method="post" className="mt-6">
          <Button type="submit" variant="secondary" className="w-full">
            Sign out
          </Button>
        </form>
      </div>
    </div>
  )
}
