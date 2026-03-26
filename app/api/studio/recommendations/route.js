import { StudioFactoryError, runStudioAction } from '../../../../lib/studio-factory.js'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  try {
    const url = new URL(request.url)
    const payload = {
      business_id: url.searchParams.get('businessId') || '',
      topic_hint: url.searchParams.get('topicHint') || '',
      audience_hint: url.searchParams.get('audienceHint') || '',
      count: Number(url.searchParams.get('count') || 6),
    }
    return Response.json(await runStudioAction('studio_suggest_topics', payload))
  } catch (error) {
    if (error instanceof StudioFactoryError && error.payload) {
      return Response.json(error.payload, { status: error.statusCode || 500 })
    }
    return Response.json({ error: error.message || 'Studio recommendations unavailable' }, { status: 500 })
  }
}
