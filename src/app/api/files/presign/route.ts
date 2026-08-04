import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError } from '@/lib/api'
import { apiRequireTenantUser } from '@/lib/auth/guards'
import { presignSchema } from '@/lib/schemas'
import { buildKey, extensionOf, presignPut, isR2Configured } from '@/lib/r2'
import { checkPresignClaims } from '@/lib/upload'
import { rateLimit, limitKey } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

/** Which purposes an employee may upload for. Everything else is org-only. */
const EMPLOYEE_PURPOSES = new Set(['photo', 'general'])

const FOLDERS: Record<string, string> = {
  photo: 'photos',
  logo: 'branding',
  payslip: 'payslips',
  employee_doc: 'documents',
  work_auth: 'work-auth',
  general: 'files',
}

/**
 * Phase one of an upload: hand back a short-lived presigned PUT.
 *
 * The KEY IS BUILT HERE, on the server, from the caller's own tenant id. The
 * client never proposes a path, so it cannot write into another tenant's prefix
 * or overwrite an existing object — the basename is a fresh UUID every time.
 *
 * The claim checks below are a courtesy (fail fast, before a 25MB upload), not
 * the security boundary. That is `/api/files/finalize`, which inspects the bytes
 * that actually arrived.
 */
async function handlePOST(request: NextRequest) {
  const gate = await apiRequireTenantUser()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  if (!isR2Configured()) {
    return jsonError('File storage is not configured. Please contact support.', 503)
  }

  const limited = await rateLimit(limitKey('presign', ctx.userId), 60, 10 * 60 * 1000)
  if (!limited.ok) return jsonError('Too many uploads. Please wait a moment.', 429)

  const input = await parseBody(request, presignSchema)

  if (ctx.role !== 'org' && !EMPLOYEE_PURPOSES.has(input.purpose)) {
    return jsonError('You do not have permission to upload this kind of file.', 403)
  }

  const ext = extensionOf(input.fileName)
  const claims = checkPresignClaims(input.purpose, input.contentType, input.sizeBytes, ext)
  if (!claims.ok) return jsonError(claims.error, 400)

  const key = buildKey(ctx.tenantId, FOLDERS[input.purpose] ?? 'files', ext)
  const url = await presignPut(key, input.contentType, input.sizeBytes)

  return jsonOk({ url, key })
}

export const POST = withErrorHandler(handlePOST)
