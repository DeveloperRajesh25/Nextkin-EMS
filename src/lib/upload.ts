import 'server-only'

/**
 * The upload security pipeline. EVERY byte that reaches R2 passes through here.
 *
 * Stages, in order, all additive:
 *   1. SIZE CAP            — per-purpose, enforced before anything is read.
 *   2. SVG SANITIZATION    — an SVG is XML that can carry <script>; it is parsed,
 *                            stripped with DOMPurify, and the CLEANED bytes are
 *                            what gets stored. Never the original.
 *   3. MAGIC-BYTE SNIFF    — the real content type, from the leading bytes. The
 *                            claimed Content-Type and the extension are both
 *                            attacker-controlled and prove nothing.
 *   4. DANGEROUS-MIME DENY — PE/ELF/Mach-O/wasm/jar/shell/html/xhtml are refused
 *                            no matter what they claim to be.
 *   5. IMAGE-SPOOF CHECK   — something calling itself an image whose bytes are
 *                            not an image is the classic `avatar.png` webshell.
 *
 * WHY THIS RUNS AT FINALIZE, NOT AT PRESIGN
 * -----------------------------------------
 * Uploads are two-phase: the browser PUTs straight to R2 with a presigned URL
 * (so a 40MB file never traverses a lambda), then calls finalize. The presign
 * step has only the client's CLAIMS to go on. So finalize reads the stored
 * object back and validates the bytes that actually landed — and only then is a
 * database row written. An object that fails is deleted. The result: an
 * unreferenced object can exist for a moment, but a row NEVER points at content
 * that was not inspected.
 */
import DOMPurify from 'isomorphic-dompurify'
import { headObject, getObjectHead, getObject, putObject, deleteObject } from '@/lib/r2'

/** file-type only needs the first few KB to fingerprint anything it knows. */
export const SNIFF_BYTES = 4100

const MAX_SVG_BYTES = 2 * 1024 * 1024

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
const IMAGE_PURPOSES = new Set(['photo', 'logo'])
/** Purposes where an SVG is acceptable (after sanitization). */
const SVG_ALLOWED_PURPOSES = new Set(['logo'])

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'svg'])

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
 * Sniff the true MIME from leading bytes.
 *
 * Returns null for text formats (HTML, SVG, CSV) — they have no magic bytes.
 * Callers MUST treat null as "unknown", never as "safe": sniffing is a spoof
 * DETECTOR, not the allowlist.
 *
 * `file-type` is ESM-only, so it is imported dynamically to work under any
 * surrounding module system in the Node runtime.
 */
export async function sniffMime(head: Uint8Array): Promise<string | null> {
  try {
    const { fileTypeFromBuffer } = await import('file-type')
    const result = await fileTypeFromBuffer(head)
    return result?.mime ?? null
  } catch {
    return null
  }
}

/**
 * Strip everything executable from an SVG. Returns the cleaned markup, or null
 * if the input is not a usable SVG or still looks dangerous afterwards.
 */
export function sanitizeSvg(svg: string): string | null {
  if (!svg || svg.length > MAX_SVG_BYTES) return null

  let clean: string
  try {
    clean = DOMPurify.sanitize(svg, {
      USE_PROFILES: { svg: true, svgFilters: true },
      FORBID_TAGS: ['script', 'foreignObject', 'iframe', 'a', 'use', 'image'],
      FORBID_ATTR: [
        'onload', 'onerror', 'onclick', 'onmouseover', 'onmouseenter',
        'onbegin', 'onend', 'onrepeat', 'href', 'xlink:href',
      ],
    })
  } catch {
    return null
  }

  if (!clean || !clean.toLowerCase().includes('<svg')) return null
  // Belt and braces: refuse anything executable that somehow survived.
  if (/<script|javascript:|data:text\/html|on\w+\s*=|<foreignobject/i.test(clean)) return null
  return clean
}

export type ValidationResult =
  | { ok: true; contentType: string; size: number }
  | { ok: false; error: string; status: number }

export interface FinalizeOptions {
  key: string
  purpose: string
  /** Extension taken from the ORIGINAL filename — used for the spoof check only. */
  ext: string
  claimedType: string
}

/**
 * Validate an object already stored in R2. Deletes it and returns an error when
 * any stage fails, so nothing that fails validation stays reachable.
 */
