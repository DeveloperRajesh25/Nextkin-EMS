import 'server-only'

/**
 * Upload POLICY — the rules, with no machinery behind them.
 *
 * This module is split out from `@/lib/upload` for one reason: what it costs to
 * import. The validation pipeline pulls in DOMPurify (and jsdom behind it),
 * `file-type` and `unpdf` — heavyweight, and listed in `serverExternalPackages`
 * so they are traced into the deployed function rather than bundled. A route
 * that only needs to answer "is a 2MB image/png plausible for a logo?" should
 * not pay for any of that, and must not fail to boot if one of them cannot be
 * loaded.
 *
 * That is not hypothetical. `/api/files/presign` imported `checkPresignClaims`
 * from the full module and so loaded jsdom at cold start, for a route that never
 * touches an SVG. A module-load failure there is unrecoverable — it happens
 * before the handler, and therefore before `withErrorHandler`, so the caller
 * gets a platform 500 with no JSON body and no message explaining anything.
 *
 * Everything here is pure: constants and synchronous predicates, no I/O, no
 * optional dependencies. Import it freely.
 */

/** file-type only needs the first few KB to fingerprint anything it knows. */
export const SNIFF_BYTES = 4100

export const MAX_SVG_BYTES = 2 * 1024 * 1024

/** Per-purpose byte caps. */
export const SIZE_LIMITS: Record<string, number> = {
  photo: 5 * 1024 * 1024,
  logo: 2 * 1024 * 1024,
  payslip: 15 * 1024 * 1024,
  employee_doc: 25 * 1024 * 1024,
  work_auth: 25 * 1024 * 1024,
  general: 50 * 1024 * 1024,
}

export function sizeLimitFor(purpose: string): number {
  return SIZE_LIMITS[purpose] ?? SIZE_LIMITS.general
}

/** Purposes that must end up as a genuine raster image. */
export const IMAGE_PURPOSES = new Set(['photo', 'logo'])
/** Purposes where an SVG is acceptable (after sanitization). */
export const SVG_ALLOWED_PURPOSES = new Set(['logo'])

export const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'svg'])

/**
 * Content types that must never be stored, whatever the extension or the
 * claimed type says. HTML is in here because a stored HTML file served from a
 * storage origin is a stored-XSS primitive.
 */
const DANGEROUS_MIMES = new Set([
  'application/x-msdownload',
  'application/x-executable',
  'application/x-elf',
  'application/x-mach-binary',
  'application/vnd.microsoft.portable-executable',
  'application/x-dosexec',
  'application/java-vm',
  'application/java-archive',
  'application/wasm',
  'application/x-sh',
  'application/x-shellscript',
  'application/x-msdos-program',
  'application/x-bat',
  'text/html',
  'application/xhtml+xml',
  'application/hta',
])

export function isDangerousMime(mime: string | null | undefined): boolean {
  return !!mime && DANGEROUS_MIMES.has(mime.toLowerCase())
}

/**
 * Pre-flight the CLAIMS at presign time. Cheap rejections (obviously wrong type
 * or oversized) happen before we hand out an upload URL at all; the real gate is
 * still `validateStoredObject`, which reads the bytes that actually landed.
 */
export function checkPresignClaims(
  purpose: string,
  contentType: string,
  sizeBytes: number,
  ext: string
): { ok: true } | { ok: false; error: string } {
  const limit = sizeLimitFor(purpose)
  if (sizeBytes > limit) {
    const mb = Math.max(1, Math.floor(limit / (1024 * 1024)))
    return { ok: false, error: `That file is larger than the ${mb}MB limit.` }
  }
  if (isDangerousMime(contentType)) {
    return { ok: false, error: 'That file type is not allowed.' }
  }
  if (IMAGE_PURPOSES.has(purpose)) {
    const svgOk = SVG_ALLOWED_PURPOSES.has(purpose) && ext === 'svg'
    if (!contentType.toLowerCase().startsWith('image/') && !svgOk) {
      return { ok: false, error: 'Please choose an image file.' }
    }
  }
  if (purpose === 'payslip' && contentType.toLowerCase() !== 'application/pdf') {
    return { ok: false, error: 'A payslip must be a PDF.' }
  }
  return { ok: true }
}
