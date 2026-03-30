const DEFAULT_BWS_API = 'https://www.bw-space.com'
const FALLBACK_ERROR_LIMIT = 240

export function getAutopenProxyConfig(env = process.env) {
  return {
    upstreamBaseUrl: env.BWS_API_URL || DEFAULT_BWS_API,
    autopenApiKey: env.AUTOPEN_API_KEY || '',
    cronSecret: env.BWS_CRON_SECRET || '',
  }
}

export function extractAutopenErrorDetail(payload) {
  if (!payload) return null

  if (typeof payload === 'string') {
    return payload.trim().slice(0, FALLBACK_ERROR_LIMIT) || null
  }

  if (Array.isArray(payload)) {
    return extractAutopenErrorDetail(payload[0])
  }

  if (typeof payload === 'object') {
    for (const key of ['error', 'message', 'detail', 'reason']) {
      const value = payload[key]
      if (typeof value === 'string' && value.trim()) {
        return value.trim().slice(0, FALLBACK_ERROR_LIMIT)
      }
    }
  }

  try {
    return JSON.stringify(payload).slice(0, FALLBACK_ERROR_LIMIT)
  } catch {
    return null
  }
}

function createAutopenProxyMeta({
  upstreamBaseUrl,
  upstreamPath,
  method,
  ok,
  upstreamStatus,
  startedAt,
  finishedAt,
  detail = null,
}) {
  const startedAtMs = Date.parse(startedAt)
  const finishedAtMs = Date.parse(finishedAt)

  return {
    ok,
    upstreamBaseUrl,
    upstreamPath,
    method,
    upstreamStatus,
    startedAt,
    finishedAt,
    durationMs: Number.isFinite(startedAtMs) && Number.isFinite(finishedAtMs)
      ? Math.max(0, finishedAtMs - startedAtMs)
      : null,
    detail,
  }
}

async function readUpstreamPayload(response) {
  const contentType = response.headers.get('content-type') || ''
  const rawText = await response.text()

  if (!rawText) return null

  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(rawText)
    } catch {
      return { rawText }
    }
  }

  try {
    return JSON.parse(rawText)
  } catch {
    return rawText
  }
}

export async function fetchAutopenUpstream({
  upstreamPath,
  method = 'GET',
  query = null,
  body,
  auth = 'autopen-key',
  timeoutMs = 20000,
  headers = {},
  env = process.env,
  fetchImpl = fetch,
}) {
  const config = getAutopenProxyConfig(env)
  const startedAt = new Date().toISOString()

  if (auth === 'autopen-key' && !config.autopenApiKey) {
    return {
      ok: false,
      status: 500,
      data: null,
      meta: createAutopenProxyMeta({
        upstreamBaseUrl: config.upstreamBaseUrl,
        upstreamPath,
        method,
        ok: false,
        upstreamStatus: 500,
        startedAt,
        finishedAt: new Date().toISOString(),
        detail: 'AUTOPEN_API_KEY 未設定',
      }),
    }
  }

  if (auth === 'cron-bearer' && !config.cronSecret) {
    return {
      ok: false,
      status: 500,
      data: null,
      meta: createAutopenProxyMeta({
        upstreamBaseUrl: config.upstreamBaseUrl,
        upstreamPath,
        method,
        ok: false,
        upstreamStatus: 500,
        startedAt,
        finishedAt: new Date().toISOString(),
        detail: 'BWS_CRON_SECRET 未設定',
      }),
    }
  }

  const requestHeaders = new Headers(headers)
  if (auth === 'autopen-key') requestHeaders.set('x-api-key', config.autopenApiKey)
  if (auth === 'cron-bearer') requestHeaders.set('Authorization', `Bearer ${config.cronSecret}`)
  if (body !== undefined && !requestHeaders.has('Content-Type')) {
    requestHeaders.set('Content-Type', 'application/json')
  }

  const search = query
    ? (query instanceof URLSearchParams ? query.toString() : new URLSearchParams(query).toString())
    : ''
  const url = `${config.upstreamBaseUrl}${upstreamPath}${search ? `?${search}` : ''}`
  const signal = timeoutMs && typeof AbortSignal?.timeout === 'function'
    ? AbortSignal.timeout(timeoutMs)
    : undefined

  try {
    const response = await fetchImpl(url, {
      method,
      headers: Object.fromEntries(requestHeaders.entries()),
      body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
      signal,
      next: { revalidate: 0 },
    })

    const payload = await readUpstreamPayload(response)
    const finishedAt = new Date().toISOString()

    return {
      ok: response.ok,
      status: response.status,
      data: payload,
      meta: createAutopenProxyMeta({
        upstreamBaseUrl: config.upstreamBaseUrl,
        upstreamPath,
        method,
        ok: response.ok,
        upstreamStatus: response.status,
        startedAt,
        finishedAt,
        detail: response.ok ? null : extractAutopenErrorDetail(payload),
      }),
    }
  } catch (error) {
    const isTimeout = error?.name === 'AbortError' || error?.name === 'TimeoutError'

    return {
      ok: false,
      status: isTimeout ? 504 : 502,
      data: null,
      meta: createAutopenProxyMeta({
        upstreamBaseUrl: config.upstreamBaseUrl,
        upstreamPath,
        method,
        ok: false,
        upstreamStatus: isTimeout ? 504 : 502,
        startedAt,
        finishedAt: new Date().toISOString(),
        detail: error?.message || 'AutoPen 上游請求失敗',
      }),
    }
  }
}

export function createAutopenErrorPayload(result, fallbackMessage) {
  const detail = result?.meta?.detail || null

  return {
    error: fallbackMessage,
    detail,
    meta: result?.meta || null,
  }
}

export function withAutopenMeta(payload, meta, collectionKey = 'data') {
  if (Array.isArray(payload)) {
    return { [collectionKey]: payload, meta }
  }

  if (payload && typeof payload === 'object') {
    return { ...payload, meta }
  }

  return { [collectionKey]: payload ?? null, meta }
}
