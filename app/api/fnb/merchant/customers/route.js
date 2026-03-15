import {
  decodeMerchantSession,
  getMerchantHome,
  getMerchantSessionCookieName,
  listCustomers,
} from '../../../../../lib/fnb-service.js'

export async function GET(request) {
  try {
    const url = new URL(request.url)
    const sessionToken = request.cookies.get(getMerchantSessionCookieName())?.value || null
    const session = decodeMerchantSession(sessionToken)
      || (process.env.FNB_DEMO_MODE === '1' ? { lineUserId: 'line:merchant-azhu', defaultLocationId: null } : null)
    const lineUserId = session?.lineUserId || null
    const locationId = url.searchParams.get('locationId') || session?.defaultLocationId || null
    const query = url.searchParams.get('query') || ''
    const tag = url.searchParams.get('tag') || ''

    if (!lineUserId) {
      return Response.json({
        ok: false,
        error: 'Missing merchant session',
      }, { status: 401 })
    }

    const home = await getMerchantHome(lineUserId, locationId)
    return Response.json({
      ok: true,
      customers: await listCustomers(home.activeMembership.location.id, { query, tag }),
      location: home.activeMembership.location,
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
