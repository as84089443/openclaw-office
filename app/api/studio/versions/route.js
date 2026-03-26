import { StudioFactoryError, runStudioAction } from '../../../../lib/studio-factory.js'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  try {
    const url = new URL(request.url)
    const payload = {
      content_item_id: url.searchParams.get('contentItemId') || '',
      latest_only: ['1', 'true', 'yes'].includes((url.searchParams.get('latestOnly') || '').toLowerCase()),
      summary_only: ['1', 'true', 'yes'].includes((url.searchParams.get('summary') || '').toLowerCase()),
    }
    return Response.json(await runStudioAction('studio_list_versions', payload))
  } catch (error) {
    if (error instanceof StudioFactoryError && error.payload) {
      return Response.json(error.payload, { status: error.statusCode || 500 })
    }
    return Response.json({ error: error.message || 'Studio versions unavailable' }, { status: 500 })
  }
}
