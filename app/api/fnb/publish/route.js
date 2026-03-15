import { publishScheduled } from '../../../../lib/fnb-service.js'

export async function POST(request) {
  try {
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
    }, { status: 500 })
  }
}
