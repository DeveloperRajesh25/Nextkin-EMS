import type { Metadata } from 'next'
import { requireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/patterns'
import { DocumentLibrary } from './document-library'

export const metadata: Metadata = { title: 'Documents' }
export const dynamic = 'force-dynamic'

export default async function DocumentsPage() {
  const ctx = await requireOrg()
  const supabase = await createSupabaseServerClient()

  const { data: documents } = await supabase
    .from('documents')
    .select('id, employee_id, kind, file_url, file_name, mime_type, size_bytes, extracted_text, created_at')
    .order('created_at', { ascending: false })
    .limit(500)

  const employeeIds = Array.from(
    new Set((documents ?? []).map((d) => d.employee_id).filter(Boolean) as string[])
  )
  const names = new Map<string, string>()
  if (employeeIds.length) {
    const { data } = await supabase.from('profiles').select('id, full_name, email').in('id', employeeIds)
    for (const p of data ?? []) names.set(p.id, p.full_name || p.email || 'Employee')
  }

  const rows = (documents ?? []).map((doc) => ({
    ...doc,
    employeeName: doc.employee_id ? (names.get(doc.employee_id) ?? null) : null,
    // Only a snippet reaches the browser. The full extracted text of a contract
    // can be hundreds of kilobytes and nothing on this page displays it.
    excerpt: doc.extracted_text ? doc.extracted_text.slice(0, 240) : null,
    searchText: doc.extracted_text ? doc.extracted_text.slice(0, 4000).toLowerCase() : '',
  }))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Documents"
        description="Every file in your workspace. PDF contents are searchable."
      />
      <DocumentLibrary documents={rows} timezone={ctx.tenant.timezone} />
    </div>
  )
}
