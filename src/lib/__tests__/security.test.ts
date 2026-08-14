import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { readFile } from 'fs/promises'
import {
  encryptToken, decryptToken, isEncryptionConfigured, safeEqual,
  generateTempPassword, EncryptionKeyError,
} from '@/lib/crypto'
import { isDangerousMime, sanitizeSvg, sizeLimitFor, checkPresignClaims } from '@/lib/upload'
import {
  keyBelongsToTenant, buildKey, extensionOf, presignPut, r2Config, r2ConfigProblem,
} from '@/lib/r2'

const VALID_KEY = 'a'.repeat(64) // 64 hex chars = 32 bytes
const originalKey = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY

afterEach(() => {
  if (originalKey === undefined) delete process.env.GOOGLE_TOKEN_ENCRYPTION_KEY
  else process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = originalKey
})

/**
 * The fail-closed property is the point of this module. A key derivation that
 * quietly accepts anything looks identical from the outside while protecting
 * tokens with whatever entropy someone typed into a dashboard.
 */
describe('token encryption key handling', () => {
  beforeEach(() => {
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = VALID_KEY
  })

  it('round-trips a token', () => {
    const secret = 'ya29.a0AfH6SMBexample-refresh-token'
    const encrypted = encryptToken(secret)
    expect(encrypted).not.toContain(secret)
    expect(decryptToken(encrypted)).toBe(secret)
  })

  it('uses the documented v1:iv:tag:ct wire format', () => {
    const parts = encryptToken('hello').split(':')
    expect(parts).toHaveLength(4)
    expect(parts[0]).toBe('v1')
  })

  it('produces a different ciphertext each time (random IV)', () => {
    expect(encryptToken('same')).not.toBe(encryptToken('same'))
  })

  it('accepts base64 that decodes to exactly 32 bytes', () => {
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')
    expect(isEncryptionConfigured()).toBe(true)
    expect(decryptToken(encryptToken('ok'))).toBe('ok')
  })

  it('FAILS CLOSED on a malformed key instead of hashing it', () => {
    // The tempting shortcut is SHA-256(whatever) so a "wrong" key still works.
    // That silently downgrades AES-256 to the strength of this string.
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = 'changeme'
    expect(isEncryptionConfigured()).toBe(false)
    expect(() => encryptToken('secret')).toThrow(EncryptionKeyError)
  })

  it('FAILS CLOSED on base64 of the wrong length', () => {
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = Buffer.alloc(16, 1).toString('base64')
    expect(isEncryptionConfigured()).toBe(false)
    expect(() => encryptToken('secret')).toThrow(EncryptionKeyError)
  })

  it('FAILS CLOSED when the key is absent', () => {
    delete process.env.GOOGLE_TOKEN_ENCRYPTION_KEY
    expect(isEncryptionConfigured()).toBe(false)
    expect(() => encryptToken('secret')).toThrow(EncryptionKeyError)
  })

  it('rejects a tampered ciphertext via the GCM auth tag', () => {
    const encrypted = encryptToken('sensitive')
    const parts = encrypted.split(':')
    // Flip a byte in the ciphertext.
    const tampered = Buffer.from(parts[3], 'base64')
    tampered[0] ^= 0xff
    parts[3] = tampered.toString('base64')
    expect(() => decryptToken(parts.join(':'))).toThrow()
  })

  it('rejects a payload encrypted under a different key', () => {
    const encrypted = encryptToken('sensitive')
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = 'b'.repeat(64)
    expect(() => decryptToken(encrypted)).toThrow()
  })

  it('rejects a malformed payload shape', () => {
    expect(() => decryptToken('not-a-token')).toThrow('Malformed encrypted token')
    expect(() => decryptToken('v2:a:b:c')).toThrow('Malformed encrypted token')
  })
})

