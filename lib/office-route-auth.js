import { createHash, timingSafeEqual } from 'node:crypto'

const OFFICE_SESSION_COOKIE_NAME = 'office_admin_session'

export class OfficeRequestAuthError extends Error {
  constructor(message = 'Unauthorized office request', status = 401) {
    super(message)
    this.name = 'OfficeRequestAuthError'
    this.status = status
  }
}

function compareToken(left, right) {
  const leftBuffer = Buffer.from(String(left || ''))
  const rightBuffer = Buffer.from(String(right || ''))
  if (leftBuffer.length !== rightBuffer.length) return false
  return timingSafeEqual(leftBuffer, rightBuffer)
}

function getConfiguredOfficeToken() {
  return (
    process.env.OFFICE_ADMIN_TOKEN
    || process.env.OPENCLAW_OFFICE_TOKEN
    || process.env.X_OFFICE_TOKEN
    || ''
  )
}

function hashOfficeToken(token) {
  return createHash('sha256')
    .update(`office-admin:${String(token || '')}`)
    .digest('hex')
}

export function getOfficeSessionCookieName() {
  return OFFICE_SESSION_COOKIE_NAME
}

export function isOfficeAuthConfigured() {
  return Boolean(getConfiguredOfficeToken())
}

export function createOfficeSessionCookieValue(token) {
  return hashOfficeToken(token)
}

export function validateOfficeToken(candidate) {
  const token = getConfiguredOfficeToken()
  if (!token) return true
  return compareToken(candidate, token)
}

function getOfficeHeaderToken(request) {
  return (
    request.headers.get('x-office-token')
    || request.headers.get('x-office')
    || request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    || null
  )
}

function isAuthorizedByCookie(request) {
  if (!isOfficeAuthConfigured()) return true
  const expected = createOfficeSessionCookieValue(getConfiguredOfficeToken())
  const received = request.cookies.get(getOfficeSessionCookieName())?.value || ''
  if (!expected || !received) return false
  return compareToken(received, expected)
}

export function getOfficeAuthState(request) {
  const configured = isOfficeAuthConfigured()
  if (!configured) {
    return {
      configured: false,
      authenticated: true,
      authSource: 'disabled',
    }
  }

  const headerToken = getOfficeHeaderToken(request)
  if (headerToken && validateOfficeToken(headerToken)) {
    return {
      configured: true,
      authenticated: true,
      authSource: 'header',
    }
  }

  if (isAuthorizedByCookie(request)) {
    return {
      configured: true,
      authenticated: true,
      authSource: 'cookie',
    }
  }

  return {
    configured: true,
    authenticated: false,
    authSource: null,
  }
}

export function assertOfficeApiRequest(request) {
  const state = getOfficeAuthState(request)
  if (state.authenticated) return state
  throw new OfficeRequestAuthError()
}

export function getOfficeRequestErrorStatus(error, fallback = 500) {
  return Number.isInteger(error?.status) ? error.status : fallback
}
