/**
 * GET /api/autopen/tasks — 代理 BWS-WEB autopen 任務列表（解決 CORS）
 */
import { NextResponse } from 'next/server'
import {
  createAutopenErrorPayload,
  fetchAutopenUpstream,
  withAutopenMeta,
} from '../../../../lib/autopen-proxy.js'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const limit = searchParams.get('limit') || '20'
  const status = searchParams.get('status') || ''
  const page = searchParams.get('page') || '1'

  try {
    const params = new URLSearchParams({ limit, page })
    if (status) params.set('status', status)

    const result = await fetchAutopenUpstream({
      upstreamPath: '/api/admin/autopen',
      query: params,
      headers: { 'Content-Type': 'application/json' },
    })

    if (!result.ok) {
      return NextResponse.json(
        createAutopenErrorPayload(result, 'AutoPen 任務列表同步失敗'),
        { status: result.status },
      )
    }

    return NextResponse.json(withAutopenMeta(result.data, result.meta, 'tasks'))
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    const body = await request.json()
    const result = await fetchAutopenUpstream({
      upstreamPath: '/api/admin/autopen/batch-by-titles',
      method: 'POST',
      body,
    })

    if (!result.ok) {
      return NextResponse.json(
        createAutopenErrorPayload(result, '建立 AutoPen 任務失敗'),
        { status: result.status },
      )
    }

    return NextResponse.json(withAutopenMeta(result.data, result.meta, 'tasks'), {
      status: result.status,
    })
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
