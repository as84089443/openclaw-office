import {
  decodeMerchantSession,
  getMerchantSessionCookieName,
} from '../fnb-service.js'
import { createHash, timingSafeEqual } from 'crypto'

const OPS_SESSION_COOKIE_NAME = 'fnb_ops_admin'

export class RequestAuthError extends Error {
  constructor(message = 'Unauthorized', status = 401) {
    super(message)
    this.name = 'RequestAuthError'
    this.status = status
  }
}

function compareToken(left, right) {
  const leftBuffer = Buffer.from(String(left || ''))
  const rightBuffer = Buffer.from(String(right || ''))
  if (leftBuffer.length !== rightBuffer.length) return false
  return timingSafeEqual(leftBuffer, rightBuffer)
}

function hashOpsToken(token) {
  return createHash('sha256').update(`fnb-ops:${String(token || '')}`).digest('hex')
}

export function resolveMerchantRequestSession(request) {
  const sessionToken = request.cookies.get(getMerchantSessionCookieName())?.value || null
  const session = decodeMerchantSession(sessionToken)
    || (process.env.FNB_DEMO_MODE === '1' ? { lineUserId: 'line:merchant-azhu', defaultLocationId: null } : null)
  return {
    session,
    lineUserId: session?.lineUserId || null,
    defaultLocationId: session?.defaultLocationId || null,
  }
}

export function getOpsSessionCookieName() {
  return OPS_SESSION_COOKIE_NAME
}

export function createOpsSessionCookieValue(token) {
  return hashOpsToken(token)
}

export function validateOpsToken(candidate) {
  const token = process.env.FNB_INTERNAL_API_TOKEN
  if (process.env.FNB_DEMO_MODE === '1') return true
  if (!token) throw new RequestAuthError('FNB_INTERNAL_API_TOKEN is required for internal F&B routes', 500)
  return compareToken(candidate, token)
}

function isAuthorizedByCookie(request) {
  const expected = createOpsSessionCookieValue(process.env.FNB_INTERNAL_API_TOKEN || '')
  const received = request.cookies.get(getOpsSessionCookieName())?.value || ''
  if (!expected || !received) return false
  return compareToken(received, expected)
}

export function assertInternalApiRequest(request) {
  if (process.env.FNB_DEMO_MODE === '1') return
  const received = request.headers.get('x-fnb-admin-token') || request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (received && validateOpsToken(received)) return
  if (isAuthorizedByCookie(request)) return
  throw new RequestAuthError('Unauthorized internal F&B request', 401)
}

export function getRequestErrorStatus(error, fallback = 500) {
  return Number.isInteger(error?.status) ? error.status : fallback
}
