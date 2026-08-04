'use client'

import * as React from 'react'
import { Search, ShieldCheck } from 'lucide-react'
import { DataTable, EmptyState, type Column } from '@/components/ui/patterns'
import { Input, Select } from '@/components/ui/input'
import { formatLocal } from '@/lib/time'

interface AuditRow {
  id: string
  tenant_id: string | null
  tenantName: string
  actor_email: string | null
  action: string
  entity: string | null
  entity_id: string | null
  ip: string | null
  meta: Record<string, unknown>
  created_at: string
}

export function AuditViewer({ logs }: { logs: AuditRow[] }) {
  const [query, setQuery] = React.useState('')
  const [action, setAction] = React.useState('all')

  // The action namespace ("employee.created", "tenant.suspended") gives a
  // natural filter dimension without a separate category column.
  const actionGroups = React.useMemo(() => {
    const groups = new Set<string>()
    for (const log of logs) groups.add(log.action.split('.')[0])
    return Array.from(groups).sort()
  }, [logs])

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return logs.filter((log) => {
      if (action !== 'all' && !log.action.startsWith(`${action}.`)) return false
      if (!q) return true
      return [log.action, log.actor_email, log.tenantName, log.entity]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(q))
    })
  }, [logs, query, action])

  const columns: Column<AuditRow>[] = [
    {
      key: 'time',
      header: 'When',
      cell: (row) => (
        <span className="tabular whitespace-nowrap text-ink-muted">
          {formatLocal(row.created_at, 'UTC', 'd MMM yyyy, HH:mm:ss')}
        </span>
      ),
    },
    {
      key: 'action',
      header: 'Action',
      cell: (row) => (
        <code className="rounded bg-page px-1.5 py-0.5 font-mono text-[11px]">{row.action}</code>
      ),
    },
    {
      key: 'actor',
      header: 'Actor',
      cell: (row) => (
        <span className="truncate text-ink-muted">{row.actor_email || 'system'}</span>
      ),
    },
    {
      key: 'tenant',
      header: 'Organization',
      cell: (row) => <span className="truncate">{row.tenantName}</span>,
    },
    {
      key: 'entity',
      header: 'Entity',
      cell: (row) => <span className="text-ink-muted">{row.entity || '—'}</span>,
    },
    {
      key: 'meta',
      header: 'Detail',
      cell: (row) => {
        const keys = Object.keys(row.meta ?? {})
        if (!keys.length) return <span className="text-ink-muted">—</span>
        return (
          <span
            className="line-clamp-1 max-w-[260px] font-mono text-[11px] text-ink-muted"
            title={JSON.stringify(row.meta, null, 2)}
          >
            {keys.map((key) => `${key}=${String(row.meta[key])}`).join(' ')}
          </span>
        )
      },
    },
    {
      key: 'ip',
      header: 'IP',
      cell: (row) => <span className="tabular text-xs text-ink-muted">{row.ip || '—'}</span>,
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
            placeholder="Search by action, actor, organization or entity"
            className="pl-9"
            aria-label="Search audit log"
          />
        </div>
        <Select
          value={action}
          onChange={(e) => setAction(e.target.value)}
          aria-label="Filter by action group"
          className="sm:w-48"
        >
          <option value="all">All actions</option>
          {actionGroups.map((group) => (
            <option key={group} value={group}>
              {group}
            </option>
          ))}
        </Select>
      </div>

      <DataTable
        columns={columns}
        rows={filtered}
        rowKey={(row) => row.id}
        empty={
          <EmptyState
            icon={ShieldCheck}
            title={logs.length ? 'No matches' : 'Nothing recorded yet'}
            description={
              logs.length
                ? 'Try a different search term or clear the filter.'
                : 'Actions across the platform are recorded here as they happen.'
            }
          />
        }
      />

      <p className="px-1 text-xs text-ink-muted">
        Showing the {filtered.length} most recent of {logs.length} loaded entries.
      </p>
    </div>
  )
}
