'use client'

/**
 * In-progress onboardings.
 *
 * A draft is not an employee — it has no account, no email address that works,
 * and nothing referencing it — so it gets its own list and a real delete rather
 * than the deactivate the employee table offers.
 */

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowRight, ClipboardList, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/patterns'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/primitives'
import { apiDelete, ApiClientError } from '@/lib/fetcher'
import { formatLocal } from '@/lib/time'
import { ONBOARDING_STEPS } from '@/lib/onboarding'

export interface DraftRow {
  id: string
  first_name: string | null
  last_name: string | null
  personal_email: string | null
  designation: string | null
  current_step: number
  completed_steps: number[] | null
  created_at: string
  updated_at: string
}

const TOTAL = ONBOARDING_STEPS.length

export function DraftList({ drafts, timezone }: { drafts: DraftRow[]; timezone: string }) {
  const router = useRouter()
  const [pending, setPending] = React.useState<DraftRow | null>(null)
  const [busy, setBusy] = React.useState(false)

  async function remove(draft: DraftRow) {
    setBusy(true)
    try {
      await apiDelete(`/api/org/onboarding/${draft.id}`)
      toast.success('Draft deleted')
      setPending(null)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'That draft could not be deleted')
    } finally {
      setBusy(false)
    }
  }

  if (!drafts.length) {
    return (
      <div className="card-surface overflow-hidden">
        <EmptyState
          icon={ClipboardList}
          title="No onboardings in progress"
          description="Start onboarding someone and you can save your work at any point, then come back to finish it."
          action={
            <Button asChild>
              <Link href="/org/employees/onboard">Onboard an employee</Link>
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <>
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {drafts.map((draft) => {
          const done = (draft.completed_steps ?? []).length
          const name =
            [draft.first_name, draft.last_name].filter(Boolean).join(' ').trim() ||
            draft.personal_email ||
            'Unnamed draft'

          return (
            <li key={draft.id} className="card-surface flex flex-col p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{name}</p>
                  <p className="mt-0.5 truncate text-xs text-ink-muted">
                    {draft.designation || 'No job title yet'}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label={`Delete the draft for ${name}`}
                  onClick={() => setPending(draft)}
                  className="focus-ring shrink-0 rounded p-1 text-ink-muted transition hover:text-danger"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>

              <div className="mt-4">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-ink-muted">
                    {done} of {TOTAL} steps completed
                  </span>
                  <span className="tabular text-ink-muted">
                    {Math.round((done / TOTAL) * 100)}%
                  </span>
                </div>
                <div
                  className="mt-2 h-1.5 overflow-hidden rounded-full bg-page"
                  role="progressbar"
                  aria-valuenow={done}
                  aria-valuemin={0}
                  aria-valuemax={TOTAL}
                  aria-label={`${name} onboarding progress`}
                >
                  <div
                    className="h-full rounded-full bg-brand-600 transition-[width]"
                    style={{ width: `${(done / TOTAL) * 100}%` }}
                  />
                </div>
              </div>

              <p className="mt-4 text-xs text-ink-muted">
                Started {formatLocal(draft.created_at, timezone, 'd MMM yyyy')} · last saved{' '}
                {formatLocal(draft.updated_at, timezone, 'd MMM, HH:mm')}
              </p>

              <Button asChild variant="secondary" className="mt-4 w-full">
                <Link href={`/org/employees/onboard/${draft.id}`}>
                  Resume
                  <ArrowRight />
                </Link>
              </Button>
            </li>
          )
        })}
      </ul>

      <Dialog open={!!pending} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Delete this draft?</DialogTitle>
            <DialogDescription>
              Everything entered so far is discarded. No account was created, so there is nothing
              else to undo — any files already uploaded stay in your Documents library.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setPending(null)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" loading={busy} onClick={() => pending && remove(pending)}>
              Delete draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
