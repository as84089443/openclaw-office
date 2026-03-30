import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildAutopenOverview,
  normalizeAutopenTask,
} from '../lib/autopen-overview.js'

test('normalizeAutopenTask derives article slug and failure context from result_json', () => {
  const task = normalizeAutopenTask({
    id: 'task-1',
    status: 'failed',
    keyword: '台北自然光攝影棚',
    error_message: '',
    retry_count: '2',
    created_at: '2026-03-29T00:00:00.000Z',
    result_json: {
      slug: 'taipei-daylight-studio',
      _failure: {
        phase: '配圖',
        at: '2026-03-29T00:05:00.000Z',
        reason: 'Unsplash quota exceeded',
      },
    },
  })

  assert.equal(task.article_slug, 'taipei-daylight-studio')
  assert.equal(task.error_message, 'Unsplash quota exceeded')
  assert.equal(task.failure_phase, '配圖')
  assert.equal(task.failure_at, '2026-03-29T00:05:00.000Z')
  assert.equal(task.retry_count, 2)
})

test('buildAutopenOverview normalizes stats and adds failure/worker runbook', () => {
  const overview = buildAutopenOverview({
    statsResult: {
      ok: true,
      data: {
        queued: 3,
        processing: 0,
        completed: 12,
        failed: 2,
        cancelled: 1,
        today: 4,
        avg_duration_seconds: 640,
      },
      meta: {
        upstreamPath: '/api/admin/autopen/stats',
        finishedAt: '2026-03-29T00:10:00.000Z',
      },
    },
    tasksResult: {
      ok: true,
      data: {
        tasks: [
          {
            id: 'task-queued',
            status: 'queued',
            keyword: '攝影棚採光技巧',
            retry_count: 0,
            created_at: '2026-03-29T00:08:00.000Z',
          },
        ],
      },
      meta: {
        upstreamPath: '/api/admin/autopen',
        finishedAt: '2026-03-29T00:10:05.000Z',
      },
    },
    failureHistoryResult: {
      ok: true,
      data: {
        tasks: [
          {
            id: 'task-failed',
            status: 'failed',
            keyword: '商品攝影棚推薦',
            error_message: 'GPT proxy rate limited',
            retry_count: 1,
            completed_at: '2026-03-29T00:09:00.000Z',
          },
        ],
      },
      meta: {
        upstreamPath: '/api/admin/autopen',
        finishedAt: '2026-03-29T00:10:08.000Z',
      },
    },
    retryHint: {
      supported: false,
      reason: '重排仍需回 BWS 後台。',
      href: 'https://www.bw-space.com/admin/autopen',
    },
  })

  assert.equal(overview.summary.todayCompleted, 4)
  assert.equal(overview.summary.total, 18)
  assert.equal(overview.summary.avgDurationSeconds, 640)
  assert.equal(overview.failureHistory.length, 1)
  assert.equal(overview.recentFailures.length, 1)
  assert.equal(overview.recentFailures[0].error_message, 'GPT proxy rate limited')
  assert.equal(overview.sync.ok, true)
  assert.equal(overview.sync.lastOkAt, '2026-03-29T00:10:08.000Z')
  assert.ok(overview.runbook.some(item => item.key === 'worker-idle'))
  assert.ok(overview.runbook.some(item => item.key === 'recent-failures'))
})

test('buildAutopenOverview turns invalid api key into a concrete runbook item', () => {
  const overview = buildAutopenOverview({
    statsResult: {
      ok: false,
      meta: {
        upstreamPath: '/api/admin/autopen/stats',
        upstreamStatus: 401,
        detail: 'Invalid API key',
      },
    },
    tasksResult: {
      ok: true,
      data: { tasks: [] },
      meta: {
        upstreamPath: '/api/admin/autopen',
        finishedAt: '2026-03-29T00:12:00.000Z',
      },
    },
    failureHistoryResult: {
      ok: true,
      data: { tasks: [] },
      meta: {
        upstreamPath: '/api/admin/autopen',
        finishedAt: '2026-03-29T00:12:02.000Z',
      },
    },
  })

  assert.equal(overview.sync.ok, false)
  assert.equal(overview.sync.segments.stats.error, 'Invalid API key')
  assert.ok(overview.runbook.some(item => item.key === '統計-api-key'))
  assert.match(overview.runbook.find(item => item.key === '統計-api-key').detail, /AUTOPEN_API_KEY/)
})