describe('safeEqual', () => {
  it('matches identical strings and rejects everything else', () => {
    expect(safeEqual('secret-value', 'secret-value')).toBe(true)
    expect(safeEqual('secret-value', 'secret-valuf')).toBe(false)
    expect(safeEqual('short', 'a-much-longer-value')).toBe(false)
    expect(safeEqual('', '')).toBe(true)
    expect(safeEqual('x', '')).toBe(false)
  })
})

describe('generateTempPassword', () => {
  it('meets the length and character-class guarantees', () => {
    for (let i = 0; i < 30; i++) {
      const password = generateTempPassword()
      expect(password).toHaveLength(16)
      expect(password).toMatch(/[A-Z]/)
      expect(password).toMatch(/[a-z]/)
      expect(password).toMatch(/[0-9]/)
      expect(password).toMatch(/[!@#$%^&*\-_=+]/)
    }
  })

  it('excludes ambiguous glyphs so it can be read aloud', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateTempPassword()).not.toMatch(/[0O1lI]/)
    }
  })

  it('does not repeat', () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateTempPassword()))
    expect(seen.size).toBe(200)
  })
})

/**
 * Upload pipeline. The rule under test: the claimed type and the extension are
 * attacker-controlled, so neither may be the thing that decides safety.
 */
describe('dangerous MIME denylist', () => {
  it('refuses executables, archives-that-run, scripts and HTML', () => {
    for (const mime of [
      'application/x-msdownload',
      'application/x-executable',
      'application/x-elf',
      'application/x-mach-binary',
      'application/java-archive',
      'application/wasm',
      'application/x-sh',
      'text/html',
      'application/xhtml+xml',
    ]) {
      expect(isDangerousMime(mime)).toBe(true)
    }
  })

  it('allows ordinary document and image types', () => {
    for (const mime of ['application/pdf', 'image/png', 'image/jpeg', 'text/plain']) {
      expect(isDangerousMime(mime)).toBe(false)
    }
  })

  it('treats an unknown (null) sniff as NOT safe-by-default', () => {
    // null means "no signature", which callers must handle as unknown. It is
    // not on the denylist, and it is not a pass either — the imageOnly and
    // payslip checks reject it separately.
    expect(isDangerousMime(null)).toBe(false)
  })
})

describe('SVG sanitization', () => {
  it('strips a script tag', async () => {
    const clean = await sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><circle r="5"/></svg>')
    expect(clean).not.toBeNull()
    expect(clean!.toLowerCase()).not.toContain('<script')
    expect(clean).toContain('circle')
  })

  it('strips inline event handlers', async () => {
    const clean = await sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect onload="alert(1)" width="10" height="10"/></svg>')
    expect(clean).not.toBeNull()
    expect(clean!.toLowerCase()).not.toContain('onload')
  })

  it('strips foreignObject, which can carry arbitrary HTML', async () => {
    const clean = await sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><script>alert(1)</script></body></foreignObject></svg>'
    )
    if (clean !== null) {
      expect(clean.toLowerCase()).not.toContain('foreignobject')
      expect(clean.toLowerCase()).not.toContain('<script')
    }
  })

  it('rejects input that is not an SVG at all', async () => {
    expect(await sanitizeSvg('<html><body>hi</body></html>')).toBeNull()
    expect(await sanitizeSvg('')).toBeNull()
  })

  it('keeps legitimate SVG markup intact', async () => {
    const clean = await sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 4h16v16H4z" fill="#C41E33"/></svg>'
    )
    expect(clean).toContain('path')
    expect(clean).toContain('#C41E33')
  })
})

/**
 * `/api/files/presign` must not be able to import the heavy validation
 * pipeline. This is the regression guard for a cold-start crash that took the
 * whole route down before any error handler existed to explain it.
 */
