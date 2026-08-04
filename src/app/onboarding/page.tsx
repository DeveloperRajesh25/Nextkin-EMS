import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { requireOrg } from '@/lib/auth/guards'
import { OnboardingFlow } from './onboarding-flow'

export const metadata: Metadata = { title: 'Welcome' }
export const dynamic = 'force-dynamic'

/**
 * First run. Deliberately short — three decisions, all changeable later in
 * Settings — because a long wizard between signup and the product is where new
 * workspaces get abandoned.
 *
 * It lives OUTSIDE /org so the org layout's `!onboarded -> redirect here` cannot
 * loop back on itself.
 */
export default async function OnboardingPage() {
  const ctx = await requireOrg()
  if (ctx.tenant.onboarded) redirect('/org')

  return (
    <div className="flex min-h-screen items-center justify-center bg-page px-4 py-10">
      <OnboardingFlow
        orgName={ctx.tenant.name}
        defaultColor={ctx.tenant.primaryColor}
        defaultTimezone={ctx.tenant.timezone}
      />
    </div>
  )
}