test('buildAutopenOverview keeps dedicated failure history outside recent task window', () => {
  const overview = buildAutopenOverview({
    statsResult: {
      ok: true,
      data: {
        queued: 0,
        processing: 1,
        completed: 20,
        failed: 12,
        cancelled: 0,
        today: 3,
      },
      meta: {
        upstreamPath: '/api/admin/autopen/stats',
        finishedAt: '2026-03-29T00:20:00.000Z',
      },
    },
    tasksResult: {
      ok: true,
      data: {
        tasks: [
          {
            id: 'task-processing',
            status: 'processing',
            keyword: '商業攝影企劃',
            processing_phase: '配圖',
            created_at: '2026-03-29T00:18:00.000Z',
          },
        ],
      },
      meta: {
        upstreamPath: '/api/admin/autopen',
        finishedAt: '2026-03-29T00:20:05.000Z',
      },
    },
    failureHistoryResult: {
      ok: true,
      data: {
        tasks: Array.from({ length: 10 }, (_, index) => ({
          id: `failed-${index}`,
          status: 'failed',
          keyword: `失敗任務 ${index}`,
          error_message: 'Publisher rejected payload',
          completed_at: `2026-03-29T00:${String(index).padStart(2, '0')}:00.000Z`,
        })),
      },
      meta: {
        upstreamPath: '/api/admin/autopen',
        finishedAt: '2026-03-29T00:20:08.000Z',
      },
    },
    failureHistoryLimit: 10,
  })

  assert.equal(overview.failureHistory.length, 10)
  assert.equal(overview.recentFailures.length, 5)
  assert.equal(overview.hasMoreFailureHistory, true)
  assert.ok(overview.runbook.some(item => item.key === 'failure-history-window'))
})

test('buildAutopenOverview groups repeated failed task signatures', () => {
  const overview = buildAutopenOverview({
    statsResult: {
      ok: true,
      data: {
        queued: 0,
        processing: 0,
        completed: 14,
        failed: 3,
        cancelled: 0,
      },
      meta: {
        upstreamPath: '/api/admin/autopen/stats',
        finishedAt: '2026-03-29T00:24:00.000Z',
      },
    },
    tasksResult: {
      ok: true,
      data: { tasks: [] },
      meta: {
        upstreamPath: '/api/admin/autopen',
        finishedAt: '2026-03-29T00:24:02.000Z',
      },
    },
    failureHistoryResult: {
      ok: true,
      data: {
        tasks: [
          {
            id: 'failed-a',
            status: 'failed',
            keyword: '商品照怎麼去背',
            error_message: 'Unsplash quota exceeded',
            failure_phase: '配圖',
            completed_at: '2026-03-29T00:23:00.000Z',
          },
          {
            id: 'failed-b',
            status: 'failed',
            keyword: '棚拍道具怎麼選',
            error_message: 'Unsplash quota exceeded',
            failure_phase: '配圖',
            completed_at: '2026-03-29T00:22:00.000Z',
          },
          {
            id: 'failed-c',
            status: 'failed',
            keyword: '商攝報價單範例',
            error_message: 'Publisher rejected payload',
            failure_phase: '發布',
            completed_at: '2026-03-29T00:21:00.000Z',
          },
        ],
      },
      meta: {
        upstreamPath: '/api/admin/autopen',
        finishedAt: '2026-03-29T00:24:03.000Z',
      },
    },
    retryHint: {
      supported: false,
      reason: '重排仍需回 BWS 後台。',
      href: 'https://www.bw-space.com/admin/autopen',
    },
  })

  assert.equal(overview.failureSignatures.length, 2)
  assert.equal(overview.failureSignatures[0].label, 'Unsplash quota exceeded')
  assert.equal(overview.failureSignatures[0].count, 2)
  assert.deepEqual(
    overview.failureSignatures[0].keywords,
    ['商品照怎麼去背', '棚拍道具怎麼選'],
  )
  assert.ok(overview.runbook.some(item => item.key === 'recent-failure-signature'))
  assert.match(overview.attention.message, /Unsplash quota exceeded/)
})

