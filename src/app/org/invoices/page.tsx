import type { Metadata } from 'next'
import { requireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/patterns'
import { suggestInvoiceNumber } from '@/lib/invoice'
import { InvoiceWorkspace } from './invoice-workspace'
import type { Invoice } from '@/types/db'

export const metadata: Metadata = { title: 'Invoices' }
export const dynamic = 'force-dynamic'

export default async function InvoicesPage() {
  const ctx = await requireOrg()
  const supabase = await createSupabaseServerClient()

  const { data: invoices } = await supabase
    .from('invoices')
    .select('*')
    .order('issue_date', { ascending: false })
    .limit(500)

  const suggested = suggestInvoiceNumber((invoices ?? []).map((i) => i.invoice_number))

  return (
    <div className="space-y-6">
      <PageHeader title="Invoices" description="Create, track and print invoices." />
      <InvoiceWorkspace
        invoices={(invoices ?? []) as Invoice[]}
        suggestedNumber={suggested}
        orgName={ctx.tenant.name}
        timezone={ctx.tenant.timezone}
      />
    </div>
  )
}
