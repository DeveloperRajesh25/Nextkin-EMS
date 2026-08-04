import type { Metadata } from 'next'
import { PauseOctagon } from 'lucide-react'
import { Button } from '@/components/ui/button'

export const metadata: Metadata = { title: 'Workspace suspended' }

/**
 * Where every user of a suspended tenant lands — org owner and employees alike.
 * Suspension is enforced in `app.is_active_member()`, so their data is already
 * unreachable by the time they see this; the page only explains why.
 */
export default function WorkspaceSuspendedPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-page px-4">
      <div className="card-surface w-full max-w-md p-8 text-center">
        <span className="mx-auto mb-5 grid size-14 place-items-center rounded-2xl bg-amber-50 text-amber-600">
          <PauseOctagon className="size-6" aria-hidden />
        </span>
        <h1 className="text-[22px] font-bold tracking-[-0.02em]">This workspace is suspended</h1>
        <p className="mt-2.5 text-sm leading-relaxed text-ink-muted">
          Access has been paused by the platform administrator. Your data is safe and will be
          available again as soon as the workspace is reactivated.
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
