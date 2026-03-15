'use client'

import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle, BriefcaseBusiness, Clock3, RefreshCw, ShieldAlert, Sparkles } from 'lucide-react'

const TYPE_META = {
  decision: { label: '待決策', color: '#f59e0b', icon: Clock3 },
  blocked: { label: '阻塞', color: '#ef4444', icon: AlertTriangle },
  risk: { label: '風險', color: '#f97316', icon: ShieldAlert },
  opportunity: { label: '商機', color: '#22c55e', icon: BriefcaseBusiness },
  digest_only: { label: '摘要', color: '#64748b', icon: Sparkles },
}

const ACTION_LABEL = {
  create_task: 'Create Task',
  acknowledge: 'Acknowledge',
  resolve: 'Resolve',
  reopen: 'Reopen',
  snooze: 'Snooze 24h',
}

function toPriorityOrder(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : Number.MAX_SAFE_INTEGER
}

function deriveRecommendedAction(item, hint = null) {
  const suggested = String(hint?.suggestedAction || '').toLowerCase()
  if (suggested === 'create_task') {
    return item.linkedTaskId ? 'acknowledge' : 'create_task'
  }
  if (suggested === 'resolve') return item.status === 'open' ? 'resolve' : 'reopen'
  if (suggested === 'reopen') return item.status === 'open' ? 'acknowledge' : 'reopen'
  if (suggested === 'acknowledge') return 'acknowledge'
  if (suggested === 'snooze') return 'snooze'
  if (item.status !== 'open') return 'reopen'
  if (!item.linkedTaskId && item.unresolved) return 'create_task'
  return 'acknowledge'
}

function formatTime(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleString()
}

function CountCard({ label, value, color, Icon }) {
  return (
    <div className="glass-card rounded-xl p-4" style={{ borderColor: `${color}44` }}>
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-400">{label}</div>
        <Icon className="h-4 w-4" style={{ color }} />
      </div>
      <div className="mt-3 text-3xl font-display" style={{ color }}>
        {value}
      </div>
    </div>
  )
}

