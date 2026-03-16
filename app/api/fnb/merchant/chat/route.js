import {
  getMerchantHome,
  submitMerchantCopilotMessage,
} from '../../../../../lib/fnb-service.js'
import { resolveMerchantRequestSession } from '../../../../../lib/fnb/route-auth.js'

export async function POST(request) {
  try {
    const body = await request.json()
    const { lineUserId, defaultLocationId } = resolveMerchantRequestSession(request)
    const locationId = body.locationId || defaultLocationId || null
    const message = String(body.message || '').trim()

    if (!lineUserId) {
      return Response.json({ ok: false, error: 'Missing merchant identity' }, { status: 401 })
    }
    if (!message) {
      return Response.json({ ok: false, error: 'Message is required' }, { status: 400 })
    }

    const result = await submitMerchantCopilotMessage(lineUserId, locationId, message, {
      source: 'line',
    })

    return Response.json({
      ok: true,
      result,
      home: await getMerchantHome(lineUserId, locationId),
    })
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
