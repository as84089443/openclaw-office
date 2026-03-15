import {
  decodeMerchantSession,
  getMerchantSessionCookieName,
  listPendingApprovalsForOperator,
} from '../../../../../lib/fnb-service.js'

export async function GET(request) {
  try {
    const url = new URL(request.url)
    const sessionToken = request.cookies.get(getMerchantSessionCookieName())?.value || null
    const session = decodeMerchantSession(sessionToken)
      || (process.env.FNB_DEMO_MODE === '1' ? { lineUserId: 'line:merchant-azhu', defaultLocationId: null } : null)
    const lineUserId = session?.lineUserId || null
    const locationId = url.searchParams.get('locationId') || session?.defaultLocationId || null
    if (!lineUserId) {
      return Response.json({
        ok: false,
        error: 'Missing merchant session',
      }, { status: 401 })
    }

    return Response.json({
      ok: true,
      approvals: await listPendingApprovalsForOperator(lineUserId, locationId),
    })
  } catch (error) {
    const message = String(error.message || '')
    if (message.includes('does not have access')) {
      return Response.json({ ok: false, error: message }, { status: 403 })
    }
    if (message.includes('not bound')) {
      return Response.json({ ok: false, error: message }, { status: 401 })
    }
    return Response.json({
      ok: false,
      error: message,
    }, { status: 500 })
  }
}