describe('presign route dependency weight', () => {
  it('reaches no optional heavy dependency from the policy module', async () => {
    const policy = await import('@/lib/upload-policy')
    expect(typeof policy.checkPresignClaims).toBe('function')

    const source = await readFile(
      new URL('../upload-policy.ts', import.meta.url),
      'utf8'
    )
    for (const heavy of ['isomorphic-dompurify', 'jsdom', 'file-type', 'unpdf']) {
      expect(source).not.toContain(`'${heavy}'`)
    }
  })

  it('keeps the route importing policy, not the pipeline', async () => {
    const route = await readFile(
      new URL('../../app/api/files/presign/route.ts', import.meta.url),
      'utf8'
    )
    expect(route).toContain("@/lib/upload-policy")
    expect(route).not.toMatch(/from '@\/lib\/upload'/)
  })
})

describe('presign claim checks', () => {
  it('rejects an oversized file before an upload URL is issued', () => {
    const result = checkPresignClaims('logo', 'image/png', 5 * 1024 * 1024, 'png')
    expect(result.ok).toBe(false)
  })

  it('rejects a dangerous claimed type outright', () => {
    expect(checkPresignClaims('general', 'application/x-msdownload', 1000, 'exe').ok).toBe(false)
  })

  it('requires a payslip to claim PDF', () => {
    expect(checkPresignClaims('payslip', 'image/png', 1000, 'png').ok).toBe(false)
    expect(checkPresignClaims('payslip', 'application/pdf', 1000, 'pdf').ok).toBe(true)
  })

  it('requires an image for photo uploads but allows SVG for a logo', () => {
    expect(checkPresignClaims('photo', 'application/pdf', 1000, 'pdf').ok).toBe(false)
    expect(checkPresignClaims('logo', 'image/svg+xml', 1000, 'svg').ok).toBe(true)
  })

  it('applies a tighter cap to logos than to general files', () => {
    expect(sizeLimitFor('logo')).toBeLessThan(sizeLimitFor('general'))
    expect(sizeLimitFor('unknown-purpose')).toBe(sizeLimitFor('general'))
  })
})

/**
 * Storage keys. The `<tenant_id>/` prefix is what lets a download route prove
 * ownership cheaply, so anything that could break the prefix test matters.
 */
describe('R2 key scoping', () => {
  const tenantA = '11111111-1111-1111-1111-111111111111'
  const tenantB = '22222222-2222-2222-2222-222222222222'

  it('accepts a key under the caller tenant', () => {
    expect(keyBelongsToTenant(`${tenantA}/payslips/abc.pdf`, tenantA)).toBe(true)
  })

  it('rejects another tenant key', () => {
    expect(keyBelongsToTenant(`${tenantB}/payslips/abc.pdf`, tenantA)).toBe(false)
  })

  it('rejects traversal and absolute paths', () => {
    expect(keyBelongsToTenant(`${tenantA}/../${tenantB}/secret.pdf`, tenantA)).toBe(false)
    expect(keyBelongsToTenant(`/${tenantA}/file.pdf`, tenantA)).toBe(false)
    expect(keyBelongsToTenant(`../../etc/passwd`, tenantA)).toBe(false)
  })

  it('rejects a prefix that merely STARTS with the tenant id', () => {
    // Without the trailing slash, tenant `1111…` would match `1111…-evil/`.
    expect(keyBelongsToTenant(`${tenantA}-evil/file.pdf`, tenantA)).toBe(false)
  })

  it('rejects empty inputs', () => {
    expect(keyBelongsToTenant('', tenantA)).toBe(false)
    expect(keyBelongsToTenant(`${tenantA}/x.pdf`, '')).toBe(false)
  })

  it('builds keys with a random basename, never the client filename', () => {
    const key = buildKey(tenantA, 'payslips', 'pdf')
    expect(key.startsWith(`${tenantA}/payslips/`)).toBe(true)
    expect(key.endsWith('.pdf')).toBe(true)
    expect(buildKey(tenantA, 'payslips', 'pdf')).not.toBe(key)
  })

  it('sanitizes a hostile extension and folder', () => {
    const key = buildKey(tenantA, '../../etc', 'pdf?x=1')
    expect(key).not.toContain('..')
    expect(key).toMatch(/\.pdf$/)
  })

  it('extracts extensions safely', () => {
    expect(extensionOf('invoice.PDF')).toBe('pdf')
    expect(extensionOf('archive.tar.gz')).toBe('gz')
    expect(extensionOf('noextension')).toBe('')
    expect(extensionOf('weird.p df')).toBe('pdf')
  })
})