test('buildAutopenOverview surfaces worker history and repeated worker failures', () => {
  const overview = buildAutopenOverview({
    statsResult: {
      ok: true,
      data: {
        queued: 4,
        processing: 0,
        completed: 18,
        failed: 1,
        cancelled: 0,
      },
      meta: {
        upstreamPath: '/api/admin/autopen/stats',
        finishedAt: '2026-03-29T00:30:00.000Z',
      },
    },
    tasksResult: {
      ok: true,
      data: { tasks: [] },
      meta: {
        upstreamPath: '/api/admin/autopen',
        finishedAt: '2026-03-29T00:30:02.000Z',
      },
    },
    failureHistoryResult: {
      ok: true,
      data: { tasks: [] },
      meta: {
        upstreamPath: '/api/admin/autopen',
        finishedAt: '2026-03-29T00:30:03.000Z',
      },
    },
    workerRun: {
      ok: false,
      origin: 'office-manual-trigger',
      processed: 0,
      succeeded: 0,
      failed: 0,
      detail: 'Unauthorized',
      meta: {
        upstreamPath: '/api/cron/autopen-worker',
        upstreamStatus: 401,
        startedAt: '2026-03-29T00:29:00.000Z',
        finishedAt: '2026-03-29T00:29:01.000Z',
        durationMs: 1000,
      },
    },
    workerHistory: [
      {
        ok: false,
        origin: 'office-manual-trigger',
        processed: 0,
        succeeded: 0,
        failed: 0,
        detail: 'Unauthorized',
        recordedAt: '2026-03-29T00:29:01.000Z',
        meta: {
          upstreamPath: '/api/cron/autopen-worker',
          upstreamStatus: 401,
          startedAt: '2026-03-29T00:29:00.000Z',
          finishedAt: '2026-03-29T00:29:01.000Z',
          durationMs: 1000,
        },
      },
      {
        ok: false,
        origin: 'office-manual-trigger',
        processed: 0,
        succeeded: 0,
        failed: 0,
        detail: 'Unauthorized',
        recordedAt: '2026-03-29T00:28:01.000Z',
        meta: {
          upstreamPath: '/api/cron/autopen-worker',
          upstreamStatus: 401,
          startedAt: '2026-03-29T00:28:00.000Z',
          finishedAt: '2026-03-29T00:28:01.000Z',
          durationMs: 1000,
        },
      },
      {
        ok: true,
        origin: 'office-manual-trigger',
        processed: 2,
        succeeded: 2,
        failed: 0,
        recordedAt: '2026-03-29T00:20:04.000Z',
        meta: {
          upstreamPath: '/api/cron/autopen-worker',
          upstreamStatus: 200,
          startedAt: '2026-03-29T00:20:00.000Z',
          finishedAt: '2026-03-29T00:20:04.000Z',
          durationMs: 4000,
        },
      },
    ],
  })

  assert.equal(overview.workerRun.status, 'error')
  assert.equal(overview.workerRun.meta.upstreamStatus, 401)
  assert.equal(overview.workerHistory.length, 3)
  assert.equal(overview.workerSummary.consecutiveFailures, 2)
  assert.equal(overview.workerFailureSignatures[0].label, 'Unauthorized')
  assert.equal(overview.workerFailureSignatures[0].count, 2)
  assert.equal(overview.workerFailureSignatures[0].consecutiveCount, 2)
  assert.equal(overview.attention.title, '最近 2 次 Worker 觸發都失敗')
  assert.match(overview.attention.message, /Unauthorized/)
  assert.ok(overview.runbook.some(item => item.key === 'worker-last-run-auth'))
  assert.ok(overview.runbook.some(item => item.key === 'worker-consecutive-failures'))
  assert.match(
    overview.runbook.find(item => item.key === 'worker-consecutive-failures').detail,
    /Unauthorized/,
  )
})

