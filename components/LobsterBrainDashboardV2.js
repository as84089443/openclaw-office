'use client'

import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  AlertTriangle,
  Bot,
  BrainCircuit,
  Bug,
  GitBranchPlus,
  Orbit,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  ChevronDown,
  LayoutGrid,
  Activity,
  AlertCircle,
  Network,
  Clock,
  History,
  Info,
  Inbox,
  CheckCircle2
} from 'lucide-react'

// ============================================================================
// Constants & formatters (Imported from legacy to maintain compatibility)
// ============================================================================

const WORKFLOW_STATUS_LABEL = {
  open: '待處理', pending: '待處理', task_created: '已建立交辦',
  assigned: '已指派', in_progress: '進行中', completed: '已完成',
  failed: '未完成', snoozed: '稍後再看', acknowledged: '已記下',
  resolved: '已處理', approved: '已同意', rejected: '已退回',
  applied: '已套用', rolled_back: '已還原',
}

const WORKFLOW_PHASE_LABEL = {
  queued: '待派工', running: '執行中', waiting_reviewer: '等 Reviewer',
  awaiting_continuation: '等續跑', waiting_human_gate: '等老闆拍板',
  completed: '已完成', failed: '未完成', superseded: '已被取代',
}

const RESEARCH_OPERATOR_PHASE_LABEL = {
  running_research: '研究中', delegating: '派工中', verifying: '驗證中',
  waiting_human_gate: '等老闆拍板',
}

const BRAIN_MODE_LABEL = {
  queued: '待接手', execution: '執行中', review: '待驗收', blocked: '卡住',
}

const DELEGATION_STATUS_LABEL = {
  queued: '已排隊', running: '進行中', idle: '待命', blocked: '已卡住',
  dispatch_failed: '派送失敗', awaiting_continuation: '等續跑',
  'awaiting-continuation': '等續跑',
}

const SIDECAR_STATUS_LABEL = {
  queued: '已排隊', dispatched: '已派送', running: '進行中', dispatch_failed: '派送失敗',
}

const TASK_TYPE_LABEL = {
  primary: '主任務', sidecar_review: 'Sidecar Review', worker_subtask: '子任務',
  verifier: '驗證', memory_distill: '記憶蒸餾',
}

const MERGE_POLICY_LABEL = {
  advisory: '建議參考', consensus_required: '需共識', blocking_review: '可阻擋',
  root_cause_support: '根因支援',
}

const CONSENSUS_STATUS_LABEL = {
  pending_review: '待 reviewer', needs_more_review: '需更多 reviewer',
  advisory_only: '僅 advisory', clear: '已收斂', blocked: '被擋下',
  human_gate: '待人工核准', conflict: '意見衝突',
}

const RISK_TIER_LABEL = {
  low: '低風險', medium: '中風險', high: '高風險', irreversible: '不可逆',
}

const RULE_STATUS_LABEL = {
  draft: '草稿', dry_run: 'Dry Run', canary: 'Canary', approved: '已核准',
  auto_applied: '已自動套用', rolled_back: '已回滾',
}