/**
 * The SHAPE of the presigned upload url.
 *
 * Both properties asserted here have broken uploads in production before, and
 * neither is visible in a server log — the failure happens between the browser
 * and the storage backend. They are cheap to assert and expensive to rediscover.
 */
describe('R2 presigned upload url', () => {
  let url: string

  beforeAll(async () => {
    Object.assign(r2Config, {
      accessKeyId: 'A'.repeat(32),
      secretAccessKey: 'S'.repeat(64),
      bucket: 'test-bucket',
      endpoint: 'https://account.r2.cloudflarestorage.com',
    })
    url = await presignPut('tenant/photos/abc.png', 'image/png')
  })

  it('carries no SDK checksum parameters', () => {
    // A CRC32 computed at signing time is the checksum of an EMPTY body; the
    // browser's real bytes would then be rejected as a mismatch.
    expect(url).not.toMatch(/x-amz-checksum/i)
    expect(url).not.toMatch(/x-amz-sdk-checksum-algorithm/i)
  })

  it('signs nothing a browser cannot control', () => {
    // `Content-Length` is a forbidden header name in fetch. Signing it makes the
    // signature depend on a value no client code can set.
    const signed = new URL(url).searchParams.get('X-Amz-SignedHeaders')
    expect(signed).toBe('host')
  })

  it('expires', () => {
    const expires = Number(new URL(url).searchParams.get('X-Amz-Expires'))
    expect(expires).toBeGreaterThan(0)
    expect(expires).toBeLessThanOrEqual(15 * 60)
  })
})

/**
 * Configuration faults must be DIAGNOSED, not thrown.
 *
 * Each shape below made the SDK throw `TypeError: Invalid URL` deep inside
 * signing, which surfaced as a bare 500 on `/api/files/presign` — an upload that
 * fails with nothing anywhere to say why. They are cheap to detect up front.
 */
describe('R2 configuration diagnosis', () => {
  const good = {
    accountId: '',
    accessKeyId: 'A'.repeat(32),
    secretAccessKey: 'S'.repeat(64),
    bucket: 'test-bucket',
    endpoint: 'https://account.r2.cloudflarestorage.com',
  }
  const withConfig = (patch: Partial<typeof good>) => {
    Object.assign(r2Config, good, patch)
    return r2ConfigProblem()
  }

  it('passes a well-formed configuration', () => {
    expect(withConfig({})).toBeNull()
    expect(withConfig({ endpoint: '', accountId: 'abc123' })).toBeNull()
  })

  it('names each missing variable', () => {
    expect(withConfig({ bucket: '' })).toContain('R2_BUCKET')
    expect(withConfig({ accessKeyId: '' })).toContain('R2_ACCESS_KEY_ID')
    expect(withConfig({ endpoint: '', accountId: '' })).toContain('R2_ENDPOINT or R2_ACCOUNT_ID')
  })

  it('rejects an endpoint that is not a usable URL', () => {
    expect(withConfig({ endpoint: 'account.r2.cloudflarestorage.com' })).toContain('R2_ENDPOINT')
    expect(withConfig({ endpoint: 'http://account.r2.cloudflarestorage.com' })).toContain('https://')
  })

  it('rejects the bucket being pasted into the endpoint', () => {
    // What Cloudflare's bucket page shows is the endpoint WITH the bucket on it.
    const problem = withConfig({ endpoint: 'https://account.r2.cloudflarestorage.com/my-bucket' })
    expect(problem).toContain('R2_BUCKET')
  })

  it('never leaks a value', () => {
    const problem = withConfig({ endpoint: 'nonsense', secretAccessKey: 'topsecret' })
    expect(problem).not.toContain('topsecret')
    expect(problem).not.toContain('nonsense')
  })

  afterEach(() => Object.assign(r2Config, good))
})
