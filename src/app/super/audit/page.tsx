import type { Metadata } from 'next'
import { requireSuperAdmin } from '@/lib/auth/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { PageHeader } from '@/components/ui/patterns'
import { AuditViewer } from './audit-viewer'

export const metadata: Metadata = { title: 'Audit log' }
export const dynamic = 'force-dynamic'

export default async function AuditPage() {
  await requireSuperAdmin()
  const admin = createAdminClient()

  const [{ data: logs }, { data: tenants }] = await Promise.all([
    admin
      .from('audit_logs')
      .select('id, tenant_id, actor_email, action, entity, entity_id, ip, meta, created_at')
      .order('created_at', { ascending: false })
      .limit(1000),
    admin.from('tenants').select('id, name'),
  ])

  const tenantName = new Map((tenants ?? []).map((t) => [t.id, t.name]))

  const rows = (logs ?? []).map((log) => ({
    ...log,
    tenantName: log.tenant_id ? (tenantName.get(log.tenant_id) ?? 'Unknown') : 'Platform',
  }))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit log"
        description="Append-only. There is no update or delete path for these records, anywhere in the product."
      />
      <AuditViewer logs={rows} />
    </div>
  )
}