test('buildAutopenOverview flags when worker succeeds but queue does not move', () => {
  const overview = buildAutopenOverview({
    statsResult: {
      ok: true,
      data: {
        queued: 5,
        processing: 0,
        completed: 18,
        failed: 0,
        cancelled: 0,
      },
      meta: {
        upstreamPath: '/api/admin/autopen/stats',
        finishedAt: '2026-03-29T00:40:00.000Z',
      },
    },
    tasksResult: {
      ok: true,
      data: {
        tasks: [
          {
            id: 'queued-1',
            status: 'queued',
            keyword: '台北商品攝影棚推薦',
            retry_count: 1,
            created_at: '2026-03-29T00:38:00.000Z',
          },
          {
            id: 'processing-1',
            status: 'processing',
            keyword: '商業空間拍攝技巧',
            processing_phase: '配圖',
            created_at: '2026-03-29T00:38:20.000Z',
          },
        ],
      },
      meta: {
        upstreamPath: '/api/admin/autopen',
        finishedAt: '2026-03-29T00:40:02.000Z',
      },
    },
    failureHistoryResult: {
      ok: true,
      data: {
        tasks: [
          {
            id: 'failed-1',
            status: 'failed',
            keyword: '商攝報價怎麼寫',
            error_message: 'Publisher rejected payload',
            completed_at: '2026-03-29T00:39:30.000Z',
          },
        ],
      },
      meta: {
        upstreamPath: '/api/admin/autopen',
        finishedAt: '2026-03-29T00:40:03.000Z',
      },
    },
    workerRun: {
      ok: true,
      origin: 'office-manual-trigger',
      processed: 2,
      succeeded: 2,
      failed: 0,
      queueImpact: {
        before: { queued: 5, processing: 0, completed: 18, failed: 0, cancelled: 0 },
        after: { queued: 5, processing: 0, completed: 18, failed: 0, cancelled: 0 },
      },
      meta: {
        upstreamPath: '/api/cron/autopen-worker',
        upstreamStatus: 200,
        startedAt: '2026-03-29T00:39:00.000Z',
        finishedAt: '2026-03-29T00:39:05.000Z',
        durationMs: 5000,
      },
    },
  })

  assert.equal(overview.workerRun.queueImpact.status, 'unchanged')
  assert.equal(overview.attention.title, 'Worker 剛跑完，但佇列沒有明顯下降')
  assert.equal(overview.queueDiagnosis.suspectedCause, 'processing-stuck')
  assert.equal(overview.queueDiagnosis.processingCandidates.length, 1)
  assert.equal(overview.queueDiagnosis.queuedCandidates.length, 1)
  assert.equal(overview.queueDiagnosis.failedCandidates.length, 1)
  assert.match(overview.attention.message, /processing 任務/)
  assert.ok(overview.runbook.some(item => item.key === 'worker-queue-unchanged'))
  assert.match(
    overview.runbook.find(item => item.key === 'worker-queue-unchanged').detail,
    /processing 任務/,
  )
})

