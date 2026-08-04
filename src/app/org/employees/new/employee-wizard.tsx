'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, ArrowRight, Check, Copy, FileUp, Loader2, Trash2, UserRound, X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { FormField, FormError } from '@/components/ui/form-field'
import { Switch } from '@/components/ui/primitives'
import { apiPost, uploadFile, ApiClientError } from '@/lib/fetcher'
import { cn } from '@/lib/utils'

interface Department {
  id: string
  name: string
}

interface UploadedDoc {
  key: string
  fileName: string
  mimeType: string
  sizeBytes: number
}

const STEPS = [
  { title: 'Personal', hint: 'Who they are' },
  { title: 'Work', hint: 'Role and department' },
  { title: 'Documents', hint: 'Optional files' },
] as const

/**
 * Three steps, one submit.
 *
 * Nothing is written until the final step, so abandoning the wizard leaves no
 * half-made account. The exception is file uploads, which must happen as they
 * are chosen (that is what produces a storage key) — those land as unattached
 * documents and are linked to the employee by the create call.
 */
export function EmployeeWizard({
  departments, defaultTimezone,
}: {
  departments: Department[]
  defaultTimezone: string
}) {
  const router = useRouter()
  const [step, setStep] = React.useState(0)
  const [error, setError] = React.useState<string | null>(null)
  const [fields, setFields] = React.useState<Record<string, string>>({})
  const [submitting, setSubmitting] = React.useState(false)

  // Step 1
  const [fullName, setFullName] = React.useState('')
  const [email, setEmail] = React.useState('')
  const [phone, setPhone] = React.useState('')
  const [photoKey, setPhotoKey] = React.useState<string | null>(null)
  const [photoUploading, setPhotoUploading] = React.useState(false)

  // Step 2
  const [employeeCode, setEmployeeCode] = React.useState('')
  const [designation, setDesignation] = React.useState('')
  const [departmentId, setDepartmentId] = React.useState('')
  const [dateOfJoining, setDateOfJoining] = React.useState('')
  const [timezone, setTimezone] = React.useState(defaultTimezone)

  // Step 3
  const [documents, setDocuments] = React.useState<UploadedDoc[]>([])
  const [docUploading, setDocUploading] = React.useState(false)
  const [sendEmail, setSendEmail] = React.useState(true)

  // Result
  const [created, setCreated] = React.useState<{
    email: string
    tempPassword: string
    emailSent: boolean
  } | null>(null)

  function validateStep(index: number): boolean {
    const next: Record<string, string> = {}
    if (index === 0) {
      if (fullName.trim().length < 2) next.fullName = 'Enter their full name'
      if (!/^\S+@\S+\.\S+$/.test(email.trim())) next.email = 'Enter a valid email address'
    }
    setFields(next)
    return Object.keys(next).length === 0
  }

  function goNext() {
    setError(null)
    if (!validateStep(step)) return
    setStep((s) => Math.min(s + 1, STEPS.length - 1))
  }

  async function onPhotoChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setPhotoUploading(true)
    setError(null)
    try {
      const result = await uploadFile(file, 'photo')
      setPhotoKey(result.key)
      toast.success('Photo uploaded')
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'The photo could not be uploaded')
    } finally {
      setPhotoUploading(false)
    }
  }

  async function onDocumentChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (!files.length) return
    setDocUploading(true)
    setError(null)
    try {
      for (const file of files) {
        const result = await uploadFile(file, 'employee_doc')
        setDocuments((prev) => [
          ...prev,
          {
            key: result.key,
            fileName: file.name,
            mimeType: result.contentType,
            sizeBytes: file.size,
          },
        ])
      }
      toast.success(files.length === 1 ? 'Document uploaded' : `${files.length} documents uploaded`)
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'That file could not be uploaded')
    } finally {
      setDocUploading(false)
    }
  }

  async function onSubmit() {
    setError(null)
    setSubmitting(true)
    try {
      const result = await apiPost<{ email: string; tempPassword: string; emailSent: boolean }>(
        '/api/org/employees',
        {
          fullName: fullName.trim(),
          email: email.trim(),
          phone: phone.trim() || undefined,
          photoKey: photoKey || undefined,
          employeeCode: employeeCode.trim() || undefined,
          designation: designation.trim() || undefined,
          departmentId: departmentId || null,
          dateOfJoining: dateOfJoining || null,
          timezone,
          documents,
          sendCredentialsEmail: sendEmail,
        }
      )
      setCreated(result)
      router.refresh()
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message)
        setFields(err.fields ?? {})
        // Send the user back to the step that owns the bad field.
        if (err.fields?.fullName || err.fields?.email) setStep(0)
      } else {
        setError('Something went wrong. Please try again.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  /* ------------------------------------------------------------ Success ---- */
  if (created) {
    return (
      <div className="card-surface mx-auto max-w-lg p-8 text-center">
        <span className="mx-auto mb-5 grid size-14 place-items-center rounded-2xl bg-emerald-50 text-emerald-600">
          <Check className="size-6" aria-hidden />
        </span>
        <h2 className="text-[20px] font-bold tracking-[-0.02em]">{fullName} is set up</h2>
        <p className="mt-2 text-sm text-ink-muted">
          {created.emailSent
            ? 'Their sign-in details have been emailed to them.'
            : 'Share these details with them — this password is shown only once.'}
        </p>

        <div className="mt-6 space-y-3 rounded-xl border border-line bg-page p-4 text-left">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
              Email
            </p>
            <p className="mt-0.5 break-all text-sm font-medium">{created.email}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
              Temporary password
            </p>
            <div className="mt-1 flex items-center gap-2">
              <code className="flex-1 rounded-lg border border-line bg-card px-3 py-2 font-mono text-sm font-semibold tracking-wide">
                {created.tempPassword}
              </code>
              <Button
                variant="secondary"
                size="icon"
                aria-label="Copy password"
                onClick={() => {
                  navigator.clipboard.writeText(created.tempPassword)
                  toast.success('Copied')
                }}
              >
                <Copy />
              </Button>
            </div>
          </div>
        </div>

        <p className="mt-4 text-xs leading-relaxed text-ink-muted">
          They will be asked to choose their own password the first time they sign in. This
          temporary one is not stored anywhere and cannot be shown again.
        </p>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <Button asChild variant="secondary" className="flex-1">
            <Link href="/org/employees">Back to employees</Link>
          </Button>
          <Button className="flex-1" onClick={() => window.location.reload()}>
            Add another
          </Button>
        </div>
      </div>
    )
  }

  /* -------------------------------------------------------------- Wizard --- */
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      {/* Stepper */}
      <ol className="flex items-center gap-2">
        {STEPS.map((s, i) => {
          const state = i < step ? 'done' : i === step ? 'current' : 'todo'
          return (
            <li key={s.title} className="flex flex-1 items-center gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-2.5">
                <span
                  className={cn(
                    'grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold transition',
                    state === 'done' && 'bg-brand-600 text-white',
                    state === 'current' && 'bg-brand-600 text-white ring-4 ring-brand-100',
                    state === 'todo' && 'border border-line bg-card text-ink-muted'
                  )}
                >
                  {state === 'done' ? <Check className="size-3.5" /> : i + 1}
                </span>
                <span className="hidden min-w-0 sm:block">
                  <span
                    className={cn(
                      'block truncate text-[13px] font-medium',
                      state === 'todo' ? 'text-ink-muted' : 'text-ink'
                    )}
                  >
                    {s.title}
                  </span>
                  <span className="block truncate text-[11px] text-ink-muted">{s.hint}</span>
                </span>
              </div>
              {i < STEPS.length - 1 ? (
                <span
                  className={cn('h-px flex-1', i < step ? 'bg-brand-600' : 'bg-line')}
                  aria-hidden
                />
              ) : null}
            </li>
          )
        })}
      </ol>

      <div className="card-surface p-6">
        <FormError message={error} />

        {/* ---------------------------------------------------- Step 1 ----- */}
        {step === 0 ? (
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <span className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-full border border-line bg-page text-ink-muted">
                {photoUploading ? (
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
              <div>
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-card px-3.5 py-2 text-sm font-medium shadow-sm transition hover:bg-page">
                  <FileUp className="size-4" />
                  {photoKey ? 'Change photo' : 'Upload photo'}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="sr-only"
                    onChange={onPhotoChange}
                    disabled={photoUploading}
                  />
                </label>
                <p className="mt-1.5 text-xs text-ink-muted">PNG, JPEG, WebP or GIF, up to 5MB.</p>
              </div>
            </div>

            <FormField label="Full name" error={fields.fullName} required>
              <Input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Alice Nguyen"
                autoComplete="off"
              />
            </FormField>

            <FormField
              label="Work email"
              error={fields.email}
              hint="Their sign-in details are sent here. It cannot be changed later."
              required
            >
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="alice@company.com"
                autoComplete="off"
              />
            </FormField>

            <FormField label="Phone" error={fields.phone}>
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1 555 0100"
                autoComplete="off"
              />
            </FormField>
          </div>
        ) : null}

        {/* ---------------------------------------------------- Step 2 ----- */}
        {step === 1 ? (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Employee code" hint="Must be unique in your workspace.">
                <Input
                  value={employeeCode}
                  onChange={(e) => setEmployeeCode(e.target.value)}
                  placeholder="ACM-001"
                />
              </FormField>
              <FormField label="Designation">
                <Input
                  value={designation}
                  onChange={(e) => setDesignation(e.target.value)}
                  placeholder="Staff Nurse"
                />
              </FormField>
            </div>

            <FormField
              label="Department"
              hint={
                departments.length
                  ? undefined
                  : 'No departments yet — you can add them in Settings.'
              }
            >
              <Select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                <option value="">No department</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </FormField>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Date of joining">
                <Input
                  type="date"
                  value={dateOfJoining}
                  onChange={(e) => setDateOfJoining(e.target.value)}
                />
              </FormField>
              <FormField
                label="Timezone"
                hint="Used for their attendance days and late-login check."
              >
                <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} />
              </FormField>
            </div>
          </div>
        ) : null}

        {/* ---------------------------------------------------- Step 3 ----- */}
        {step === 2 ? (
          <div className="space-y-4">
            <label
              className={cn(
                'flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-line px-6 py-10 text-center transition hover:border-brand-200 hover:bg-brand-50/40',
                docUploading && 'pointer-events-none opacity-60'
              )}
            >
              {docUploading ? (
                <Loader2 className="mb-2 size-6 animate-spin text-brand-600" />
              ) : (
                <FileUp className="mb-2 size-6 text-ink-muted" />
              )}
              <span className="text-sm font-medium">
                {docUploading ? 'Uploading…' : 'Upload documents'}
              </span>
              <span className="mt-1 text-xs text-ink-muted">
                Contracts, ID, certifications. PDFs are indexed for search. Up to 25MB each.
              </span>
              <input
                type="file"
                multiple
                className="sr-only"
                onChange={onDocumentChange}
                disabled={docUploading}
              />
            </label>

            {documents.length ? (
              <ul className="divide-y divide-line rounded-xl border border-line">
                {documents.map((doc) => (
                  <li key={doc.key} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="min-w-0 flex-1 truncate text-sm">{doc.fileName}</span>
                    <span className="tabular shrink-0 text-xs text-ink-muted">
                      {(doc.sizeBytes / 1024).toFixed(0)} KB
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove ${doc.fileName}`}
                      onClick={() =>
                        setDocuments((prev) => prev.filter((d) => d.key !== doc.key))
                      }
                      className="focus-ring rounded p-1 text-ink-muted hover:text-danger"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="flex items-start gap-3 rounded-xl border border-line bg-page p-4">
              <Switch
                id="send-credentials"
                checked={sendEmail}
                onCheckedChange={setSendEmail}
                className="mt-0.5"
              />
              <label htmlFor="send-credentials" className="cursor-pointer">
                <span className="block text-sm font-medium">Email their sign-in details</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-ink-muted">
                  The temporary password is also shown to you once after saving, so you can share
                  it in person instead.
                </span>
              </label>
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-3">
        {step === 0 ? (
          <Button asChild variant="ghost">
            <Link href="/org/employees">
              <X />
              Cancel
            </Link>
          </Button>
        ) : (
          <Button variant="secondary" onClick={() => setStep((s) => s - 1)} disabled={submitting}>
            <ArrowLeft />
            Back
          </Button>
        )}

        {step < STEPS.length - 1 ? (
          <Button onClick={goNext}>
            Continue
            <ArrowRight />
          </Button>
        ) : (
          <Button onClick={onSubmit} loading={submitting} disabled={docUploading}>
            <Check />
            Create account
          </Button>
        )}
      </div>
    </div>
  )
}
