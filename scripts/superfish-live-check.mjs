import { readEnvMap, resolveBaseUrl, fetchJson } from './superfish-utils.mjs'

function parseJsonSafe(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function sanitizeBaseUrl(input) {
  return String(input || '').replace(/\/+$/, '')
}

function asCheck(name, pass, detail = null) {
  return { name, pass: Boolean(pass), ...(detail ? { detail } : {}) }
}

async function fetchWithBody(url, options = {}) {
  const response = await fetch(url, options)
  const text = await response.text()
  return {
    ok: response.ok,
    status: response.status,
    headers: response.headers,
    text,
    body: parseJsonSafe(text),
  }
}

async function verifyHealth(baseUrl) {
  const health = await fetchJson(`${baseUrl}/api/health`)
  const line = health?.readiness?.line ?? {}
  const merchantCopilot = health?.readiness?.merchantCopilot ?? {}

  const checks = [
    asCheck('health.status', health?.status === 'healthy', `status=${health?.status ?? 'unknown'}`),
    asCheck('health.readiness.line.messaging', line?.messaging === true),
    asCheck('health.readiness.line.login', line?.login === true),
    asCheck('health.readiness.line.liff', line?.liff === true),
    asCheck('health.readiness.line.richMenuImage', line?.richMenuImage === true),
    asCheck('health.readiness.merchantCopilot.internalRoutesProtected', merchantCopilot?.internalRoutesProtected === true),
    asCheck('health.mode.not_demo', health?.readiness?.demoMode === false && health?.readiness?.environment !== 'demo', `environment=${health?.readiness?.environment ?? 'unknown'}`),
  ]

  return { checks, health }
}

async function verifyLineStart(baseUrl) {
  const callback = `${baseUrl}/api/auth/line/callback`
  const result = await fetchWithBody(`${baseUrl}/api/auth/line/start?redirectTo=/merchant`, {
    redirect: 'manual',
  })
  const location = result.headers.get('location') || ''

  const checks = [
    asCheck('line.start.redirect_status', [302, 303, 307, 308].includes(result.status), `status=${result.status}`),
    asCheck('line.start.redirect_uri', location.includes(`redirect_uri=${encodeURIComponent(callback)}`)),
  ]

  return {
    checks,
    status: result.status,
    location,
    setCookie: result.headers.get('set-cookie') || '',
  }
}

function extractCookieValue(setCookieHeader, key) {
  if (!setCookieHeader) return ''
  const match = setCookieHeader.match(new RegExp(`${key}=([^;]+)`))
  return match ? match[1] : ''
}

async function verifyCallbackDryRun(baseUrl, lineStartInfo) {
  const location = lineStartInfo.location || ''
  let state = ''
  try {
    state = new URL(location).searchParams.get('state') || ''
  } catch {
    state = ''
  }
  const sid = extractCookieValue(lineStartInfo.setCookie, 'fnb_oauth_line_sid')

  if (!state || !sid) {
    return {
      checks: [
        asCheck('line.callback.dry_run.prerequisites', false, 'missing state or oauth cookie from /api/auth/line/start'),
      ],
      status: null,
      body: null,
    }
  }

  const callbackResult = await fetchWithBody(`${baseUrl}/api/auth/line/callback?code=dummy-code&state=${encodeURIComponent(state)}`, {
    redirect: 'manual',
    headers: {
      cookie: `fnb_oauth_line_sid=${sid}`,
    },
  })

  const errorText = String(callbackResult.body?.error || callbackResult.text || '')
  const isMismatch = errorText.includes('LINE OAuth callback redirect URI mismatch')
  return {
    checks: [
      asCheck('line.callback.dry_run.no_redirect_mismatch', !isMismatch, `status=${callbackResult.status}, error=${errorText.slice(0, 80)}`),
    ],
    status: callbackResult.status,
    body: callbackResult.body,
  }
}

async function verifyLiffBootstrap(baseUrl) {
  const result = await fetchWithBody(`${baseUrl}/api/liff/bootstrap`)
  const body = result.body || {}

  const isExpected401 = result.status === 401 && body?.needsBinding === true
  const isExpected200 = result.status === 200 && body?.enabled === true

  return {
    checks: [
      asCheck(
        'liff.bootstrap.expected_response',
        isExpected401 || isExpected200,
        `status=${result.status}, enabled=${String(body?.enabled)}, needsBinding=${String(body?.needsBinding)}`,
      ),
    ],
    status: result.status,
    body,
  }
}

async function verifyInternalMerchantCopilot(baseUrl, envMap = {}) {
  const adminToken = process.env.FNB_INTERNAL_API_TOKEN || envMap.FNB_INTERNAL_API_TOKEN || ''
  const unauthorized = await fetchWithBody(`${baseUrl}/api/fnb/internal/openclaw/tasks`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ action: 'claim-next' }),
  })

  const checks = [
    asCheck(
      'merchantCopilot.internal.unauthorized_status',
      unauthorized.status === 401,
      `status=${unauthorized.status}`,
    ),
  ]

  if (!adminToken) {
    checks.push(asCheck('merchantCopilot.internal.admin_token_present', false, 'missing FNB_INTERNAL_API_TOKEN'))
    return {
      checks,
      unauthorized: { status: unauthorized.status, body: unauthorized.body },
      authorized: null,
    }
  }

  const authorized = await fetchWithBody(`${baseUrl}/api/fnb/internal/openclaw/tasks`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-fnb-admin-token': adminToken,
    },
    body: JSON.stringify({ action: 'claim-next' }),
  })

  checks.push(asCheck('merchantCopilot.internal.authorized_status', authorized.status === 200, `status=${authorized.status}`))
  checks.push(asCheck('merchantCopilot.internal.authorized_ok', authorized.body?.ok === true))

  return {
    checks,
    unauthorized: { status: unauthorized.status, body: unauthorized.body },
    authorized: { status: authorized.status, body: authorized.body },
  }
}

async function main() {
  const envMap = await readEnvMap()
  const baseUrl = sanitizeBaseUrl(resolveBaseUrl(envMap))
  if (!/^https?:\/\//i.test(baseUrl)) {
    throw new Error(`FNB_PUBLIC_BASE_URL is invalid: ${baseUrl}`)
  }

  const healthInfo = await verifyHealth(baseUrl)
  const lineStartInfo = await verifyLineStart(baseUrl)
  const liffInfo = await verifyLiffBootstrap(baseUrl)
  const callbackDryRunInfo = await verifyCallbackDryRun(baseUrl, lineStartInfo)
  const internalInfo = await verifyInternalMerchantCopilot(baseUrl, envMap)

  const checks = [
    ...healthInfo.checks,
    ...lineStartInfo.checks,
    ...liffInfo.checks,
    ...callbackDryRunInfo.checks,
    ...internalInfo.checks,
  ]
  const ok = checks.every((check) => check.pass)

  const output = {
    ok,
    baseUrl,
    checks,
    lineStart: {
      status: lineStartInfo.status,
      location: lineStartInfo.location,
    },
    liffBootstrap: {
      status: liffInfo.status,
      body: liffInfo.body,
    },
    callbackDryRun: {
      status: callbackDryRunInfo.status,
      body: callbackDryRunInfo.body,
    },
    merchantCopilotInternal: internalInfo,
    readiness: healthInfo.health?.readiness ?? null,
  }

  console.log(JSON.stringify(output, null, 2))
  if (!ok) {
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error?.message || String(error) }, null, 2))
  process.exit(1)
})
