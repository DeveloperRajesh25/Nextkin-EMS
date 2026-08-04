import type { Metadata } from 'next'
import { UserX } from 'lucide-react'
import { Button } from '@/components/ui/button'

export const metadata: Metadata = { title: 'Account deactivated' }

/**
 * Where a deactivated user lands. They can still read their own profile row (the
 * one carve-out in the profiles SELECT policy), which is exactly what makes it
 * possible to explain the situation instead of showing a blank error.
 */
export default function AccountInactivePage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-page px-4">
      <div className="card-surface w-full max-w-md p-8 text-center">
        <span className="mx-auto mb-5 grid size-14 place-items-center rounded-2xl bg-brand-50 text-brand-600">
          <UserX className="size-6" aria-hidden />
        </span>
        <h1 className="text-[22px] font-bold tracking-[-0.02em]">Your account is deactivated</h1>
        <p className="mt-2.5 text-sm leading-relaxed text-ink-muted">
          Access to this workspace has been turned off for your account. If you think this is a
          mistake, please contact your organization&apos;s administrator.
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
