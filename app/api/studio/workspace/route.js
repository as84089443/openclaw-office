import { StudioFactoryError, runStudioAction } from '../../../../lib/studio-factory.js'
import { assertOfficeApiRequest, getOfficeRequestErrorStatus } from '../../../../lib/office-route-auth.js'

export const dynamic = 'force-dynamic'

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
    return Response.json(await runStudioAction('studio_generate_workspace', body))
  } catch (error) {
    if (error instanceof StudioFactoryError && error.payload) {
      return Response.json(error.payload, { status: error.statusCode || 500 })
    }
    return Response.json({ error: error.message || 'Studio workspace generation failed' }, { status: 500 })
  }
}
