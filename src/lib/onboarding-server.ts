import 'server-only'

/**
 * Server-side half of the onboarding wizard: the draft patch → column mapping,
 * and the bank-account encryption boundary.
 *
 * THE ACCOUNT NUMBER RULE
 * -----------------------
 * A bank account number exists in plaintext for exactly one hop: inside the
 * request body of the save that carries it. `toColumns` encrypts it on the way
 * in (AES-256-GCM, same scheme and key as the stored Google refresh token), and
 * nothing ever decrypts it back to a browser — the wizard is told only the last
 * four digits, so a compromised session cannot read a number out of the UI.
 */
import { encryptToken, decryptToken, isEncryptionConfigured } from '@/lib/crypto'
import { DRAFT_COLUMNS, type DraftFieldKey } from '@/lib/onboarding'
import type { OnboardingDraftInput } from '@/lib/schemas'

export class OnboardingPatchError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.name = 'OnboardingPatchError'
    this.status = status
  }
}

/**
 * A validated patch → the columns to write. ONLY keys the caller actually sent
 * appear in the result: a step-3 save must not blank out step 1, and an autosave
 * of one field must not resurrect a value the user just cleared elsewhere.
 */
export function toColumns(input: OnboardingDraftInput): Record<string, unknown> {
  const patch: Record<string, unknown> = {}

  for (const [key, column] of Object.entries(DRAFT_COLUMNS) as [DraftFieldKey, string][]) {
    if (key === 'accountNumber') continue // handled below — it is encrypted
    const value = (input as Record<string, unknown>)[key]
    // `undefined` is "not sent", which is not the same as "cleared" (null).
    if (!(key in input) || value === undefined) continue
    patch[column] = value ?? null
  }

  if ('accountNumber' in input) {
    const raw = input.accountNumber
    if (!raw) {
      patch.account_number_enc = null
    } else {
      if (!isEncryptionConfigured()) {
        // Fail loudly rather than store a bank account number in the clear.
        throw new OnboardingPatchError(
          'Bank details cannot be saved: encryption is not configured on this server.',
          503
        )
      }
      patch.account_number_enc = encryptToken(raw)
    }
  }

  if (input.additionalDocs !== undefined) patch.additional_docs = input.additionalDocs
  if (input.currentStep !== undefined) patch.current_step = input.currentStep
  if (input.completedSteps !== undefined) {
    patch.completed_steps = Array.from(new Set(input.completedSteps)).sort((a, b) => a - b)
  }

  return patch
}

/**
 * The last four digits of a stored account number, or null.
 *
 * A failed decrypt is not an error worth surfacing: it means the key rotated or
 * the value is corrupt, and the only consequence is that the masked hint is
 * missing. The number itself is still there for whoever holds the right key.
 */
export function accountLast4(ciphertext: string | null | undefined): string | null {
  if (!ciphertext) return null
  try {
    const plain = decryptToken(ciphertext)
    return plain.length >= 4 ? plain.slice(-4) : null
  } catch {
    return null
  }
}

/**
 * A unique employee code for this tenant, e.g. `EMP-0007`.
 *
 * Called only when the org left the field blank. The uniqueness index on
 * (tenant_id, employee_code) is the real guarantee — this just picks a
 * candidate that is very likely free, and the caller retries on conflict.
 */
export function suggestEmployeeCode(existingCount: number): string {
  return `EMP-${String(existingCount + 1).padStart(4, '0')}`
}
