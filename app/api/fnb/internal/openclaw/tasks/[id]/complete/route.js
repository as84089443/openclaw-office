import { completeMerchantCopilotTask } from '../../../../../../../../lib/fnb-service.js'
import { assertInternalApiRequest, getRequestErrorStatus } from '../../../../../../../../lib/fnb/route-auth.js'

export async function POST(request, { params }) {
  try {
    assertInternalApiRequest(request)
    let body = {}
    try {
      body = await request.json()
    } catch {}

    const result = body.result || null
    const confidence = body.confidence ?? null
    const metadata = body.metadata || {}
    if (body.status === 'failed' || body.error) {
      metadata.status = 'failed'
      metadata.error = body.error || metadata.error || 'Merchant Copilot completion failed'
    }

    return Response.json({
      ok: true,
      ...(await completeMerchantCopilotTask(params.id, result, confidence, metadata)),
    })
  } catch (error) {
    return Response.json(
      { ok: false, error: String(error.message || error) },
      { status: getRequestErrorStatus(error) },
    )
  }
}
