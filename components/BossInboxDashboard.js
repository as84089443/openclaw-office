'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle, ArrowRight, Bot, BrainCircuit, BriefcaseBusiness, Bug, Clock3, GitBranchPlus, Orbit, RefreshCw, ShieldAlert, Sparkles } from 'lucide-react'

const TYPE_META = {
  decision: { label: '待拍板', color: '#f59e0b', icon: Clock3 },
  blocked: { label: '卡住', color: '#ef4444', icon: AlertTriangle },
  risk: { label: '風險', color: '#f97316', icon: ShieldAlert },
  opportunity: { label: '商機', color: '#22c55e', icon: BriefcaseBusiness },
  digest_only: { label: '摘要', color: '#64748b', icon: Sparkles },
}

const ACTION_LABEL = {
  create_task: '交辦跟進',
  acknowledge: '先記下',
  resolve: '標記完成',
  reopen: '重新打開',
  snooze: '明天再看',
}

const ITEM_STATUS_LABEL = {
  open: '待處理',
  acknowledged: '已記下',
  resolved: '已處理',
  snoozed: '稍後再看',
  reopened: '重新打開',
  closed: '已關閉',
}

const WORKFLOW_STATUS_LABEL = {
  open: '待處理',
  pending: '待處理',
  task_created: '已建立交辦',
  assigned: '已指派',
  in_progress: '進行中',
  completed: '已完成',
  failed: '未完成',
  snoozed: '稍後再看',
  acknowledged: '已記下',
  resolved: '已處理',
  approved: '已同意',
  rejected: '已退回',
  applied: '已套用',
  rolled_back: '已還原',
}

const WORKFLOW_PHASE_LABEL = {
  queued: '待派工',
  running: '執行中',
  waiting_reviewer: '等 Reviewer',
  awaiting_continuation: '等續跑',
  waiting_human_gate: '等老闆拍板',
  completed: '已完成',
  failed: '未完成',
  superseded: '已被取代',
}

const RESEARCH_OPERATOR_PHASE_LABEL = {
  running_research: '研究中',
  delegating: '派工中',
  verifying: '驗證中',
  waiting_human_gate: '等老闆拍板',
}

const REVIEW_STATUS_LABEL = {
  pending: '待確認',
  approved: '已同意',
  rejected: '已退回',
}

const APPLY_STATUS_LABEL = {
  applied: '已套用',
  rolled_back: '已還原',
  not_applied: '尚未套用',
}

const CANDIDATE_KIND_LABEL = {
  recurring: '例行調整',
  one_off: '單次調整',
  prompt: '提示詞調整',
  heartbeat: '節奏調整',
  knowledge: '知識補強',
}

const ACCESS_SOURCE_LABEL = {
  cookie: '瀏覽器登入',
  session: '瀏覽器登入',
  header: '手動驗證',
  disabled: '未啟用',
}

const DELIVERY_STATUS_LABEL = {
  pending: '待送達',
  queued: '準備中',
  sent: '已送出',
  delivered: '已送達',
  success: '已送達',
  failed: '送達失敗',
}

const BRAIN_MODE_LABEL = {
  queued: '待接手',
  execution: '執行中',
  review: '待驗收',
  blocked: '卡住',
}

const DELEGATION_STATUS_LABEL = {
  queued: '已排隊',
  running: '進行中',
  idle: '待命',
  blocked: '已卡住',
  dispatch_failed: '派送失敗',
  awaiting_continuation: '等續跑',
  'awaiting-continuation': '等續跑',
}

const SIDECAR_STATUS_LABEL = {
  queued: '已排隊',
  dispatched: '已派送',
  running: '進行中',
  dispatch_failed: '派送失敗',
}

const TASK_TYPE_LABEL = {
  primary: '主任務',
  sidecar_review: 'Sidecar Review',
  worker_subtask: '子任務',
  verifier: '驗證',
  memory_distill: '記憶蒸餾',
}

const MERGE_POLICY_LABEL = {
  advisory: '建議參考',
  consensus_required: '需共識',
  blocking_review: '可阻擋',
  root_cause_support: '根因支援',
}

const RESOLUTION_SOURCE_LABEL = {
  self: '自行收斂',
  parent: '由主任務關閉',
  dispatch_failed: '派送失敗',
}

const CONSENSUS_STATUS_LABEL = {
  pending_review: '待 reviewer',
  needs_more_review: '需更多 reviewer',
  advisory_only: '僅 advisory',
  clear: '已收斂',
  blocked: '被 reviewer 擋下',
  human_gate: '待人工核准',
  conflict: '意見衝突',
}

const RISK_TIER_LABEL = {
  low: '低風險',
  medium: '中風險',
  high: '高風險',
  irreversible: '不可逆',
}

const RULE_STATUS_LABEL = {
  draft: '草稿',
  dry_run: 'Dry Run',
  canary: 'Canary',
  approved: '已核准',
  auto_applied: '已自動套用',
  rolled_back: '已回滾',
}

function toPriorityOrder(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : Number.MAX_SAFE_INTEGER
}

function getAvailableHintActionsForItem(item) {
  const status = item?.status || 'open'
  if (status !== 'open') return ['reopen']
  const actions = ['acknowledge', 'resolve', 'snooze']
  if (item?.unresolved && !item?.linkedTaskId) {
    actions.push('create_task')
  }
  return actions
}

function isHintActionAvailable(item, action) {
  const candidate = String(action || '').toLowerCase()
  return getAvailableHintActionsForItem(item).includes(candidate)
}

function deriveRecommendedAction(item, hint = null) {
  const hintedActionList = Array.isArray(hint?.actionScores)
    ? hint.actionScores
      .map((entry) => String(entry?.action || '').toLowerCase())
      .filter(Boolean)
    : []

  for (const action of hintedActionList) {
    if (isHintActionAvailable(item, action)) return action
  }

  const suggested = String(hint?.suggestedAction || '').toLowerCase()
  if (isHintActionAvailable(item, suggested)) return suggested
  if (suggested === 'reopen' && isHintActionAvailable(item, 'reopen')) return 'reopen'
  if (item.status !== 'open') return 'reopen'
  if (item.unresolved && !item.linkedTaskId) return 'create_task'
  if (isHintActionAvailable(item, 'resolve')) return 'resolve'
  if (isHintActionAvailable(item, 'acknowledge')) return 'acknowledge'
  return item.status === 'open' ? 'snooze' : 'reopen'
}

function formatTime(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('zh-TW', {
    hour12: false,
  })
}

function humanizeToken(value) {
  const token = String(value || '').trim()
  if (!token) return '—'
  return token.replaceAll('_', ' ')
}

function formatStatusLabel(value, labels, fallback = '—') {
  const token = String(value || '').trim()
  if (!token) return fallback
  return labels[token] || humanizeToken(token)
}

function formatCandidateKind(value) {
  const token = String(value || '').trim()
  if (!token) return CANDIDATE_KIND_LABEL.recurring
  return CANDIDATE_KIND_LABEL[token] || humanizeToken(token)
}

function formatAuthSource(value) {
  return formatStatusLabel(value, ACCESS_SOURCE_LABEL, '未啟用')
}

function formatDeliveryStatus(value) {
  return formatStatusLabel(value, DELIVERY_STATUS_LABEL, '待送達')
}

function formatAutonomyLabel(label, level) {
  if (label) return label
  return `第 ${level || 1} 階段`
}

function formatBrainMode(value) {
  return formatStatusLabel(value, BRAIN_MODE_LABEL, '未設定')
}

function formatDelegationStatus(value) {
  return formatStatusLabel(value, DELEGATION_STATUS_LABEL, '未設定')
}

function formatTaskType(value) {
  return formatStatusLabel(value, TASK_TYPE_LABEL, '未分類')
}

function formatMergePolicy(value) {
  return formatStatusLabel(value, MERGE_POLICY_LABEL, '未設定')
}

function formatResolutionSource(value) {
  return formatStatusLabel(value, RESOLUTION_SOURCE_LABEL, '未設定')
}

function formatConsensusStatus(value) {
  return formatStatusLabel(value, CONSENSUS_STATUS_LABEL, '未評估')
}

function formatRiskTier(value) {
  return formatStatusLabel(value, RISK_TIER_LABEL, '未分級')
}

function formatRuleStatus(value) {
  return formatStatusLabel(value, RULE_STATUS_LABEL, '草稿')
}

function formatRelativeTime(ts) {
  if (!ts) return '—'
  const deltaMs = Date.now() - Number(ts)
  if (!Number.isFinite(deltaMs)) return '—'
  const deltaMinutes = Math.round(deltaMs / 60000)
  if (deltaMinutes <= 1) return '剛剛'
  if (deltaMinutes < 60) return `${deltaMinutes} 分鐘前`
  const deltaHours = Math.round(deltaMinutes / 60)
  if (deltaHours < 24) return `${deltaHours} 小時前`
  const deltaDays = Math.round(deltaHours / 24)
  return `${deltaDays} 天前`
}

function formatHintActionScores(actionScores = []) {
  if (!Array.isArray(actionScores) || actionScores.length === 0) return []
  return actionScores
    .map((entry) => {
      const action = String(entry?.action || '').trim()
      if (!action) return null
      const score = Number(entry?.score)
      const success = Number(entry?.expectedSuccess)
      return {
        action,
        actionLabel: ACTION_LABEL[action] || action,
        score: Number.isFinite(score) ? score : 0,
        success: Number.isFinite(success) ? success : 0,
      }
    })
    .filter(Boolean)
}

