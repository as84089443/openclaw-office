import { listMerchantThreads } from '../../../../../lib/fnb-service.js'
import { resolveMerchantRequestSession } from '../../../../../lib/fnb/route-auth.js'

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const { lineUserId, defaultLocationId } = resolveMerchantRequestSession(request)
    const locationId = searchParams.get('locationId') || defaultLocationId || null

    if (!lineUserId) {
      return Response.json({ ok: false, error: 'Missing merchant identity' }, { status: 401 })
    }

    const result = await listMerchantThreads(lineUserId, locationId)
    return Response.json({ ok: true, ...result })
  } catch (error) {
    const message = String(error.message || '')
    if (message.includes('does not have access')) {
      return Response.json({ ok: false, error: message }, { status: 403 })
    }
    if (message.includes('not bound')) {
      return Response.json({ ok: false, error: message }, { status: 401 })
    }
    return Response.json({ ok: false, error: message }, { status: 500 })
  }
}
