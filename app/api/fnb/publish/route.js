import { publishScheduled } from '../../../../lib/fnb-service.js'
import { assertInternalApiRequest, getRequestErrorStatus } from '../../../../lib/fnb/route-auth.js'

export async function POST(request) {
  try {
    assertInternalApiRequest(request)
    const body = await request.json()
    const result = await publishScheduled(body.channel, body.payload || body)
    return Response.json({
      ok: true,
      result,
    })
  } catch (error) {
    return Response.json({
      ok: false,
      error: error.message,
    }, { status: getRequestErrorStatus(error) })
  }
}
