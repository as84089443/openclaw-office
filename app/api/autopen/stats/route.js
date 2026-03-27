/**
 * GET /api/autopen/stats — 代理 BWS-WEB autopen 統計數據
 * POST /api/autopen/stats/worker — 觸發 Worker
 */
import { NextResponse } from 'next/server'

const BWS_API = process.env.BWS_API_URL || 'https://www.bw-space.com'
const AUTOPEN_KEY = process.env.AUTOPEN_API_KEY || ''
const CRON_SECRET = process.env.BWS_CRON_SECRET || ''

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const r = await fetch(`${BWS_API}/api/admin/autopen/stats`, {
      headers: { 'x-api-key': AUTOPEN_KEY },
      next: { revalidate: 0 },
    })
    if (!r.ok) return NextResponse.json({ error: `BWS API ${r.status}` }, { status: r.status })
    return NextResponse.json(await r.json())
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
