import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

import {
  createAutopenWorkerStateSnapshot,
  readAutopenWorkerHistory,
  readAutopenWorkerState,
  readAutopenWorkerStateStore,
  recordAutopenWorkerRun,
} from '../lib/autopen-worker-state.js'

test('createAutopenWorkerStateSnapshot keeps worker counts and meta', () => {
  const snapshot = createAutopenWorkerStateSnapshot({
    ok: true,
    data: {
      processed: 3,
      succeeded: 2,
      failed: 1,
      errors: ['task-1: GPT proxy rate limited'],
    },
    meta: {
      upstreamPath: '/api/cron/autopen-worker',
      method: 'GET',
      upstreamStatus: 200,
      startedAt: '2026-03-29T01:00:00.000Z',
      finishedAt: '2026-03-29T01:00:08.000Z',
      durationMs: 8000,
    },
  }, {
    queueImpact: {
      before: { queued: 4, processing: 0, completed: 10, failed: 1, cancelled: 0 },
      after: { queued: 2, processing: 1, completed: 11, failed: 1, cancelled: 0 },
    },
    taskWindow: {
      tasks: [
        {
          id: 'queued-1',
          status: 'queued',
          keyword: '台北商品攝影棚推薦',
          retry_count: 1,
        },
        {
          id: 'processing-1',
          status: 'processing',
          keyword: '商業空間拍攝技巧',
          processing_phase: '配圖',
        },
      ],
      failureHistory: [
        {
          id: 'failed-1',
          status: 'failed',
          keyword: '商攝報價怎麼寫',
          error_message: 'Publisher rejected payload',
          completed_at: '2026-03-29T01:00:07.000Z',
        },
      ],
      capturedAt: '2026-03-29T01:00:08.000Z',
    },
  })

  assert.equal(snapshot.status, 'success')
  assert.equal(snapshot.processed, 3)
  assert.equal(snapshot.failed, 1)
  assert.equal(snapshot.errors[0], 'task-1: GPT proxy rate limited')
  assert.equal(snapshot.meta.upstreamPath, '/api/cron/autopen-worker')
  assert.equal(snapshot.queueImpact.status, 'changed')
  assert.equal(snapshot.queueImpact.delta.queued, -2)
  assert.equal(snapshot.queueImpact.after.processing, 1)
  assert.equal(snapshot.taskWindow.queuedCandidates[0].keyword, '台北商品攝影棚推薦')
  assert.equal(snapshot.taskWindow.processingCandidates[0].processing_phase, '配圖')
  assert.equal(snapshot.taskWindow.failedCandidates[0].error_message, 'Publisher rejected payload')
})

test('recordAutopenWorkerRun persists a readable worker snapshot history', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'autopen-worker-state-'))
  const filePath = join(tempDir, 'worker.json')

  try {
    recordAutopenWorkerRun({
      ok: false,
      data: { error: 'Unauthorized' },
      meta: {
        upstreamPath: '/api/cron/autopen-worker',
        method: 'GET',
        upstreamStatus: 401,
        startedAt: '2026-03-29T01:05:00.000Z',
        finishedAt: '2026-03-29T01:05:01.000Z',
        durationMs: 1000,
        detail: 'Unauthorized',
      },
    }, {
      filePath,
      origin: 'office-manual-trigger',
    })
    recordAutopenWorkerRun({
      ok: true,
      data: {
        processed: 2,
        succeeded: 2,
        failed: 0,
        errors: [],
      },
      meta: {
        upstreamPath: '/api/cron/autopen-worker',
        method: 'GET',
        upstreamStatus: 200,
        startedAt: '2026-03-29T01:06:00.000Z',
        finishedAt: '2026-03-29T01:06:04.000Z',
        durationMs: 4000,
      },
    }, {
      filePath,
      origin: 'office-manual-trigger',
      taskWindow: {
        tasks: [
          {
            id: 'processing-1',
            status: 'processing',
            keyword: '商業空間拍攝技巧',
            processing_phase: '配圖',
          },
        ],
        capturedAt: '2026-03-29T01:06:04.000Z',
      },
    })

    const written = JSON.parse(readFileSync(filePath, 'utf8'))
    const snapshot = readAutopenWorkerState({ filePath })
    const history = readAutopenWorkerHistory({ filePath })
    const store = readAutopenWorkerStateStore({ filePath })

    assert.equal(written.latest.status, 'success')
    assert.equal(Array.isArray(written.history), true)
    assert.equal(written.history.length, 2)
    assert.equal(snapshot.status, 'success')
    assert.equal(snapshot.meta.upstreamStatus, 200)
    assert.equal(snapshot.origin, 'office-manual-trigger')
    assert.equal(history.length, 2)
    assert.equal(history[0].status, 'success')
    assert.equal(history[1].detail, 'Unauthorized')
    assert.equal(store.latest.status, 'success')
    assert.equal(store.history[1].meta.upstreamStatus, 401)
    assert.equal(store.history[0].queueImpact, null)
    assert.equal(store.history[0].taskWindow.processingCandidates[0].keyword, '商業空間拍攝技巧')
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test('readAutopenWorkerState keeps backward compatibility with legacy single snapshot files', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'autopen-worker-state-legacy-'))
  const filePath = join(tempDir, 'worker.json')

  try {
    const legacySnapshot = {
      status: 'error',
      origin: 'office-manual-trigger',
      triggeredAt: '2026-03-29T01:10:00.000Z',
      completedAt: '2026-03-29T01:10:01.000Z',
      recordedAt: '2026-03-29T01:10:01.000Z',
      processed: 0,
      succeeded: 0,
      failed: 0,
      detail: 'Unauthorized',
      meta: {
        upstreamPath: '/api/cron/autopen-worker',
        upstreamStatus: 401,
      },
    }

    writeFileSync(filePath, `${JSON.stringify(legacySnapshot, null, 2)}\n`)

    const snapshot = readAutopenWorkerState({ filePath })
    const history = readAutopenWorkerHistory({ filePath })
    const store = readAutopenWorkerStateStore({ filePath })

    assert.equal(snapshot.status, 'error')
    assert.equal(snapshot.detail, 'Unauthorized')
    assert.equal(history.length, 1)
    assert.equal(history[0].meta.upstreamStatus, 401)
    assert.equal(store.latest.status, 'error')
    assert.equal(store.history.length, 1)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})