test('buildAutopenOverview marks persistent stuck tasks across worker snapshots', () => {
  const overview = buildAutopenOverview({
    statsResult: {
      ok: true,
      data: {
        queued: 4,
        processing: 1,
        completed: 18,
        failed: 0,
        cancelled: 0,
      },
      meta: {
        upstreamPath: '/api/admin/autopen/stats',
        finishedAt: '2026-03-29T00:50:00.000Z',
      },
    },
    tasksResult: {
      ok: true,
      data: {
        tasks: [
          {
            id: 'queued-persistent',
            status: 'queued',
            keyword: '台北商品攝影棚推薦',
            retry_count: 2,
            created_at: '2026-03-29T00:48:00.000Z',
          },
          {
            id: 'processing-persistent',
            status: 'processing',
            keyword: '商業空間拍攝技巧',
            processing_phase: '配圖',
            created_at: '2026-03-29T00:48:20.000Z',
          },
        ],
      },
      meta: {
        upstreamPath: '/api/admin/autopen',
        finishedAt: '2026-03-29T00:50:02.000Z',
      },
    },
    failureHistoryResult: {
      ok: true,
      data: { tasks: [] },
      meta: {
        upstreamPath: '/api/admin/autopen',
        finishedAt: '2026-03-29T00:50:03.000Z',
      },
    },
    workerRun: {
      ok: true,
      origin: 'office-manual-trigger',
      processed: 1,
      succeeded: 1,
      failed: 0,
      queueImpact: {
        before: { queued: 4, processing: 1, completed: 18, failed: 0, cancelled: 0 },
        after: { queued: 4, processing: 1, completed: 18, failed: 0, cancelled: 0 },
      },
      meta: {
        upstreamPath: '/api/cron/autopen-worker',
        upstreamStatus: 200,
        startedAt: '2026-03-29T00:49:00.000Z',
        finishedAt: '2026-03-29T00:49:05.000Z',
        durationMs: 5000,
      },
    },
    workerHistory: [
      {
        ok: true,
        origin: 'office-manual-trigger',
        processed: 1,
        succeeded: 1,
        failed: 0,
        recordedAt: '2026-03-29T00:49:05.000Z',
        taskWindow: {
          capturedAt: '2026-03-29T00:49:05.000Z',
          queuedCandidates: [
            {
              id: 'queued-persistent',
              status: 'queued',
              keyword: '台北商品攝影棚推薦',
            },
          ],
          processingCandidates: [
            {
              id: 'processing-persistent',
              status: 'processing',
              keyword: '商業空間拍攝技巧',
              processing_phase: '配圖',
            },
          ],
          failedCandidates: [],
        },
        meta: {
          upstreamPath: '/api/cron/autopen-worker',
          upstreamStatus: 200,
        },
      },
      {
        ok: true,
        origin: 'office-manual-trigger',
        processed: 0,
        succeeded: 0,
        failed: 0,
        recordedAt: '2026-03-29T00:43:05.000Z',
        taskWindow: {
          capturedAt: '2026-03-29T00:43:05.000Z',
          queuedCandidates: [
            {
              id: 'queued-persistent',
              status: 'queued',
              keyword: '台北商品攝影棚推薦',
            },
            {
              id: 'processing-persistent',
              status: 'queued',
              keyword: '商業空間拍攝技巧',
            },
          ],
          processingCandidates: [],
          failedCandidates: [],
        },
        meta: {
          upstreamPath: '/api/cron/autopen-worker',
          upstreamStatus: 200,
        },
      },
    ],
  })

  assert.equal(overview.queueDiagnosis.persistent.candidates.length, 2)
  const queuedCandidate = overview.queueDiagnosis.persistent.candidates.find(
    candidate => candidate.keyword === '台北商品攝影棚推薦',
  )
  assert.equal(queuedCandidate.seenInRuns, 2)
  assert.equal(queuedCandidate.stuckType, 'queued-only')
  assert.equal(queuedCandidate.stuckTypeLabel, '長期待在 queued')
  assert.match(overview.attention.message, /queued -> processing 後卡住/)
  assert.ok(overview.runbook.some(item => item.key === 'persistent-stuck-tasks'))

  const processingCandidate = overview.queueDiagnosis.persistent.candidates.find(
    candidate => candidate.keyword === '商業空間拍攝技巧',
  )
  assert.equal(processingCandidate.timeline.length, 2)
  assert.deepEqual(
    processingCandidate.timeline.map(point => point.bucket),
    ['queued', 'processing'],
  )
  assert.equal(processingCandidate.stuckType, 'queued-to-processing-stuck')
  assert.equal(processingCandidate.stuckTypeLabel, 'queued -> processing 後卡住')
  assert.match(processingCandidate.stuckTypeSummary, /推進到 processing 後就沒有再往前/)
  assert.match(processingCandidate.timelineSummary, /queued -> processing/)
})