const RESOLUTION_SOURCE_LABEL = {
  self: '自行收斂',
  parent: '由主任務關閉',
  dispatch_failed: '派送失敗',
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

function formatTaskType(value) { return formatStatusLabel(value, TASK_TYPE_LABEL, '未分類') }
function formatBrainMode(value) { return formatStatusLabel(value, BRAIN_MODE_LABEL, '未設定') }
function formatRiskTier(value) { return formatStatusLabel(value, RISK_TIER_LABEL, '未分級') }
function formatConsensusStatus(value) { return formatStatusLabel(value, CONSENSUS_STATUS_LABEL, '未評估') }
function formatMergePolicy(value) { return formatStatusLabel(value, MERGE_POLICY_LABEL, '未設定') }
function formatDelegationStatus(value) { return formatStatusLabel(value, DELEGATION_STATUS_LABEL, '未設定') }
function formatRuleStatus(value) { return formatStatusLabel(value, RULE_STATUS_LABEL, '草稿') }
function formatResolutionSource(value) { return formatStatusLabel(value, RESOLUTION_SOURCE_LABEL, '未設定') }

function formatTime(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('zh-TW', { hour12: false })
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


// ============================================================================
// Layout Components
// ============================================================================

function MetricGroup({ title, icon: Icon, children }) {
  return (
    <div className="flex flex-col rounded-3xl border border-white/5 bg-white/[0.02] p-6 shadow-2xl backdrop-blur-md">
      <div className="flex items-center gap-3 border-b border-white/10 pb-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/5 text-gray-300">
          <Icon className="h-5 w-5" />
        </div>
        <h3 className="font-display text-lg tracking-wide text-white">{title}</h3>
      </div>
      <div className="mt-6 flex flex-col gap-4">
        {children}
      </div>
    </div>
  )
}

function MetricRow({ label, value, tone = 'cyan', highlightIfNonZero = false, hideWhenZero = false }) {
  if (hideWhenZero && (value === 0 || value === undefined || value === null)) return null

  const isHighlighted = highlightIfNonZero && value > 0

  const tones = {
    cyan: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/20',
    amber: 'bg-amber-500/10 text-amber-300 border-amber-500/20',
    rose: 'bg-rose-500/10 text-rose-300 border-rose-500/20',
    emerald: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
    neutral: 'bg-white/5 text-gray-300 border-white/10',
  }

  const badgeStyle = isHighlighted ? tones[tone] : tones.neutral
  const valueStyle = isHighlighted ? `font-bold ${tones[tone].split(' ')[1]}` : 'text-white'

  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-gray-400">{label}</span>
      <div className={`flex min-w-[3rem] items-center justify-center rounded-lg border px-2 py-1 ${badgeStyle}`}>
        <span className={`font-display text-lg tracking-wider ${valueStyle}`}>{value || 0}</span>
      </div>
    </div>
  )
}

function ChildTaskItem({ child }) {
  const childBlockers = (child.blockers || []).filter(Boolean).join(' / ')
  const childOpenLoops = (child.openLoops || []).filter(Boolean).join(' / ')
  
  return (
    <div className="rounded-xl border border-white/5 bg-black/20 p-4 transition-all hover:bg-black/30">
      <div className="flex flex-col gap-2 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-cyan-500/20 bg-cyan-500/5 px-2 py-0.5 text-[10px] uppercase tracking-wider text-cyan-200">
              {child.agentEmoji} {child.agentName}
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-wider text-gray-300">
              {formatTaskType(child.taskType)}
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-wider text-gray-400">
              {formatStatusLabel(child.status, WORKFLOW_STATUS_LABEL, '進行中')}
            </span>
            {child.riskTier && (
              <span className="text-[10px] uppercase tracking-wider text-gray-500">
                {formatRiskTier(child.riskTier)}
              </span>
            )}
          </div>
          <div className="mt-2 text-sm text-gray-200">{child.title}</div>
          {child.summary && <div className="mt-1 text-xs text-gray-500 line-clamp-2">{child.summary}</div>}
        </div>
        <div className="text-[10px] text-gray-600 xl:text-right">
          {formatRelativeTime(child.updatedAt)}
        </div>
      </div>
      
      {(child.rootCause || childBlockers || childOpenLoops || child.resolutionSource || child.consensus?.summary || child.humanGateReason) && (
        <div className="mt-3 flex flex-col gap-2 text-xs">
          {child.humanGateReason && (
            <div className="flex items-start gap-2 rounded px-2 text-amber-300">
              <ShieldAlert className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{child.humanGateReason}</span>
            </div>
          )}
          {childBlockers && (
            <div className="flex items-start gap-2 rounded px-2 text-rose-300">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{childBlockers}</span>
            </div>
          )}
          {child.consensus?.summary && (
            <div className="flex items-start gap-2 rounded px-2 text-emerald-300">
              <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{child.consensus.summary}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function TrackCardV2({ track }) {
  const [expanded, setExpanded] = useState(false)

  const childTasks = track.childTasks || []
  const hasIssue = Boolean(track.humanGateReason || track.rootCause || (track.blockers?.length > 0))
  const consensus = track.consensus || null
  const blockerLine = (track.blockers || []).filter(Boolean).join(' / ')
  const openLoopLine = (track.openLoops || []).filter(Boolean).join(' / ')
  const suggestedSubagents = (track.suggestedSubagents || []).filter(Boolean)
  const delegatedAgents = (track.delegatedAgents || []).filter(Boolean)
  const sidecarDispatchLine = (track.sidecarDispatches || [])
    .map((dispatch) => `${dispatch.agentName}${dispatch.status ? ` (${formatStatusLabel(dispatch.status, SIDECAR_STATUS_LABEL, dispatch.status)})` : ''}`)
    .join(' / ')

  return (
    <div className={`overflow-hidden rounded-2xl border transition-all duration-300 ${
      expanded ? 'border-white/10 bg-white/[0.03] shadow-lg' : 'border-white/5 bg-transparent hover:bg-white/[0.02]'
    } ${hasIssue && !expanded ? 'border-rose-500/20 bg-rose-500/[0.02]' : ''}`}>
      
      {/* Header - Always visible, clean summary */}
      <div 
        className="flex cursor-pointer flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex w-full flex-col sm:w-8/12">
          {/* Main tags */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1 xl:gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2 py-1 text-[10px] xl:text-[11px] uppercase tracking-widest text-cyan-200">
              <span>{track.agentEmoji}</span>
              <span className="font-medium">{track.agentName}</span>
            </span>
            <span className="text-[10px] xl:text-[11px] uppercase tracking-wider text-gray-400">
              {formatStatusLabel(track.workflowPhase, WORKFLOW_PHASE_LABEL, track.workflowPhase || track.status)}
            </span>
            {hasIssue && !expanded && (
               <span className="flex items-center gap-1 rounded-full border border-rose-500/20 bg-rose-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-rose-300">
                 <AlertTriangle className="h-3 w-3" />
                 <span>Needs Attention</span>
               </span>
            )}
            {track.continuationRequired && !expanded && (
              <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-amber-200">
                等續跑
              </span>
            )}
          </div>
          
          {/* Title and summary */}
          <h4 className="mt-3 font-display text-lg font-medium text-white xl:text-xl">{track.title}</h4>
          
          <p className="mt-1 line-clamp-1 text-sm text-gray-400">
            {track.summary || track.focus || '無需特別摘要，穩定執行中...'}
          </p>
        </div>

        {/* Right side overview */}
        <div className="flex items-center justify-between sm:w-4/12 sm:flex-col sm:items-end sm:gap-2">
           <div className="flex items-center gap-2 text-xs text-gray-500">
             <Clock className="h-3 w-3" />
             {formatRelativeTime(track.updatedAt)}
           </div>
           
           <div className="flex items-center gap-2 text-gray-500">
             {childTasks.length > 0 && (
               <span className="flex items-center gap-1 rounded-md bg-white/5 px-2 py-1 text-[10px] tracking-wider">
                 <Network className="h-3 w-3 text-cyan-500/50" />
                 {childTasks.length} 節點
               </span>
             )}
             <div className={`flex items-center justify-center rounded-full p-1 transition-transform ${expanded ? 'rotate-180 bg-white/10 text-white' : 'bg-transparent hover:bg-white/5'}`}>
               <ChevronDown className="h-4 w-4" />
             </div>
           </div>
        </div>
      </div>

      {/* Expanded Detail Body (Progressive Disclosure) */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            className="border-t border-white/5 bg-black/40 p-5 backdrop-blur-sm"
          >
            {/* Context & Source */}
            <div className="mb-6 flex flex-wrap gap-4 text-xs">
              {(track.requestFrom || track.originDescription) && (
                <div className="flex items-center gap-2 text-gray-400">
                  <span className="uppercase tracking-widest text-cyan-500">來源</span>
                  <span>{track.requestFrom || '系統'}{track.originDescription ? ` / ${track.originDescription}` : ''}</span>
                </div>
              )}
              <div className="flex items-center gap-2 text-gray-400">
                 <span className="uppercase tracking-widest text-cyan-500">大腦模式</span>
                 <span>{formatBrainMode(track.brainMode)}</span>
              </div>
              <div className="flex items-center gap-2 text-gray-400">
                 <span className="uppercase tracking-widest text-cyan-500">風險基準</span>
                 <span>{formatRiskTier(track.riskTier)}</span>
              </div>
            </div>

            {/* Diagnostic Badges */}
            {(track.humanGateReason || track.rootCause || blockerLine || openLoopLine || track.evolutionNote || consensus?.recommendedAction) && (
              <div className="mb-6 space-y-2 text-sm">
                {track.humanGateReason && (
                  <div className="flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-amber-100">
                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                    <div><span className="font-bold text-amber-300">人工 Gate：</span>{track.humanGateReason}</div>
                  </div>
                )}
                {blockerLine && (
                  <div className="flex items-start gap-3 rounded-xl border border-rose-500/20 bg-rose-500/5 px-4 py-3 text-rose-100">
                     <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
                     <div><span className="font-bold text-rose-300">阻擋點：</span>{blockerLine}</div>
                  </div>
                )}
                {track.rootCause && (
                  <div className="flex items-start gap-3 rounded-xl border border-fuchsia-500/20 bg-fuchsia-500/5 px-4 py-3 text-fuchsia-100">
                     <Bug className="mt-0.5 h-4 w-4 shrink-0 text-fuchsia-400" />
                     <div><span className="font-bold text-fuchsia-300">根因分析：</span>{track.rootCause}</div>
                  </div>
                )}
                {consensus?.recommendedAction && (
                  <div className="flex items-start gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-emerald-100">
                     <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                     <div><span className="font-bold text-emerald-300">共識決定：</span>{consensus.recommendedAction}</div>
                  </div>
                )}
                {openLoopLine && (
                  <div className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-gray-300">
                     <History className="mt-0.5 h-4 w-4 shrink-0 text-cyan-400" />
                     <div><span className="font-bold text-cyan-300">Open Loops：</span>{openLoopLine}</div>
                  </div>
                )}
              </div>
            )}

            {/* Variable Grid */}
            <div className="mb-6 grid gap-4 rounded-xl border border-white/5 bg-white/[0.02] p-4 lg:grid-cols-2">
              <div className="space-y-1">
                <div className="text-[10px] uppercase tracking-[0.2em] text-cyan-500/70">目前的焦點</div>
                <div className="text-sm text-gray-300">{track.focus || '—'}</div>
              </div>
              <div className="space-y-1">
                <div className="text-[10px] uppercase tracking-[0.2em] text-cyan-500/70">下一自動步驟</div>
                <div className="text-sm text-gray-300">{track.nextAutoStep || track.nextHandoff || track.nextCheckpoint || '—'}</div>
              </div>
              <div className="space-y-1">
                <div className="text-[10px] uppercase tracking-[0.2em] text-cyan-500/70">治理 (Retry / Esc)</div>
                <div className="text-sm text-gray-300">
                  {track.retryCount || 0}/{track.retryBudget || 0}
                  {track.escalationLevel ? ` (L${track.escalationLevel})` : ''}
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-[10px] uppercase tracking-[0.2em] text-cyan-500/70">共識總結</div>
                <div className="line-clamp-2 text-sm text-gray-300" title={consensus?.summary}>
                  {consensus?.summary || '無'}
                </div>
              </div>
            </div>

            {/* Sub-agents / Sidecars */}
            {(delegatedAgents.length > 0 || sidecarDispatchLine || suggestedSubagents.length > 0) && (
              <div className="mb-6 flex flex-wrap gap-4 rounded-xl border border-white/5 bg-black/40 p-4 text-xs">
                 {delegatedAgents.length > 0 && (
                   <div className="text-gray-400">
                     <span className="mr-2 text-cyan-400">已委派給：</span>{delegatedAgents.join(', ')}
                   </div>
                 )}
                 {sidecarDispatchLine && (
                   <div className="text-gray-400">
                     <span className="mr-2 text-cyan-400">Reviewers：</span>{sidecarDispatchLine}
                   </div>
                 )}
                 {suggestedSubagents.length > 0 && (
                   <div className="text-gray-400">
                     <span className="mr-2 text-cyan-400">建議幫手：</span>{suggestedSubagents.join(', ')}
                   </div>
                 )}
              </div>
            )}

            {/* Child Task Graph */}
            {childTasks.length > 0 && (
              <div className="mt-2 space-y-4">
                <div className="flex items-center gap-2 border-b border-white/5 pb-2 text-xs uppercase tracking-widest text-gray-500">
                  <Network className="h-4 w-4" />
                  子任務圖譜 ({track.activeChildTaskCount || 0} / {childTasks.length})
                </div>
                <div className="grid gap-3 lg:grid-cols-2">
                  {childTasks.map(child => <ChildTaskItem key={child.id} child={child} />)}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ============================================================================
// Main Dashboard V2 Export
// ============================================================================

export default function LobsterBrainDashboardV2({ lobsterBrain, onRefresh, refreshing }) {
  const [activeTab, setActiveTab] = useState('direct')

  if (!lobsterBrain) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center space-y-4 text-center">
        <BrainCircuit className="h-12 w-12 text-cyan-500/50" />
        <p className="text-gray-400">尚無大腦數據 (或系統尚未初始化)</p>
      </div>
    )
  }

  const directIngressTracks = lobsterBrain.directIngressTracks || []
  const manualRequestTracks = lobsterBrain.manualRequestTracks || []
  const backgroundTracks = lobsterBrain.backgroundTracks || []

  const tabs = [
    { id: 'direct', label: '你的交辦', count: directIngressTracks.length, data: directIngressTracks },
    { id: 'manual', label: '手動/API', count: manualRequestTracks.length, data: manualRequestTracks },
    { id: 'bg', label: '背景自治', count: backgroundTracks.length, data: backgroundTracks },
  ]

  const currentTracks = tabs.find(t => t.id === activeTab)?.data || []

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-4 xl:p-8">
      
      {/* 1. Header & System Overview */}
      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-black/80 to-black/40 p-8 shadow-2xl backdrop-blur-xl">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-cyan-900/20 via-transparent to-transparent opacity-50"></div>
        
        <div className="relative z-10 flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-cyan-400">
              <BrainCircuit className="h-4 w-4" />
              龍蝦大腦 (V2 Preview)
            </div>
            <h1 className="mt-3 font-display text-4xl leading-tight text-white drop-shadow-sm">
              自主網路運營中樞
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-gray-400">
              從全景視角監控自主魚群的負載、阻塞瓶頸與知識演化。你只需要專注在出問題的節點與直接交辦的項目。
            </p>
          </div>
          
          <div className="flex items-center gap-4">
            <button
              onClick={onRefresh}
              className="group flex flex-col items-center justify-center rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-6 py-4 transition-all hover:bg-cyan-500/20"
            >
              <RefreshCw className={`h-6 w-6 text-cyan-300 ${refreshing ? 'animate-spin' : 'group-hover:rotate-180 transition-transform duration-500'}`} />
              <span className="mt-2 text-[10px] uppercase tracking-widest text-cyan-200">更新視圖</span>
            </button>
          </div>
        </div>

        {/* 2. Top-level Metrics Bar */}
        <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          
          {/* Workload */}
          <MetricGroup title="運營負載" icon={Activity}>
             <MetricRow label="你的交辦" value={lobsterBrain.directIngressTaskCount} tone="cyan" highlightIfNonZero />
             <MetricRow label="手動 / API" value={lobsterBrain.manualRequestTaskCount} tone="neutral" />
             <MetricRow label="背景自治" value={lobsterBrain.backgroundTaskCount} tone="neutral" />
             <div className="my-2 border-t border-white/5"></div>
             <MetricRow label="圖譜節點總數" value={lobsterBrain.taskGraphNodeCount} tone="cyan" />
             <MetricRow label="活躍子任務" value={lobsterBrain.activeChildTaskCount} tone="cyan" highlightIfNonZero />
             <MetricRow label="委派執行中" value={lobsterBrain.delegatedRunCount} tone="neutral" />
          </MetricGroup>

          {/* Attention & Blockers */}
          <MetricGroup title="阻擋與需要關注" icon={AlertCircle}>
             <MetricRow label="人工 Gate 攔截" value={lobsterBrain.humanGateCount} tone="amber" highlightIfNonZero hideWhenZero />
             <MetricRow label="共識產生衝突" value={lobsterBrain.blockedConsensusCount} tone="rose" highlightIfNonZero hideWhenZero />
             <MetricRow label="記憶過舊或斷線" value={lobsterBrain.staleMemoryCount} tone="amber" highlightIfNonZero hideWhenZero />
             <div className="my-2 border-t border-white/5"></div>
             <MetricRow label="等待續跑佇列" value={lobsterBrain.continuationQueueCount} tone="neutral" highlightIfNonZero hideWhenZero />
             <MetricRow label="輔助 Reviewer" value={lobsterBrain.sidecarDispatchCount} tone="neutral" />
          </MetricGroup>

          {/* Evolution (Knowledge base) */}
          <MetricGroup title="進化與知識" icon={Sparkles}>
             <MetricRow label="已補齊根因" value={lobsterBrain.rootedCount} tone="emerald" highlightIfNonZero hideWhenZero />
             <MetricRow label="產生演化備註" value={lobsterBrain.evolvingCount} tone="emerald" highlightIfNonZero hideWhenZero />
             <div className="my-2 border-t border-white/5"></div>
             <MetricRow label="Reusable Rules 總數" value={lobsterBrain.reusableRuleCount} tone="emerald" highlightIfNonZero />
          </MetricGroup>

        </div>
      </div>

      {/* 3. Task Tracks Board (Tabbed) */}
      <div className="space-y-6">
        {/* Tab Navigation */}
        <div className="flex items-center gap-2 border-b border-white/10 pb-4">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm transition-all ${
                  isActive 
                  ? 'bg-white/10 font-medium text-white shadow-sm' 
                  : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'
                }`}
              >
                {tab.label}
                <span className={`rounded-full px-2 py-0.5 text-[10px] ${isActive ? 'bg-cyan-500/20 text-cyan-300' : 'bg-black/40 text-gray-500'}`}>
                  {tab.count}
                </span>
              </button>
            )
          })}
        </div>

        {/* Task List items */}
        <div className="space-y-4">
          <AnimatePresence mode="popLayout">
            {currentTracks.length === 0 ? (
              <motion.div 
                initial={{ opacity: 0 }} 
                animate={{ opacity: 1 }} 
                exit={{ opacity: 0 }}
                className="flex flex-col items-center justify-center rounded-2xl border border-white/5 bg-black/20 py-20 text-center"
              >
                <Inbox className="h-10 w-10 text-gray-600" />
                <p className="mt-4 text-gray-400">此區塊目前沒有活躍中的任務</p>
              </motion.div>
            ) : (
              currentTracks.map((track) => (
                <motion.div 
                  key={track.id}
                  layout 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                >
                  <TrackCardV2 track={track} />
                </motion.div>
              ))
            )}
          </AnimatePresence>
        </div>
      </div>

    </div>
  )
}
