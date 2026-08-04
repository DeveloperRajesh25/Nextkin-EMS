'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FormField, FormError } from '@/components/ui/form-field'
import { apiPost, ApiClientError } from '@/lib/fetcher'

export function ChangePasswordForm({ forced }: { forced: boolean }) {
  const router = useRouter()
  const [currentPassword, setCurrentPassword] = React.useState('')
  const [newPassword, setNewPassword] = React.useState('')
  const [confirmPassword, setConfirmPassword] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [fields, setFields] = React.useState<Record<string, string>>({})
  const [submitting, setSubmitting] = React.useState(false)

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setFields({})
    setSubmitting(true)

    try {
      const { redirectTo } = await apiPost<{ redirectTo: string }>(
        '/api/auth/change-password',
        { currentPassword, newPassword, confirmPassword }
      )
      toast.success('Password updated')
      router.replace(redirectTo)
      router.refresh()
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message)
        setFields(err.fields ?? {})
      } else {
        setError('Something went wrong. Please try again.')
      }
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
      <FormError message={error} />

      <FormField
        label={forced ? 'Temporary password' : 'Current password'}
        error={fields.currentPassword}
        required
      >
        <Input
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          required
        />
      </FormField>

      <FormField
        label="New password"
        error={fields.newPassword}
        hint="At least 10 characters, with a letter and a number."
        required
      >
        <Input
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
        />
      </FormField>

      <FormField label="Confirm new password" error={fields.confirmPassword} required>
        <Input
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
        />
      </FormField>

      <Button type="submit" className="w-full" size="lg" loading={submitting}>
        {forced ? 'Set password and continue' : 'Update password'}
      </Button>
    </form>
  )
}
