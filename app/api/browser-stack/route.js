import { getBrowserStackSnapshot } from '../../../lib/browser-stack.js'
import { assertOfficeApiRequest, getOfficeRequestErrorStatus } from '../../../lib/office-route-auth.js'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  try {
    assertOfficeApiRequest(request)
  } catch (error) {
    return Response.json({ error: error.message || 'Unauthorized office request' }, { status: getOfficeRequestErrorStatus(error, 401) })
  }

  try {
    return Response.json(await getBrowserStackSnapshot())
  } catch (error) {
    return Response.json({ error: error.message || 'Browser stack API unavailable' }, { status: 500 })
  }
}
