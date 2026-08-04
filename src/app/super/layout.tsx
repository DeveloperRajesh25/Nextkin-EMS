import { requireSuperAdmin } from '@/lib/auth/guards'
import { AppShell } from '@/components/shell/app-shell'

export const dynamic = 'force-dynamic'

/**
 * The platform console. Every page under here is cross-tenant by design, which
 * is exactly why each one loads its data with the ADMIN client behind
 * `requireSuperAdmin()` — RLS gives a super admin a read-only cross-tenant
 * bypass, but anything that must aggregate or act still goes through this gate
 * first.
 */
export default async function SuperLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireSuperAdmin()
  return <AppShell ctx={ctx}>{children}</AppShell>
}
