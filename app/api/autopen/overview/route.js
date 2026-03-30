import { NextResponse } from 'next/server'

import { fetchAutopenUpstream } from '../../../../lib/autopen-proxy.js'
import { buildAutopenOverview } from '../../../../lib/autopen-overview.js'
import { readAutopenWorkerStateStore } from '../../../../lib/autopen-worker-state.js'

export const dynamic = 'force-dynamic'

const TASK_LIMIT = 20
const FAILURE_HISTORY_LIMIT = 10

export async function GET() {
  const [statsResult, tasksResult, failureHistoryResult] = await Promise.all([
    fetchAutopenUpstream({
      upstreamPath: '/api/admin/autopen/stats',
    }),
    fetchAutopenUpstream({
      upstreamPath: '/api/admin/autopen',
      query: new URLSearchParams({ limit: String(TASK_LIMIT) }),
      headers: { 'Content-Type': 'application/json' },
    }),
    fetchAutopenUpstream({
      upstreamPath: '/api/admin/autopen',
      query: new URLSearchParams({
        limit: String(FAILURE_HISTORY_LIMIT),
        status: 'failed',
      }),
      headers: { 'Content-Type': 'application/json' },
    }),
  ])
  const workerStateStore = readAutopenWorkerStateStore()

  const overview = buildAutopenOverview({
    statsResult,
    tasksResult,
    failureHistoryResult,
    workerRun: workerStateStore.latest,
    workerHistory: workerStateStore.history,
    failureHistoryLimit: FAILURE_HISTORY_LIMIT,
    retryHint: {
      supported: false,
      reason: 'BWS `/api/admin/autopen/requeue-failed` 目前只支援 admin session，OpenClaw Office 還不能直接用 x-api-key 重排 failed 任務。',
      href: 'https://www.bw-space.com/admin/autopen',
    },
  })

  return NextResponse.json(overview)
}
