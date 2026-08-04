'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Check, X, CalendarOff, Search } from 'lucide-react'
import { toast } from 'sonner'
import { DataTable, EmptyState, StatusChip, type Column } from '@/components/ui/patterns'
import { Button } from '@/components/ui/button'
import { Input, Select, Textarea } from '@/components/ui/input'
import {
  Avatar, AvatarFallback, AvatarImage,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogBody, DialogFooter, Tabs, TabsList, TabsTrigger,
} from '@/components/ui/primitives'
import { FormField } from '@/components/ui/form-field'
import { apiPatch, ApiClientError } from '@/lib/fetcher'
import { formatLocal } from '@/lib/time'
import { initials, truncate } from '@/lib/utils'
import type { LeaveStatus } from '@/types/db'

interface LeaveRow {
  id: string
  employee_id: string
  employeeName: string
  employeePhoto: string | null
  start_date: string
  end_date: string
  days: number
  reason: string
  status: LeaveStatus
  decision_note: string | null
  decided_at: string | null
  created_at: string
}

export function LeaveQueue({
  leaves, timezone,
}: {
  leaves: LeaveRow[]
  timezone: string
}) {
  const router = useRouter()
  const [tab, setTab] = React.useState<'pending' | 'decided' | 'all'>('pending')
  const [query, setQuery] = React.useState('')
  const [decision, setDecision] = React.useState<{
    leave: LeaveRow
    status: 'approved' | 'rejected'
  } | null>(null)
  const [note, setNote] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return leaves.filter((leave) => {
      if (tab === 'pending' && leave.status !== 'pending') return false
      if (tab === 'decided' && leave.status === 'pending') return false
      if (!q) return true
      return (
        leave.employeeName.toLowerCase().includes(q) || leave.reason.toLowerCase().includes(q)
      )
    })
  }, [leaves, tab, query])

  const pendingCount = leaves.filter((l) => l.status === 'pending').length

  async function submitDecision() {
    if (!decision) return
    setBusy(true)
    try {
      await apiPatch(`/api/org/leaves/${decision.leave.id}`, {
        status: decision.status,
        note: note.trim() || undefined,
      })
      toast.success(`Leave ${decision.status}`)
      setDecision(null)
      setNote('')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  const columns: Column<LeaveRow>[] = [
    {
      key: 'employee',
      header: 'Employee',
      cell: (row) => (
        <div className="flex items-center gap-2.5">
          <Avatar className="size-8">
            {row.employeePhoto ? (
              <AvatarImage
                src={`/api/files/view?key=${encodeURIComponent(row.employeePhoto)}`}
                alt=""
              />
            ) : null}
            <AvatarFallback>{initials(row.employeeName)}</AvatarFallback>
          </Avatar>
          <span className="truncate font-medium">{row.employeeName}</span>
        </div>
      ),
    },
    {
      key: 'dates',
      header: 'Dates',
      cell: (row) => (
        <span className="tabular whitespace-nowrap">
          {row.start_date} → {row.end_date}
        </span>
      ),
    },
    {
      key: 'days',
      header: 'Days',
      cell: (row) => <span className="tabular font-medium">{row.days}</span>,
    },
    {
      key: 'reason',
      header: 'Reason',
      cell: (row) => (
        <span className="text-ink-muted" title={row.reason}>
          {truncate(row.reason, 60)}
        </span>
      ),
    },
    {
      key: 'applied',
      header: 'Applied',
      cell: (row) => (
        <span className="whitespace-nowrap text-ink-muted">
          {formatLocal(row.created_at, timezone, 'd MMM')}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row) => <StatusChip status={row.status} />,
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'w-[150px]',
      cell: (row) =>
        row.status === 'pending' ? (
          <div className="flex justify-end gap-1.5">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setDecision({ leave: row, status: 'approved' })}
            >
              <Check />
              Approve
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Reject leave for ${row.employeeName}`}
              onClick={() => setDecision({ leave: row, status: 'rejected' })}
            >
              <X />
            </Button>
          </div>
        ) : (
          <span className="block text-right text-xs text-ink-muted">
            {row.decided_at ? formatLocal(row.decided_at, timezone, 'd MMM') : '—'}
          </span>
        ),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value="pending">
              Pending{pendingCount ? ` (${pendingCount})` : ''}
            </TabsTrigger>
            <TabsTrigger value="decided">Decided</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="relative sm:w-72">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or reason"
            className="pl-9"
            aria-label="Search leave requests"
          />
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={filtered}
        rowKey={(row) => row.id}
        empty={
          <EmptyState
            icon={CalendarOff}
            title={tab === 'pending' ? 'Nothing to review' : 'No leave requests'}
            description={
              tab === 'pending'
                ? 'Requests from your team appear here as soon as they apply.'
                : 'Nothing matches this filter.'
            }
          />
        }
      />

      <Dialog open={!!decision} onOpenChange={(open) => !open && setDecision(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>
              {decision?.status === 'approved' ? 'Approve' : 'Reject'} leave
            </DialogTitle>
            <DialogDescription>
              {decision?.leave.employeeName} · {decision?.leave.start_date} →{' '}
              {decision?.leave.end_date} ({decision?.leave.days}{' '}
              {decision?.leave.days === 1 ? 'day' : 'days'})
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4 pb-4">
            <div className="rounded-lg bg-page p-3 text-sm">
              <p className="mb-1 text-xs font-medium uppercase tracking-wider text-ink-muted">
                Their reason
              </p>
              {decision?.leave.reason}
            </div>
            <FormField
              label="Note"
              hint="Included in the email we send them. Optional."
            >
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                placeholder={
                  decision?.status === 'approved'
                    ? 'Enjoy your time off.'
                    : 'Let them know why, and what to do next.'
                }
              />
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDecision(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant={decision?.status === 'approved' ? 'default' : 'danger'}
              loading={busy}
              onClick={submitDecision}
            >
              {decision?.status === 'approved' ? 'Approve' : 'Reject'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