test('buildAutopenOverview classifies persistent queued-failed bounce tasks', () => {
  const overview = buildAutopenOverview({
    statsResult: {
      ok: true,
      data: {
        queued: 2,
        processing: 0,
        completed: 18,
        failed: 1,
        cancelled: 0,
      },
      meta: {
        upstreamPath: '/api/admin/autopen/stats',
        finishedAt: '2026-03-29T01:10:00.000Z',
      },
    },
    tasksResult: {
      ok: true,
      data: {
        tasks: [
          {
            id: 'helper-queued',
            status: 'queued',
            keyword: '棚拍服裝搭配',
            created_at: '2026-03-29T01:08:00.000Z',
          },
        ],
      },
      meta: {
        upstreamPath: '/api/admin/autopen',
        finishedAt: '2026-03-29T01:10:02.000Z',
      },
    },
    failureHistoryResult: {
      ok: true,
      data: {
        tasks: [
          {
            id: 'bounce-task',
            status: 'failed',
            keyword: '相片去背教學',
            error_message: 'Unsplash quota exceeded',
            completed_at: '2026-03-29T01:00:30.000Z',
          },
        ],
      },
      meta: {
        upstreamPath: '/api/admin/autopen',
        finishedAt: '2026-03-29T01:10:03.000Z',
      },
    },
    workerRun: {
      ok: true,
      origin: 'office-manual-trigger',
      processed: 1,
      succeeded: 1,
      failed: 0,
      queueImpact: {
        before: { queued: 2, processing: 0, completed: 18, failed: 1, cancelled: 0 },
        after: { queued: 2, processing: 0, completed: 18, failed: 1, cancelled: 0 },
      },
      meta: {
        upstreamPath: '/api/cron/autopen-worker',
        upstreamStatus: 200,
        startedAt: '2026-03-29T01:00:00.000Z',
        finishedAt: '2026-03-29T01:00:05.000Z',
        durationMs: 5000,
      },
    },
    workerHistory: [
      {
        ok: true,
        origin: 'office-manual-trigger',
        processed: 1,
        succeeded: 1,
        failed: 0,
        recordedAt: '2026-03-29T01:00:05.000Z',
        taskWindow: {
          capturedAt: '2026-03-29T01:00:05.000Z',
          queuedCandidates: [],
          processingCandidates: [],
          failedCandidates: [
            {
              id: 'bounce-task',
              status: 'failed',
              keyword: '相片去背教學',
              failure_phase: '配圖',
              error_message: 'Unsplash quota exceeded',
            },
          ],
        },
        meta: {
          upstreamPath: '/api/cron/autopen-worker',
          upstreamStatus: 200,
        },
      },
      {
        ok: true,
        origin: 'office-manual-trigger',
        processed: 0,
        succeeded: 0,
        failed: 0,
        recordedAt: '2026-03-29T00:54:05.000Z',
        taskWindow: {
          capturedAt: '2026-03-29T00:54:05.000Z',
          queuedCandidates: [
            {
              id: 'bounce-task',
              status: 'queued',
              keyword: '相片去背教學',
            },
          ],
          processingCandidates: [],
          failedCandidates: [],
        },
        meta: {
          upstreamPath: '/api/cron/autopen-worker',
          upstreamStatus: 200,
        },
      },
    ],
  })

  const bounceCandidate = overview.queueDiagnosis.persistent.candidates.find(
    candidate => candidate.keyword === '相片去背教學',
  )

  assert.ok(bounceCandidate)
  assert.deepEqual(
    bounceCandidate.timeline.map(point => point.bucket),
    ['queued', 'failed'],
  )
  assert.equal(bounceCandidate.stuckType, 'queued-failed-bounce')
  assert.equal(bounceCandidate.stuckTypeLabel, 'queued / failed 來回震盪')
  assert.equal(bounceCandidate.topErrorSignature.label, 'Unsplash quota exceeded')
  assert.equal(bounceCandidate.topErrorSignature.count, 2)
  assert.equal(bounceCandidate.topErrorSignature.confidence, 'high')
  assert.equal(bounceCandidate.topErrorSignature.confidenceLabel, '高可信度')
  assert.equal(bounceCandidate.topErrorSignature.evidenceScore, 5)
  assert.equal(bounceCandidate.topErrorSignature.consistency, 'strong')
  assert.equal(bounceCandidate.topErrorSignature.consistencyLabel, 'bucket / phase 高度一致')
  assert.equal(bounceCandidate.topErrorSignature.timelineStability, 'medium')
  assert.equal(bounceCandidate.topErrorSignature.timelineStabilityLabel, 'timeline 模式穩定')
  assert.equal(bounceCandidate.topErrorSignature.recentFailureConsistency, 'strong')
  assert.equal(bounceCandidate.topErrorSignature.recentFailureConsistencyLabel, 'recent failure 高度一致')
  assert.match(bounceCandidate.topErrorSignature.evidenceSummary, /task 自身錯誤訊息/)
  assert.match(bounceCandidate.topErrorSignature.evidenceSummary, /bucket（failed）與 phase（配圖）都和這個 signature 對得上/)
  assert.match(bounceCandidate.topErrorSignature.evidenceSummary, /最近 2 次 snapshot 仍維持固定的 queued -> failed 模式/)
  assert.match(bounceCandidate.topErrorSignature.evidenceSummary, /recent failure history 裡有 1 筆和這個 signature 相同的錯誤/)
  assert.equal(
    bounceCandidate.rootCausePatternLabel,
    'queued / failed 來回震盪 + Unsplash quota exceeded',
  )
  assert.equal(bounceCandidate.patternRunbookFocusKey, 'image-quota-bounce')
  assert.equal(bounceCandidate.patternRunbookFocusLabel, '配圖 quota 重試循環')
  assert.match(bounceCandidate.patternRunbookFocusDetail, /Unsplash quota|配圖供應商限制/)
  assert.match(
    bounceCandidate.rootCausePatternDetail,
    /最近重複錯誤是「Unsplash quota exceeded」/,
  )
  assert.ok(Array.isArray(bounceCandidate.patternRunbookSteps))
  assert.match(
    bounceCandidate.patternRunbookSteps.join(' '),
    /Unsplash|quota|配圖來源/,
  )
  assert.match(
    bounceCandidate.patternRunbookSteps.join(' '),
    /quota reset|不要先重排整批|圖片供應商額度/,
  )
  assert.match(bounceCandidate.stuckTypeSummary, /重試後又撞到同一種錯誤/)
  assert.match(overview.queueDiagnosis.persistent.summary, /queued \/ failed 來回震盪 \+ Unsplash quota exceeded/)
  const persistentRunbook = overview.runbook.find(item => item.key === 'persistent-stuck-tasks')
  assert.ok(persistentRunbook)
  assert.match(persistentRunbook.title, /配圖 quota 重試循環/)
  assert.match(
    persistentRunbook.steps.join(' '),
    /Unsplash|quota|配圖來源/,
  )
  assert.match(
    persistentRunbook.steps.join(' '),
    /quota reset|不要先重排整批|圖片供應商額度/,
  )
})

