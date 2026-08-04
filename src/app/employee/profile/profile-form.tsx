'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { FileUp, Loader2, UserRound } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { FormField, FormError } from '@/components/ui/form-field'
import { apiPatch, uploadFile, ApiClientError } from '@/lib/fetcher'
import { COMMON_TIMEZONES } from '@/lib/timezones'

/**
 * Self-service profile edit.
 *
 * The fields here are exactly the ones `tg_profiles_guard` lets a user change on
 * their own row. Role, department, designation, employee code and `is_active`
 * are privileged — the trigger raises if any of them appear in a self-update, so
 * the form cannot offer them even by accident.
 */
export function ProfileForm({
  profile,
}: {
  profile: {
    fullName: string
    phone: string
    photoUrl: string | null
    timezone: string
  }
}) {
  const router = useRouter()
  const [fullName, setFullName] = React.useState(profile.fullName)
  const [phone, setPhone] = React.useState(profile.phone)
  const [timezone, setTimezone] = React.useState(profile.timezone)
  const [photoKey, setPhotoKey] = React.useState(profile.photoUrl)
  const [uploading, setUploading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [fields, setFields] = React.useState<Record<string, string>>({})
  const [submitting, setSubmitting] = React.useState(false)

  async function onPhotoChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      const uploaded = await uploadFile(file, 'photo')
      setPhotoKey(uploaded.key)
      toast.success('Photo uploaded — save to apply it')
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'That upload failed')
    } finally {
      setUploading(false)
    }
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setFields({})
    setSubmitting(true)
    try {
      await apiPatch('/api/employee/profile', {
        fullName,
        phone: phone || undefined,
        photoKey: photoKey || undefined,
        timezone,
      })
      toast.success('Profile updated')
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your details</CardTitle>
        <CardDescription>These are the parts you can change yourself.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <FormError message={error} />

          <div className="flex items-center gap-4">
            <span className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-full border border-line bg-page text-ink-muted">
              {uploading ? (
                <Loader2 className="size-5 animate-spin" />
              ) : photoKey ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/files/view?key=${encodeURIComponent(photoKey)}`}
                  alt=""
                  className="size-full object-cover"
                />
              ) : (
                <UserRound className="size-6" />
              )}
            </span>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-card px-3.5 py-2 text-sm font-medium shadow-sm transition hover:bg-page">
              <FileUp className="size-4" />
              {photoKey ? 'Change photo' : 'Upload photo'}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="sr-only"
                disabled={uploading}
                onChange={onPhotoChange}
              />
            </label>
          </div>

          <FormField label="Full name" error={fields.fullName} required>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          </FormField>

          <FormField label="Phone" error={fields.phone}>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </FormField>

          <FormField label="Timezone" hint="How dates and times are displayed to you.">
            <Select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
              {!COMMON_TIMEZONES.includes(timezone) ? (
                <option value={timezone}>{timezone}</option>
              ) : null}
              {COMMON_TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </Select>
          </FormField>

          <Button type="submit" loading={submitting} disabled={uploading}>
            Save changes
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
