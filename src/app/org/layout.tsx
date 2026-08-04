import { redirect } from 'next/navigation'
import { requireOrg } from '@/lib/auth/guards'
import { AppShell } from '@/components/shell/app-shell'

export const dynamic = 'force-dynamic'

/**
 * Gate for the entire org portal. Runs on every request to every /org route, so
 * a deactivated owner or a suspended tenant loses the whole surface at once
 * rather than page by page.
 */
export default async function OrgLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireOrg()

  // First run: send a brand-new workspace through onboarding once.
  if (!ctx.tenant.onboarded) redirect('/onboarding')

  return <AppShell ctx={ctx}>{children}</AppShell>
}
