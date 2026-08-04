'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { CheckCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { apiPost, ApiClientError } from '@/lib/fetcher'

/**
 * Mark everything unread as read.
 *
 * A single call rather than one per item: the read receipts are keyed
 * `(notification_id, user_id)`, so the server upserts the whole batch and a
 * repeated click is a no-op instead of a conflict.
 */
export function NotificationReader({ ids }: { ids: string[] }) {
  const router = useRouter()
  const [busy, setBusy] = React.useState(false)

  async function markAll() {
    setBusy(true)
    try {
      await apiPost('/api/employee/notifications/read', { ids })
      router.refresh()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button variant="secondary" loading={busy} onClick={markAll}>
      <CheckCheck />
      Mark all as read
    </Button>
  )
}
