import {
  buildBossInboxPayload,
  ensureDailyDigest,
  maybeDeliverDailyDigest,
} from '../../../lib/boss-inbox.js'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const payload = buildBossInboxPayload()
  if (payload.latestDailyDigest) {
    payload.latestDailyDigest = await maybeDeliverDailyDigest(payload.latestDailyDigest)
  }
  return Response.json(payload)
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}))
  const action = body?.action || 'generate_digest'

  if (action !== 'generate_digest') {
    return Response.json({ error: 'Unknown action' }, { status: 400 })
  }

  const digest = ensureDailyDigest({ force: Boolean(body.force) })
  const deliveredDigest = await maybeDeliverDailyDigest(digest)
  return Response.json({
    success: true,
    digest: deliveredDigest,
  })
}
