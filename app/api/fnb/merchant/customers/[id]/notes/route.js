import {
  decodeMerchantSession,
  getMerchantHome,
  getMerchantSessionCookieName,
  listCustomers,
  saveCustomerNote,
} from '../../../../../../../lib/fnb-service.js'

export async function POST(request, { params }) {
  try {
    const body = await request.json()
    const sessionToken = request.cookies.get(getMerchantSessionCookieName())?.value || null
    const session = decodeMerchantSession(sessionToken)
      || (process.env.FNB_DEMO_MODE === '1' ? { lineUserId: 'line:merchant-azhu', defaultLocationId: null } : null)
    const lineUserId = session?.lineUserId || null
    const locationId = body.locationId || session?.defaultLocationId || null
    const note = body.note

    if (!lineUserId) {
      return Response.json({
        ok: false,
        error: 'Missing merchant session',
      }, { status: 401 })
    }

    const home = await getMerchantHome(lineUserId, locationId)
    const customers = await listCustomers(home.activeMembership.location.id, {})
    const customer = customers.find((item) => item.id === params.id)
    if (!customer) {
      return Response.json({
        ok: false,
        error: 'Customer not found for location',
      }, { status: 404 })
    }

    return Response.json({
      ok: true,
      customer: await saveCustomerNote(params.id, note, home.operator.id),
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
