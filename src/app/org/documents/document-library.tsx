'use client'

import * as React from 'react'
import { Download, FileText, Search } from 'lucide-react'
import { DataTable, EmptyState, StatusChip, type Column } from '@/components/ui/patterns'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { formatLocal } from '@/lib/time'
import { humanize, truncate } from '@/lib/utils'
import type { DocumentKind } from '@/types/db'

interface DocumentRow {
  id: string
  employee_id: string | null
  employeeName: string | null
  kind: DocumentKind
  file_url: string
  file_name: string | null
  mime_type: string | null
  size_bytes: number | null
  excerpt: string | null
  searchText: string
  created_at: string
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function DocumentLibrary({
  documents, timezone,
}: {
  documents: DocumentRow[]
  timezone: string
}) {
  const [query, setQuery] = React.useState('')
  const [kind, setKind] = React.useState('all')

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return documents.filter((doc) => {
      if (kind !== 'all' && doc.kind !== kind) return false
      if (!q) return true
      // Filename, owner, AND the text extracted from the PDF — which is the
      // point of running extraction at upload time.
      return (
        (doc.file_name ?? '').toLowerCase().includes(q) ||
        (doc.employeeName ?? '').toLowerCase().includes(q) ||
        doc.searchText.includes(q)
      )
    })
  }, [documents, query, kind])

  const columns: Column<DocumentRow>[] = [
    {
      key: 'file',
      header: 'File',
      cell: (row) => (
        <div className="flex items-start gap-2.5">
          <FileText className="mt-0.5 size-4 shrink-0 text-ink-muted" aria-hidden />
          <div className="min-w-0">
            <p className="truncate font-medium">{row.file_name || 'Untitled'}</p>
            {row.excerpt ? (
              <p className="mt-0.5 line-clamp-1 text-xs text-ink-muted">
                {truncate(row.excerpt.replace(/\s+/g, ' '), 90)}
              </p>
            ) : null}
          </div>
        </div>
      ),
    },
    {
      key: 'kind',
      header: 'Type',
      cell: (row) => <StatusChip status="neutral" tone="neutral" label={humanize(row.kind)} />,
    },
    {
      key: 'employee',
      header: 'Employee',
      cell: (row) => <span className="text-ink-muted">{row.employeeName || '—'}</span>,
    },
    {
      key: 'size',
      header: 'Size',
      cell: (row) => <span className="tabular text-ink-muted">{formatBytes(row.size_bytes)}</span>,
    },
    {
      key: 'uploaded',
      header: 'Uploaded',
      cell: (row) => (
        <span className="whitespace-nowrap text-ink-muted">
          {formatLocal(row.created_at, timezone, 'd MMM yyyy')}
        </span>
      ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'w-14',
      cell: (row) => (
        <Button asChild size="icon" variant="ghost" aria-label={`Download ${row.file_name}`}>
          <a
            href={`/api/files/view?key=${encodeURIComponent(row.file_url)}&download=${encodeURIComponent(
              row.file_name || 'document'
            )}`}
          >
            <Download />
          </a>
        </Button>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search filenames, employees, or text inside PDFs"
            className="pl-9"
            aria-label="Search documents"
          />
        </div>
        <Select
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          aria-label="Filter by type"
          className="sm:w-52"
        >
          <option value="all">All types</option>
          <option value="employee_doc">Employee documents</option>
          <option value="work_auth">Work authorization</option>
          <option value="general">General</option>
        </Select>
      </div>

      <DataTable
        columns={columns}
        rows={filtered}
        rowKey={(row) => row.id}
        empty={
          <EmptyState
            icon={FileText}
            title={documents.length ? 'No matches' : 'No documents yet'}
            description={
              documents.length
                ? 'Try a different search term or clear the filter.'
                : 'Files uploaded while adding employees or recording work authorizations appear here.'
            }
          />
        }
      />
    </div>
  )
}
