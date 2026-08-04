'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Bell, Send } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Select, Textarea } from '@/components/ui/input'
import { FormField, FormError } from '@/components/ui/form-field'
import { Switch } from '@/components/ui/primitives'
import { EmptyState, StatusChip } from '@/components/ui/patterns'
import { apiPost, ApiClientError } from '@/lib/fetcher'
import { formatLocal } from '@/lib/time'
import type { NotificationTarget } from '@/types/db'

interface SentRow {
  id: string
  title: string
  description: string | null
  send_to_type: NotificationTarget
  target_id: string | null
  created_at: string
}

export function NotificationComposer({
  sent, departments, employees, timezone,
}: {
  sent: SentRow[]
  departments: { id: string; name: string }[]
  employees: { id: string; full_name: string | null; email: string | null }[]
  timezone: string
}) {
  const router = useRouter()
  const [title, setTitle] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [sendToType, setSendToType] = React.useState<NotificationTarget>('all')
  const [targetId, setTargetId] = React.useState('')
  const [alsoEmail, setAlsoEmail] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [fields, setFields] = React.useState<Record<string, string>>({})
  const [submitting, setSubmitting] = React.useState(false)

  const nameFor = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const d of departments) map.set(d.id, d.name)
    for (const e of employees) map.set(e.id, e.full_name || e.email || 'Employee')
    return map
  }, [departments, employees])

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setFields({})
    setSubmitting(true)
    try {
      const result = await apiPost<{ emailed: number }>('/api/org/notifications', {
        title,
        description: description || undefined,
        sendToType,
        targetId: sendToType === 'all' ? null : targetId,
        alsoEmail,
      })
      toast.success(
        result.emailed ? `Sent, and emailed to ${result.emailed} people` : 'Notification sent'
      )
      setTitle('')
      setDescription('')
      router.refresh()
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message)
        setFields(err.fields ?? {})
      } else {
        setError('Something went wrong. Please try again.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  function audienceLabel(row: SentRow): string {
    if (row.send_to_type === 'all') return 'Everyone'
    const name = row.target_id ? nameFor.get(row.target_id) : null
    return name ?? (row.send_to_type === 'department' ? 'A department' : 'One person')
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[400px_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Compose</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <FormError message={error} />

            <FormField label="Title" error={fields.title} required>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Timesheet deadline moved"
                required
              />
            </FormField>

            <FormField label="Message" error={fields.description}>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                placeholder="Add any detail your team needs."
              />
            </FormField>

            <FormField label="Send to">
              <Select
                value={sendToType}
                onChange={(e) => {
                  setSendToType(e.target.value as NotificationTarget)
                  setTargetId('')
                }}
              >
                <option value="all">Everyone</option>
                <option value="department">A department</option>
                <option value="employee">One employee</option>
              </Select>
            </FormField>

            {sendToType === 'department' ? (
              <FormField label="Department" error={fields.targetId} required>
                <Select value={targetId} onChange={(e) => setTargetId(e.target.value)} required>
                  <option value="">Choose a department</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              </FormField>
            ) : null}

            {sendToType === 'employee' ? (
              <FormField label="Employee" error={fields.targetId} required>
                <Select value={targetId} onChange={(e) => setTargetId(e.target.value)} required>
                  <option value="">Choose an employee</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.full_name || e.email}
                    </option>
                  ))}
                </Select>
              </FormField>
            ) : null}

            <div className="flex items-start gap-3 rounded-lg bg-page p-3.5">
              <Switch id="also-email" checked={alsoEmail} onCheckedChange={setAlsoEmail} />
              <label htmlFor="also-email" className="cursor-pointer">
                <span className="block text-sm font-medium">Also send by email</span>
                <span className="mt-0.5 block text-xs text-ink-muted">
                  In-app delivery happens either way.
                </span>
              </label>
            </div>

            <Button type="submit" className="w-full" loading={submitting}>
              <Send />
              Send notification
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recently sent</CardTitle>
        </CardHeader>
        {sent.length === 0 ? (
          <EmptyState
            icon={Bell}
            title="Nothing sent yet"
            description="Your announcements will be listed here."
          />
        ) : (
          <ul className="divide-y divide-line">
            {sent.map((row) => (
              <li key={row.id} className="px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{row.title}</p>
                    {row.description ? (
                      <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-ink-muted">
                        {row.description}
                      </p>
                    ) : null}
                  </div>
                  <span className="shrink-0 text-xs text-ink-muted">
                    {formatLocal(row.created_at, timezone, 'd MMM, HH:mm')}
                  </span>
                </div>
                <div className="mt-2">
                  <StatusChip
                    status={row.send_to_type === 'all' ? 'info' : 'neutral'}
                    tone={row.send_to_type === 'all' ? 'info' : 'neutral'}
                    label={audienceLabel(row)}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
