import {
  getDefaultLocationId,
  getOpsSnapshot,
  getServiceStatus,
  listMerchantLocations,
  onboardMerchant,
} from '../../../../lib/fnb-service.js'
import { assertInternalApiRequest, getRequestErrorStatus } from '../../../../lib/fnb/route-auth.js'

export async function GET(request) {
  try {
    assertInternalApiRequest(request)
    const { searchParams } = new URL(request.url)
    const locations = await listMerchantLocations()
    const locationId = searchParams.get('locationId') || await getDefaultLocationId()
    if (!locationId) {
      return Response.json({
        ok: true,
        snapshot: null,
        checklist: [],
        locations,
        serviceStatus: await getServiceStatus(),
      })
    }

    return Response.json({
      ok: true,
      snapshot: await getOpsSnapshot(locationId),
      locations,
      serviceStatus: await getServiceStatus(),
    })
  } catch (error) {
    return Response.json({
      ok: false,
      error: error.message,
    }, { status: getRequestErrorStatus(error) })
  }
}

export async function POST(request) {
  try {
    assertInternalApiRequest(request)
    const body = await request.json()
    const result = await onboardMerchant(body)
    return Response.json({
      ok: true,
      ...result,
      locations: await listMerchantLocations(),
      serviceStatus: await getServiceStatus(),
    })
  } catch (error) {
    return Response.json({
      ok: false,
      error: error.message,
    }, { status: getRequestErrorStatus(error) })
  }
}