test('buildAutopenOverview infers persistent task signature from matching worker failures when task error is missing', () => {
  const overview = buildAutopenOverview({
    statsResult: {
      ok: true,
      data: {
        queued: 1,
        processing: 1,
        completed: 18,
        failed: 0,
        cancelled: 0,
      },
      meta: {
        upstreamPath: '/api/admin/autopen/stats',
        finishedAt: '2026-03-29T01:20:00.000Z',
      },
    },
    tasksResult: {
      ok: true,
      data: {
        tasks: [
          {
            id: 'helper-queued',
            status: 'queued',
            keyword: '商攝服裝準備',
            created_at: '2026-03-29T01:18:00.000Z',
          },
          {
            id: 'stuck-processing',
            status: 'processing',
            keyword: '商業攝影合約注意事項',
            processing_phase: '發布',
            created_at: '2026-03-29T01:18:30.000Z',
          },
        ],
      },
      meta: {
        upstreamPath: '/api/admin/autopen',
        finishedAt: '2026-03-29T01:20:02.000Z',
      },
    },
    failureHistoryResult: {
      ok: true,
      data: { tasks: [] },
      meta: {
        upstreamPath: '/api/admin/autopen',
        finishedAt: '2026-03-29T01:20:03.000Z',
      },
    },
    workerRun: {
      ok: true,
      origin: 'office-manual-trigger',
      processed: 0,
      succeeded: 0,
      failed: 0,
      queueImpact: {
        before: { queued: 1, processing: 1, completed: 18, failed: 0, cancelled: 0 },
        after: { queued: 1, processing: 1, completed: 18, failed: 0, cancelled: 0 },
      },
      meta: {
        upstreamPath: '/api/cron/autopen-worker',
        upstreamStatus: 200,
        startedAt: '2026-03-29T01:20:00.000Z',
        finishedAt: '2026-03-29T01:20:05.000Z',
        durationMs: 5000,
      },
    },
    workerHistory: [
      {
        ok: false,
        status: 'error',
        origin: 'office-manual-trigger',
        detail: 'Publisher validation failed',
        recordedAt: '2026-03-29T01:14:05.000Z',
        taskWindow: {
          capturedAt: '2026-03-29T01:14:05.000Z',
          queuedCandidates: [],
          processingCandidates: [
            {
              id: 'stuck-processing',
              status: 'processing',
              keyword: '商業攝影合約注意事項',
              processing_phase: '發布',
            },
          ],
          failedCandidates: [],
        },
        meta: {
          upstreamPath: '/api/cron/autopen-worker',
          upstreamStatus: 500,
        },
      },
      {
        ok: false,
        status: 'error',
        origin: 'office-manual-trigger',
        detail: 'Publisher validation failed',
        recordedAt: '2026-03-29T01:08:05.000Z',
        taskWindow: {
          capturedAt: '2026-03-29T01:08:05.000Z',
          queuedCandidates: [],
          processingCandidates: [
            {
              id: 'stuck-processing',
              status: 'processing',
              keyword: '商業攝影合約注意事項',
              processing_phase: '發布',
            },
          ],
          failedCandidates: [],
        },
        meta: {
          upstreamPath: '/api/cron/autopen-worker',
          upstreamStatus: 500,
        },
      },
    ],
  })

  const candidate = overview.queueDiagnosis.persistent.candidates.find(
    item => item.keyword === '商業攝影合約注意事項',
  )

  assert.ok(candidate)
  assert.equal(candidate.stuckType, 'processing-only')
  assert.equal(candidate.topErrorSignature.label, 'Publisher validation failed')
  assert.equal(candidate.topErrorSignature.count, 2)
  assert.equal(candidate.topErrorSignature.inferred, true)
  assert.equal(candidate.topErrorSignature.source, 'worker')
  assert.equal(candidate.topErrorSignature.confidence, 'high')
  assert.equal(candidate.topErrorSignature.confidenceLabel, '高可信度')
  assert.equal(candidate.topErrorSignature.evidenceScore, 4)
  assert.equal(candidate.topErrorSignature.consistency, 'strong')
  assert.equal(candidate.topErrorSignature.consistencyLabel, 'bucket / phase 高度一致')
  assert.equal(candidate.topErrorSignature.timelineStability, 'strong')
  assert.equal(candidate.topErrorSignature.timelineStabilityLabel, 'timeline 高度穩定')
  assert.equal(candidate.topErrorSignature.recentFailureConsistency, 'none')
  assert.equal(candidate.topErrorSignature.recentFailureConsistencyLabel, 'recent failure 尚未對位')
  assert.match(candidate.topErrorSignature.evidenceSummary, /2 次帶到同一個 task 的 Worker failures 補推/)
  assert.match(candidate.topErrorSignature.evidenceSummary, /bucket（processing）與 phase（發布）都和這個 signature 對得上/)
  assert.match(candidate.topErrorSignature.evidenceSummary, /最近 2 次 snapshot 都維持同一個 bucket 模式/)
  assert.match(candidate.topErrorSignature.evidenceSummary, /recent failure history 暫時沒有提供額外的同類錯誤對位/)
  assert.equal(candidate.rootCausePatternLabel, '長期待在 processing + Publisher validation failed')
  assert.equal(candidate.patternRunbookFocusKey, 'publish-validation-stuck')
  assert.equal(candidate.patternRunbookFocusLabel, '發布 validation 卡關')
  assert.match(candidate.patternRunbookFocusDetail, /發布 phase|payload|slug|validation/)
  assert.match(candidate.rootCausePatternDetail, /任務本身沒有明確錯誤訊息/)
  assert.match(candidate.patternRunbookSteps.join(' '), /payload|validation|發布/)
  assert.match(candidate.patternRunbookSteps.join(' '), /matching Worker failures|taskWindow|detail/)
  assert.match(candidate.patternRunbookSteps.join(' '), /article slug|schema|單一代表任務/)
  const persistentRunbook = overview.runbook.find(item => item.key === 'persistent-stuck-tasks')
  assert.ok(persistentRunbook)
  assert.match(persistentRunbook.title, /發布 validation 卡關/)
  assert.match(persistentRunbook.steps.join(' '), /payload|validation|發布/)
  assert.match(persistentRunbook.steps.join(' '), /article slug|schema|單一代表任務/)
  assert.match((persistentRunbook.references || []).join(' '), /worker-signature|\/api\/cron\/autopen-worker|HTTP 500/)
})
