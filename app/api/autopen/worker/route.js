/**
 * POST /api/autopen/worker — 代理觸發 BWS-WEB autopen worker
 */
import { NextResponse } from 'next/server'

const BWS_API = process.env.BWS_API_URL || 'https://www.bw-space.com'
const CRON_SECRET = process.env.BWS_CRON_SECRET || ''

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST() {
  if (!CRON_SECRET) {
    return NextResponse.json({ error: 'BWS_CRON_SECRET 未設定' }, { status: 500 })
  }
  try {
    const r = await fetch(`${BWS_API}/api/cron/autopen-worker`, {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
      signal: AbortSignal.timeout(280000),
    })
    const data = await r.json()
    return NextResponse.json(data, { status: r.status })
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