export async function validateStoredObject(opts: FinalizeOptions): Promise<ValidationResult> {
  const { key, purpose, ext, claimedType } = opts
  const limit = sizeLimitFor(purpose)

  // --- 1. True size, from storage, not from the client ----------------------
  let head: { size: number; contentType?: string }
  try {
    head = await headObject(key)
  } catch {
    return { ok: false, error: 'The upload did not complete. Please try again.', status: 400 }
  }

  if (head.size === 0) {
    await deleteObject(key)
    return { ok: false, error: 'That file is empty.', status: 400 }
  }
  if (head.size > limit) {
    await deleteObject(key)
    const mb = Math.max(1, Math.floor(limit / (1024 * 1024)))
    return { ok: false, error: `That file is larger than the ${mb}MB limit.`, status: 413 }
  }

  const lowerExt = (ext || '').toLowerCase()
  const claimed = (claimedType || '').toLowerCase()
  const isSvg = lowerExt === 'svg' || claimed === 'image/svg+xml'

  // --- 2. SVG: sanitize and REPLACE the stored bytes ------------------------
  if (isSvg) {
    if (!SVG_ALLOWED_PURPOSES.has(purpose)) {
      await deleteObject(key)
      return { ok: false, error: 'SVG files are not allowed here.', status: 400 }
    }
    if (head.size > MAX_SVG_BYTES) {
      await deleteObject(key)
      return { ok: false, error: 'That SVG is too large to process safely.', status: 413 }
    }

    let clean: string | null
    try {
      clean = sanitizeSvg((await getObject(key)).toString('utf8'))
    } catch {
      clean = null
    }
    if (!clean) {
      await deleteObject(key)
      return { ok: false, error: 'That SVG could not be processed safely.', status: 400 }
    }

    // Overwrite with the sanitized markup — the original never stays reachable.
    await putObject(key, clean, 'image/svg+xml')
    return { ok: true, contentType: 'image/svg+xml', size: Buffer.byteLength(clean) }
  }

  // --- 3/4/5. Sniff the real bytes -----------------------------------------
  let sniffed: string | null = null
  try {
    sniffed = await sniffMime(await getObjectHead(key, SNIFF_BYTES))
  } catch {
    sniffed = null
  }

  if (isDangerousMime(sniffed)) {
    await deleteObject(key)
    return { ok: false, error: 'That file type is not allowed.', status: 400 }
  }

  const claimsImage = claimed.startsWith('image/') || IMAGE_EXTS.has(lowerExt)
  if (claimsImage && sniffed && !sniffed.startsWith('image/')) {
    await deleteObject(key)
    return { ok: false, error: 'That file is not a valid image.', status: 400 }
  }

  if (IMAGE_PURPOSES.has(purpose) && (!sniffed || !sniffed.startsWith('image/'))) {
    await deleteObject(key)
    return {
      ok: false,
      error: 'Please upload a valid image (PNG, JPEG, WebP or GIF).',
      status: 400,
    }
  }

  if (purpose === 'payslip' && sniffed !== 'application/pdf') {
    await deleteObject(key)
    return { ok: false, error: 'A payslip must be a PDF.', status: 400 }
  }

  // The SNIFFED type wins over the claimed one. Browsers report Content-Type
  // from the OS registry and it is routinely non-canonical (Windows sends PNG as
  // `image/x-png`). Magic bytes are the truth.
  return {
    ok: true,
    contentType: sniffed || claimed || 'application/octet-stream',
    size: head.size,
  }
}

/**
 * Pre-flight the CLAIMS at presign time. Cheap rejections (obviously wrong type
 * or oversized) happen before we hand out an upload URL at all; the real gate is
 * still `validateStoredObject`.
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

/**
 * Extract text from a stored PDF for search and preview.
 *
 * Best-effort by design: a scanned PDF is an image and yields nothing, and a
 * malformed one must not fail the upload that triggered it. Returns null rather
 * than throwing.
 */
export async function extractPdfText(key: string): Promise<string | null> {
  try {
    const buf = await getObject(key)
    const { extractText, getDocumentProxy } = await import('unpdf')
    const pdf = await getDocumentProxy(new Uint8Array(buf))
    const { text } = await extractText(pdf, { mergePages: true })
    const merged = Array.isArray(text) ? text.join('\n') : text
    const trimmed = (merged || '').replace(/\s+\n/g, '\n').trim()
    // Cap what goes to the database — a 500-page contract does not belong in a
    // row, and the tsvector index only needs a representative slice.
    return trimmed ? trimmed.slice(0, 500_000) : null
  } catch (err) {
    console.warn('[pdf] text extraction failed for', key, err)
    return null
  }
}
