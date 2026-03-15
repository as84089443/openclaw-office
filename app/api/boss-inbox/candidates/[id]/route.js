import { applyCandidatePatch, getCandidatePatchById, reviewCandidatePatch, unapplyCandidatePatch } from '../../../../../lib/evolution.js'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ACTION_TO_STATUS = {
  approve: 'approved',
  approved: 'approved',
  reject: 'rejected',
  rejected: 'rejected',
  reset: 'pending',
  pending: 'pending',
}

export async function GET(_request, { params }) {
  const candidate = getCandidatePatchById(params?.id)
  if (!candidate) {
    return Response.json({ error: 'Candidate patch not found' }, { status: 404 })
  }

  return Response.json({
    success: true,
    candidate,
    prereqChecks: candidate.prereqChecks || [],
    dryRunSummary: candidate.dryRunSummary || null,
    autoApplyEligible: Boolean(candidate.autoApplyEligible),
    applyStatusLabel: candidate.applyStatusLabel || null,
    lifecycleUpdatedAt: candidate.lifecycleUpdatedAt || null,
  })
}

export async function POST(request, { params }) {
  const body = await request.json().catch(() => ({}))
  const action = (body?.action || '').toLowerCase()
  if (action === 'apply' || action === 'unapply' || action === 'rollback') {
    try {
      const candidate = action === 'apply'
        ? applyCandidatePatch({
            id: params?.id,
            applier: body?.reviewer || 'boss-inbox-ui',
          })
        : unapplyCandidatePatch({
            id: params?.id,
            applier: body?.reviewer || 'boss-inbox-ui',
          })

      if (!candidate) {
        return Response.json({ error: 'Candidate patch not found' }, { status: 404 })
      }

      return Response.json({
        success: true,
        candidate,
      })
    } catch (error) {
      return Response.json({ error: error.message || 'Failed to apply candidate patch' }, { status: 400 })
    }
  }

  const status = ACTION_TO_STATUS[body?.action || body?.reviewStatus || '']
  if (!status) {
    return Response.json({ error: 'Unknown review action' }, { status: 400 })
  }

  try {
    const candidate = reviewCandidatePatch({
      id: params?.id,
      reviewStatus: status,
      reviewNote: body?.note || null,
      reviewer: body?.reviewer || 'boss-inbox-ui',
    })

    if (!candidate) {
      return Response.json({ error: 'Candidate patch not found' }, { status: 404 })
    }

    return Response.json({
      success: true,
      candidate,
    })
  } catch (error) {
    return Response.json({ error: error.message || 'Failed to review candidate patch' }, { status: 400 })
  }
}
