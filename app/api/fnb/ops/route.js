import {
  claimNextMerchantCopilotTask,
  completeMerchantCopilotTask,
  generateCampaignPlan,
  generateWeeklyDigest,
  getDefaultLocationId,
  getOpsSnapshot,
  getServiceStatus,
  handleMerchantReply,
  listMerchantLocations,
  onboardMerchant,
  recordAttribution,
  runAutopilot,
  sendApprovalCard,
} from '../../../../lib/fnb-service.js'
import { assertInternalApiRequest, getRequestErrorStatus } from '../../../../lib/fnb/route-auth.js'

export async function GET(request) {
  const { searchParams } = new URL(request.url)

  try {
    assertInternalApiRequest(request)
    const locations = await listMerchantLocations()
    const locationId = searchParams.get('locationId') || await getDefaultLocationId()
    return Response.json({
      ok: true,
      snapshot: locationId ? await getOpsSnapshot(locationId) : null,
      locations,
      defaultLocationId: locationId,
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
    const locationId = body.locationId || await getDefaultLocationId()
    const action = body.action

    if (action === 'onboard-merchant') {
      const result = await onboardMerchant(body.payload || {})
      return Response.json({
        ok: true,
        result,
        snapshot: result.snapshot,
        locations: await listMerchantLocations(),
        defaultLocationId: result.locationId,
        serviceStatus: await getServiceStatus(),
      })
    }

    if (action === 'generate-plan') {
      const result = await generateCampaignPlan(locationId)
      return Response.json({
        ok: true,
        result,
        snapshot: await getOpsSnapshot(locationId),
        locations: await listMerchantLocations(),
        defaultLocationId: locationId,
        serviceStatus: await getServiceStatus(),
      })
    }

    if (action === 'run-autopilot') {
      const result = await runAutopilot(locationId)
      return Response.json({
        ok: true,
        result,
        snapshot: await getOpsSnapshot(locationId),
        locations: await listMerchantLocations(),
        defaultLocationId: locationId,
        serviceStatus: await getServiceStatus(),
      })
    }

    if (action === 'send-approval-card') {
      const result = await sendApprovalCard(locationId, body.draftId, body.channel || 'line')
      return Response.json({
        ok: true,
        result,
        snapshot: await getOpsSnapshot(locationId),
        locations: await listMerchantLocations(),
        defaultLocationId: locationId,
        serviceStatus: await getServiceStatus(),
      })
    }

    if (action === 'merchant-reply') {
      const result = await handleMerchantReply(locationId, body.messageIntent, body.payload || {})
      return Response.json({
        ok: true,
        result,
        snapshot: await getOpsSnapshot(locationId),
        locations: await listMerchantLocations(),
        defaultLocationId: locationId,
        serviceStatus: await getServiceStatus(),
      })
    }

    if (action === 'record-event') {
      const result = await recordAttribution(body.source, body.campaignId, body.eventType, body.value, {
        locationId,
        draftId: body.draftId,
        offerId: body.offerId,
        metadata: body.metadata,
      })
      return Response.json({
        ok: true,
        result,
        snapshot: await getOpsSnapshot(locationId),
        locations: await listMerchantLocations(),
        defaultLocationId: locationId,
        serviceStatus: await getServiceStatus(),
      })
    }

    if (action === 'generate-digest') {
      const result = await generateWeeklyDigest(locationId, body.period || {})
      return Response.json({
        ok: true,
        result,
        snapshot: await getOpsSnapshot(locationId),
        locations: await listMerchantLocations(),
        defaultLocationId: locationId,
        serviceStatus: await getServiceStatus(),
      })
    }

    if (action === 'merchant-copilot-complete-next') {
      const claimed = await claimNextMerchantCopilotTask()
      const result = claimed?.task
        ? await completeMerchantCopilotTask(claimed.task.id)
        : { ok: true, status: 'idle', message: 'No queued merchant copilot task' }
      return Response.json({
        ok: true,
        result,
        snapshot: await getOpsSnapshot(locationId),
        locations: await listMerchantLocations(),
        defaultLocationId: locationId,
        serviceStatus: await getServiceStatus(),
      })
    }

    return Response.json({
      ok: false,
      error: `Unsupported action: ${action}`,
    }, { status: 400 })
  } catch (error) {
    return Response.json({
      ok: false,
      error: error.message,
    }, { status: getRequestErrorStatus(error) })
  }
}
