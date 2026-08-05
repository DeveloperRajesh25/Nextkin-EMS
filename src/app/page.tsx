import { redirect } from 'next/navigation'
import { resolveContext, homeFor } from '@/lib/auth/context'

export const dynamic = 'force-dynamic'

/**
 * There is no marketing site here (§11). The root is a router: signed-in users
 * go to their portal, everyone else to sign-in.
 */
export default async function RootPage() {
  const result = await resolveContext()
  if (result.status === 'anonymous') redirect('/login')
  if (result.status === 'orphaned') redirect('/session-invalid')
  const ctx = result.ctx
  if (!ctx.isActive) redirect('/account-inactive')
  if (ctx.role !== 'super_admin' && ctx.tenant?.status === 'suspended') {
    redirect('/workspace-suspended')
  }
  if (ctx.mustChangePassword) redirect('/change-password')
  redirect(homeFor(ctx.role))
}
