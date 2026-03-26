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
    return Response.json(await runStudioAction('studio_list_content', payload))
  } catch (error) {
    if (error instanceof StudioFactoryError && error.payload) {
      return Response.json(error.payload, { status: error.statusCode || 500 })
    }
    return Response.json({ error: error.message || 'Studio content unavailable' }, { status: 500 })
  }
}
