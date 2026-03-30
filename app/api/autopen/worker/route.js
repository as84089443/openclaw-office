/**
 * POST /api/autopen/worker — 代理觸發 BWS-WEB autopen worker
 */
import { NextResponse } from 'next/server'
import {
  createAutopenErrorPayload,
  fetchAutopenUpstream,
  withAutopenMeta,
} from '../../../../lib/autopen-proxy.js'
import { getAutopenWorkerProxyRequest } from '../../../../lib/autopen-worker.js'
import {
  createAutopenWorkerQueueImpact,
  createAutopenWorkerTaskWindow,
  recordAutopenWorkerRun,
} from '../../../../lib/autopen-worker-state.js'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const TASK_LIMIT = 20
const FAILURE_HISTORY_LIMIT = 10

function getAutopenStatsRequest() {
  return {
    upstreamPath: '/api/admin/autopen/stats',
  }
}

function getAutopenTasksRequest(limit = TASK_LIMIT) {
  return {
    upstreamPath: '/api/admin/autopen',
    query: new URLSearchParams({ limit: String(limit) }),
    headers: { 'Content-Type': 'application/json' },
  }
}

function getAutopenFailureHistoryRequest(limit = FAILURE_HISTORY_LIMIT) {
  return {
    upstreamPath: '/api/admin/autopen',
    query: new URLSearchParams({
      limit: String(limit),
      status: 'failed',
    }),
    headers: { 'Content-Type': 'application/json' },
  }
}

export async function POST() {
  try {
    const beforeStatsResult = await fetchAutopenUpstream(getAutopenStatsRequest())
    const result = await fetchAutopenUpstream(getAutopenWorkerProxyRequest())
    const [afterStatsResult, afterTasksResult, afterFailureHistoryResult] = await Promise.all([
      fetchAutopenUpstream(getAutopenStatsRequest()),
      fetchAutopenUpstream(getAutopenTasksRequest()),
      fetchAutopenUpstream(getAutopenFailureHistoryRequest()),
    ])
    let workerState = null

    try {
      workerState = recordAutopenWorkerRun(result, {
        origin: 'office-manual-trigger',
        queueImpact: createAutopenWorkerQueueImpact({
          before: {
            stats: beforeStatsResult?.ok ? beforeStatsResult.data : null,
            meta: beforeStatsResult?.meta || null,
          },
          after: {
            stats: afterStatsResult?.ok ? afterStatsResult.data : null,
            meta: afterStatsResult?.meta || null,
          },
        }),
        taskWindow: createAutopenWorkerTaskWindow({
          tasks: afterTasksResult?.ok ? afterTasksResult.data?.tasks : [],
          failureHistory: afterFailureHistoryResult?.ok ? afterFailureHistoryResult.data?.tasks : [],
          capturedAt: afterFailureHistoryResult?.meta?.finishedAt
            || afterTasksResult?.meta?.finishedAt
            || afterStatsResult?.meta?.finishedAt
            || null,
        }),
      })
    } catch (stateError) {
      console.error('[autopen-worker] Failed to persist worker snapshot:', stateError.message)
    }

    if (!result.ok) {
      return NextResponse.json(
        {
          ...createAutopenErrorPayload(result, 'AutoPen Worker 觸發失敗'),
          workerState,
        },
        { status: result.status },
      )
    }

    return NextResponse.json(
      {
        ...withAutopenMeta(result.data, result.meta, 'workerRun'),
        workerState,
      },
      {
        status: result.status,
      },
    )
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
