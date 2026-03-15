import {
  decodeMerchantSession,
  getMerchantHome,
  getMerchantSessionCookieName,
  handleMerchantReply,
  listPendingApprovalsForOperator,
} from '../../../../../../../lib/fnb-service.js'

const intentByAction = {
  approve: 'approve-draft',
  reschedule: 'reschedule-draft',
  skip: 'skip-draft',
}

export async function POST(request, { params }) {
  try {
    const body = await request.json()
    const approvalId = params.id
    const sessionToken = request.cookies.get(getMerchantSessionCookieName())?.value || null
    const session = decodeMerchantSession(sessionToken)
      || (process.env.FNB_DEMO_MODE === '1' ? { lineUserId: 'line:merchant-azhu', defaultLocationId: null } : null)
    const lineUserId = session?.lineUserId || null
    const locationId = body.locationId || session?.defaultLocationId || null
    const action = body.action
    const messageIntent = intentByAction[action]

    if (!lineUserId || !messageIntent) {
      return Response.json({
        ok: false,
        error: 'Missing merchant identity or unsupported action',
      }, { status: lineUserId ? 400 : 401 })
    }

    const home = await getMerchantHome(lineUserId, locationId)
    const approvals = await listPendingApprovalsForOperator(lineUserId, home.activeMembership.location.id)
    const approval = approvals.find((item) => item.id === approvalId)
    if (!approval) {
      return Response.json({
        ok: false,
        error: 'Approval not found for operator',
      }, { status: 404 })
    }

    const result = await handleMerchantReply(home.activeMembership.location.id, messageIntent, {
      draftId: approval.draftId,
      actorId: home.operator.id,
      scheduledFor: body.scheduledFor || null,
    })

    return Response.json({
      ok: true,
      result,
      home: await getMerchantHome(lineUserId, home.activeMembership.location.id),
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
