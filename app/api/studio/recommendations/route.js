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
    const result = await runStudioAction('studio_suggest_topics', payload)
    if (result?.error === 'business_not_found' || result?.message?.includes('business_not_found')) {
      return Response.json({ status: 'ok', items: [], _note: 'business_not_yet_synced' })
    }
    return Response.json(result)
  } catch (error) {
    if (error instanceof StudioFactoryError && error.payload) {
      const payload = error.payload
      if (payload?.error === 'business_not_found' || payload?.message?.includes('business_not_found')) {
        return Response.json({ status: 'ok', items: [], _note: 'business_not_yet_synced' })
      }
      return Response.json(payload, { status: error.statusCode || 500 })
    }
    return Response.json({ error: error.message || 'Studio recommendations unavailable' }, { status: 500 })
  }
}
