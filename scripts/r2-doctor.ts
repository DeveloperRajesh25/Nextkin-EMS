/**
 * R2 DOCTOR — proves the upload path works, end to end, from the outside.
 *
 * Uploads are two-phase: the browser PUTs straight to R2 with a presigned url,
 * then the server validates the stored bytes. That means an upload can fail in
 * a place no server log ever sees — the browser's CORS preflight to R2. To the
 * page, a refused preflight is indistinguishable from the network being down;
 * to R2, no request happened at all. This script closes that blind spot by
 * sending the exact preflight a browser sends, per origin.
 *
 *   npm run r2:doctor              check everything, change nothing
 *   npm run r2:doctor -- --fix     also WRITE the CORS policy for the origins below
 *
 * `--fix` needs an R2 API token with **Admin Read & Write** — the Object Read &
 * Write token the app runs on cannot change bucket configuration, and will fail
 * here with AccessDenied. That is expected: the app's own credentials should not
 * be able to rewrite the bucket's CORS policy.
 *
 * ORIGINS are read from R2_CORS_ORIGINS (comma-separated) when set, otherwise
 * derived from APP_URL/NEXT_PUBLIC_APP_URL plus localhost for development.
 */
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  PutBucketCorsCommand,
  GetBucketCorsCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { config } from 'dotenv'

config({ path: '.env.local' })
config()

const FIX = process.argv.includes('--fix')

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID || ''
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || ''
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || ''
const BUCKET = process.env.R2_BUCKET || ''
const ENDPOINT =
  (process.env.R2_ENDPOINT || '').replace(/\/+$/, '') ||
  (ACCOUNT_ID ? `https://${ACCOUNT_ID}.r2.cloudflarestorage.com` : '')

/** Every origin a browser may upload from. */
function origins(): string[] {
  const configured = (process.env.R2_CORS_ORIGINS || '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean)
  if (configured.length) return configured

  const app = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, '')
  return [...new Set([app, 'http://localhost:3000'].filter(Boolean))]
}

/**
 * `content-type` is the only header the uploader sends. `content-length` stays
 * in the list because browsers set it themselves and a preflight that omits it
 * from AllowedHeaders can still be refused by a stricter engine. `etag` is
 * exposed so a client could verify what landed.
 */
function corsRules(allowed: string[]) {
  return [
    {
      AllowedOrigins: allowed,
      AllowedMethods: ['PUT', 'GET', 'HEAD'],
      AllowedHeaders: ['content-type', 'content-length'],
      ExposeHeaders: ['etag'],
      MaxAgeSeconds: 3600,
    },
  ]
}

let failures = 0
const ok = (m: string) => console.log(`  ✓ ${m}`)
const bad = (m: string) => {
  failures++
  console.log(`  ✗ ${m}`)
}
const note = (m: string) => console.log(`    ${m}`)

async function main() {
  console.log('\nR2 doctor\n')

  // --- 1. Configuration -----------------------------------------------------
  console.log('Configuration')
  const missing = (
    [
      ['R2_ACCESS_KEY_ID', ACCESS_KEY_ID],
      ['R2_SECRET_ACCESS_KEY', SECRET_ACCESS_KEY],
      ['R2_BUCKET', BUCKET],
    ] as const
  )
    .filter(([, v]) => !v)
    .map(([k]) => k)

  if (missing.length || !ENDPOINT) {
    bad(`missing ${[...missing, ENDPOINT ? '' : 'R2_ENDPOINT or R2_ACCOUNT_ID'].filter(Boolean).join(', ')}`)
    note('Uploads answer 503 "File storage is not configured" until these are set.')
    process.exit(1)
  }
  ok(`bucket ${BUCKET} at ${ENDPOINT}`)

  const client = new S3Client({
    region: 'auto',
    endpoint: ENDPOINT,
    forcePathStyle: true,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    credentials: { accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY },
  })

  const key = `__doctor/${new Date().toISOString().replace(/[:.]/g, '-')}.bin`
  const body = Buffer.from('r2-doctor round trip')

  // --- 2. CORS --------------------------------------------------------------
  console.log('\nCORS policy')
  const wanted = origins()
  note(`origins that must be allowed: ${wanted.join(', ')}`)

  if (FIX) {
    try {
      await client.send(
        new PutBucketCorsCommand({
          Bucket: BUCKET,
          CORSConfiguration: { CORSRules: corsRules(wanted) },
        })
      )
      ok('CORS policy written')
    } catch (err) {
      bad(`could not write the CORS policy: ${(err as Error).name}`)
      note('Needs an R2 API token with Admin Read & Write. Set it in the CORS box')
      note('in the Cloudflare dashboard instead (R2 → bucket → Settings → CORS Policy):')
      note(JSON.stringify(corsRules(wanted)))
    }
  }

  try {
    const current = await client.send(new GetBucketCorsCommand({ Bucket: BUCKET }))
    note(`current policy: ${JSON.stringify(current.CORSRules)}`)
  } catch {
    note('(cannot read the stored policy with this token — probing it instead)')
  }

  /*
   * The real test, and the one that matters: send the browser's preflight. A
   * 403 here IS the bug users see as "the upload did not complete", however
   * healthy the bucket looks from the server side.
   */
  const probeUrl = await getSignedUrl(
    client,
    new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: 'application/octet-stream' }),
    { expiresIn: 300 }
  )

  if (/x-amz-checksum/.test(probeUrl)) {
    bad('the presigned url carries an x-amz-checksum-* parameter — uploads will mismatch')
    note('The S3 client must be built with requestChecksumCalculation: WHEN_REQUIRED.')
  } else {
    ok('presigned url is clean (no SDK checksum parameters)')
  }

  const signedHeaders = new URL(probeUrl).searchParams.get('X-Amz-SignedHeaders') || ''
  if (signedHeaders.split(';').some((h) => h && h !== 'host')) {
    bad(`the signature covers headers a browser cannot control: ${signedHeaders}`)
  } else {
    ok('signature covers host only')
  }

  for (const origin of wanted) {
    const res = await fetch(probeUrl, {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'PUT',
        'Access-Control-Request-Headers': 'content-type',
      },
    })
    const allow = res.headers.get('access-control-allow-origin')
    if (res.ok && allow) {
      ok(`preflight from ${origin} → ${res.status}`)
    } else {
      bad(`preflight from ${origin} → ${res.status} (no allow-origin header)`)
      note('Every browser upload from this origin fails. Add it to the bucket CORS policy.')
    }
  }

  // --- 3. Round trip --------------------------------------------------------
  console.log('\nRound trip')
  try {
    const put = await fetch(probeUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body,
    })
    if (!put.ok) {
      bad(`presigned PUT → ${put.status} ${(await put.text()).slice(0, 200)}`)
    } else {
      ok('presigned PUT accepted')

      const head = await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }))
      Number(head.ContentLength) === body.length
        ? ok(`HEAD reports ${head.ContentLength} bytes`)
        : bad(`HEAD reports ${head.ContentLength} bytes, expected ${body.length}`)

      const getUrl = await getSignedUrl(
        client,
        new GetObjectCommand({ Bucket: BUCKET, Key: key }),
        { expiresIn: 300 }
      )
      const get = await fetch(getUrl)
      ;(await get.text()) === body.toString()
        ? ok('presigned GET returns the same bytes')
        : bad('presigned GET returned different bytes')
    }
  } finally {
    await client
      .send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }))
      .then(() => ok('test object deleted'))
      .catch(() => bad(`could not delete the test object ${key}`))
  }

  console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('\nr2-doctor crashed:', err)
  process.exit(1)
})
