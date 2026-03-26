import { StudioFactoryError, runStudioAction } from '../../../../lib/studio-factory.js'
import { assertOfficeApiRequest, getOfficeRequestErrorStatus } from '../../../../lib/office-route-auth.js'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  try {
    const url = new URL(request.url)
    const businessId = (url.searchParams.get('id') || '').trim()
    if (businessId) {
      return Response.json(await runStudioAction('studio_get_business', { business_id: businessId }))
    }
    return Response.json(await runStudioAction('studio_list_businesses'))
  } catch (error) {
    if (error instanceof StudioFactoryError && error.payload) {
      return Response.json(error.payload, { status: error.statusCode || 500 })
    }
    return Response.json({ error: error.message || 'Studio businesses unavailable' }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    assertOfficeApiRequest(request)
  } catch (error) {
    return Response.json(
      { error: error.message || 'Unauthorized office request' },
      { status: getOfficeRequestErrorStatus(error, 401) }
    )
  }

  try {
    const body = await request.json()
    return Response.json(await runStudioAction('studio_upsert_business', body))
  } catch (error) {
    if (error instanceof StudioFactoryError && error.payload) {
      return Response.json(error.payload, { status: error.statusCode || 500 })
    }
    return Response.json({ error: error.message || 'Studio business save failed' }, { status: 500 })
  }
}
