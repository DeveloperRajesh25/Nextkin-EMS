import 'server-only'

/**
 * AES-256-GCM encryption for third-party OAuth tokens at rest (the Google
 * refresh token in `calendar_connections.google_refresh_token_enc`).
 *
 * Wire format — one opaque string per token:
 *     v1:<iv_b64>:<authTag_b64>:<ciphertext_b64>
 * The version prefix leaves room to rotate the scheme without ambiguity.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THIS KEY FAILS CLOSED.                                                   │
 * │                                                                          │
 * │ A common shortcut is to accept any string and SHA-256 it into 32 bytes   │
 * │ "so a mis-formatted key still works". That silently downgrades AES-256   │
 * │ to the entropy of whatever someone typed into the dashboard — the system │
 * │ reports healthy while the real key might be `changeme`. Here a malformed │
 * │ value THROWS. Connecting a calendar fails loudly and gets fixed, instead │
 * │ of succeeding with tokens that are barely protected.                     │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
import crypto from 'crypto'

const ALGO = 'aes-256-gcm'
const IV_BYTES = 12 // GCM standard nonce length
const VERSION = 'v1'

export class EncryptionKeyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EncryptionKeyError'
  }
}

/**
 * Resolve the 32-byte key. Accepts exactly two documented forms:
 *   • 64 hexadecimal characters
 *   • base64 that decodes to exactly 32 bytes (`openssl rand -base64 32`)
 * Anything else — including a plausible-looking passphrase — is rejected.
 */
function getKey(): Buffer {
  const raw = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY

  if (!raw) {
    throw new EncryptionKeyError(
      'GOOGLE_TOKEN_ENCRYPTION_KEY is not configured. Generate one with: openssl rand -base64 32'
    )
  }

  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, 'hex')
  }

  try {
    const decoded = Buffer.from(raw, 'base64')
    if (decoded.length === 32) return decoded
  } catch {
    /* fall through to the throw */
  }

  throw new EncryptionKeyError(
    'GOOGLE_TOKEN_ENCRYPTION_KEY is malformed. It must be 64 hex characters, or ' +
      'base64 decoding to exactly 32 bytes. Refusing to derive a weaker key from ' +
      'it. Generate a valid one with: openssl rand -base64 32'
  )
}

/**
 * Is encryption usable right now? Routes call this BEFORE starting an OAuth
 * flow so a misconfigured key surfaces as "Calendar is not configured" rather
 * than as a 500 after the user has already authorised at Google.
 */
export function isEncryptionConfigured(): boolean {
  try {
    getKey()
    return true
  } catch {
    return false
  }
}

export function encryptToken(plaintext: string): string {
  const key = getKey()
  const iv = crypto.randomBytes(IV_BYTES)
  const cipher = crypto.createCipheriv(ALGO, key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [VERSION, iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':')
}

/**
 * Decrypt a value produced by encryptToken. Throws on a malformed payload or a
 * failed auth tag (tampering, or the wrong key). Callers treat any throw as
 * "this token is unusable" and move the connection to `needs_reauth` — never
 * surfacing the reason, which would leak whether the key or the data is wrong.
 */
export function decryptToken(payload: string): string {
  const parts = (payload || '').split(':')
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('Malformed encrypted token')
  }
  const [, ivB64, tagB64, ctB64] = parts
  const key = getKey()

  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString(
    'utf8'
  )
}

/** Length-safe constant-time string comparison (cron secrets, webhook tokens). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a || '', 'utf8')
  const bb = Buffer.from(b || '', 'utf8')
  // timingSafeEqual throws on a length mismatch, and the length itself is not a
  // useful secret here, so compare lengths first and bail.
  if (ab.length !== bb.length) return false
  return crypto.timingSafeEqual(ab, bb)
}

/**
 * A strong temporary password with a guaranteed mix of character classes.
 * Ambiguous glyphs (0/O, 1/l/I) are excluded so an org can read the value aloud
 * or retype it reliably when handing it to a new teammate.
 */
export function generateTempPassword(length = 16): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const lower = 'abcdefghijkmnpqrstuvwxyz'
  const digits = '23456789'
  const symbols = '!@#$%^&*-_=+'
  const categories = [upper, lower, digits, symbols]
  const all = upper + lower + digits + symbols

  const bytes = crypto.randomBytes(length)
  const chars: string[] = []
  for (let i = 0; i < length; i++) chars.push(all[bytes[i] % all.length])

  // Guarantee at least one from each class (position-shuffled below).
  const pick = crypto.randomBytes(categories.length)
  for (let i = 0; i < categories.length; i++) {
    chars[i] = categories[i][pick[i] % categories[i].length]
  }

  // Fisher-Yates with crypto randomness so the guaranteed characters are not
  // always the first four.
  const shuffle = crypto.randomBytes(length)
  for (let i = length - 1; i > 0; i--) {
    const j = shuffle[i] % (i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }

  return chars.join('')
}
