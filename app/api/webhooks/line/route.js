import { processLineWebhook } from '../../../../lib/fnb-service.js'

export async function POST(request) {
  const rawBody = await request.text()
  const signature = request.headers.get('x-line-signature')

  try {
    const result = await processLineWebhook(rawBody, signature)
    return Response.json(result)
  } catch (error) {
    return Response.json({
      ok: false,
      error: error.message,
    }, { status: 400 })
  }
}
