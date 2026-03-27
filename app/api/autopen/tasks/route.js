/**
 * GET /api/autopen/tasks — 代理 BWS-WEB autopen 任務列表（解決 CORS）
 */
import { NextResponse } from 'next/server'

const BWS_API = process.env.BWS_API_URL || 'https://www.bw-space.com'
const AUTOPEN_KEY = process.env.AUTOPEN_API_KEY || ''

export const dynamic = 'force-dynamic'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const limit = searchParams.get('limit') || '20'
  const status = searchParams.get('status') || ''
  const page = searchParams.get('page') || '1'

  try {
    const params = new URLSearchParams({ limit, page })
    if (status) params.set('status', status)

    const r = await fetch(`${BWS_API}/api/admin/autopen?${params}`, {
      headers: {
        'x-api-key': AUTOPEN_KEY,
        'Content-Type': 'application/json',
      },
      next: { revalidate: 0 },
    })

    if (!r.ok) {
      return NextResponse.json({ error: `BWS API ${r.status}` }, { status: r.status })
    }

    const data = await r.json()
    return NextResponse.json(data)
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    const body = await request.json()
    const r = await fetch(`${BWS_API}/api/admin/autopen/batch-by-titles`, {
      method: 'POST',
      headers: {
        'x-api-key': AUTOPEN_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    const data = await r.json()
    return NextResponse.json(data, { status: r.status })
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
