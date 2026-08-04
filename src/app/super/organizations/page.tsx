import type { Metadata } from 'next'
import { requireSuperAdmin } from '@/lib/auth/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { PageHeader } from '@/components/ui/patterns'
import { OrganizationList } from './organization-list'

export const metadata: Metadata = { title: 'Organizations' }
export const dynamic = 'force-dynamic'

export default async function OrganizationsPage() {
  await requireSuperAdmin()
  const admin = createAdminClient()

  const [{ data: tenants }, { data: profiles }] = await Promise.all([
    admin
      .from('tenants')
      .select('id, name, slug, status, primary_color, timezone, created_at, onboarded_at')
      .order('created_at', { ascending: false }),
    // One pass over profiles rather than a count query per tenant, which would
    // be N+1 across the whole platform.
    admin.from('profiles').select('tenant_id, role, is_active'),
  ])

  const counts = new Map<string, { employees: number; orgs: number; inactive: number }>()
  for (const profile of profiles ?? []) {
    if (!profile.tenant_id) continue
    const entry = counts.get(profile.tenant_id) ?? { employees: 0, orgs: 0, inactive: 0 }
    if (profile.role === 'employee') entry.employees += 1
    if (profile.role === 'org') entry.orgs += 1
    if (!profile.is_active) entry.inactive += 1
    counts.set(profile.tenant_id, entry)
  }

  const rows = (tenants ?? []).map((tenant) => ({
    ...tenant,
    employeeCount: counts.get(tenant.id)?.employees ?? 0,
    orgCount: counts.get(tenant.id)?.orgs ?? 0,
    inactiveCount: counts.get(tenant.id)?.inactive ?? 0,
  }))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Organizations"
        description="Every customer workspace on the platform."
      />
      <OrganizationList tenants={rows} />
    </div>
  )
}
