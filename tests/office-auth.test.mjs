import test from 'node:test'
import assert from 'node:assert/strict'

process.env.OFFICE_ADMIN_TOKEN = 'office-secret'

const {
  assertOfficeApiRequest,
  createOfficeSessionCookieValue,
  getOfficeAuthState,
  getOfficeSessionCookieName,
  isOfficeAuthConfigured,
  validateOfficeToken,
} = await import('../lib/office-route-auth.js')

function createRequestLike({ headers = {}, cookieValue = null } = {}) {
  const normalizedHeaders = new Headers(headers)
  return {
    headers: normalizedHeaders,
    cookies: {
      get(name) {
        if (name !== getOfficeSessionCookieName() || !cookieValue) return undefined
        return { value: cookieValue }
      },
    },
  }
}

test('office auth is enabled when OFFICE_ADMIN_TOKEN is configured', () => {
  assert.equal(isOfficeAuthConfigured(), true)
  assert.equal(validateOfficeToken('office-secret'), true)
  assert.equal(validateOfficeToken('wrong-secret'), false)
})

test('x-office-token header authorizes office request', () => {
  const request = createRequestLike({
    headers: { 'x-office-token': 'office-secret' },
  })

  const state = assertOfficeApiRequest(request)
  assert.equal(state.authenticated, true)
  assert.equal(state.authSource, 'header')
})

test('office session cookie authorizes office request', () => {
  const request = createRequestLike({
    cookieValue: createOfficeSessionCookieValue('office-secret'),
  })

  const state = getOfficeAuthState(request)
  assert.equal(state.authenticated, true)
  assert.equal(state.authSource, 'cookie')
})

test('missing token stays unauthorized when office auth is configured', () => {
  const request = createRequestLike()
  const state = getOfficeAuthState(request)

  assert.equal(state.configured, true)
  assert.equal(state.authenticated, false)
  assert.equal(state.authSource, null)
})