function AttentionRow({
  item,
  actionHint,
  actionId,
  onAttentionAction,
  isTaskDraftOpen,
  taskDraft,
  onOpenTaskDraft,
  onTaskDraftChange,
  onTaskDraftCancel,
  onTaskDraftSubmit,
  agentOptions,
}) {
  const [ownerDraft, setOwnerDraft] = useState(item.assignedOwner || '')
  const [nextReviewDraft, setNextReviewDraft] = useState('')
  useEffect(() => {
    setOwnerDraft(item.assignedOwner || '')
  }, [item.id, item.assignedOwner])
  const meta = TYPE_META[item.attentionType] || TYPE_META.digest_only
  const Icon = meta.icon
  const recommendedAction = deriveRecommendedAction(item, actionHint)
  const recommendedLabel = ACTION_LABEL[recommendedAction] || 'Action'
  const canRecommendCreateTask = !(actionId !== null || Boolean(item.linkedTaskId))
  const canRecommendMutate = actionId === null
  const recommendedDisabled = recommendedAction === 'create_task' ? !canRecommendCreateTask : !canRecommendMutate
  const linkedTaskLabel = item.linkedTaskId
    ? `${item.linkedTaskId}${item.linkedTaskStatus ? ` / ${item.linkedTaskStatus}` : ''}`
    : null
  return (
    <div className="rounded-xl border border-white/6 bg-black/20 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-lg">{item.agentEmoji}</span>
            <span className="font-display text-white">{item.agentName}</span>
            <span
              className="rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.18em]"
              style={{ borderColor: `${meta.color}55`, color: meta.color }}
            >
              {meta.label}
            </span>
          </div>
          <div className="mt-2 text-sm text-white">{item.title}</div>
          {item.detail && (
            <div className="mt-2 text-sm leading-6 text-gray-400">{item.detail}</div>
          )}
          <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-gray-500">
            <span>更新: {formatTime(item.updatedAt)}</span>
            {item.channel && <span>{item.channel}</span>}
            {item.commercialValue > 0 && <span>估值 ${item.commercialValue.toLocaleString()}</span>}
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-gray-500">
            <span>source: {item.source}</span>
            <span>status: {item.status || 'open'}</span>
            <span>signal: {item.signalScore || 0}</span>
            <span>count: {item.signalCount || 1}</span>
            {item.latestEventId && <span>event: {String(item.latestEventId).slice(0, 18)}...</span>}
          </div>
          {(item.assignedOwner || item.snoozedUntil || item.nextReviewAt) && (
            <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-300/80">
              {item.assignedOwner && <span>owner: {item.assignedOwner}</span>}
              {item.snoozedUntil && <span>snoozed: {formatTime(item.snoozedUntil)}</span>}
              {item.nextReviewAt && <span>next review: {formatTime(item.nextReviewAt)}</span>}
            </div>
          )}
          {actionHint && (
            <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-cyan-100/80">
              <span>hint: {recommendedLabel}</span>
              {actionHint?.recommendedOwner && <span>owner: {actionHint.recommendedOwner}</span>}
              {actionHint?.shouldBlock && <span className="text-rose-200">blocking</span>}
            </div>
          )}
          {item.categories?.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-cyan-200/80">
              {item.categories.map((category) => (
                <span key={`${item.id}-${category}`} className="rounded-full border border-cyan-400/20 px-2 py-0.5">
                  {category}
                </span>
              ))}
            </div>
          )}
          {(item.linkedRequestId || item.linkedTaskId) && (
            <div className="mt-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-[11px] text-emerald-200">
              {item.linkedRequestId && <div>request: {item.linkedRequestId}{item.linkedRequestState ? ` / ${item.linkedRequestState}` : ''}</div>}
              {linkedTaskLabel && <div>task: {linkedTaskLabel}</div>}
            </div>
          )}
        </div>
        <div
          className="rounded-lg p-2"
          style={{ background: `${meta.color}12`, color: meta.color }}
        >
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={recommendedDisabled}
          onClick={() => {
            if (recommendedAction === 'create_task') {
              onOpenTaskDraft(item, actionHint)
              return
            }
            if (recommendedAction === 'snooze') {
              onAttentionAction(item.id, 'snooze', { snoozeHours: 24 })
              return
            }
            onAttentionAction(item.id, recommendedAction)
          }}
          className="rounded-lg border border-cyan-400/50 bg-cyan-500/10 px-3 py-2 text-xs uppercase tracking-[0.18em] text-cyan-200 transition hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {actionId === `${item.id}:${recommendedAction}` ? 'Running...' : `Recommended: ${recommendedLabel}`}
        </button>
        <button
          type="button"
          disabled={actionId !== null}
          onClick={() => onAttentionAction(item.id, 'acknowledge')}
          className="rounded-lg border border-white/15 px-3 py-2 text-xs uppercase tracking-[0.18em] text-gray-200 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {actionId === `${item.id}:acknowledge` ? 'Acknowledging...' : 'Acknowledge'}
        </button>
        <button
          type="button"
          disabled={actionId !== null || Boolean(item.linkedTaskId)}
          onClick={() => onOpenTaskDraft(item, actionHint)}
          className="rounded-lg border border-cyan-500/30 px-3 py-2 text-xs uppercase tracking-[0.18em] text-cyan-300 transition hover:bg-cyan-500/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {item.linkedTaskId ? 'Task Linked' : 'Create Task'}
        </button>
        <button
          type="button"
          disabled={actionId !== null}
          onClick={() => onAttentionAction(item.id, 'resolve')}
          className="rounded-lg border border-emerald-500/30 px-3 py-2 text-xs uppercase tracking-[0.18em] text-emerald-300 transition hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {actionId === `${item.id}:resolve` ? 'Resolving...' : 'Resolve'}
        </button>
        <button
          type="button"
          disabled={actionId !== null}
          onClick={() => onAttentionAction(item.id, 'snooze', { snoozeHours: 24 })}
          className="rounded-lg border border-amber-500/30 px-3 py-2 text-xs uppercase tracking-[0.18em] text-amber-200 transition hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {actionId === `${item.id}:snooze` ? 'Snoozing...' : 'Snooze 24h'}
        </button>
        {item.status !== 'open' && (
          <button
            type="button"
            disabled={actionId !== null}
            onClick={() => onAttentionAction(item.id, 'reopen')}
            className="rounded-lg border border-white/15 px-3 py-2 text-xs uppercase tracking-[0.18em] text-gray-200 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {actionId === `${item.id}:reopen` ? 'Reopening...' : 'Reopen'}
          </button>
        )}
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="text-xs text-gray-400">
          <div className="mb-2 uppercase tracking-[0.18em] text-slate-400">Owner</div>
          <div className="flex gap-2">
            <select
              value={ownerDraft}
              onChange={(event) => setOwnerDraft(event.target.value)}
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-400/40"
            >
              <option value="">(none)</option>
              {agentOptions.map((agent) => (
                <option key={`${item.id}-owner-${agent.id}`} value={agent.id}>
                  {agent.emoji} {agent.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={actionId !== null}
              onClick={() => onAttentionAction(item.id, 'set_owner', { owner: ownerDraft || null })}
              className="rounded-lg border border-white/15 px-3 py-2 text-xs uppercase tracking-[0.18em] text-gray-200 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {actionId === `${item.id}:set_owner` ? 'Saving...' : 'Set'}
            </button>
          </div>
        </label>
        <label className="text-xs text-gray-400">
          <div className="mb-2 uppercase tracking-[0.18em] text-slate-400">Next Review</div>
          <div className="flex gap-2">
            <input
              type="datetime-local"
              value={nextReviewDraft}
              onChange={(event) => setNextReviewDraft(event.target.value)}
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-400/40"
            />
            <button
              type="button"
              disabled={actionId !== null}
              onClick={() => onAttentionAction(item.id, 'set_next_review_at', { nextReviewAt: nextReviewDraft || null })}
              className="rounded-lg border border-white/15 px-3 py-2 text-xs uppercase tracking-[0.18em] text-gray-200 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {actionId === `${item.id}:set_next_review_at` ? 'Saving...' : 'Set'}
            </button>
          </div>
        </label>
      </div>
      {isTaskDraftOpen && taskDraft && (
        <div className="mt-4 rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4">
          <div className="text-xs uppercase tracking-[0.18em] text-cyan-300">Confirm Sheet</div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="text-xs text-gray-400">
              <div className="mb-2 uppercase tracking-[0.18em] text-slate-400">Title</div>
              <input
                value={taskDraft.title}
                onChange={(event) => onTaskDraftChange('title', event.target.value)}
                className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-400/40"
              />
            </label>
            <label className="text-xs text-gray-400">
              <div className="mb-2 uppercase tracking-[0.18em] text-slate-400">Target Agent</div>
              <select
                value={taskDraft.targetAgent}
                onChange={(event) => onTaskDraftChange('targetAgent', event.target.value)}
                className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-400/40"
              >
                {agentOptions.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.emoji} {agent.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="mt-3 block text-xs text-gray-400">
            <div className="mb-2 uppercase tracking-[0.18em] text-slate-400">Detail</div>
            <textarea
              rows={5}
              value={taskDraft.detail}
              onChange={(event) => onTaskDraftChange('detail', event.target.value)}
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm leading-6 text-white outline-none transition focus:border-cyan-400/40"
            />
          </label>
          <label className="mt-3 block text-xs text-gray-400">
            <div className="mb-2 uppercase tracking-[0.18em] text-slate-400">Note</div>
            <input
              value={taskDraft.note}
              onChange={(event) => onTaskDraftChange('note', event.target.value)}
              placeholder="Optional note"
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-400/40"
            />
          </label>
          <div className="mt-3 grid gap-3 md:grid-cols-4 text-[11px] text-gray-400">
            <div className="rounded-lg border border-white/6 bg-black/20 px-3 py-2">attention: {item.attentionType}</div>
            <div className="rounded-lg border border-white/6 bg-black/20 px-3 py-2">priority: {item.priority || 0}</div>
            <div className="rounded-lg border border-white/6 bg-black/20 px-3 py-2">needsDecision: {item.needsDecision ? 'yes' : 'no'}</div>
            <div className="rounded-lg border border-white/6 bg-black/20 px-3 py-2">estimatedValue: {item.commercialValue || 0}</div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={actionId !== null}
              onClick={() => onTaskDraftSubmit(item.id)}
              className="rounded-lg border border-cyan-500/30 px-3 py-2 text-xs uppercase tracking-[0.18em] text-cyan-300 transition hover:bg-cyan-500/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {actionId === `${item.id}:create_task` ? 'Creating...' : 'Confirm Create Task'}
            </button>
            <button
              type="button"
              disabled={actionId !== null}
              onClick={onTaskDraftCancel}
              className="rounded-lg border border-white/15 px-3 py-2 text-xs uppercase tracking-[0.18em] text-gray-300 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function AgentCard({ agent }) {
  const layerLabel = agent.activityState === 'inactive'
    ? 'Inactive'
    : agent.layer === 'focus'
      ? 'Focus'
      : 'Active'
  return (
    <div className="rounded-xl border border-white/6 bg-black/20 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xl">{agent.emoji}</span>
            <span className="font-display text-white">{agent.name}</span>
          </div>
          <div className="mt-1 text-xs text-gray-500">{agent.role}</div>
        </div>
        <div
          className="rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.18em]"
          style={{
            borderColor: agent.layer === 'focus' ? `${agent.color}55` : 'rgba(255,255,255,0.12)',
            color: agent.layer === 'focus' ? agent.color : '#94a3b8',
          }}
        >
          {layerLabel}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-4 gap-2 text-center text-xs">
        {['decision', 'blocked', 'risk', 'opportunity'].map((key) => (
          <div key={key} className="rounded-lg bg-white/4 px-2 py-2">
            <div className="text-gray-500">{TYPE_META[key].label}</div>
            <div className="mt-1 font-bold text-white">{agent.unresolvedCounts?.[key] || 0}</div>
          </div>
        ))}
      </div>

      <div className="mt-4 text-sm leading-6 text-gray-400">{agent.todaySummary}</div>
      <div className="mt-3 text-[11px] text-gray-500">
        最後活動: {formatTime(agent.lastActive)}
      </div>
      {agent.bindings?.length > 0 && (
        <div className="mt-2 text-[11px] text-gray-500">{agent.bindings[0]}</div>
      )}
    </div>
  )
}

function DigestSection({ section }) {
  return (
    <div className="rounded-xl border border-white/6 bg-black/20 p-4">
      <div className="text-xs uppercase tracking-[0.18em] text-cyan-300">{section.label}</div>
      <div className="mt-3 space-y-3">
        {section.items.map((item) => (
          <div key={item.id} className="rounded-lg border border-white/6 bg-white/[0.03] p-3">
            <div className="text-sm font-medium text-white">
              {item.agentEmoji} {item.agentName} / {item.title}
            </div>
            <div className="mt-2 text-sm leading-6 text-gray-300">
              你需要做的事：{item.action}
            </div>
            <div className="mt-1 text-sm leading-6 text-gray-400">
              若不處理：{item.impact}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function GrowthSignalRow({ signal }) {
  return (
    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
      <div className="flex items-center gap-2 text-sm text-emerald-200">
        <span className="text-lg">{signal.agentEmoji}</span>
        <span className="font-display text-white">{signal.agentName}</span>
        <span className="rounded-full border border-emerald-400/30 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-emerald-300">
          {signal.label}
        </span>
      </div>
      <div className="mt-3 text-sm leading-6 text-white">{signal.summary}</div>
      <div className="mt-2 text-[11px] text-emerald-100/80">成長分數 {signal.score} / 更新 {formatTime(signal.runAt)}</div>
    </div>
  )
}

function CandidatePatchRow({ item }) {
  const statusColor = item.reviewStatus === 'approved'
    ? 'text-emerald-300 border-emerald-400/30'
    : item.reviewStatus === 'rejected'
      ? 'text-rose-300 border-rose-400/30'
      : 'text-amber-200 border-amber-400/30'
  const applyLabel = item.applyStatus === 'applied'
    ? 'applied'
    : item.applyStatus === 'rolled_back'
      ? 'rolled back'
      : 'not applied'
  return (
    <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-white">
          {item.agentName ? `${item.agentName} / ` : ''}
          {item.category}
        </div>
        <div className="flex items-center gap-2">
          <div className="text-[11px] text-amber-100/80">
            {item.candidateKind || 'recurring'}
          </div>
          <div className="text-[11px] text-amber-200">
            impact {item.estimatedImpact} / x{item.recurrence}
          </div>
          <div className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] ${statusColor}`}>
            {item.reviewStatus || 'pending'}
          </div>
        </div>
      </div>
      <div className="mt-2 text-sm leading-6 text-amber-50">{item.reason}</div>
      <div className="mt-2 text-sm leading-6 text-amber-100/80">{item.proposedChange}</div>
      {item.evolutionStatusLabel && (
        <div className="mt-2 text-[11px] text-amber-200/80">
          gate: {item.evolutionStatusLabel}
          {item.autoApplyEligible ? ' / auto-eligible' : ''}
        </div>
      )}
      {item.dryRunSummary && (
        <div className="mt-2 text-[11px] text-cyan-100/80">{item.dryRunSummary}</div>
      )}
      {item.applyPrereqs?.length > 0 && (
        <div className="mt-2 text-[11px] text-rose-200/80">
          prereqs: {item.applyPrereqs.join(' | ')}
        </div>
      )}
      {item.evidenceRefs?.length > 0 && (
        <div className="mt-2 text-[11px] text-amber-100/80">
          evidence: {item.evidenceRefs.slice(0, 3).join(' | ')}
        </div>
      )}
      <div className="mt-2 text-[11px] text-amber-200/80">{item.target}</div>
      {item.reviewArtifactPath && (
        <div className="mt-2 text-[11px] text-cyan-200/80">{item.reviewArtifactPath}</div>
      )}
      {(item.reviewedAt || item.reviewNote) && (
        <div className="mt-2 text-[11px] text-amber-100/70">
          {item.reviewedAt ? `reviewed ${formatTime(item.reviewedAt)}` : ''}
          {item.reviewedBy ? ` / by ${item.reviewedBy}` : ''}
          {item.reviewNote ? ` / ${item.reviewNote}` : ''}
        </div>
      )}
      {(item.appliedAt || item.appliedBy) && (
        <div className="mt-2 text-[11px] text-emerald-200/80">
          {item.appliedAt ? `applied ${formatTime(item.appliedAt)}` : ''}
          {item.appliedBy ? ` / by ${item.appliedBy}` : ''}
        </div>
      )}
      {(item.applyStatus || item.unappliedAt || item.unappliedBy) && (
        <div className="mt-2 text-[11px] text-slate-200/70">
          apply state: {applyLabel}
          {item.unappliedAt ? ` / rolled back ${formatTime(item.unappliedAt)}` : ''}
          {item.unappliedBy ? ` / by ${item.unappliedBy}` : ''}
        </div>
      )}
    </div>
  )
}

export default function BossInboxDashboard() {
  const [payload, setPayload] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [showAllFish, setShowAllFish] = useState(false)
  const [showInactiveFish, setShowInactiveFish] = useState(false)
  const [candidateActionId, setCandidateActionId] = useState(null)
  const [candidateError, setCandidateError] = useState('')
  const [attentionActionId, setAttentionActionId] = useState(null)
  const [attentionError, setAttentionError] = useState('')
  const [taskDraftId, setTaskDraftId] = useState(null)
  const [taskDraft, setTaskDraft] = useState(null)

  const load = async (withSpinner = false) => {
    if (withSpinner) setRefreshing(true)
    try {
      const res = await fetch('/api/boss-inbox', { cache: 'no-store' })
      const data = await res.json()
      setPayload(data)
    } catch (error) {
      console.error('Failed to fetch boss inbox:', error)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    load()
    const timer = setInterval(() => load(), 30_000)
    return () => clearInterval(timer)
  }, [])

  const attentionItems = payload?.attentionItems || []
  const attentionActionHints = payload?.attentionActionHints || {}
  const sortedAttentionItems = useMemo(() => {
    const list = [...attentionItems]
    list.sort((a, b) => {
      const aPriority = toPriorityOrder(attentionActionHints[a.id]?.priorityOrder)
      const bPriority = toPriorityOrder(attentionActionHints[b.id]?.priorityOrder)
      if (aPriority !== bPriority) return aPriority - bPriority
      if ((b.unresolved ? 1 : 0) !== (a.unresolved ? 1 : 0)) {
        return (b.unresolved ? 1 : 0) - (a.unresolved ? 1 : 0)
      }
      if ((b.signalScore || 0) !== (a.signalScore || 0)) return (b.signalScore || 0) - (a.signalScore || 0)
      if ((b.commercialValue || 0) !== (a.commercialValue || 0)) return (b.commercialValue || 0) - (a.commercialValue || 0)
      return (b.updatedAt || 0) - (a.updatedAt || 0)
    })
    return list
  }, [attentionItems, attentionActionHints])
  const focusItems = useMemo(
    () => sortedAttentionItems.filter((item) => item.unresolved && item.attentionType !== 'digest_only').slice(0, 12),
    [sortedAttentionItems],
  )
  const digestItems = useMemo(
    () => sortedAttentionItems.filter((item) => item.unresolved && item.attentionType === 'digest_only').slice(0, 6),
    [sortedAttentionItems],
  )
  const allAgents = payload?.agentSummaries || []
  const activeAgents = payload?.activeAgentSummaries || allAgents.filter((agent) => agent.activityState === 'active')
  const inactiveAgents = payload?.inactiveAgentSummaries || allAgents.filter((agent) => agent.activityState === 'inactive')
  const agentRank = useMemo(() => {
    const map = {}
    for (const item of sortedAttentionItems) {
      if (!item.unresolved) continue
      if (map[item.agentId] !== undefined) continue
      map[item.agentId] = toPriorityOrder(attentionActionHints[item.id]?.priorityOrder)
    }
    return map
  }, [sortedAttentionItems, attentionActionHints])
  const orderedActiveAgents = useMemo(() => {
    const list = [...activeAgents]
    list.sort((a, b) => {
      const aRank = agentRank[a.id] ?? Number.MAX_SAFE_INTEGER
      const bRank = agentRank[b.id] ?? Number.MAX_SAFE_INTEGER
      if (aRank !== bRank) return aRank - bRank
      if ((b.unresolvedTotal || 0) !== (a.unresolvedTotal || 0)) return (b.unresolvedTotal || 0) - (a.unresolvedTotal || 0)
      return (b.lastActive || 0) - (a.lastActive || 0)
    })
    return list
  }, [activeAgents, agentRank])
  const focusAgents = orderedActiveAgents.filter((agent) => agent.layer === 'focus')
  const growthSignals = payload?.growthSignals || []
  const candidatePatches = payload?.candidatePatches || []
  const governanceSummary = payload?.governanceSummary || null
  const approvedCandidatePatches = candidatePatches.filter((item) => item.reviewStatus === 'approved')
  const pendingCandidatePatches = candidatePatches.filter((item) => (item.reviewStatus || 'pending') === 'pending')
  const approvedNotAppliedCandidatePatches = candidatePatches.filter((item) => item.reviewStatus === 'approved' && item.applyStatus !== 'applied')
  const appliedOrRolledBackCandidatePatches = candidatePatches.filter((item) => item.reviewStatus === 'approved' && ['applied', 'rolled_back'].includes(item.applyStatus))
  const rejectedCandidatePatches = candidatePatches.filter((item) => item.reviewStatus === 'rejected')
  const agentEvolutionStatus = payload?.agentEvolutionStatus || []
  const latestDigest = payload?.latestDailyDigest || null
  const digestSections = latestDigest?.sections || []
  const digestAnomalies = latestDigest?.anomalies || []
  const digestEvolution = latestDigest?.evolution || null
  const hasStructuredDigest = Boolean(latestDigest?.headline || digestSections.length > 0 || digestAnomalies.length > 0)
  const agentOptions = allAgents
    .filter((agent) => agent.activityState === 'active')
    .map((agent) => ({ id: agent.id, name: agent.name, emoji: agent.emoji }))

  const openTaskDraft = (item, actionHint = null) => {
    const hintedTarget = actionHint?.suggestedTargetAgent || null
    const defaultTargetAgent = hintedTarget || ((item.attentionType === 'blocked' || item.attentionType === 'risk') ? 'admin' : item.agentId)
    const finalTargetAgent = agentOptions.some((entry) => entry.id === defaultTargetAgent)
      ? defaultTargetAgent
      : (agentOptions[0]?.id || defaultTargetAgent)
    setTaskDraftId(item.id)
    setTaskDraft({
      title: item.title || '',
      detail: [item.title, item.detail].filter(Boolean).join('\n'),
      targetAgent: finalTargetAgent,
      note: '',
    })
    setAttentionError('')
  }

  const updateTaskDraft = (field, value) => {
    setTaskDraft((current) => ({ ...(current || {}), [field]: value }))
  }

  const cancelTaskDraft = () => {
    setTaskDraftId(null)
    setTaskDraft(null)
  }

  const mutateCandidate = async (id, action) => {
    setCandidateActionId(`${id}:${action}`)
    setCandidateError('')
    try {
      const res = await fetch(`/api/boss-inbox/candidates/${encodeURIComponent(id)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action,
          reviewer: 'boss-inbox-ui',
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || 'Failed to review candidate patch')
      }
      await load(true)
    } catch (error) {
      setCandidateError(error.message || 'Failed to review candidate patch')
    } finally {
      setCandidateActionId(null)
    }
  }

  const mutateAttention = async (id, action, extra = {}) => {
    setAttentionActionId(`${id}:${action}`)
    setAttentionError('')
    try {
      const res = await fetch(`/api/boss-inbox/attention/${encodeURIComponent(id)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action,
          reviewer: 'boss-inbox-ui',
          ...extra,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || 'Failed to update attention item')
      }
      await load(true)
      if (action === 'create_task' || action === 'resolve' || action === 'acknowledge') {
        cancelTaskDraft()
      }
    } catch (error) {
      setAttentionError(error.message || 'Failed to update attention item')
    } finally {
      setAttentionActionId(null)
    }
  }

  if (loading) {
    return (
      <div className="glass-card rounded-2xl p-6 text-sm text-gray-400">
        Loading Boss Inbox...
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="glass-card rounded-2xl p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-xs uppercase tracking-[0.22em] text-cyan-300">Boss Inbox</div>
            <h2 className="mt-2 font-display text-3xl text-white">只看待處理、風險與商機</h2>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-gray-400">
              Dashboard 負責全局總覽；Discord 保留給真正要處理與回覆的時刻。
            </p>
          </div>
          <button
            type="button"
            onClick={() => load(true)}
            className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/30 px-4 py-2 text-sm text-cyan-300 transition hover:bg-cyan-500/10"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <CountCard label="待決策" value={payload?.unresolvedCounts?.decision || 0} color={TYPE_META.decision.color} Icon={TYPE_META.decision.icon} />
        <CountCard label="阻塞" value={payload?.unresolvedCounts?.blocked || 0} color={TYPE_META.blocked.color} Icon={TYPE_META.blocked.icon} />
        <CountCard label="風險" value={payload?.unresolvedCounts?.risk || 0} color={TYPE_META.risk.color} Icon={TYPE_META.risk.icon} />
        <CountCard label="商機" value={payload?.unresolvedCounts?.opportunity || 0} color={TYPE_META.opportunity.color} Icon={TYPE_META.opportunity.icon} />
      </div>

      {governanceSummary && (
        <div className="glass-card rounded-2xl p-4">
          <div className="grid gap-3 text-sm md:grid-cols-3 xl:grid-cols-8">
            <div className="rounded-xl border border-white/6 bg-black/20 px-4 py-3 text-gray-300">
              今日升格訊號 <span className="ml-2 font-display text-white">{governanceSummary.escalatedSignalsCount || 0}</span>
            </div>
            <div className="rounded-xl border border-white/6 bg-black/20 px-4 py-3 text-gray-300">
              可處理商機 <span className="ml-2 font-display text-white">{governanceSummary.actionableOpportunityCount || 0}</span>
            </div>
            <div className="rounded-xl border border-white/6 bg-black/20 px-4 py-3 text-gray-300">
              未掛任務 <span className="ml-2 font-display text-white">{governanceSummary.openAttentionWithoutTask || 0}</span>
            </div>
            <div className="rounded-xl border border-white/6 bg-black/20 px-4 py-3 text-gray-300">
              已掛任務 <span className="ml-2 font-display text-white">{governanceSummary.openAttentionWithTask || 0}</span>
            </div>
            <div className="rounded-xl border border-white/6 bg-black/20 px-4 py-3 text-gray-300">
              任務過久未動 <span className="ml-2 font-display text-white">{governanceSummary.openWithStaleTask || 0}</span>
            </div>
            <div className="rounded-xl border border-white/6 bg-black/20 px-4 py-3 text-gray-300">
              Snoozed <span className="ml-2 font-display text-white">{governanceSummary.snoozedCount || 0}</span>
            </div>
            <div className="rounded-xl border border-white/6 bg-black/20 px-4 py-3 text-gray-300">
              等待 Apply <span className="ml-2 font-display text-white">{governanceSummary.approvedNotAppliedCount || 0}</span>
            </div>
            <div className="rounded-xl border border-white/6 bg-black/20 px-4 py-3 text-gray-300">
              Need Dry-run <span className="ml-2 font-display text-white">{governanceSummary.candidateNeedDryRun || 0}</span>
            </div>
            <div className="rounded-xl border border-white/6 bg-black/20 px-4 py-3 text-gray-300">
              Auto Eligible <span className="ml-2 font-display text-white">{governanceSummary.candidateAutoEligible || 0}</span>
            </div>
            <div className="rounded-xl border border-white/6 bg-black/20 px-4 py-3 text-gray-300">
              Digest Delivery <span className="ml-2 font-display text-white">{governanceSummary.digestDeliveryStatus || 'pending'}</span>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1.4fr,1fr]">
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card rounded-2xl p-6"
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-cyan-300">Layer 1</div>
              <div className="mt-2 font-display text-xl text-white">待處理優先</div>
            </div>
            <div className="text-xs text-gray-500">{focusItems.length} items</div>
          </div>
          <div className="mt-5 space-y-3">
            {attentionError && (
              <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-200">
                {attentionError}
              </div>
            )}
            {focusItems.length === 0 && (
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm text-emerald-300">
                目前沒有需要立即處理的項目。
              </div>
            )}
            {focusItems.map((item) => (
              <AttentionRow
                key={item.id}
                item={item}
                actionHint={attentionActionHints[item.id] || null}
                actionId={attentionActionId}
                onAttentionAction={mutateAttention}
                isTaskDraftOpen={taskDraftId === item.id}
                taskDraft={taskDraft}
                onOpenTaskDraft={openTaskDraft}
                onTaskDraftChange={updateTaskDraft}
                onTaskDraftCancel={cancelTaskDraft}
                onTaskDraftSubmit={(id) => mutateAttention(id, 'create_task', taskDraft || {})}
                agentOptions={agentOptions}
              />
            ))}
          </div>
          {digestItems.length > 0 && (
            <div className="mt-6">
              <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Digest Only</div>
              <div className="mt-3 space-y-2">
                {digestItems.map((item) => (
                  <div key={item.id} className="rounded-lg border border-white/6 bg-white/3 px-4 py-3 text-sm text-gray-400">
                    <span className="mr-2">{item.agentEmoji}</span>
                    <span className="text-white">{item.agentName}</span>
                    <span className="mx-2 text-gray-600">/</span>
                    {item.title}
                  </div>
                ))}
              </div>
            </div>
          )}
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="glass-card rounded-2xl p-6"
        >
          <div className="text-xs uppercase tracking-[0.2em] text-cyan-300">Daily Digest</div>
          <div className="mt-2 font-display text-xl text-white">老闆晚間摘要</div>
          <div className="mt-3 text-xs text-gray-500">
            生成時間: {formatTime(latestDigest?.generatedAt)}
            {latestDigest?.deliveryChannel ? ` / channel: ${latestDigest.deliveryChannel}` : ''}
            {latestDigest?.deliveryStatus ? ` / delivery: ${latestDigest.deliveryStatus}` : ''}
          </div>
          {hasStructuredDigest ? (
            <div className="mt-4 space-y-4">
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm leading-7 text-emerald-200">
                {latestDigest?.headline || 'No digest generated yet.'}
              </div>

              {latestDigest?.quietDay && !latestDigest?.tomorrowPreview && digestSections.length === 0 && (
                <div className="rounded-xl border border-white/6 bg-black/20 p-4 text-sm text-gray-400">
                  今天沒有額外需要你拍板或處理的項目。
                </div>
              )}

              {digestSections.map((section) => (
                <DigestSection key={section.id} section={section} />
              ))}

              {digestEvolution && (
                <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-cyan-300">今日進化</div>
                  <div className="mt-3 space-y-2 text-sm leading-6 text-cyan-100">
                    <div>待審改進：{digestEvolution.candidatePatchCount || 0} 件</div>
                    <div>未解卡片：{digestEvolution.openAttentionCount || 0} 張</div>
                    <div>已掛任務：{digestEvolution.linkedTaskCount || 0} 張</div>
                    <div>已升格訊號：{digestEvolution.escalatedSignalsCount || 0} 張</div>
                    <div>待 apply：{digestEvolution.approvedNotAppliedCount || 0} 件</div>
                    <div>
                      24h 無新學習：
                      {(digestEvolution.staleAgents || []).length > 0
                        ? ` ${(digestEvolution.staleAgents || []).map((entry) => `${entry.agentEmoji} ${entry.agentName}`).join('、')}`
                        : ' 無'}
                    </div>
                    <div>
                      下一輪最值得放行：
                      {digestEvolution.topExperiment?.summary
                        ? ` ${digestEvolution.topExperiment.agentEmoji} ${digestEvolution.topExperiment.agentName} / ${digestEvolution.topExperiment.summary}`
                        : ' 無'}
                    </div>
                  </div>
                </div>
              )}

              {latestDigest?.tomorrowPreview && (
                <div className="rounded-xl border border-white/6 bg-black/20 p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-cyan-300">明天第一件事</div>
                  <div className="mt-3 text-sm leading-7 text-gray-300">{latestDigest.tomorrowPreview}</div>
                </div>
              )}

              {digestAnomalies.length > 0 && (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-amber-300">系統異常附錄</div>
                  <div className="mt-3 space-y-2">
                    {digestAnomalies.map((anomaly, index) => (
                      <div key={`${anomaly.type}-${index}`} className="text-sm leading-6 text-amber-100">
                        {anomaly.label}: {anomaly.detail}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <pre className="mt-4 max-h-[560px] overflow-auto whitespace-pre-wrap rounded-xl border border-white/6 bg-black/20 p-4 text-sm leading-7 text-gray-300">
              {latestDigest?.content || 'No digest generated yet.'}
            </pre>
          )}
        </motion.section>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr,1fr]">
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08 }}
          className="glass-card rounded-2xl p-6"
        >
          <div className="text-xs uppercase tracking-[0.2em] text-cyan-300">Growth Signals</div>
          <div className="mt-2 font-display text-xl text-white">今天最值得追的成長訊號</div>
          <div className="mt-5 space-y-3">
            {growthSignals.length === 0 && (
              <div className="rounded-xl border border-white/6 bg-black/20 p-4 text-sm text-gray-400">
                目前沒有足夠強的商業成長訊號。
              </div>
            )}
            {growthSignals.map((signal) => (
              <GrowthSignalRow key={signal.id} signal={signal} />
            ))}
          </div>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.12 }}
          className="glass-card rounded-2xl p-6"
        >
          <div className="text-xs uppercase tracking-[0.2em] text-cyan-300">Candidate Patches</div>
          <div className="mt-2 font-display text-xl text-white">待審核改進</div>
          <div className="mt-3 text-xs text-gray-500">
            pending {pendingCandidatePatches.length} / approved {approvedCandidatePatches.length} / rejected {rejectedCandidatePatches.length}
          </div>
          {candidateError && (
            <div className="mt-4 rounded-xl border border-rose-500/20 bg-rose-500/5 p-3 text-sm text-rose-200">
              {candidateError}
            </div>
          )}
          <div className="mt-5 space-y-3">
            {pendingCandidatePatches.length === 0 && (
              <div className="rounded-xl border border-white/6 bg-black/20 p-4 text-sm text-gray-400">
                目前沒有新的 prompt / heartbeat / knowledge 候選改進。
              </div>
            )}
            {pendingCandidatePatches.slice(0, 6).map((item) => (
              <div key={item.id} className="space-y-3">
                <CandidatePatchRow item={item} />
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={candidateActionId !== null}
                    onClick={() => mutateCandidate(item.id, 'approve')}
                    className="rounded-lg border border-emerald-500/30 px-3 py-2 text-xs uppercase tracking-[0.18em] text-emerald-300 transition hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {candidateActionId === `${item.id}:approve` ? 'Approving...' : 'Approve'}
                  </button>
                  <button
                    type="button"
                    disabled={candidateActionId !== null}
                    onClick={() => mutateCandidate(item.id, 'reject')}
                    className="rounded-lg border border-rose-500/30 px-3 py-2 text-xs uppercase tracking-[0.18em] text-rose-300 transition hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {candidateActionId === `${item.id}:reject` ? 'Rejecting...' : 'Reject'}
                  </button>
                </div>
              </div>
            ))}
          </div>
          {(approvedNotAppliedCandidatePatches.length > 0 || appliedOrRolledBackCandidatePatches.length > 0 || rejectedCandidatePatches.length > 0) && (
            <div className="mt-6 space-y-3 border-t border-white/6 pt-6">
              {approvedNotAppliedCandidatePatches.length > 0 && (
                <div className="space-y-3">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Approved / Not Applied</div>
                  {approvedNotAppliedCandidatePatches.slice(0, 6).map((item) => (
                    <div key={item.id} className="space-y-3">
                      <CandidatePatchRow item={item} />
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={candidateActionId !== null || !item.autoApplyEligible}
                          onClick={() => mutateCandidate(item.id, 'apply')}
                          className="rounded-lg border border-cyan-500/30 px-3 py-2 text-xs uppercase tracking-[0.18em] text-cyan-300 transition hover:bg-cyan-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {candidateActionId === `${item.id}:apply` ? 'Applying...' : 'Apply'}
                        </button>
                        <button
                          type="button"
                          disabled={candidateActionId !== null}
                          onClick={() => mutateCandidate(item.id, 'reset')}
                          className="rounded-lg border border-white/15 px-3 py-2 text-xs uppercase tracking-[0.18em] text-gray-300 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {candidateActionId === `${item.id}:reset` ? 'Resetting...' : 'Reset'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {appliedOrRolledBackCandidatePatches.length > 0 && (
                <div className="space-y-3">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Applied / Rolled Back</div>
                  {appliedOrRolledBackCandidatePatches.slice(0, 6).map((item) => (
                    <div key={item.id} className="space-y-3">
                      <CandidatePatchRow item={item} />
                      <div className="flex flex-wrap gap-2">
                        {item.applyStatus === 'applied' && (
                          <button
                            type="button"
                            disabled={candidateActionId !== null}
                            onClick={() => mutateCandidate(item.id, 'unapply')}
                            className="rounded-lg border border-slate-500/30 px-3 py-2 text-xs uppercase tracking-[0.18em] text-slate-200 transition hover:bg-slate-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {candidateActionId === `${item.id}:unapply` ? 'Rolling Back...' : 'Rollback'}
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={candidateActionId !== null}
                          onClick={() => mutateCandidate(item.id, 'reset')}
                          className="rounded-lg border border-white/15 px-3 py-2 text-xs uppercase tracking-[0.18em] text-gray-300 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {candidateActionId === `${item.id}:reset` ? 'Resetting...' : 'Reset'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {rejectedCandidatePatches.length > 0 && (
                <div className="space-y-3">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Rejected</div>
                  {rejectedCandidatePatches.slice(0, 6).map((item) => (
                    <div key={item.id} className="space-y-3">
                      <CandidatePatchRow item={item} />
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={candidateActionId !== null}
                          onClick={() => mutateCandidate(item.id, 'reset')}
                          className="rounded-lg border border-white/15 px-3 py-2 text-xs uppercase tracking-[0.18em] text-gray-300 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {candidateActionId === `${item.id}:reset` ? 'Resetting...' : 'Reset'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </motion.section>
      </div>

      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="glass-card rounded-2xl p-6"
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
          <div className="text-xs uppercase tracking-[0.2em] text-cyan-300">Layer 2</div>
          <div className="mt-2 font-display text-xl text-white">Active Fleet</div>
        </div>
        <button
          type="button"
          onClick={() => setShowAllFish((value) => !value)}
          className="rounded-xl border border-white/10 px-4 py-2 text-sm text-gray-300 transition hover:border-cyan-400/30 hover:text-white"
        >
            {showAllFish ? 'Collapse' : `Expand Active (${orderedActiveAgents.length})`}
        </button>
      </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {(showAllFish ? orderedActiveAgents : focusAgents).map((agent) => (
            <AgentCard key={agent.id} agent={agent} />
          ))}
        </div>

        {inactiveAgents.length > 0 && (
          <div className="mt-6 rounded-2xl border border-white/6 bg-black/20 p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Inactive Roster</div>
                <div className="mt-2 text-sm text-gray-400">這些 workspace 目前不在 active Discord 回報閉環內。</div>
              </div>
              <button
                type="button"
                onClick={() => setShowInactiveFish((value) => !value)}
                className="rounded-xl border border-white/10 px-4 py-2 text-sm text-gray-300 transition hover:border-cyan-400/30 hover:text-white"
              >
                {showInactiveFish ? 'Hide Inactive' : `Show Inactive (${inactiveAgents.length})`}
              </button>
            </div>
            {showInactiveFish && (
              <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {inactiveAgents.map((agent) => (
                  <AgentCard key={agent.id} agent={agent} />
                ))}
              </div>
            )}
          </div>
        )}

        <div className="mt-6 rounded-2xl border border-white/6 bg-black/20 p-4">
          <div className="text-xs uppercase tracking-[0.18em] text-cyan-300">Evolution Status</div>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {agentEvolutionStatus
              .filter((entry) => entry.activityState === 'active' || showInactiveFish)
              .slice(0, showAllFish ? agentEvolutionStatus.length : 9)
              .map((entry) => (
              <div key={entry.agentId} className="rounded-xl border border-white/6 bg-white/[0.03] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm text-white">
                    {entry.agentEmoji} {entry.agentName}
                  </div>
                  <div className={`text-[11px] ${entry.stale ? 'text-amber-300' : 'text-emerald-300'}`}>
                    {entry.activityState === 'inactive' ? 'INACTIVE' : (entry.stale ? 'STALE' : 'ACTIVE')}
                  </div>
                </div>
                <div className="mt-3 text-sm leading-6 text-gray-300">
                  最近學到：{entry.lastLearned || '無'}
                </div>
                <div className="mt-2 text-sm leading-6 text-gray-400">
                  下一輪要試：{entry.nextTest || '無'}
                </div>
                <div className="mt-3 text-[11px] text-gray-500">
                  候選改進 {entry.candidateCount || 0} / 品質回歸 {entry.qualityRegressionCount || 0}
                </div>
              </div>
            ))}
          </div>
        </div>
      </motion.section>
    </div>
  )
}
