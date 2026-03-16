import { claimNextMerchantCopilotTask } from '../../../../../../lib/fnb-service.js'
import { assertInternalApiRequest, getRequestErrorStatus } from '../../../../../../lib/fnb/route-auth.js'

export async function POST(request) {
  try {
    assertInternalApiRequest(request)
    let body = {}
    try {
      body = await request.json()
    } catch {}

    const action = body.action || 'claim-next'
    if (action !== 'claim-next') {
      return Response.json({ ok: false, error: `Unsupported action: ${action}` }, { status: 400 })
    }

    const result = await claimNextMerchantCopilotTask()
    return Response.json({
      ok: true,
      task: result?.task || null,
      thread: result?.thread || null,
      messages: result?.messages || [],
    })
  } catch (error) {
    return Response.json(
      { ok: false, error: String(error.message || error) },
      { status: getRequestErrorStatus(error) },
    )
  }
}
