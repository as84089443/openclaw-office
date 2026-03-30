/**
 * GET /api/autopen/stats — 代理 BWS-WEB autopen 統計數據
 * POST /api/autopen/stats/worker — 觸發 Worker
 */
import { NextResponse } from 'next/server'
import {
  createAutopenErrorPayload,
  fetchAutopenUpstream,
  withAutopenMeta,
} from '../../../../lib/autopen-proxy.js'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const result = await fetchAutopenUpstream({
      upstreamPath: '/api/admin/autopen/stats',
    })

    if (!result.ok) {
      return NextResponse.json(
        createAutopenErrorPayload(result, 'AutoPen 統計同步失敗'),
        { status: result.status },
      )
    }

    return NextResponse.json(withAutopenMeta(result.data, result.meta, 'stats'))
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
