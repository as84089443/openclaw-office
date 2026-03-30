import test from 'node:test'
import assert from 'node:assert/strict'

import { getAutopenWorkerProxyRequest } from '../lib/autopen-worker.js'

test('worker proxy request uses the GET-only upstream cron route with cron bearer auth', () => {
  const request = getAutopenWorkerProxyRequest()

  assert.equal(request.upstreamPath, '/api/cron/autopen-worker')
  assert.equal(request.method, 'GET')
  assert.equal(request.auth, 'cron-bearer')
  assert.equal(request.timeoutMs, 280000)
})
