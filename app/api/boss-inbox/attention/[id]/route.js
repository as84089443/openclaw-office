import { getAttentionItemById, runAttentionAction } from '../../../../../lib/boss-inbox.js'
import { getAttentionStateById } from '../../../../../lib/db.js'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(_request, { params }) {
  const item = getAttentionItemById(params?.id)
  if (item) {
    return Response.json({ success: true, attentionItem: item })
  }

  const state = getAttentionStateById(params?.id)
  if (!state) {
    return Response.json({ error: 'Attention item not found' }, { status: 404 })
  }
  const now = Date.now()
  const unresolved = state.status === 'open' && !(
    (state.snoozedUntil && state.snoozedUntil > now) ||
    (state.nextReviewAt && state.nextReviewAt > now)
  )

  return Response.json({
    success: true,
    attentionItem: {
      id: state.id,
      source: state.source,
      agentId: state.agentId,
      attentionType: state.attentionType,
      status: state.status,
      signalCount: state.signalCount,
      signalScore: state.signalScoreMax,
      categories: state.categories,
      linkedRequestId: state.linkedRequestId,
      linkedTaskId: state.linkedTaskId,
      latestEventId: state.latestEventId,
      firstSeenAt: state.firstSeenAt,
      lastSeenAt: state.lastSeenAt,
      snoozedUntil: state.snoozedUntil,
      nextReviewAt: state.nextReviewAt,
      assignedOwner: state.assignedOwner,
      closedReason: state.closedReason,
      taskResult: state.taskResult,
      completionValue: state.completionValue,
      didImprove: state.didImprove,
      didImproveScore: state.didImproveScore ?? null,
      businessDelta: state.businessDelta ?? null,
      processScore: state.processScore ?? null,
      businessScore: state.businessScore ?? null,
      rollbackNeeded: state.rollbackNeeded,
      lastFeedbackAt: state.lastFeedbackAt,
      unresolved,
    },
  })
}

export async function POST(request, { params }) {
  const body = await request.json().catch(() => ({}))
  const action = String(body?.action || '').toLowerCase()

  if (!action) {
    return Response.json({ error: 'action is required' }, { status: 400 })
  }

  try {
    const result = runAttentionAction(params?.id, {
      action,
      title: Object.prototype.hasOwnProperty.call(body, 'title') ? body.title : undefined,
      detail: Object.prototype.hasOwnProperty.call(body, 'detail') ? body.detail : undefined,
      targetAgent: Object.prototype.hasOwnProperty.call(body, 'targetAgent') ? body.targetAgent : undefined,
      note: Object.prototype.hasOwnProperty.call(body, 'note') ? body.note : undefined,
      owner: Object.prototype.hasOwnProperty.call(body, 'owner') ? body.owner : undefined,
      assignedOwner: Object.prototype.hasOwnProperty.call(body, 'assignedOwner') ? body.assignedOwner : undefined,
      closeReason: Object.prototype.hasOwnProperty.call(body, 'closeReason') ? body.closeReason : undefined,
      nextReviewAt: Object.prototype.hasOwnProperty.call(body, 'nextReviewAt') ? body.nextReviewAt : undefined,
      snoozedUntil: Object.prototype.hasOwnProperty.call(body, 'snoozedUntil') ? body.snoozedUntil : undefined,
      snoozeHours: Object.prototype.hasOwnProperty.call(body, 'snoozeHours') ? body.snoozeHours : undefined,
      reviewer: body?.reviewer || 'boss-inbox-ui',
    })

    if (!result) {
      return Response.json({ error: 'Attention item not found' }, { status: 404 })
    }

    return Response.json({
      success: true,
      ...result,
    })
  } catch (error) {
    return Response.json({ error: error.message || 'Failed to update attention item' }, { status: 400 })
  }
}
