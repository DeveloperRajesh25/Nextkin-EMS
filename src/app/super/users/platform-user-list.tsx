'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Search, Users, ShieldAlert } from 'lucide-react'
import { toast } from 'sonner'
import { DataTable, EmptyState, StatusChip, type Column } from '@/components/ui/patterns'
import { Button } from '@/components/ui/button'
import { Input, Select, Textarea } from '@/components/ui/input'
import { FormField } from '@/components/ui/form-field'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogBody, DialogFooter,
} from '@/components/ui/primitives'
import { apiPatch, ApiClientError } from '@/lib/fetcher'
import { formatLocal } from '@/lib/time'
import type { UserRole } from '@/types/db'

interface UserRow {
  id: string
  full_name: string | null
  email: string | null
  role: UserRole
  tenant_id: string | null
  tenantName: string
  is_active: boolean
  must_change_password: boolean
  created_at: string
}

export function PlatformUserList({ users }: { users: UserRow[] }) {
  const router = useRouter()
  const [query, setQuery] = React.useState('')
  const [role, setRole] = React.useState('all')
  const [status, setStatus] = React.useState('all')
  const [pending, setPending] = React.useState<UserRow | null>(null)
  const [reason, setReason] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return users.filter((user) => {
      if (role !== 'all' && user.role !== role) return false
      if (status === 'active' && !user.is_active) return false
      if (status === 'inactive' && user.is_active) return false
      if (!q) return true
      return [user.full_name, user.email, user.tenantName]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(q))
    })
  }, [users, query, role, status])

  async function toggleActive() {
    if (!pending) return
    setBusy(true)
    try {
      await apiPatch(`/api/super/users/${pending.id}`, {
        isActive: !pending.is_active,
        reason: reason || undefined,
      })
      toast.success(pending.is_active ? 'Account deactivated' : 'Account reactivated')
      setPending(null)
      setReason('')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  const columns: Column<UserRow>[] = [
    {
      key: 'user',
      header: 'User',
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.full_name || 'Unnamed'}</p>
          <p className="truncate text-xs text-ink-muted">{row.email}</p>
        </div>
      ),
    },
    {
      key: 'org',
      header: 'Organization',
      cell: (row) => <span className="truncate text-ink-muted">{row.tenantName}</span>,
    },
    {
      key: 'role',
      header: 'Role',
      cell: (row) => (
        <StatusChip
          status={row.role === 'super_admin' ? 'brand' : row.role === 'org' ? 'info' : 'neutral'}
          tone={row.role === 'super_admin' ? 'brand' : row.role === 'org' ? 'info' : 'neutral'}
          label={row.role === 'super_admin' ? 'Platform' : row.role === 'org' ? 'Owner' : 'Employee'}
        />
      ),
    },
    {
      key: 'created',
      header: 'Created',
      cell: (row) => (
        <span className="whitespace-nowrap text-ink-muted">
          {formatLocal(row.created_at, 'UTC', 'd MMM yyyy')}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row) => (
        <div className="flex flex-wrap gap-1.5">
          <StatusChip status={row.is_active ? 'active' : 'inactive'} />
          {row.must_change_password ? (
            <StatusChip status="pending" label="Password not set" />
          ) : null}
        </div>
      ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'w-32',
      cell: (row) =>
        row.role === 'super_admin' ? (
          <span className="block text-right text-xs text-ink-muted">Managed in Supabase</span>
        ) : (
          <div className="flex justify-end">
            <Button size="sm" variant="ghost" onClick={() => setPending(row)}>
              {row.is_active ? 'Deactivate' : 'Reactivate'}
            </Button>
          </div>
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
            placeholder="Search by name, email or organization"
            className="pl-9"
            aria-label="Search users"
          />
        </div>
        <Select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          aria-label="Filter by role"
          className="sm:w-40"
        >
          <option value="all">All roles</option>
          <option value="org">Owners</option>
          <option value="employee">Employees</option>
          <option value="super_admin">Platform</option>
        </Select>
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Filter by status"
          className="sm:w-40"
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Deactivated</option>
        </Select>
      </div>

      <DataTable
        columns={columns}
        rows={filtered}
        rowKey={(row) => row.id}
        empty={
          <EmptyState
            icon={Users}
            title={users.length ? 'No matches' : 'No users yet'}
            description={
              users.length ? 'Try a different search or clear the filters.' : 'Accounts appear here as they are created.'
            }
          />
        }
      />

      <Dialog open={!!pending} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="size-5 text-brand-600" />
              {pending?.is_active ? 'Deactivate' : 'Reactivate'} this account
            </DialogTitle>
            <DialogDescription>
              {pending?.full_name || pending?.email} at {pending?.tenantName}.{' '}
              {pending?.is_active
                ? 'They lose access immediately — on their next request, not when their session expires.'
                : 'They will be able to sign in again with their existing password.'}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="pb-4">
            <FormField label="Reason" hint="Recorded in the audit log. Optional.">
              <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setPending(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant={pending?.is_active ? 'danger' : 'default'}
              loading={busy}
              onClick={toggleActive}
            >
              {pending?.is_active ? 'Deactivate' : 'Reactivate'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