function formatUrgencyReason(item, actionHint) {
  if (!actionHint?.shouldBlock) return null

  if (item.source === 'stale-agent') {
    return '這條魚超過 24 小時沒有新學習或回報，先確認是不是斷線、沒資料，或回報停住了。'
  }

  if (item.attentionType === 'blocked') {
    return '這件事目前卡住後續流程，不先解開，後面就很難往下走。'
  }

  if (item.attentionType === 'risk') {
    return '這張被列為風險，先確認處理方向，才不會讓問題繼續放大。'
  }

  return '這件事會影響後續安排，所以建議先處理。'
}

function withSelectedAgent(agentOptions = [], selectedAgentId) {
  const selected = String(selectedAgentId || '').trim()
  if (!selected) return agentOptions
  if (agentOptions.some((agent) => agent.id === selected)) return agentOptions
  return [{ id: selected, name: humanizeToken(selected), emoji: '🗂️' }, ...agentOptions]
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

function LobsterMetricCard({ label, value, Icon, tone = 'cyan' }) {
  const toneMap = {
    cyan: 'border-cyan-500/20 bg-cyan-500/5 text-cyan-200',
    amber: 'border-amber-500/20 bg-amber-500/5 text-amber-200',
    rose: 'border-rose-500/20 bg-rose-500/5 text-rose-200',
    emerald: 'border-emerald-500/20 bg-emerald-500/5 text-emerald-200',
  }
  const style = toneMap[tone] || toneMap.cyan
  return (
    <div className={`rounded-xl border px-4 py-3 ${style}`}>
      <div className="flex items-center justify-between text-xs uppercase tracking-[0.16em]">
        <span>{label}</span>
        <Icon className="h-4 w-4" />
      </div>
      <div className="mt-3 font-display text-2xl text-white">{value}</div>
    </div>
  )
}

function LobsterTrackSection({
  eyebrow,
  title,
  description,
  tracks,
  emptyText,
  collapsible = false,
  defaultOpen = false,
  onRefresh,
}) {
  if (!tracks || tracks.length === 0) return null

  const body = (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-[0.16em] text-cyan-300">{eyebrow}</div>
          <div className="mt-2 text-lg text-white">{title}</div>
          <div className="mt-1 max-w-3xl text-sm leading-7 text-gray-400">{description}</div>
        </div>
        <div className="text-xs text-gray-500">{tracks.length} 題</div>
      </div>
      <div className="space-y-3">
        {tracks.map((track) => <LobsterTrackCard key={track.id} track={track} onRefresh={onRefresh} />)}
      </div>
    </div>
  )

  if (!collapsible) return body

  return (
    <details className="rounded-2xl border border-white/8 bg-black/10 p-4" open={defaultOpen}>
      <summary className="cursor-pointer list-none">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-[0.16em] text-cyan-300">{eyebrow}</div>
            <div className="mt-2 text-lg text-white">{title}</div>
            <div className="mt-1 max-w-3xl text-sm leading-7 text-gray-400">{description}</div>
          </div>
          <div className="text-xs text-gray-500">{tracks.length} 題</div>
        </div>
      </summary>
      <div className="mt-4 space-y-3">
        {tracks.length === 0 ? (
          <div className="rounded-xl border border-white/8 bg-black/20 px-4 py-3 text-sm text-gray-400">
            {emptyText}
          </div>
        ) : tracks.map((track) => <LobsterTrackCard key={track.id} track={track} onRefresh={onRefresh} />)}
      </div>
    </details>
  )
}

function LobsterTrackCard({ track, onRefresh }) {
  const [busy, setBusy] = useState(null)
  const [actionError, setActionError] = useState('')

  const callWorkflow = async (body) => {
    const res = await fetch('/api/workflow', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data?.error || '操作失敗')
    return data
  }

  const handleAction = async (action) => {
    setBusy(action)
    setActionError('')
    try {
      if (action === 'retry') {
        await callWorkflow({ action: 'retry_task', taskId: track.id })
      } else if (action === 'release') {
        await callWorkflow({ action: 'retry_task', taskId: track.id })
      } else if (action === 'delete') {
        if (!track.requestId) throw new Error('找不到 requestId，無法刪除')
        await callWorkflow({ action: 'manual_complete', requestId: track.requestId, result: '已由看板刪除' })
      }
      if (onRefresh) setTimeout(() => onRefresh(true), 800)
    } catch (err) {
      setActionError(err.message || '操作失敗')
    } finally {
      setBusy(null)
    }
  }

  const isBlocked = ['blocked', 'human_gate'].includes(String(track.status || ''))
  const isActive = !['completed', 'failed'].includes(String(track.status || ''))

  const blockerLine = (track.blockers || []).filter(Boolean).join(' / ')
  const openLoopLine = (track.openLoops || []).filter(Boolean).join(' / ')
  const suggestedSubagents = (track.suggestedSubagents || []).filter(Boolean)
  const delegatedAgents = (track.delegatedAgents || []).filter(Boolean)
  const childTasks = track.childTasks || []
  const consensus = track.consensus || null
  const reusableRule = track.reusableRule || null
  const sidecarDispatchLine = (track.sidecarDispatches || [])
    .map((dispatch) => `${dispatch.agentName}${dispatch.status ? ` (${formatStatusLabel(dispatch.status, SIDECAR_STATUS_LABEL, dispatch.status)})` : ''}`)
    .join(' / ')
  const showWorkflowPhase = Boolean(
    track.workflowPhase
    && !(
      (track.workflowPhase === 'running' && track.status === 'in_progress')
      || (track.workflowPhase === 'queued' && ['pending', 'assigned'].includes(track.status))
      || (track.workflowPhase === 'completed' && track.status === 'completed')
      || (track.workflowPhase === 'failed' && track.status === 'failed')
    ),
  )
  const showResearchOperatorPhase = Boolean(track.researchOperatorPhase)
  return (
    <div className={`rounded-2xl border p-4 ${track.staleMemory ? 'border-amber-500/20 bg-amber-500/5' : 'border-white/8 bg-black/20'}`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2 py-1 text-[11px] uppercase tracking-[0.18em] text-cyan-200">
              {track.agentEmoji} {track.agentName}
            </span>
            {track.originLabel && (
              <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-[11px] uppercase tracking-[0.18em] text-emerald-200">
                {track.originLabel}
              </span>
            )}
            <span className="rounded-full border border-white/10 px-2 py-1 text-[11px] uppercase tracking-[0.18em] text-gray-300">
              {formatBrainMode(track.brainMode)}
            </span>
            <span className="rounded-full border border-white/10 px-2 py-1 text-[11px] uppercase tracking-[0.18em] text-gray-400">
              {formatStatusLabel(track.status, WORKFLOW_STATUS_LABEL, '進行中')}
            </span>
            {showWorkflowPhase && (
              <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-[11px] uppercase tracking-[0.18em] text-amber-100">
                {formatStatusLabel(track.workflowPhase, WORKFLOW_PHASE_LABEL, track.workflowPhase)}
              </span>
            )}
            {showResearchOperatorPhase && (
              <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2 py-1 text-[11px] uppercase tracking-[0.18em] text-cyan-100">
                {formatStatusLabel(track.researchOperatorPhase, RESEARCH_OPERATOR_PHASE_LABEL, track.researchOperatorPhase)}
              </span>
            )}
            <span className="rounded-full border border-white/10 px-2 py-1 text-[11px] uppercase tracking-[0.18em] text-gray-300">
              {formatRiskTier(track.riskTier)}
            </span>
            {consensus && (
              <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-[11px] uppercase tracking-[0.18em] text-emerald-200">
                {formatConsensusStatus(consensus.status)}
              </span>
            )}
            {track.continuationRequired && (
              <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-[11px] uppercase tracking-[0.18em] text-amber-200">
                等續跑
              </span>
            )}
          </div>
          <div className="mt-3 font-display text-lg text-white">{track.title}</div>
          {(track.requestFrom || track.originDescription) && (
            <div className="mt-2 text-xs leading-6 text-gray-500">
              來源: {track.requestFrom || '系統'}{track.originDescription ? ` / ${track.originDescription}` : ''}
            </div>
          )}
          {track.summary && (
            <div className="mt-2 text-sm leading-7 text-gray-300">{track.summary}</div>
          )}
        </div>
        <div className="text-xs text-gray-500">
          記憶更新 {formatRelativeTime(track.updatedAt)} / {formatTime(track.updatedAt)}
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-white/6 bg-white/3 px-4 py-3">
          <div className="text-[11px] uppercase tracking-[0.16em] text-cyan-300">焦點</div>
          <div className="mt-2 text-sm text-gray-200">{track.focus || '—'}</div>
        </div>
        <div className="rounded-xl border border-white/6 bg-white/3 px-4 py-3">
          <div className="text-[11px] uppercase tracking-[0.16em] text-cyan-300">下一檢查點</div>
          <div className="mt-2 text-sm text-gray-200">{track.nextCheckpoint || track.nextStep || '—'}</div>
        </div>
        <div className="rounded-xl border border-white/6 bg-white/3 px-4 py-3">
          <div className="text-[11px] uppercase tracking-[0.16em] text-cyan-300">目前里程碑</div>
          <div className="mt-2 text-sm text-gray-200">{track.milestone || '—'}</div>
        </div>
        <div className="rounded-xl border border-white/6 bg-white/3 px-4 py-3">
          <div className="text-[11px] uppercase tracking-[0.16em] text-cyan-300">下一個自動步驟</div>
          <div className="mt-2 text-sm text-gray-200">{track.nextAutoStep || track.nextHandoff || track.nextStep || '—'}</div>
        </div>
        <div className="rounded-xl border border-white/6 bg-white/3 px-4 py-3">
          <div className="text-[11px] uppercase tracking-[0.16em] text-cyan-300">委派狀態</div>
          <div className="mt-2 text-sm text-gray-200">
            {formatDelegationStatus(track.delegationStatus)}
            {track.reviewerMode ? ` / ${track.reviewerMode}` : ''}
          </div>
        </div>
        <div className="rounded-xl border border-white/6 bg-white/3 px-4 py-3">
          <div className="text-[11px] uppercase tracking-[0.16em] text-cyan-300">治理</div>
          <div className="mt-2 text-sm text-gray-200">
            Retry {track.retryCount || 0}/{track.retryBudget || 0}
            {track.escalationLevel ? ` / Escalation L${track.escalationLevel}` : ''}
          </div>
        </div>
        <div className="rounded-xl border border-white/6 bg-white/3 px-4 py-3">
          <div className="text-[11px] uppercase tracking-[0.16em] text-cyan-300">共識摘要</div>
          <div className="mt-2 text-sm text-gray-200">
            {consensus?.summary || '目前還沒有 reviewer / verifier 共識摘要。'}
          </div>
        </div>
      </div>

      {(track.rootCause || blockerLine || openLoopLine || track.nextHandoff || track.nextAutoStep || suggestedSubagents.length > 0 || delegatedAgents.length > 0 || sidecarDispatchLine || track.evolutionNote || track.humanGateReason || consensus?.recommendedAction || reusableRule) && (
        <div className="mt-4 space-y-2 text-sm leading-7">
          {track.humanGateReason && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-amber-100">
              <span className="mr-2 text-amber-300">人工 Gate</span>{track.humanGateReason}
            </div>
          )}
          {track.rootCause && (
            <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 px-4 py-3 text-rose-100">
              <span className="mr-2 text-rose-300">根因</span>{track.rootCause}
            </div>
          )}
          {blockerLine && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-amber-100">
              <span className="mr-2 text-amber-300">Blockers</span>{blockerLine}
            </div>
          )}
          {openLoopLine && (
            <div className="rounded-xl border border-white/6 bg-black/20 px-4 py-3 text-gray-300">
              <span className="mr-2 text-cyan-300">Open Loops</span>
              {track.openLoopCount ? `${track.openLoopCount} 項 / ` : ''}
              {openLoopLine}
            </div>
          )}
          {delegatedAgents.length > 0 && (
            <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 px-4 py-3 text-cyan-100">
              <span className="mr-2 text-cyan-300">已派給</span>{delegatedAgents.join(' / ')}
            </div>
          )}
          {track.nextHandoff && (
            <div className="rounded-xl border border-white/6 bg-black/20 px-4 py-3 text-gray-300">
              <span className="mr-2 text-cyan-300">下一交接點</span>{track.nextHandoff}
            </div>
          )}
          {track.nextAutoStep && (
            <div className="rounded-xl border border-white/6 bg-black/20 px-4 py-3 text-gray-300">
              <span className="mr-2 text-cyan-300">下一個自動步驟</span>{track.nextAutoStep}
            </div>
          )}
          {suggestedSubagents.length > 0 && (
            <div className="rounded-xl border border-white/6 bg-black/20 px-4 py-3 text-gray-300">
              <span className="mr-2 text-cyan-300">建議子代理</span>{suggestedSubagents.join(' / ')}
            </div>
          )}
          {sidecarDispatchLine && (
            <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 px-4 py-3 text-cyan-100">
              <span className="mr-2 text-cyan-300">已叫進 reviewer</span>{sidecarDispatchLine}
            </div>
          )}
          {consensus?.recommendedAction && (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-emerald-100">
              <span className="mr-2 text-emerald-300">共識動作</span>{consensus.recommendedAction}
            </div>
          )}
          {track.evolutionNote && (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-emerald-100">
              <span className="mr-2 text-emerald-300">演化備註</span>{track.evolutionNote}
            </div>
          )}
          {reusableRule && (
            <div className="rounded-xl border border-fuchsia-500/20 bg-fuchsia-500/5 px-4 py-3 text-fuchsia-100">
              <span className="mr-2 text-fuchsia-300">Reusable Rule</span>
              {reusableRule.title}
              {reusableRule.summary ? ` / ${reusableRule.summary}` : ''}
              {` / ${formatRuleStatus(reusableRule.status)}`}
            </div>
          )}
        </div>
      )}

      {childTasks.length > 0 && (
        <div className="mt-4 rounded-2xl border border-cyan-500/10 bg-cyan-500/5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[11px] uppercase tracking-[0.16em] text-cyan-300">Task Graph</div>
            <div className="text-xs text-gray-500">
              子任務 {track.childTaskCount || childTasks.length} 題 / 活躍中 {track.activeChildTaskCount || 0} 題
            </div>
          </div>
          <div className="mt-3 space-y-3">
            {childTasks.map((child) => {
              const childBlockers = (child.blockers || []).filter(Boolean).join(' / ')
              const childOpenLoops = (child.openLoops || []).filter(Boolean).join(' / ')
              return (
                <div
                  key={child.id}
                  className={`rounded-xl border px-4 py-3 ${child.staleMemory ? 'border-amber-500/20 bg-amber-500/5' : 'border-white/8 bg-black/20'}`}
                >
                  <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2 py-1 text-[11px] uppercase tracking-[0.16em] text-cyan-200">
                          {child.agentEmoji} {child.agentName}
                        </span>
                        <span className="rounded-full border border-white/10 px-2 py-1 text-[11px] uppercase tracking-[0.16em] text-gray-300">
                          {formatTaskType(child.taskType)}
                        </span>
                        <span className="rounded-full border border-white/10 px-2 py-1 text-[11px] uppercase tracking-[0.16em] text-gray-400">
                          {formatStatusLabel(child.status, WORKFLOW_STATUS_LABEL, '進行中')}
                        </span>
                        {child.mergePolicy && (
                          <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-[11px] uppercase tracking-[0.16em] text-emerald-200">
                            {formatMergePolicy(child.mergePolicy)}
                          </span>
                        )}
                        {child.riskTier && (
                          <span className="rounded-full border border-white/10 px-2 py-1 text-[11px] uppercase tracking-[0.16em] text-gray-300">
                            {formatRiskTier(child.riskTier)}
                          </span>
                        )}
                        {child.closedByParent && (
                          <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-[11px] uppercase tracking-[0.16em] text-amber-200">
                            由主任務關閉
                          </span>
                        )}
                      </div>
                      <div className="mt-2 text-sm text-white">{child.title}</div>
                      {child.summary && (
                        <div className="mt-1 text-xs leading-6 text-gray-300">{child.summary}</div>
                      )}
                    </div>
                    <div className="text-xs text-gray-500">
                      {formatRelativeTime(child.updatedAt)} / {formatTime(child.updatedAt)}
                    </div>
                  </div>

                  {(child.rootCause || childBlockers || childOpenLoops || child.resolutionSource || child.consensus?.summary || child.humanGateReason) && (
                    <div className="mt-3 space-y-2 text-xs leading-6">
                      {child.consensus?.summary && (
                        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-emerald-100">
                          <span className="mr-2 text-emerald-300">共識</span>{child.consensus.summary}
                        </div>
                      )}
                      {child.humanGateReason && (
                        <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-amber-100">
                          <span className="mr-2 text-amber-300">人工 Gate</span>{child.humanGateReason}
                        </div>
                      )}
                      {child.rootCause && (
                        <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 px-3 py-2 text-rose-100">
                          <span className="mr-2 text-rose-300">根因</span>{child.rootCause}
                        </div>
                      )}
                      {childBlockers && (
                        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-amber-100">
                          <span className="mr-2 text-amber-300">Blockers</span>{childBlockers}
                        </div>
                      )}
                      {childOpenLoops && (
                        <div className="rounded-lg border border-white/6 bg-black/20 px-3 py-2 text-gray-300">
                          <span className="mr-2 text-cyan-300">Open Loops</span>{childOpenLoops}
                        </div>
                      )}
                      {child.resolutionSource && (
                        <div className="rounded-lg border border-white/6 bg-black/20 px-3 py-2 text-gray-300">
                          <span className="mr-2 text-cyan-300">收斂來源</span>{formatResolutionSource(child.resolutionSource)}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {isActive && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {isBlocked && (
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => handleAction('release')}
              className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy === 'release' ? '放行中…' : '✅ 放行'}
            </button>
          )}
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => handleAction('retry')}
            className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy === 'retry' ? '重試中…' : '🔁 再試一次'}
          </button>
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => { if (window.confirm('確定要刪除這個任務嗎？')) handleAction('delete') }}
            className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy === 'delete' ? '刪除中…' : '🗑 刪除'}
          </button>
          {actionError && (
            <span className="text-xs text-rose-400">{actionError}</span>
          )}
        </div>
      )}
    </div>
  )
}

function LobsterBrainPanel({ lobsterBrain, onRefresh }) {
  if (!lobsterBrain) return null
  const tracks = lobsterBrain.trackedTasks || []
  const directIngressTracks = lobsterBrain.directIngressTracks || []
  const manualRequestTracks = lobsterBrain.manualRequestTracks || []
  const backgroundTracks = lobsterBrain.backgroundTracks || []
  const reusableRules = lobsterBrain.reusableRules || []
  return (
    <div className="glass-card rounded-2xl p-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-cyan-300">龍蝦大腦</div>
          <div className="mt-2 font-display text-2xl text-white">正式記憶與追蹤面板</div>
          <div className="mt-3 max-w-3xl text-sm leading-7 text-gray-400">
            先把你直接交辦的題目放最前面，再把手動 / API 與背景自治任務分開。你不用再從一堆內部 smoke、維運或系統跟進題裡猜哪幾張才是你的。
          </div>
        </div>
        <div className="text-xs text-gray-500">
          直接交辦 {lobsterBrain.directIngressTaskCount || 0} 題 / 手動 API {lobsterBrain.manualRequestTaskCount || 0} 題 / 背景自治 {lobsterBrain.backgroundTaskCount || 0} 題
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <LobsterMetricCard label="你的交辦" value={lobsterBrain.directIngressTaskCount || 0} Icon={BrainCircuit} tone="cyan" />
        <LobsterMetricCard label="手動 / API" value={lobsterBrain.manualRequestTaskCount || 0} Icon={RefreshCw} tone="amber" hideWhenZero />
        <LobsterMetricCard label="背景自治" value={lobsterBrain.backgroundTaskCount || 0} Icon={Bot} tone="rose" hideWhenZero />
        <LobsterMetricCard label="圖譜節點" value={lobsterBrain.taskGraphNodeCount || 0} Icon={GitBranchPlus} tone="cyan" />
        <LobsterMetricCard label="活躍子任務" value={lobsterBrain.activeChildTaskCount || 0} Icon={RefreshCw} tone="cyan" />
        <LobsterMetricCard label="續跑佇列" value={lobsterBrain.continuationQueueCount || 0} Icon={Orbit} tone="amber" hideWhenZero />
        <LobsterMetricCard label="委派中" value={lobsterBrain.delegatedRunCount || 0} Icon={Bot} tone="cyan" hideWhenZero />
        <LobsterMetricCard label="sidecar reviewer" value={lobsterBrain.sidecarDispatchCount || 0} Icon={RefreshCw} tone="cyan" hideWhenZero />
        <LobsterMetricCard label="已補根因" value={lobsterBrain.rootedCount || 0} Icon={Bug} tone="rose" hideWhenZero />
        <LobsterMetricCard label="有演化備註" value={lobsterBrain.evolvingCount || 0} Icon={Sparkles} tone="emerald" hideWhenZero />
        <LobsterMetricCard label="記憶過舊" value={lobsterBrain.staleMemoryCount || 0} Icon={GitBranchPlus} tone="amber" hideWhenZero />
        <LobsterMetricCard label="人工 Gate" value={lobsterBrain.humanGateCount || 0} Icon={ShieldAlert} tone="amber" hideWhenZero />
        <LobsterMetricCard label="共識阻擋" value={lobsterBrain.blockedConsensusCount || 0} Icon={AlertTriangle} tone="rose" hideWhenZero />
        <LobsterMetricCard label="Reusable Rule" value={lobsterBrain.reusableRuleCount || 0} Icon={Sparkles} tone="emerald" hideWhenZero />
      </div>

      <div className="mt-5 space-y-3">
        {tracks.length === 0 ? (
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm text-emerald-300">
            目前沒有活躍中的龍蝦記憶追蹤任務。
          </div>
        ) : (
          <>
            {directIngressTracks.length === 0 && (
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-100">
                目前沒有來自 Discord / TG 的直接交辦；下面看到的會是手動 / API 任務或背景自治流程。
              </div>
            )}
            <LobsterTrackSection
              eyebrow="你的正式交辦"
              title="只看你從 Discord / TG 直接丟進來的題目"
              description="這一區才是你最近真的交辦給魚群的任務。"
              tracks={directIngressTracks}
              onRefresh={onRefresh}
            />
            <LobsterTrackSection
              eyebrow="手動 / API 交辦"
              title="透過 Office 或 API 建立的任務"
              description="這些不是背景自治，但也不是從 Discord / TG 直接進來。先收在第二層，避免和你當下的正式交辦混在一起。"
              tracks={manualRequestTracks}
              emptyText="目前沒有手動 / API 交辦。"
              collapsible
              onRefresh={onRefresh}
            />
            <LobsterTrackSection
              eyebrow="背景自治 / 維運"
              title="系統內部驗證、Boss Inbox 跟進與背景流程"
              description="這些是系統自己跑的 smoke、維運、attention follow-up，不是你剛剛直接交辦的題目。"
              tracks={backgroundTracks}
              emptyText="目前沒有背景自治任務。"
              collapsible
              onRefresh={onRefresh}
            />
          </>
        )}
      </div>

      <div className="mt-6 rounded-2xl border border-fuchsia-500/10 bg-fuchsia-500/5 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[11px] uppercase tracking-[0.16em] text-fuchsia-300">Reusable Memory</div>
          <div className="text-xs text-gray-500">最近 {reusableRules.length} 條規則候選</div>
        </div>
        <div className="mt-3 space-y-3">
          {reusableRules.length === 0 ? (
            <div className="rounded-xl border border-white/8 bg-black/20 px-4 py-3 text-sm text-gray-400">
              目前還沒有被升格成 reusable rule 的候選。
            </div>
          ) : reusableRules.map((rule) => (
            <div key={rule.id} className="rounded-xl border border-white/8 bg-black/20 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-fuchsia-500/20 bg-fuchsia-500/10 px-2 py-1 text-[11px] uppercase tracking-[0.16em] text-fuchsia-200">
                  {rule.category || 'guardrail'}
                </span>
                <span className="rounded-full border border-white/10 px-2 py-1 text-[11px] uppercase tracking-[0.16em] text-gray-300">
                  {formatRuleStatus(rule.status)}
                </span>
                <span className="text-[11px] text-gray-500">信心 {Math.round(Number(rule.confidence || 0) * 100)}%</span>
              </div>
              <div className="mt-2 text-sm text-white">{rule.title || '未命名規則'}</div>
              {rule.summary && (
                <div className="mt-1 text-xs leading-6 text-gray-300">{rule.summary}</div>
              )}
              <div className="mt-2 text-[11px] text-gray-500">
                Trigger: {rule.triggerKey || 'general'}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function LobsterBrainTeaser({ lobsterBrain }) {
  if (!lobsterBrain) return null

  return (
    <div className="glass-card rounded-2xl p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl">
          <div className="text-xs uppercase tracking-[0.2em] text-cyan-300">龍蝦大腦</div>
          <div className="mt-2 font-display text-2xl text-white">獨立進度面板已拆出去</div>
          <div className="mt-3 text-sm leading-7 text-gray-400">
            首頁只留摘要，完整的 task graph、reviewer、verifier、consensus 與 reusable memory 已移到獨立頁，避免老闆收件匣資訊太雜。
          </div>
        </div>

        <Link
          href="/office/openclaw"
          className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/30 bg-cyan-500/8 px-4 py-2 text-sm text-cyan-200 transition hover:bg-cyan-500/14"
        >
          打開龍蝦面板
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <LobsterMetricCard label="活躍任務" value={lobsterBrain.activeTaskCount || 0} Icon={BrainCircuit} tone="cyan" />
        <LobsterMetricCard label="活躍子任務" value={lobsterBrain.activeChildTaskCount || 0} Icon={RefreshCw} tone="cyan" />
        <LobsterMetricCard label="續跑佇列" value={lobsterBrain.continuationQueueCount || 0} Icon={Orbit} tone="amber" />
        <LobsterMetricCard label="人工 Gate" value={lobsterBrain.humanGateCount || 0} Icon={ShieldAlert} tone="amber" />
      </div>
    </div>
  )
}

function OfficeAccessPanel({
  access,
  tokenDraft,
  busy,
  error,
  onTokenChange,
  onSubmit,
  onLogout,
}) {
  if (!access?.configured) return null

  return (
    <div className="glass-card rounded-2xl p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.18em] text-cyan-300">辦公室權限</div>
          <div className="mt-2 text-sm text-white">
            {access.authenticated
              ? '這個瀏覽器已經可以直接處理老闆收件匣裡的項目。'
              : '這個頁面目前有保護機制。貼上驗證碼後，這個瀏覽器就能直接處理老闆收件匣。'}
          </div>
          <div className="mt-2 text-[11px] text-gray-400">
            驗證方式: <code>x-office-token</code>
            {access.authSource ? ` / 目前: ${formatAuthSource(access.authSource)}` : ''}
          </div>
        </div>

        {access.authenticated ? (
          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 text-xs uppercase tracking-[0.18em] text-emerald-200">
              已授權
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={onLogout}
              className="rounded-lg border border-white/15 px-3 py-2 text-xs uppercase tracking-[0.18em] text-gray-200 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? '清除中...' : '清除授權'}
            </button>
          </div>
        ) : (
          <form className="flex w-full max-w-xl flex-col gap-3 lg:w-auto lg:flex-row" onSubmit={onSubmit}>
            <input
              type="password"
              value={tokenDraft}
              onChange={(event) => onTokenChange(event.target.value)}
              placeholder="貼上 Office 驗證碼"
              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-400/40 lg:min-w-[320px]"
            />
            <button
              type="submit"
              disabled={busy || !tokenDraft.trim()}
              className="rounded-lg border border-cyan-400/40 bg-cyan-500/10 px-3 py-2 text-xs uppercase tracking-[0.18em] text-cyan-200 transition hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? '驗證中...' : '確認'}
            </button>
          </form>
        )}
      </div>

      {error && (
        <div className="mt-3 rounded-lg border border-rose-500/20 bg-rose-500/5 px-3 py-2 text-sm text-rose-200">
          {error}
        </div>
      )}
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
  const [replyDraft, setReplyDraft] = useState(item.taskResult || item.closedReason || '')
  useEffect(() => {
    setOwnerDraft(item.assignedOwner || '')
  }, [item.id, item.assignedOwner])
  useEffect(() => {
    setReplyDraft(item.taskResult || item.closedReason || '')
  }, [item.id, item.taskResult, item.closedReason])
  const meta = TYPE_META[item.attentionType] || TYPE_META.digest_only
  const Icon = meta.icon
  const recommendedAction = deriveRecommendedAction(item, actionHint)
  const recommendedLabel = ACTION_LABEL[recommendedAction] || '處理方式'
  const suggestedActionHint = formatHintActionScores(actionHint?.actionScores || []).find((entry) => entry.action === recommendedAction)
  const recommendedSuccess = Number.isFinite(suggestedActionHint?.success) ? suggestedActionHint.success : Number(actionHint?.expectedSuccess || 0)
  const recommendedDisabled = actionId !== null || !isHintActionAvailable(item, recommendedAction)
  const urgencyReason = formatUrgencyReason(item, actionHint)
  const ownerOptions = withSelectedAgent(agentOptions, ownerDraft)
  const taskTargetOptions = withSelectedAgent(agentOptions, taskDraft?.targetAgent)
  const savedReply = item.taskResult || item.closedReason || ''
  const replyDirty = replyDraft.trim() !== savedReply.trim()
  const linkedTaskLabel = item.linkedTaskId
    ? `${item.linkedTaskId}${item.linkedTaskStatus ? ` / ${formatStatusLabel(item.linkedTaskStatus, WORKFLOW_STATUS_LABEL)}` : ''}`
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
            {item.channel && <span>來自: {item.channel}</span>}
            {item.commercialValue > 0 && <span>估計價值: ${item.commercialValue.toLocaleString()}</span>}
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-gray-500">
            {item.source && <span>來源: {humanizeToken(item.source)}</span>}
            <span>目前狀態: {formatStatusLabel(item.status || 'open', ITEM_STATUS_LABEL)}</span>
            <span>重要度: {item.signalScore || 0}</span>
            <span>累積訊號: {item.signalCount || 1}</span>
          </div>
          {(item.assignedOwner || item.snoozedUntil || item.nextReviewAt) && (
            <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-300/80">
              {item.assignedOwner && <span>負責人: {item.assignedOwner}</span>}
              {item.snoozedUntil && <span>延後到: {formatTime(item.snoozedUntil)}</span>}
              {item.nextReviewAt && <span>下次檢視: {formatTime(item.nextReviewAt)}</span>}
            </div>
          )}
          {actionHint && (
            <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-cyan-100/80">
              <span>建議先做: {recommendedLabel}</span>
              {Number.isFinite(recommendedSuccess) && (
                <span>預估成功率: {Math.round(recommendedSuccess * 100)}%</span>
              )}
              {actionHint?.recommendedOwner && <span>建議負責人: {actionHint.recommendedOwner}</span>}
              {urgencyReason && <span className="text-rose-200">優先原因: {urgencyReason}</span>}
            </div>
          )}
          {actionHint?.actionScores?.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-cyan-200/70">
              {formatHintActionScores(actionHint.actionScores).slice(0, 3).map((entry, index) => (
                <span
                  key={`${item.id}-${entry.action}`}
                  className="rounded-full border border-cyan-400/25 px-2 py-0.5"
                  style={{ opacity: index === 0 ? 1 : 0.75 }}
                >
                  {index + 1}. {entry.actionLabel} 成功率 {Math.round(entry.success * 100)}% / 綜合 {Math.round(entry.score * 100)}
                </span>
              ))}
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
              {item.linkedRequestId && (
                <div>
                  交辦單: {item.linkedRequestId}
                  {item.linkedRequestState ? ` / ${formatStatusLabel(item.linkedRequestState, WORKFLOW_STATUS_LABEL)}` : ''}
                </div>
              )}
              {linkedTaskLabel && <div>執行單: {linkedTaskLabel}</div>}
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
      <div className="mt-4 text-[11px] uppercase tracking-[0.18em] text-slate-400">快速處理</div>
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
          {actionId === `${item.id}:${recommendedAction}` ? '處理中...' : `建議先做：${recommendedLabel}`}
        </button>
        <button
          type="button"
          disabled={actionId !== null || !isHintActionAvailable(item, 'acknowledge')}
          onClick={() => onAttentionAction(item.id, 'acknowledge')}
          className="rounded-lg border border-white/15 px-3 py-2 text-xs uppercase tracking-[0.18em] text-gray-200 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {actionId === `${item.id}:acknowledge` ? '記錄中...' : '先記下'}
        </button>
        <button
          type="button"
          disabled={actionId !== null || !isHintActionAvailable(item, 'create_task')}
          onClick={() => onOpenTaskDraft(item, actionHint)}
          className="rounded-lg border border-cyan-500/30 px-3 py-2 text-xs uppercase tracking-[0.18em] text-cyan-300 transition hover:bg-cyan-500/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {item.linkedTaskId ? '已交辦' : '交辦跟進'}
        </button>
        <button
          type="button"
          disabled={actionId !== null || !isHintActionAvailable(item, 'resolve')}
          onClick={() => onAttentionAction(item.id, 'resolve')}
          className="rounded-lg border border-emerald-500/30 px-3 py-2 text-xs uppercase tracking-[0.18em] text-emerald-300 transition hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {actionId === `${item.id}:resolve` ? '完成中...' : '標記完成'}
        </button>
        <button
          type="button"
          disabled={actionId !== null || !isHintActionAvailable(item, 'snooze')}
          onClick={() => onAttentionAction(item.id, 'snooze', { snoozeHours: 24 })}
          className="rounded-lg border border-amber-500/30 px-3 py-2 text-xs uppercase tracking-[0.18em] text-amber-200 transition hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {actionId === `${item.id}:snooze` ? '延後中...' : '明天再看'}
        </button>
        {item.status !== 'open' && (
          <button
            type="button"
            disabled={actionId !== null || !isHintActionAvailable(item, 'reopen')}
            onClick={() => onAttentionAction(item.id, 'reopen')}
            className="rounded-lg border border-white/15 px-3 py-2 text-xs uppercase tracking-[0.18em] text-gray-200 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {actionId === `${item.id}:reopen` ? '重新打開中...' : '重新打開'}
          </button>
        )}
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="text-xs text-gray-400">
          <div className="mb-2 uppercase tracking-[0.18em] text-slate-400">負責人</div>
          <div className="flex gap-2">
            <select
              value={ownerDraft}
              onChange={(event) => setOwnerDraft(event.target.value)}
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-400/40"
            >
              <option value="">未指定</option>
              {ownerOptions.map((agent) => (
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
              {actionId === `${item.id}:set_owner` ? '儲存中...' : '儲存'}
            </button>
          </div>
        </label>
        <label className="text-xs text-gray-400">
          <div className="mb-2 uppercase tracking-[0.18em] text-slate-400">下次檢視</div>
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
              {actionId === `${item.id}:set_next_review_at` ? '儲存中...' : '儲存'}
            </button>
          </div>
        </label>
      </div>
      {isTaskDraftOpen && taskDraft && (
        <div className="mt-4 rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4">
          <div className="text-xs uppercase tracking-[0.18em] text-cyan-300">交辦確認</div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="text-xs text-gray-400">
              <div className="mb-2 uppercase tracking-[0.18em] text-slate-400">標題</div>
              <input
                value={taskDraft.title}
                onChange={(event) => onTaskDraftChange('title', event.target.value)}
                className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-400/40"
              />
            </label>
            <label className="text-xs text-gray-400">
              <div className="mb-2 uppercase tracking-[0.18em] text-slate-400">交給誰</div>
              <select
                value={taskDraft.targetAgent}
                onChange={(event) => onTaskDraftChange('targetAgent', event.target.value)}
                className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-400/40"
              >
                {taskTargetOptions.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.emoji} {agent.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="mt-3 block text-xs text-gray-400">
            <div className="mb-2 uppercase tracking-[0.18em] text-slate-400">內容</div>
            <textarea
              rows={5}
              value={taskDraft.detail}
              onChange={(event) => onTaskDraftChange('detail', event.target.value)}
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm leading-6 text-white outline-none transition focus:border-cyan-400/40"
            />
          </label>
          <label className="mt-3 block text-xs text-gray-400">
            <div className="mb-2 uppercase tracking-[0.18em] text-slate-400">備註</div>
            <input
              value={taskDraft.note}
              onChange={(event) => onTaskDraftChange('note', event.target.value)}
              placeholder="有需要再補充"
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-400/40"
            />
          </label>
          <div className="mt-3 grid gap-3 md:grid-cols-4 text-[11px] text-gray-400">
            <div className="rounded-lg border border-white/6 bg-black/20 px-3 py-2">類型: {TYPE_META[item.attentionType]?.label || humanizeToken(item.attentionType)}</div>
            <div className="rounded-lg border border-white/6 bg-black/20 px-3 py-2">優先度: {item.priority || 0}</div>
            <div className="rounded-lg border border-white/6 bg-black/20 px-3 py-2">需要拍板: {item.needsDecision ? '是' : '否'}</div>
            <div className="rounded-lg border border-white/6 bg-black/20 px-3 py-2">估計價值: {item.commercialValue || 0}</div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={actionId !== null}
              onClick={() => onTaskDraftSubmit(item.id)}
              className="rounded-lg border border-cyan-500/30 px-3 py-2 text-xs uppercase tracking-[0.18em] text-cyan-300 transition hover:bg-cyan-500/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {actionId === `${item.id}:create_task` ? '交辦中...' : '確認交辦'}
            </button>
            <button
              type="button"
              disabled={actionId !== null}
              onClick={onTaskDraftCancel}
              className="rounded-lg border border-white/15 px-3 py-2 text-xs uppercase tracking-[0.18em] text-gray-300 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              取消
            </button>
          </div>
        </div>
      )}
      <div className="mt-4 rounded-xl border border-white/6 bg-white/[0.03] p-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-xs uppercase tracking-[0.18em] text-cyan-300">補充說明</div>
            <div className="mt-1 text-[11px] text-gray-500">上面的快速處理保留不變，這裡可以補一句你打算怎麼做或目前進度。</div>
          </div>
          <div className="text-[11px] text-gray-500">
            {item.lastFeedbackAt ? `上次回覆: ${formatTime(item.lastFeedbackAt)}` : '還沒有留下補充說明。'}
          </div>
        </div>
        <textarea
          rows={3}
          value={replyDraft}
          onChange={(event) => setReplyDraft(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && replyDirty && actionId === null) {
              event.preventDefault()
              onAttentionAction(item.id, 'save_reply', { taskResult: replyDraft || null })
            }
          }}
          placeholder="例如：先請 admin 檢查資料來源，下午 4 點前回報；若還是沒有資料就先交辦跟進。"
          className="mt-3 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm leading-6 text-white outline-none transition focus:border-cyan-400/40"
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={actionId !== null || !replyDirty}
            onClick={() => onAttentionAction(item.id, 'save_reply', { taskResult: replyDraft || null })}
            className="rounded-lg border border-cyan-500/30 px-3 py-2 text-xs uppercase tracking-[0.18em] text-cyan-300 transition hover:bg-cyan-500/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {actionId === `${item.id}:save_reply` ? '儲存中...' : '儲存補充'}
          </button>
          <div className="text-[11px] text-gray-500">支援 `Ctrl + Enter` / `Cmd + Enter` 快速儲存</div>
        </div>
      </div>
    </div>
  )
}

function AgentCard({ agent }) {
  const layerLabel = agent.activityState === 'inactive'
    ? '未啟用'
    : agent.layer === 'focus'
      ? '優先關注'
      : '運作中'
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
          {humanizeToken(signal.label)}
        </span>
      </div>
      <div className="mt-3 text-sm leading-6 text-white">{signal.summary}</div>
      <div className="mt-2 text-[11px] text-emerald-100/80">成長分數: {signal.score} / 更新: {formatTime(signal.runAt)}</div>
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
    ? APPLY_STATUS_LABEL.applied
    : item.applyStatus === 'rolled_back'
      ? APPLY_STATUS_LABEL.rolled_back
      : APPLY_STATUS_LABEL.not_applied
  return (
    <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-white">
          {item.agentName ? `${item.agentName} / ` : ''}
          {humanizeToken(item.category)}
        </div>
        <div className="flex items-center gap-2">
          <div className="text-[11px] text-amber-100/80">
            {formatCandidateKind(item.candidateKind)}
          </div>
          <div className="text-[11px] text-amber-200">
            影響度 {item.estimatedImpact} / 重複 {item.recurrence} 次
          </div>
          <div className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] ${statusColor}`}>
            {formatStatusLabel(item.reviewStatus || 'pending', REVIEW_STATUS_LABEL)}
          </div>
        </div>
      </div>
      <div className="mt-2 text-sm leading-6 text-amber-50">{item.reason}</div>
      <div className="mt-2 text-sm leading-6 text-amber-100/80">{item.proposedChange}</div>
      {item.evolutionStatusLabel && (
        <div className="mt-2 text-[11px] text-amber-200/80">
          目前階段: {item.evolutionStatusLabel}
          {item.autoApplyEligible ? ' / 可直接套用' : ''}
          {item.autoApproveReady ? ' / 可直接同意' : ''}
        </div>
      )}
      {item.canaryStatus && item.canaryStatus !== 'none' && (
        <div className="mt-2 text-[11px] text-cyan-100/80">
          小範圍觀察: {humanizeToken(item.canaryStatus)}
          {item.rollbackReason ? ` / ${item.rollbackReason}` : ''}
        </div>
      )}
      {(item.didImproveScore !== undefined && item.didImproveScore !== null) && (
        <div className="mt-2 text-[11px] text-cyan-100/80">
          改善分數: {Number(item.didImproveScore).toFixed(3)}
        </div>
      )}
      {item.dryRunSummary && (
        <div className="mt-2 text-[11px] text-cyan-100/80">試跑摘要: {item.dryRunSummary}</div>
      )}
      {item.applyPrereqs?.length > 0 && (
        <div className="mt-2 text-[11px] text-rose-200/80">
          先決條件: {item.applyPrereqs.join(' | ')}
        </div>
      )}
      {item.evidenceRefs?.length > 0 && (
        <div className="mt-2 text-[11px] text-amber-100/80">
          依據: {item.evidenceRefs.slice(0, 3).join(' | ')}
        </div>
      )}
      <div className="mt-2 text-[11px] text-amber-200/80">影響位置: {humanizeToken(item.target)}</div>
      {item.reviewArtifactPath && (
        <div className="mt-2 text-[11px] text-cyan-200/80">補充資料: {item.reviewArtifactPath}</div>
      )}
      {(item.reviewedAt || item.reviewNote) && (
        <div className="mt-2 text-[11px] text-amber-100/70">
          {item.reviewedAt ? `已確認 ${formatTime(item.reviewedAt)}` : ''}
          {item.reviewedBy ? ` / ${item.reviewedBy}` : ''}
          {item.reviewNote ? ` / ${item.reviewNote}` : ''}
        </div>
      )}
      {(item.appliedAt || item.appliedBy) && (
        <div className="mt-2 text-[11px] text-emerald-200/80">
          {item.appliedAt ? `已套用 ${formatTime(item.appliedAt)}` : ''}
          {item.appliedBy ? ` / ${item.appliedBy}` : ''}
        </div>
      )}
      {(item.applyStatus || item.unappliedAt || item.unappliedBy) && (
        <div className="mt-2 text-[11px] text-slate-200/70">
          目前套用狀態: {applyLabel}
          {item.unappliedAt ? ` / 已還原 ${formatTime(item.unappliedAt)}` : ''}
          {item.unappliedBy ? ` / ${item.unappliedBy}` : ''}
        </div>
      )}
    </div>
  )
}

export default function BossInboxDashboard({ mode = 'full' }) {
  const isLobsterOnly = mode === 'lobster-only'
  const [payload, setPayload] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [officeAccess, setOfficeAccess] = useState({ configured: false, authenticated: true, authSource: 'disabled' })
  const [officeTokenDraft, setOfficeTokenDraft] = useState('')
  const [officeAccessBusy, setOfficeAccessBusy] = useState(false)
  const [officeAccessError, setOfficeAccessError] = useState('')
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
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (res.status === 401) {
          await refreshOfficeAccess()
          setPayload(null)
          setOfficeAccessError(`請先完成驗證，才能查看${inboxAccessLabel}。`)
          return
        }
        throw new Error(data?.error || `${inboxLabel}載入失敗`)
      }
      setPayload(data)
    } catch (error) {
      console.error('Failed to fetch boss inbox:', error)
      setOfficeAccessError((current) => current || error.message || `${inboxLabel}載入失敗`)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  const refreshOfficeAccess = async () => {
    try {
      const res = await fetch('/api/office/session', { cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.error || '無法讀取目前的驗證狀態')
      }
      setOfficeAccess({
        configured: Boolean(data.configured),
        authenticated: Boolean(data.authenticated),
        authSource: data.authSource || null,
      })
      setOfficeAccessError('')
      return data
    } catch (error) {
      setOfficeAccess((current) => ({ ...current, configured: false, authenticated: true, authSource: 'disabled' }))
      setOfficeAccessError(error.message || '無法讀取目前的驗證狀態')
      return null
    }
  }

  useEffect(() => {
    let timer = null
    let cancelled = false

    async function bootstrap() {
      const access = await refreshOfficeAccess()
      if (cancelled) return
      if (!access?.configured || access?.authenticated) {
        await load()
        if (cancelled) return
        timer = setInterval(() => load(), 30_000)
      } else {
        setPayload(null)
        setLoading(false)
      }
    }

    bootstrap()

    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
    }
  }, [])

  const submitOfficeAccess = async (event) => {
    event.preventDefault()
    setOfficeAccessBusy(true)
    setOfficeAccessError('')
    try {
      const res = await fetch('/api/office/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: officeTokenDraft.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.error || '驗證失敗，請再試一次')
      }
      setOfficeAccess({
        configured: Boolean(data.configured),
        authenticated: Boolean(data.authenticated),
        authSource: data.authSource || 'cookie',
      })
      setOfficeTokenDraft('')
      setPayload(null)
      setLoading(true)
      await load(true)
    } catch (error) {
      setOfficeAccessError(error.message || '驗證失敗，請再試一次')
    } finally {
      setOfficeAccessBusy(false)
    }
  }

  const clearOfficeAccess = async () => {
    setOfficeAccessBusy(true)
    setOfficeAccessError('')
    try {
      const res = await fetch('/api/office/session', { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.error || '無法清除授權')
      }
      setOfficeAccess({
        configured: Boolean(data.configured),
        authenticated: Boolean(data.authenticated),
        authSource: data.authSource || null,
      })
      if (data.configured) {
        setPayload(null)
      }
    } catch (error) {
      setOfficeAccessError(error.message || '無法清除授權')
    } finally {
      setOfficeAccessBusy(false)
    }
  }

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
  const spotlightAgentIds = useMemo(() => new Set(['research-fish']), [])
  const visibleAgents = useMemo(() => {
    const base = showAllFish ? orderedActiveAgents : focusAgents
    const registry = new Map(base.map((agent) => [agent.id, agent]))

    for (const agentId of spotlightAgentIds) {
      const candidate = allAgents.find((agent) => agent.id === agentId)
      if (candidate) registry.set(agentId, candidate)
    }

    return [...registry.values()].sort((a, b) => {
      const aSpotlight = spotlightAgentIds.has(a.id) ? 0 : 1
      const bSpotlight = spotlightAgentIds.has(b.id) ? 0 : 1
      if (aSpotlight !== bSpotlight) return aSpotlight - bSpotlight

      const aRank = agentRank[a.id] ?? Number.MAX_SAFE_INTEGER
      const bRank = agentRank[b.id] ?? Number.MAX_SAFE_INTEGER
      if (aRank !== bRank) return aRank - bRank

      const aActive = a.activityState === 'active' ? 0 : 1
      const bActive = b.activityState === 'active' ? 0 : 1
      if (aActive !== bActive) return aActive - bActive

      return a.name.localeCompare(b.name, 'zh-Hant')
    })
  }, [showAllFish, orderedActiveAgents, focusAgents, spotlightAgentIds, allAgents, agentRank])
  const growthSignals = payload?.growthSignals || []
  const candidatePatches = payload?.candidatePatches || []
  const governanceSummary = payload?.governanceSummary || null
  const autonomyUpgradeAdvice = payload?.autonomyUpgradeAdvice || governanceSummary?.autonomyUpgradeAdvice || null
  const lobsterBrain = payload?.lobsterBrain || null
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
  const agentOptions = useMemo(() => {
    const registry = new Map()

    const rememberAgent = (agent) => {
      const id = String(agent?.id || '').trim()
      if (!id) return
      const current = registry.get(id) || {}
      registry.set(id, {
        id,
        name: String(agent?.name || current.name || id).trim() || id,
        emoji: String(agent?.emoji || current.emoji || '🤖').trim() || '🤖',
        activityState: agent?.activityState || current.activityState || null,
        layer: agent?.layer || current.layer || null,
      })
    }

    allAgents.forEach(rememberAgent)
    activeAgents.forEach(rememberAgent)
    inactiveAgents.forEach(rememberAgent)

    sortedAttentionItems.forEach((item) => {
      rememberAgent({
        id: item.agentId,
        name: item.agentName,
        emoji: item.agentEmoji,
        activityState: item.unresolved ? 'active' : null,
      })
      if (item.assignedOwner) {
        rememberAgent({
          id: item.assignedOwner,
          name: item.assignedOwner,
          emoji: '🗂️',
        })
      }

      const actionHint = attentionActionHints[item.id] || null
      if (actionHint?.recommendedOwner) {
        rememberAgent({
          id: actionHint.recommendedOwner,
          name: actionHint.recommendedOwner,
          emoji: '🗂️',
        })
      }
      if (actionHint?.suggestedTargetAgent) {
        rememberAgent({
          id: actionHint.suggestedTargetAgent,
          name: actionHint.suggestedTargetAgent,
          emoji: '🗂️',
        })
      }
    })

    return [...registry.values()]
      .sort((a, b) => {
        const aActivity = a.activityState === 'active' ? 0 : 1
        const bActivity = b.activityState === 'active' ? 0 : 1
        if (aActivity !== bActivity) return aActivity - bActivity

        const aLayer = a.layer === 'focus' ? 0 : 1
        const bLayer = b.layer === 'focus' ? 0 : 1
        if (aLayer !== bLayer) return aLayer - bLayer

        const aRank = agentRank[a.id] ?? Number.MAX_SAFE_INTEGER
        const bRank = agentRank[b.id] ?? Number.MAX_SAFE_INTEGER
        if (aRank !== bRank) return aRank - bRank

        return a.name.localeCompare(b.name, 'zh-Hant')
      })
      .map((agent) => ({ id: agent.id, name: agent.name, emoji: agent.emoji }))
  }, [allAgents, activeAgents, inactiveAgents, sortedAttentionItems, attentionActionHints, agentRank])

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
        if (res.status === 401) {
          await refreshOfficeAccess()
          setOfficeAccessError('請先完成驗證，才能確認這些調整建議。')
        }
        throw new Error(data?.error || '無法更新這筆調整建議')
      }
      await load(true)
    } catch (error) {
      setCandidateError(error.message || '無法更新這筆調整建議')
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
        if (res.status === 401) {
          await refreshOfficeAccess()
          setOfficeAccessError('請先完成驗證，才能更新這些待處理項目。')
        }
        throw new Error(data?.error || '無法更新這筆待處理項目')
      }
      await load(true)
      if (action === 'create_task' || action === 'resolve' || action === 'acknowledge') {
        cancelTaskDraft()
      }
    } catch (error) {
      setAttentionError(error.message || '無法更新這筆待處理項目')
    } finally {
      setAttentionActionId(null)
    }
  }

  if (loading) {
    return (
      <div className="glass-card rounded-2xl p-6 text-sm text-gray-400">
        {isLobsterOnly ? '龍蝦大腦面板載入中...' : '老闆收件匣載入中...'}
      </div>
    )
  }

  if (isLobsterOnly) {
    return (
      <div className="space-y-6">
        <div className="glass-card rounded-2xl p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-xs uppercase tracking-[0.22em] text-cyan-300">龍蝦大腦</div>
              <h2 className="mt-2 font-display text-3xl text-white">自主執行進度面板</h2>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-gray-400">
                這裡只看主任務、child tasks、reviewer、verifier、consensus 與 reusable memory，不再混進老闆收件匣的待拍板事項。
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Link
                href="/office"
                className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2 text-sm text-gray-300 transition hover:bg-white/5"
              >
                返回老闆收件匣
              </Link>
              <button
                type="button"
                onClick={() => load(true)}
                className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/30 px-4 py-2 text-sm text-cyan-300 transition hover:bg-cyan-500/10"
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                重新整理
              </button>
            </div>
          </div>
        </div>

        <OfficeAccessPanel
          access={officeAccess}
          tokenDraft={officeTokenDraft}
          busy={officeAccessBusy}
          error={officeAccessError}
          onTokenChange={setOfficeTokenDraft}
          onSubmit={submitOfficeAccess}
          onLogout={clearOfficeAccess}
        />

        {officeAccess.configured && !officeAccess.authenticated && !payload && (
          <div className="glass-card rounded-2xl p-6 text-sm leading-7 text-gray-300">
            先完成驗證，這裡的龍蝦任務圖譜與 reviewer / verifier 狀態才會顯示。
          </div>
        )}

        <LobsterBrainPanel lobsterBrain={lobsterBrain} onRefresh={load} />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="glass-card rounded-2xl p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-xs uppercase tracking-[0.22em] text-cyan-300">老闆收件匣</div>
            <h2 className="mt-2 font-display text-3xl text-white">待拍板・待跟進・風險與機會</h2>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-gray-400">
              系統細節退到後面，這裡只看需要你決定的事。
            </p>
          </div>
          <button
            type="button"
            onClick={() => load(true)}
            className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/30 px-4 py-2 text-sm text-cyan-300 transition hover:bg-cyan-500/10"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            重新整理
          </button>
        </div>
      </div>

      {(!officeAccess.configured || officeAccess.authenticated || payload) && (
        <div className="grid gap-4 md:grid-cols-4">
          <CountCard label="待拍板" value={payload?.unresolvedCounts?.decision || 0} color={TYPE_META.decision.color} Icon={TYPE_META.decision.icon} />
          <CountCard label="卡住" value={payload?.unresolvedCounts?.blocked || 0} color={TYPE_META.blocked.color} Icon={TYPE_META.blocked.icon} />
          <CountCard label="風險" value={payload?.unresolvedCounts?.risk || 0} color={TYPE_META.risk.color} Icon={TYPE_META.risk.icon} />
          <CountCard label="商機" value={payload?.unresolvedCounts?.opportunity || 0} color={TYPE_META.opportunity.color} Icon={TYPE_META.opportunity.icon} />
        </div>
      )}

      <OfficeAccessPanel
        access={officeAccess}
        tokenDraft={officeTokenDraft}
        busy={officeAccessBusy}
        error={officeAccessError}
        onTokenChange={setOfficeTokenDraft}
        onSubmit={submitOfficeAccess}
        onLogout={clearOfficeAccess}
      />

      {officeAccess.configured && !officeAccess.authenticated && !payload && (
        <div className="glass-card rounded-2xl p-6 text-sm leading-7 text-gray-300">
          先完成驗證，這裡的待處理事項、每日摘要和調整建議才會顯示。
        </div>
      )}

      {governanceSummary && (
        <div className="glass-card rounded-2xl p-4">
          <div className="mb-3 text-xs text-cyan-100/80">
            目前自動化階段: {formatAutonomyLabel(governanceSummary.autonomyLabel, governanceSummary.autonomyLevel)}
            {governanceSummary.autonomyKillSwitch ? ' / 自動升級暫停中' : ''}
          </div>
          <div className="grid gap-3 text-sm md:grid-cols-3 xl:grid-cols-12">
            <div className="rounded-xl border border-white/6 bg-black/20 px-4 py-3 text-gray-300">
              今日升格訊號 <span className="ml-2 font-display text-white">{governanceSummary.escalatedSignalsCount || 0}</span>
            </div>
            <div className="rounded-xl border border-white/6 bg-black/20 px-4 py-3 text-gray-300">
              可處理商機 <span className="ml-2 font-display text-white">{governanceSummary.actionableOpportunityCount || 0}</span>
            </div>
            <div className="rounded-xl border border-white/6 bg-black/20 px-4 py-3 text-gray-300">
              可直接同意 <span className="ml-2 font-display text-white">{governanceSummary.autoApproveReadyCount || 0}</span>
            </div>
            <div className="rounded-xl border border-white/6 bg-black/20 px-4 py-3 text-gray-300">
              24 小時內已自動同意 <span className="ml-2 font-display text-white">{governanceSummary.autoApproved24h || 0}</span>
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
              暫緩中 <span className="ml-2 font-display text-white">{governanceSummary.snoozedCount || 0}</span>
            </div>
            <div className="rounded-xl border border-white/6 bg-black/20 px-4 py-3 text-gray-300">
              等待套用 <span className="ml-2 font-display text-white">{governanceSummary.approvedNotAppliedCount || 0}</span>
            </div>
            <div className="rounded-xl border border-white/6 bg-black/20 px-4 py-3 text-gray-300">
              待試跑 <span className="ml-2 font-display text-white">{governanceSummary.candidateNeedDryRun || 0}</span>
            </div>
            <div className="rounded-xl border border-white/6 bg-black/20 px-4 py-3 text-gray-300">
              可自動套用 <span className="ml-2 font-display text-white">{governanceSummary.candidateAutoEligible || 0}</span>
            </div>
            <div className="rounded-xl border border-white/6 bg-black/20 px-4 py-3 text-gray-300">
              小範圍觀察中 <span className="ml-2 font-display text-white">{governanceSummary.canaryOpenCount || 0}</span>
            </div>
            <div className="rounded-xl border border-white/6 bg-black/20 px-4 py-3 text-gray-300">
              近 7 天自動套用成功率 <span className="ml-2 font-display text-white">{Math.round(Number(governanceSummary.autoApplySuccessRate7d || 0) * 100)}%</span>
            </div>
            <div className="rounded-xl border border-white/6 bg-black/20 px-4 py-3 text-gray-300">
              高優先待處理 <span className="ml-2 font-display text-white">{governanceSummary.openCriticalAttentionCount || 0}</span>
            </div>
            <div className="rounded-xl border border-white/6 bg-black/20 px-4 py-3 text-gray-300">
              摘要送達 <span className="ml-2 font-display text-white">{formatDeliveryStatus(governanceSummary.digestDeliveryStatus)}</span>
            </div>
          </div>
          {autonomyUpgradeAdvice?.prompt && (
            <div className="mt-3 rounded-xl border border-cyan-500/20 bg-cyan-500/5 px-4 py-3 text-sm text-cyan-100">
              <div className="font-medium text-cyan-200">{autonomyUpgradeAdvice.prompt}</div>
              {(autonomyUpgradeAdvice.reasons || []).length > 0 && (
                <div className="mt-1 text-cyan-100/90">
                  {(autonomyUpgradeAdvice.reasons || []).join(' / ')}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <LobsterBrainTeaser lobsterBrain={lobsterBrain} />

      <div className="grid gap-6 xl:grid-cols-[1.4fr,1fr]">
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card rounded-2xl p-6"
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-cyan-300">重點區</div>
              <div className="mt-2 font-display text-xl text-white">待處理優先</div>
            </div>
            <div className="text-xs text-gray-500">{focusItems.length} 項</div>
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
              <div className="text-xs uppercase tracking-[0.2em] text-slate-400">僅需知道</div>
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
          <div className="text-xs uppercase tracking-[0.2em] text-cyan-300">每日摘要</div>
          <div className="mt-2 font-display text-xl text-white">老闆晚間摘要</div>
          <div className="mt-3 text-xs text-gray-500">
            生成時間: {formatTime(latestDigest?.generatedAt)}
            {latestDigest?.deliveryChannel ? ` / 送達方式: ${humanizeToken(latestDigest.deliveryChannel)}` : ''}
            {latestDigest?.deliveryStatus ? ` / 送達狀態: ${formatDeliveryStatus(latestDigest.deliveryStatus)}` : ''}
          </div>
          {hasStructuredDigest ? (
            <div className="mt-4 space-y-4">
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm leading-7 text-emerald-200">
                {latestDigest?.headline || '今天還沒有新的摘要。'}
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
                    <div>目前階段：{formatAutonomyLabel(digestEvolution.autonomyLabel, digestEvolution.autonomyLevel)}{digestEvolution.autonomyKillSwitch ? ' / 自動升級暫停中' : ''}</div>
                    <div>待審改進：{digestEvolution.candidatePatchCount || 0} 件</div>
                    <div>未解卡片：{digestEvolution.openAttentionCount || 0} 張</div>
                    <div>已掛任務：{digestEvolution.linkedTaskCount || 0} 張</div>
                    <div>已升格訊號：{digestEvolution.escalatedSignalsCount || 0} 張</div>
                    <div>待套用：{digestEvolution.approvedNotAppliedCount || 0} 件</div>
                    <div>24 小時內已自動同意：{digestEvolution.autoApproved24h || 0} 件 / 小範圍觀察：{digestEvolution.canaryOpenCount || 0} 件</div>
                    {digestEvolution.autonomyUpgradeAdvice?.prompt && (
                      <div>升級建議：{digestEvolution.autonomyUpgradeAdvice.prompt}</div>
                    )}
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
              {latestDigest?.content || '今天還沒有新的摘要。'}
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
          <div className="text-xs uppercase tracking-[0.2em] text-cyan-300">成長機會</div>
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
          <div className="text-xs uppercase tracking-[0.2em] text-cyan-300">系統調整建議</div>
          <div className="mt-2 font-display text-xl text-white">待確認的改善項目</div>
          <div className="mt-3 text-xs text-gray-500">
            待確認 {pendingCandidatePatches.length} / 已同意 {approvedCandidatePatches.length} / 已退回 {rejectedCandidatePatches.length}
          </div>
          {candidateError && (
            <div className="mt-4 rounded-xl border border-rose-500/20 bg-rose-500/5 p-3 text-sm text-rose-200">
              {candidateError}
            </div>
          )}
          <div className="mt-5 space-y-3">
            {pendingCandidatePatches.length === 0 && (
              <div className="rounded-xl border border-white/6 bg-black/20 p-4 text-sm text-gray-400">
                目前沒有新的調整建議。
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
                    {candidateActionId === `${item.id}:approve` ? '處理中...' : '同意'}
                  </button>
                  <button
                    type="button"
                    disabled={candidateActionId !== null}
                    onClick={() => mutateCandidate(item.id, 'reject')}
                    className="rounded-lg border border-rose-500/30 px-3 py-2 text-xs uppercase tracking-[0.18em] text-rose-300 transition hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {candidateActionId === `${item.id}:reject` ? '處理中...' : '退回'}
                  </button>
                </div>
              </div>
            ))}
          </div>
          {(approvedNotAppliedCandidatePatches.length > 0 || appliedOrRolledBackCandidatePatches.length > 0 || rejectedCandidatePatches.length > 0) && (
            <div className="mt-6 space-y-3 border-t border-white/6 pt-6">
              {approvedNotAppliedCandidatePatches.length > 0 && (
                <div className="space-y-3">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-400">已同意 / 尚未套用</div>
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
                          {candidateActionId === `${item.id}:apply` ? '套用中...' : '套用'}
                        </button>
                        <button
                          type="button"
                          disabled={candidateActionId !== null}
                          onClick={() => mutateCandidate(item.id, 'reset')}
                          className="rounded-lg border border-white/15 px-3 py-2 text-xs uppercase tracking-[0.18em] text-gray-300 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {candidateActionId === `${item.id}:reset` ? '更新中...' : '重新檢視'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {appliedOrRolledBackCandidatePatches.length > 0 && (
                <div className="space-y-3">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-400">已套用 / 已還原</div>
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
                            {candidateActionId === `${item.id}:unapply` ? '還原中...' : '還原'}
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={candidateActionId !== null}
                          onClick={() => mutateCandidate(item.id, 'reset')}
                          className="rounded-lg border border-white/15 px-3 py-2 text-xs uppercase tracking-[0.18em] text-gray-300 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {candidateActionId === `${item.id}:reset` ? '更新中...' : '重新檢視'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {rejectedCandidatePatches.length > 0 && (
                <div className="space-y-3">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-400">已退回</div>
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
                          {candidateActionId === `${item.id}:reset` ? '更新中...' : '重新檢視'}
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
            <div className="text-xs uppercase tracking-[0.2em] text-cyan-300">協作區</div>
            <div className="mt-2 font-display text-xl text-white">目前正在跟進的成員</div>
          </div>
          <button
            type="button"
            onClick={() => setShowAllFish((value) => !value)}
            className="rounded-xl border border-white/10 px-4 py-2 text-sm text-gray-300 transition hover:border-cyan-400/30 hover:text-white"
          >
            {showAllFish ? '只看重點' : `展開全部（${orderedActiveAgents.length}）`}
          </button>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visibleAgents.map((agent) => (
            <AgentCard key={agent.id} agent={agent} />
          ))}
        </div>

        {inactiveAgents.length > 0 && (
          <div className="mt-6 rounded-2xl border border-white/6 bg-black/20 p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-xs uppercase tracking-[0.18em] text-slate-400">暫停中的成員</div>
                <div className="mt-2 text-sm text-gray-400">這些成員目前沒有在主動回報或跟進工作。</div>
              </div>
              <button
                type="button"
                onClick={() => setShowInactiveFish((value) => !value)}
                className="rounded-xl border border-white/10 px-4 py-2 text-sm text-gray-300 transition hover:border-cyan-400/30 hover:text-white"
              >
                {showInactiveFish ? '收起' : `查看（${inactiveAgents.length}）`}
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
          <div className="text-xs uppercase tracking-[0.18em] text-cyan-300">近期調整狀態</div>
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
                      {entry.activityState === 'inactive' ? '未啟用' : (entry.stale ? '久未更新' : '正常')}
                    </div>
                  </div>
                  <div className="mt-3 text-sm leading-6 text-gray-300">
                    最近學到：{entry.lastLearned || '無'}
                  </div>
                  <div className="mt-2 text-sm leading-6 text-gray-400">
                    下一輪要試：{entry.nextTest || '無'}
                  </div>
                  <div className="mt-3 text-[11px] text-gray-500">
                    改善建議 {entry.candidateCount || 0} / 需要回頭檢查 {entry.qualityRegressionCount || 0}
                  </div>
                </div>
              ))}
          </div>
        </div>
      </motion.section>
    </div>
  )
}
