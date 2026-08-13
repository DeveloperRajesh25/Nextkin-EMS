import { Skeleton } from '@/components/ui/patterns'

/**
 * Resuming a draft is a database round-trip plus a decrypt, so it is the one
 * screen in this flow that can visibly wait. The skeleton mirrors the wizard's
 * real layout — stepper rail, then stacked section cards — so nothing jumps
 * when the content arrives.
 */
export default function ResumeOnboardingLoading() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-6 w-52" />
        <Skeleton className="mt-2 h-4 w-80" />
      </div>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="hidden space-y-1 lg:block lg:w-64 lg:shrink-0">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="border-l-2 border-line py-2.5 pl-4">
              <Skeleton className="h-4 w-36" />
            </div>
          ))}
        </div>

        <div className="min-w-0 flex-1 space-y-5">
          {Array.from({ length: 2 }).map((_, card) => (
            <div key={card} className="card-surface space-y-5 p-6">
              <Skeleton className="h-4 w-40" />
              <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
                {Array.from({ length: 4 }).map((_, field) => (
                  <div key={field} className="space-y-1.5">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-10 w-full rounded-lg" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
