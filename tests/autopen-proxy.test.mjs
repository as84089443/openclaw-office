import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createAutopenErrorPayload,
  extractAutopenErrorDetail,
  fetchAutopenUpstream,
  withAutopenMeta,
} from '../lib/autopen-proxy.js'

test('extractAutopenErrorDetail prefers structured error fields', () => {
  assert.equal(
    extractAutopenErrorDetail({ message: '上游驗證失敗', detail: '忽略這個' }),
    '上游驗證失敗',
  )
})

test('fetchAutopenUpstream returns success data with diagnostics meta', async () => {
  const result = await fetchAutopenUpstream({
    upstreamPath: '/api/admin/autopen/stats',
    env: {
      BWS_API_URL: 'https://example.test',
      AUTOPEN_API_KEY: 'autopen-secret',
    },
    fetchImpl: async (url, init) => {
      assert.equal(url, 'https://example.test/api/admin/autopen/stats')
      assert.equal(init.method, 'GET')
      assert.equal(init.headers['x-api-key'], 'autopen-secret')

      return new Response(JSON.stringify({ total: 18, today_completed: 4 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  })

  assert.equal(result.ok, true)
  assert.equal(result.status, 200)
  assert.equal(result.data.total, 18)
  assert.equal(result.meta.ok, true)
  assert.equal(result.meta.upstreamPath, '/api/admin/autopen/stats')
})

test('fetchAutopenUpstream keeps upstream error detail for diagnostics', async () => {
  const result = await fetchAutopenUpstream({
    upstreamPath: '/api/admin/autopen',
    query: new URLSearchParams({ limit: '20' }),
    env: {
      BWS_API_URL: 'https://example.test',
      AUTOPEN_API_KEY: 'autopen-secret',
    },
    fetchImpl: async () => new Response(JSON.stringify({ error: 'Invalid API key' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    }),
  })

  assert.equal(result.ok, false)
  assert.equal(result.status, 401)
  assert.equal(result.meta.detail, 'Invalid API key')

  const payload = createAutopenErrorPayload(result, 'AutoPen 任務列表同步失敗')
  assert.equal(payload.error, 'AutoPen 任務列表同步失敗')
  assert.equal(payload.detail, 'Invalid API key')
  assert.equal(payload.meta.upstreamStatus, 401)
})

test('fetchAutopenUpstream fails fast when cron secret is missing', async () => {
  const result = await fetchAutopenUpstream({
    upstreamPath: '/api/cron/autopen-worker',
    method: 'POST',
    auth: 'cron-bearer',
    env: {
      BWS_API_URL: 'https://example.test',
    },
    fetchImpl: async () => {
      throw new Error('should not call upstream')
    },
  })

  assert.equal(result.ok, false)
  assert.equal(result.status, 500)
  assert.equal(result.meta.detail, 'BWS_CRON_SECRET 未設定')
})

test('withAutopenMeta wraps array payloads under the requested collection key', () => {
  const payload = withAutopenMeta([{ id: 1 }, { id: 2 }], { ok: true }, 'tasks')

  assert.deepEqual(payload.tasks, [{ id: 1 }, { id: 2 }])
  assert.deepEqual(payload.meta, { ok: true })
})
