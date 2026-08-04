import type { Metadata } from 'next'
import { requireSuperAdmin } from '@/lib/auth/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { PageHeader } from '@/components/ui/patterns'
import { PlatformUserList } from './platform-user-list'

export const metadata: Metadata = { title: 'Users' }
export const dynamic = 'force-dynamic'

export default async function PlatformUsersPage() {
  await requireSuperAdmin()
  const admin = createAdminClient()

  const [{ data: profiles }, { data: tenants }] = await Promise.all([
    admin
      .from('profiles')
      .select('id, full_name, email, role, tenant_id, is_active, must_change_password, created_at')
      .order('created_at', { ascending: false })
      .limit(2000),
    admin.from('tenants').select('id, name'),
  ])

  const tenantName = new Map((tenants ?? []).map((t) => [t.id, t.name]))

  const rows = (profiles ?? []).map((profile) => ({
    ...profile,
    tenantName: profile.tenant_id ? (tenantName.get(profile.tenant_id) ?? '—') : 'Platform',
  }))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Users"
        description="Every account across the platform. You can deactivate, but not edit, customer accounts."
      />
      <PlatformUserList users={rows} />
    </div>
  )
}
