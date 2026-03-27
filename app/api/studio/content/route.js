import { StudioFactoryError, runStudioAction } from '../../../../lib/studio-factory.js'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  try {
    const url = new URL(request.url)
    const contentItemId = (url.searchParams.get('contentItemId') || '').trim()
    if (contentItemId) {
      return Response.json(await runStudioAction('studio_get_content', { content_item_id: contentItemId }))
    }
    const payload = {
      business_id: url.searchParams.get('businessId') || '',
      status: url.searchParams.get('status') || '',
      limit: Number(url.searchParams.get('limit') || 50),
    }
    const result = await runStudioAction('studio_list_content', payload)
    if (result?.error === 'business_not_found' || result?.message?.includes('business_not_found')) {
      return Response.json({ status: 'ok', items: [], count: 0, _note: 'business_not_yet_synced' })
    }
    return Response.json(result)
  } catch (error) {
    if (error instanceof StudioFactoryError && error.payload) {
      const payload = error.payload
      if (payload?.error === 'business_not_found' || payload?.message?.includes('business_not_found')) {
        return Response.json({ status: 'ok', items: [], count: 0, _note: 'business_not_yet_synced' })
      }
      return Response.json(payload, { status: error.statusCode || 500 })
    }
    return Response.json({ error: error.message || 'Studio content unavailable' }, { status: 500 })
  }
}
