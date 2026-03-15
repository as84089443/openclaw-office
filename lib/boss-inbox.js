import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import {
  getConfig,
  getAgentsList,
  getAgentsMap,
  getBossInboxConfig,
  getPrimaryAgentId,
  resolveAgentId,
} from './config.js'
import {
  addEvent,
  createRequest,
  createTask,
  getDailyDigestByDate,
  getEvents,
  getLatestDailyDigest,
  getAttentionStateById,
  getRecentTasks,
  getRequests,
  getTaskById,
  getTaskByRequestId,
  getEventsByRequest,
  getRequestById,
  listAttentionStates,
  listAttentionStatesByRequestId,
  listAttentionStatesByTaskId,
  upsertAttentionState,
  updateRequest,
  upsertDailyDigest,
} from './db.js'
import { sendDiscordMessage } from './notifications.js'
import {
  buildEvolutionSnapshot,
  buildEvolutionAttentionItems,
  buildStaleAttentionItems,
  getActiveReportAgentIds,
  recordCandidatePatchOutcome,
  runNightlyEvolutionPromotion,
  syncEvolutionArtifacts,
} from './evolution.js'

export const ATTENTION_TYPES = {
  DECISION: 'decision',
  BLOCKED: 'blocked',
  RISK: 'risk',
  OPPORTUNITY: 'opportunity',
  DIGEST_ONLY: 'digest_only',
}

const ATTENTION_SEVERITY = {
  [ATTENTION_TYPES.BLOCKED]: 95,
  [ATTENTION_TYPES.RISK]: 85,
  [ATTENTION_TYPES.DECISION]: 80,
  [ATTENTION_TYPES.OPPORTUNITY]: 72,
  [ATTENTION_TYPES.DIGEST_ONLY]: 20,
}

const BLOCKED_RE = /timeout|timed out|failed|failure|error|exception|blocked|stuck|missing permission|permission denied|sync failure|缺權限|卡住|逾時|失敗|中斷/i
const RISK_RE = /risk|urgent|overdue|delivery delay|invoice|payment|booking conflict|production issue|security|財務|排程|交付|風險/i
const DECISION_RE = /approval|approve|need decision|choose|pick|sign off|核准|拍板|決策|要不要/i
const OPPORTUNITY_RE = /lead|quote|proposal|upsell|cross-sell|renew|repurchase|商機|客戶|回購|成交|報價|opportunity/i
const OPPORTUNITY_AGENTS = new Set(['bizdev', 'photo-biz', 'crm', 'marketing', 'ai-biz'])
const CRITICAL_AGENTS = new Set(['finance-company', 'invoice', 'booking', 'production', 'qa'])

const DIGEST_SECTIONS = [
  [ATTENTION_TYPES.DECISION, '待決策'],
  [ATTENTION_TYPES.BLOCKED, '阻塞'],
  [ATTENTION_TYPES.RISK, '風險'],
  [ATTENTION_TYPES.OPPORTUNITY, '商機'],
]

const ATTENTION_STATUS = {
  OPEN: 'open',
  ACKNOWLEDGED: 'acknowledged',
  RESOLVED: 'resolved',
}

function createBossInboxId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

function localDateKey(input = Date.now()) {
  const date = input instanceof Date ? input : new Date(input)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function trimText(text, max = 160) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim()
  if (!clean) return ''
  return clean.length > max ? `${clean.slice(0, max - 3)}...` : clean
}

function formatTwd(value) {
  const amount = Number(value || 0)
  if (!Number.isFinite(amount) || amount <= 0) return null
  return `NT$${amount.toLocaleString('en-US')}`
}

function timeStr() {
  return new Date().toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

function normalizeAttentionStatus(value) {
  if (value === ATTENTION_STATUS.ACKNOWLEDGED) return ATTENTION_STATUS.ACKNOWLEDGED
  if (value === ATTENTION_STATUS.RESOLVED) return ATTENTION_STATUS.RESOLVED
  return ATTENTION_STATUS.OPEN
}

function toTimestampOrNull(value) {
  if (value === null || value === undefined || value === '') return null
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const fromString = Date.parse(String(value))
  return Number.isFinite(fromString) ? fromString : null
}

function toNumberOrNull(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function isAttentionSuppressed(state, now = Date.now()) {
  const snoozedUntil = toTimestampOrNull(state?.snoozedUntil)
  const nextReviewAt = toTimestampOrNull(state?.nextReviewAt)
  return Boolean(
    (snoozedUntil && snoozedUntil > now) ||
    (nextReviewAt && nextReviewAt > now),
  )
}

function uniqueList(items = []) {
  return [...new Set((items || []).map((item) => String(item || '').trim()).filter(Boolean))]
}

function attentionSignalScore(item) {
  return Number(item?.signalScore ?? item?.severity ?? item?.priority ?? 0)
}

function parseEnvSnapshot(filePath) {
  if (!filePath || !existsSync(filePath)) return {}
  const snapshot = {}
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (!match) continue
    snapshot[match[1]] = match[2]
  }
  return snapshot
}

function getAgentSystemLogsDir() {
  return join(getConfig().openclaw?.home || '', 'workspace', 'agent-system', 'logs')
}

function getAutomationAuditSnapshot(dateKey = localDateKey()) {
  return parseEnvSnapshot(join(getAgentSystemLogsDir(), `automation-integrity-${dateKey}.env`))
}

function getTomorrowPreview() {
  const tomorrow = localDateKey(Date.now() + 24 * 60 * 60 * 1000)
  const calendarLog = join(getAgentSystemLogsDir(), `calendar-${tomorrow}.log`)
  if (!existsSync(calendarLog)) return null

  const rows = readFileSync(calendarLog, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith('['))

  if (rows.length === 0) return null
  return trimText(rows.slice(0, 2).join(' / '), 180)
}

function toAttentionStateRow(item, existing = null) {
  const now = Date.now()
  const latestSeenAt = Number(item.updatedAt || item.createdAt || Date.now())
  const existingLastSeenAt = Number(existing?.lastSeenAt || 0)
  const latestEventChanged = item.latestEventId && item.latestEventId !== existing?.latestEventId
  const categories = uniqueList([...(existing?.categories || []), ...(item.categories || [])])
  const computedSignalCount = Number(item.signalCount || 1)
  const signalCount = latestEventChanged
    ? Math.max(Number(existing?.signalCount || 0) + 1, computedSignalCount)
    : Math.max(Number(existing?.signalCount || 0), computedSignalCount)

  let status = normalizeAttentionStatus(existing?.status || ATTENTION_STATUS.OPEN)
  let resolvedAt = existing?.resolvedAt || null
  let closedReason = item.closedReason || existing?.closedReason || null
  let snoozedUntil = toTimestampOrNull(item.snoozedUntil ?? existing?.snoozedUntil)
  let nextReviewAt = toTimestampOrNull(item.nextReviewAt ?? existing?.nextReviewAt)
  if (
    status === ATTENTION_STATUS.RESOLVED &&
    latestSeenAt > Number(existing?.resolvedAt || 0)
  ) {
    status = ATTENTION_STATUS.OPEN
    resolvedAt = null
    closedReason = null
    snoozedUntil = null
    nextReviewAt = null
  }

  return {
    id: item.id,
    source: item.source || existing?.source || null,
    agentId: item.agentId || existing?.agentId || null,
    attentionType: item.attentionType || existing?.attentionType || null,
    status,
    linkedRequestId: item.linkedRequestId || existing?.linkedRequestId || null,
    linkedTaskId: item.linkedTaskId || existing?.linkedTaskId || null,
    latestEventId: item.latestEventId || item.eventId || existing?.latestEventId || null,
    signalCount,
    signalScoreMax: Math.max(Number(existing?.signalScoreMax || 0), attentionSignalScore(item)),
    categories,
    snoozedUntil,
    assignedOwner: item.assignedOwner || existing?.assignedOwner || null,
    closedReason,
    nextReviewAt,
    taskResult: item.taskResult || existing?.taskResult || null,
    completionValue: toNumberOrNull(item.completionValue ?? existing?.completionValue),
    didImprove: item.didImprove === undefined ? Boolean(existing?.didImprove) : Boolean(item.didImprove),
    rollbackNeeded: item.rollbackNeeded === undefined ? Boolean(existing?.rollbackNeeded) : Boolean(item.rollbackNeeded),
    lastFeedbackAt: toTimestampOrNull(item.lastFeedbackAt ?? existing?.lastFeedbackAt),
    firstSeenAt: existing?.firstSeenAt || item.createdAt || latestSeenAt,
    lastSeenAt: Math.max(existingLastSeenAt, latestSeenAt),
    resolvedAt,
    updatedAt: now,
  }
}

function mergeAttentionItemWithState(item, state, tasksById = new Map(), requestsById = new Map()) {
  const now = Date.now()
  const status = normalizeAttentionStatus(state?.status || ATTENTION_STATUS.OPEN)
  const linkedTask = state?.linkedTaskId ? (tasksById.get(state.linkedTaskId) || getTaskById(state.linkedTaskId)) : null
  const linkedRequest = state?.linkedRequestId ? (requestsById.get(state.linkedRequestId) || getRequestById(state.linkedRequestId)) : null
  const suppressed = isAttentionSuppressed(state, now)
  const linkedTaskUpdatedAt = linkedTask
    ? Math.max(Number(linkedTask.completedAt || 0), Number(linkedTask.startedAt || 0), Number(linkedTask.createdAt || 0)) || null
    : null

  return {
    ...item,
    latestEventId: item.latestEventId || item.eventId || state?.latestEventId || null,
    signalCount: Number(state?.signalCount || item.signalCount || 1),
    signalScore: Math.max(Number(state?.signalScoreMax || 0), attentionSignalScore(item)),
    categories: uniqueList([...(state?.categories || []), ...(item.categories || [])]),
    status,
    linkedRequestId: state?.linkedRequestId || null,
    linkedTaskId: state?.linkedTaskId || null,
    linkedRequestState: linkedRequest?.state || item.linkedRequestState || null,
    linkedTaskStatus: linkedTask?.status || item.linkedTaskStatus || null,
    linkedTaskUpdatedAt,
    snoozedUntil: toTimestampOrNull(state?.snoozedUntil),
    assignedOwner: state?.assignedOwner || null,
    closedReason: state?.closedReason || null,
    nextReviewAt: toTimestampOrNull(state?.nextReviewAt),
    taskResult: state?.taskResult || null,
    completionValue: toNumberOrNull(state?.completionValue),
    didImprove: Boolean(state?.didImprove),
    rollbackNeeded: Boolean(state?.rollbackNeeded),
    lastFeedbackAt: toTimestampOrNull(state?.lastFeedbackAt),
    firstSeenAt: state?.firstSeenAt || item.createdAt || item.updatedAt || null,
    lastSeenAt: state?.lastSeenAt || item.updatedAt || item.createdAt || null,
    unresolved: Boolean(item.unresolved) && status === ATTENTION_STATUS.OPEN && !suppressed,
  }
}

function buildAttentionItemFromState(state, tasksById = new Map(), requestsById = new Map(), agentMap = getAgentsMap()) {
  if (!state) return null
  const linkedTask = state.linkedTaskId ? (tasksById.get(state.linkedTaskId) || getTaskById(state.linkedTaskId)) : null
  const linkedRequest = state.linkedRequestId ? (requestsById.get(state.linkedRequestId) || getRequestById(state.linkedRequestId)) : null
  const agent = agentMap[state.agentId] || agentMap[getPrimaryAgentId()] || {}
  const titleFallback = `${agent?.name || state.agentId || 'Agent'} ${state.attentionType || ATTENTION_TYPES.DIGEST_ONLY}`
  const title = trimText(linkedTask?.title || linkedRequest?.task?.title || linkedRequest?.content || titleFallback, 80)
  const detail = trimText(
    linkedTask?.detail ||
    linkedRequest?.task?.detail ||
    linkedRequest?.content ||
    state.taskResult ||
    state.closedReason ||
    '',
    200,
  )

  return {
    id: state.id,
    requestId: state.linkedRequestId || null,
    source: state.source || 'attention-state',
    latestEventId: state.latestEventId || null,
    signalCount: Number(state.signalCount || 1),
    signalScore: Number(state.signalScoreMax || 0),
    categories: uniqueList(state.categories || []),
    linkedRequestId: state.linkedRequestId || null,
    linkedTaskId: state.linkedTaskId || null,
    linkedRequestState: linkedRequest?.state || null,
    linkedTaskStatus: linkedTask?.status || null,
    agentId: state.agentId || getPrimaryAgentId(),
    agentName: agent?.name || state.agentId || 'agent',
    agentEmoji: agent?.emoji || '🤖',
    agentColor: agent?.color || '#888',
    bindings: agent?.bindings || [],
    channel: agent?.bindings?.find((binding) => String(binding).startsWith('discord')) || null,
    attentionType: state.attentionType || ATTENTION_TYPES.DIGEST_ONLY,
    priority: Number(state.signalScoreMax || 0),
    severity: Number(state.signalScoreMax || 0),
    commercialValue: Number(state.completionValue || 0),
    needsDecision: state.attentionType === ATTENTION_TYPES.DECISION,
    state: linkedRequest?.state || state.status || 'open',
    title,
    detail,
    createdAt: state.firstSeenAt || Date.now(),
    updatedAt: state.lastSeenAt || Date.now(),
    unresolved: normalizeAttentionStatus(state.status) !== ATTENTION_STATUS.RESOLVED,
  }
}

function syncAttentionItemsWithState(items, tasksById = new Map(), requestsById = new Map(), agentMap = getAgentsMap()) {
  const stateMap = new Map(listAttentionStates().map((entry) => [entry.id, entry]))
  const merged = []
  const touched = new Set()

  for (const item of items) {
    const nextState = toAttentionStateRow(item, stateMap.get(item.id) || null)
    const savedState = upsertAttentionState(nextState)
    stateMap.set(item.id, savedState)
    merged.push(mergeAttentionItemWithState(item, savedState, tasksById, requestsById))
    touched.add(item.id)
  }

  for (const [id, state] of stateMap.entries()) {
    if (touched.has(id)) continue
    if (normalizeAttentionStatus(state.status) === ATTENTION_STATUS.RESOLVED) continue
    const fallback = buildAttentionItemFromState(state, tasksById, requestsById, agentMap)
    if (!fallback) continue
    merged.push(mergeAttentionItemWithState(fallback, state, tasksById, requestsById))
  }

  return merged
}

function defaultTargetAgentForAttention(item) {
  if (!item) return getPrimaryAgentId()
  if (item.attentionType === ATTENTION_TYPES.BLOCKED || item.attentionType === ATTENTION_TYPES.RISK) {
    return 'admin'
  }
  return item.agentId || getPrimaryAgentId()
}

function buildAttentionTaskDraft(item, overrides = {}) {
  const targetAgent = resolveAgentId(overrides.targetAgent || defaultTargetAgentForAttention(item))
  const detailLines = [
    `來源卡片：${item.id}`,
    item.title,
    item.detail,
    overrides.note ? `note: ${overrides.note}` : null,
    item.latestEventId ? `latestEventId: ${item.latestEventId}` : null,
    item.escalationReason ? `escalationReason: ${item.escalationReason}` : null,
    item.categories?.length ? `categories: ${item.categories.join(', ')}` : null,
  ].filter(Boolean)
  const detail = String(overrides.detail || detailLines.join('\n')).trim().slice(0, 1200)

  return {
    title: trimText(overrides.title || item.title || `${item.agentName} ${item.attentionType}`, 120),
    detail,
    targetAgent,
    attentionType: item.attentionType || ATTENTION_TYPES.DIGEST_ONLY,
    priority: Number.isFinite(overrides.priority) ? Number(overrides.priority) : Number(item.priority || 0),
    needsDecision: overrides.needsDecision === undefined ? Boolean(item.needsDecision) : Boolean(overrides.needsDecision),
    estimatedValue: Number.isFinite(overrides.estimatedValue)
      ? Number(overrides.estimatedValue)
      : (Number.isFinite(item.commercialValue) ? Number(item.commercialValue) : null),
  }
}

function createWorkflowTaskFromAttention(item, overrides = {}) {
  const draft = buildAttentionTaskDraft(item, overrides)
  const requestId = createBossInboxId('req_attention')
  const taskId = createBossInboxId('task_attention')

  const request = createRequest({
    id: requestId,
    content: draft.detail,
    from: 'Boss Inbox',
    state: 'assigned',
    assignedTo: draft.targetAgent,
    attentionType: draft.attentionType,
    priority: draft.priority,
    needsDecision: draft.needsDecision,
    estimatedValue: draft.estimatedValue,
    source: 'boss-inbox',
    task: {
      id: taskId,
      title: draft.title,
      detail: draft.detail,
      targetAgent: draft.targetAgent,
      reason: `Generated from attention card ${item.id}`,
    },
  })

  const task = createTask({
    id: taskId,
    requestId,
    title: draft.title,
    detail: draft.detail,
    assignedAgent: draft.targetAgent,
    status: 'assigned',
    attentionType: draft.attentionType,
    priority: draft.priority,
    needsDecision: draft.needsDecision,
    estimatedValue: draft.estimatedValue,
  })

  addEvent({
    id: createBossInboxId('evt_attention'),
    requestId,
    state: 'received',
    agent: 'wickedman',
    agentColor: '#ff006e',
    agentName: 'WickedMan',
    message: `Boss Inbox 建立 attention task：${draft.title}`,
    time: timeStr(),
    timestamp: Date.now(),
  })

  addEvent({
    id: createBossInboxId('evt_attention'),
    requestId,
    state: 'assigned',
    agent: draft.targetAgent,
    agentColor: getAgentsMap()[draft.targetAgent]?.color || '#888',
    agentName: getAgentsMap()[draft.targetAgent]?.name || draft.targetAgent,
    message: `從 Boss Inbox attention 接手：${draft.title}`,
    targetAgent: draft.targetAgent,
    time: timeStr(),
    timestamp: Date.now(),
  })

  return { request, task, draft }
}

function inferAction(item) {
  switch (item.attentionType) {
    case ATTENTION_TYPES.DECISION:
      return `今天拍板或回覆「${item.title}」。`
    case ATTENTION_TYPES.BLOCKED:
      if (/permission|權限/i.test(item.detail || '')) {
        return '今天補齊缺的權限或指定 owner 解鎖流程。'
      }
      if (/sync|timeout|逾時|失敗/i.test(item.detail || '')) {
        return '今天確認失敗原因並恢復這條流程。'
      }
      return '今天指定 owner 把這個阻塞排掉。'
    case ATTENTION_TYPES.RISK:
      return '今天確認風險處置與時間表，避免擴大。'
    case ATTENTION_TYPES.OPPORTUNITY:
      return '今天跟進這個機會，推進成交、回購或升級。'
    default:
      return '今天確認是否需要介入。'
  }
}

function inferImpact(item) {
  const value = formatTwd(item.commercialValue)
  switch (item.attentionType) {
    case ATTENTION_TYPES.DECISION:
      return value
        ? `不拍板會延後 ${value} 的機會與下一步。`
        : '不拍板會卡住下一步與相關魚的執行。'
    case ATTENTION_TYPES.BLOCKED:
      return '不處理會讓流程持續卡住，並延誤交付或回覆。'
    case ATTENTION_TYPES.RISK:
      return '不處理可能擴大成排程、財務、交付或系統穩定性問題。'
    case ATTENTION_TYPES.OPPORTUNITY:
      return value
        ? `預估價值 ${value}，拖延可能錯失成交窗口。`
        : '拖延可能錯失成交、回購或升級時機。'
    default:
      return '若不處理，後續狀況可能惡化。'
  }
}

function buildDigestSections(attentionItems) {
  return DIGEST_SECTIONS.map(([type, label]) => {
    const items = attentionItems
      .filter((item) => item.unresolved && item.attentionType === type)
      .slice(0, 6)
      .map((item) => ({
        id: item.id,
        agentId: item.agentId,
        agentName: item.agentName,
        agentEmoji: item.agentEmoji,
        title: item.title,
        action: inferAction(item),
        impact: inferImpact(item),
        updatedAt: item.updatedAt,
        commercialValue: item.commercialValue || 0,
      }))

    return { id: type, label, items }
  }).filter((section) => section.items.length > 0)
}

function buildAnomalies(attentionItems, dateKey = localDateKey()) {
  const env = getAutomationAuditSnapshot(dateKey)
  const anomalies = []
  const cronFailures = attentionItems.filter((item) => item.unresolved && item.source === 'cron').length
  const placeholder = Number(env.AUTOMATION_PLACEHOLDER || 0)
  const gated = Number(env.AUTOMATION_GATED || 0)
  const coreReady = Number(env.AUTOMATION_CORE_READY || 0)
  const coreTotal = Number(env.AUTOMATION_CORE_TOTAL || 0)
  const auditPath = join(getAgentSystemLogsDir(), `automation-integrity-${dateKey}.md`)

  if (placeholder > 0) {
    anomalies.push({
      type: 'placeholder',
      label: '假技能',
      detail: `${placeholder} 個 placeholder / fake skill 仍存在，不能當成完整自動化。`,
    })
  }

  if (gated > 0) {
    anomalies.push({
      type: 'gated',
      label: '待配置',
      detail: `${gated} 個外部依賴尚未配置完成。`,
    })
  }

  if (coreTotal > 0 && coreReady < coreTotal) {
    anomalies.push({
      type: 'core',
      label: '核心管線',
      detail: `核心管線目前只有 ${coreReady}/${coreTotal} 可執行。`,
    })
  }

  if (cronFailures > 0) {
    anomalies.push({
      type: 'cron',
      label: 'Cron 失敗',
      detail: `${cronFailures} 個排程失敗，已同步進阻塞 / 風險清單。`,
    })
  }

  if (anomalies.length > 0 && existsSync(auditPath)) {
    anomalies.push({
      type: 'audit_path',
      label: '稽核報告',
      detail: auditPath,
    })
  }

  return anomalies
}

function buildDailyDigestSummary(payload, dateKey) {
  const sections = buildDigestSections(payload.attentionItems)
  const anomalies = buildAnomalies(payload.attentionItems, dateKey)
  const quietDay = sections.length === 0
  const focusCount = sections.reduce((sum, section) => sum + section.items.length, 0)
  const tomorrowPreview = quietDay ? getTomorrowPreview() : null
  const bossInbox = getBossInboxConfig()
  const deliveryStatus = bossInbox.discordTarget ? 'pending' : 'not-configured'
  const evolution = {
    candidatePatchCount: payload.candidatePatches?.filter((item) => item.reviewStatus === 'pending').length || 0,
    approvedNotAppliedCount: payload.candidatePatches?.filter((item) => item.reviewStatus === 'approved' && item.applyStatus !== 'applied').length || 0,
    escalatedSignalsCount: payload.attentionItems?.filter((item) => item.unresolved && item.source === 'evolution').length || 0,
    openAttentionCount: payload.attentionItems?.filter((item) => item.unresolved).length || 0,
    linkedTaskCount: payload.attentionItems?.filter((item) => item.unresolved && item.linkedTaskId).length || 0,
    staleAgents: (payload.agentEvolutionStatus || []).filter((entry) => entry.stale).map((entry) => ({
      agentId: entry.agentId,
      agentName: entry.agentName,
      agentEmoji: entry.agentEmoji,
    })),
    topExperiment: payload.growthSignals?.[0]
      ? {
          agentId: payload.growthSignals[0].agentId,
          agentName: payload.growthSignals[0].agentName,
          agentEmoji: payload.growthSignals[0].agentEmoji,
          summary: payload.growthSignals[0].summary,
        }
      : null,
  }

  return {
    headline: quietDay
      ? '今天無待拍板與阻塞。'
      : `今天有 ${focusCount} 件要你關注的事。`,
    sections,
    anomalies,
    quietDay,
    tomorrowPreview,
    deliveryChannel: bossInbox.discordTarget ? 'discord' : 'dashboard-only',
    deliveryStatus,
    unresolvedCounts: payload.unresolvedCounts,
    evolution,
    focusAgents: payload.agentSummaries
      .filter((agent) => agent.activityState === 'active' && agent.layer === 'focus')
      .map((agent) => ({
        id: agent.id,
        name: agent.name,
        unresolvedTotal: agent.unresolvedTotal,
      })),
  }
}

function readCronJobs() {
  const jobsPath = join(getConfig().openclaw?.home || '', 'cron', 'jobs.json')
  if (!jobsPath || !existsSync(jobsPath)) return []
  try {
    const parsed = JSON.parse(readFileSync(jobsPath, 'utf8'))
    return Array.isArray(parsed?.jobs) ? parsed.jobs : []
  } catch (error) {
    console.error('[boss-inbox] Failed to read cron jobs:', error.message)
    return []
  }
}

function inferAttentionType({ request, task, text, agentId }) {
  const explicit = request?.attentionType || task?.attentionType || null
  if (explicit && Object.values(ATTENTION_TYPES).includes(explicit)) return explicit
  if (request?.needsDecision || task?.needsDecision || DECISION_RE.test(text)) {
    return ATTENTION_TYPES.DECISION
  }
  if (BLOCKED_RE.test(text)) return ATTENTION_TYPES.BLOCKED
  if (CRITICAL_AGENTS.has(agentId) && RISK_RE.test(text)) return ATTENTION_TYPES.RISK
  if (RISK_RE.test(text)) return ATTENTION_TYPES.RISK
  if (
    (Number(request?.estimatedValue || task?.estimatedValue || 0) > 0) ||
    OPPORTUNITY_RE.test(text) ||
    (OPPORTUNITY_AGENTS.has(agentId) && /(客戶|lead|quote|proposal|opportunity|回購|商機)/i.test(text))
  ) {
    return ATTENTION_TYPES.OPPORTUNITY
  }
  return ATTENTION_TYPES.DIGEST_ONLY
}

function inferPriority({ request, task, attentionType }) {
  const explicit = Number(request?.priority ?? task?.priority ?? 0)
  if (Number.isFinite(explicit) && explicit > 0) return explicit
  return ATTENTION_SEVERITY[attentionType] || 0
}

function buildRequestAttentionItem(request, task, eventsByRequest, agentMap) {
  const primaryAgentId = getPrimaryAgentId()
  const rawAgentId = request.assignedTo || task?.assignedAgent || primaryAgentId
  const agentId = resolveAgentId(rawAgentId)
  const agent = agentMap[agentId] || agentMap[primaryAgentId]
  const recentEvents = eventsByRequest[request.id] || []
  const latestEvent = recentEvents[0] || null
  const combinedText = [
    request.content,
    task?.detail,
    request.result,
    latestEvent?.message,
  ].filter(Boolean).join('\n')
  const attentionType = inferAttentionType({
    request,
    task,
    text: combinedText,
    agentId,
  })
  const priority = inferPriority({ request, task, attentionType })
  const commercialValue = Number(request.estimatedValue ?? task?.estimatedValue ?? 0)
  const updatedAt = Math.max(
    request.completedAt || 0,
    request.workStartedAt || 0,
    request.createdAt || 0,
    latestEvent?.timestamp || 0,
  )

  return {
    id: request.id,
    requestId: request.id,
    source: 'request',
    latestEventId: latestEvent?.id || null,
    signalCount: 1,
    signalScore: priority,
    categories: [attentionType],
    linkedRequestId: request.id,
    linkedTaskId: task?.id || null,
    linkedRequestState: request.state,
    linkedTaskStatus: task?.status || null,
    agentId,
    agentName: agent?.name || agentId,
    agentEmoji: agent?.emoji || '🤖',
    agentColor: agent?.color || '#888',
    bindings: agent?.bindings || [],
    channel: agent?.bindings?.find((binding) => String(binding).startsWith('discord')) || null,
    attentionType,
    priority,
    severity: priority + (commercialValue > 0 ? Math.min(commercialValue / 1000, 10) : 0),
    commercialValue,
    needsDecision: Boolean(request.needsDecision || task?.needsDecision),
    state: request.state,
    title: trimText(task?.title || request.content || latestEvent?.message || request.id, 80),
    detail: trimText(task?.detail || request.content || request.result || latestEvent?.message || '', 200),
    createdAt: request.createdAt,
    updatedAt,
    unresolved: request.state !== 'completed',
  }
}

function buildCronAttentionItems(agentMap) {
  const cronJobs = readCronJobs()
  const items = []
  for (const job of cronJobs) {
    if (!job?.enabled) continue
    const lastStatus = job?.state?.lastStatus || job?.state?.lastRunStatus || null
    if (lastStatus !== 'error') continue
    const agentId = resolveAgentId(job.agentId || getPrimaryAgentId())
    const agent = agentMap[agentId] || agentMap[getPrimaryAgentId()]
    const consecutiveErrors = Number(job?.state?.consecutiveErrors || 0)
    const attentionType = consecutiveErrors >= 2 ? ATTENTION_TYPES.RISK : ATTENTION_TYPES.BLOCKED
    const priority = ATTENTION_SEVERITY[attentionType] + Math.min(consecutiveErrors, 5)
    items.push({
      id: `cron:${job.id}`,
      requestId: null,
      source: 'cron',
      latestEventId: null,
      signalCount: Math.max(consecutiveErrors, 1),
      signalScore: priority,
      categories: ['cron-error'],
      agentId,
      agentName: agent?.name || agentId,
      agentEmoji: agent?.emoji || '🤖',
      agentColor: agent?.color || '#888',
      bindings: agent?.bindings || [],
      channel: agent?.bindings?.find((binding) => String(binding).startsWith('discord')) || null,
      attentionType,
      priority,
      severity: priority,
      commercialValue: 0,
      needsDecision: false,
      state: lastStatus,
      title: trimText(job.description || job.name || 'Cron job failure', 80),
      detail: trimText(job?.state?.lastError || 'Cron job execution failed.', 200),
      createdAt: job.createdAtMs || job.updatedAtMs || Date.now(),
      updatedAt: job?.state?.lastRunAtMs || job.updatedAtMs || Date.now(),
      unresolved: true,
    })
  }
  return items
}

function buildAgentSummaries(agents, items, requestsByAgent, evolutionByAgent = {}) {
  const activeAgentIds = getActiveReportAgentIds()
  return agents.map((agent) => {
    const agentItems = items.filter((item) => item.agentId === agent.id)
    const unresolvedItems = agentItems.filter((item) => item.unresolved)
    const latestRequest = (requestsByAgent[agent.id] || [])[0] || null
    const latestItem = unresolvedItems[0] || latestRequest || null
    const evolution = evolutionByAgent[agent.id] || null
    const activityState = activeAgentIds.has(agent.id) ? 'active' : 'inactive'
    const unresolvedCounts = {
      decision: unresolvedItems.filter((item) => item.attentionType === ATTENTION_TYPES.DECISION).length,
      blocked: unresolvedItems.filter((item) => item.attentionType === ATTENTION_TYPES.BLOCKED).length,
      risk: unresolvedItems.filter((item) => item.attentionType === ATTENTION_TYPES.RISK).length,
      opportunity: unresolvedItems.filter((item) => item.attentionType === ATTENTION_TYPES.OPPORTUNITY).length,
      digest_only: unresolvedItems.filter((item) => item.attentionType === ATTENTION_TYPES.DIGEST_ONLY).length,
    }
    const lastActive = Math.max(
      ...[latestRequest?.updatedAt, latestRequest?.createdAt, latestItem?.updatedAt, evolution?.lastRunAt, evolution?.lastLearningAt].filter(Boolean),
      0,
    ) || null

    return {
      ...agent,
      activityState,
      lastActive,
      unresolvedCounts,
      unresolvedTotal: unresolvedItems.length,
      layer: activityState !== 'active'
        ? 'inactive'
        : (unresolvedItems.some((item) => item.attentionType !== ATTENTION_TYPES.DIGEST_ONLY) ? 'focus' : 'all'),
      todaySummary: latestItem
        ? trimText(latestItem.detail || latestItem.title, 110)
        : (evolution?.lastLearned ? trimText(evolution.lastLearned, 110) : 'Today is quiet.'),
      lastLearned: evolution?.lastLearned || null,
      nextTest: evolution?.nextTest || null,
      stale: Boolean(evolution?.stale),
      candidateCount: evolution?.candidateCount || 0,
      qualityRegressionCount: evolution?.qualityRegressionCount || 0,
    }
  }).sort((a, b) => {
    if ((a.activityState === 'active' ? 0 : 1) !== (b.activityState === 'active' ? 0 : 1)) {
      return (a.activityState === 'active' ? 0 : 1) - (b.activityState === 'active' ? 0 : 1)
    }
    if (a.layer !== b.layer) return a.layer === 'focus' ? -1 : 1
    if ((b.unresolvedTotal || 0) !== (a.unresolvedTotal || 0)) {
      return (b.unresolvedTotal || 0) - (a.unresolvedTotal || 0)
    }
    return (b.lastActive || 0) - (a.lastActive || 0)
  })
}

function renderDigest(summary, dateKey) {
  const lines = [
    `# 老闆晚間摘要 (${dateKey})`,
    '',
    summary.headline,
  ]

  if (summary.sections.length > 0) {
    lines.push('')
  }

  for (const section of summary.sections) {
    lines.push(`## ${section.label}`)
    for (const item of section.items) {
      lines.push(`- ${item.agentEmoji} ${item.agentName}｜${item.title}`)
      lines.push(`  你需要做的事：${item.action}`)
      lines.push(`  若不處理：${item.impact}`)
    }
    lines.push('')
  }

  if (summary.evolution) {
    lines.push('## 今日進化')
    lines.push(`- 待審改進：${summary.evolution.candidatePatchCount || 0} 件`)
    if ((summary.evolution.staleAgents || []).length > 0) {
      lines.push(`- 24h 無新學習：${summary.evolution.staleAgents.map((entry) => `${entry.agentEmoji} ${entry.agentName}`).join('、')}`)
    }
    if (summary.evolution.topExperiment?.summary) {
      lines.push(`- 最值得放行的下一輪測試：${summary.evolution.topExperiment.agentEmoji} ${summary.evolution.topExperiment.agentName}／${summary.evolution.topExperiment.summary}`)
    }
    lines.push('')
  }

  if (summary.tomorrowPreview) {
    lines.push('## 明天第一件事')
    lines.push(`- ${summary.tomorrowPreview}`)
    lines.push('')
  }

  if (summary.anomalies.length > 0) {
    lines.push('## 系統異常附錄')
    for (const anomaly of summary.anomalies) {
      lines.push(`- ${anomaly.label}：${anomaly.detail}`)
    }
    lines.push('')
  }

  return lines.join('\n').trim()
}

function normalizeDigestDeliveryState(digest, bossInbox = getBossInboxConfig()) {
  if (!digest) return digest
  const desiredChannel = bossInbox.discordTarget ? 'discord' : 'dashboard-only'
  const normalizedStatus = digest.deliveredAt
    ? 'delivered'
    : (String(digest.deliveryStatus || '').startsWith('error:')
        ? String(digest.deliveryStatus)
        : (bossInbox.discordTarget ? 'pending' : 'not-configured'))
  const nextSummary = {
    ...(digest.summary || {}),
    deliveryChannel: desiredChannel,
    deliveryStatus: normalizedStatus,
  }

  const needsUpdate =
    digest.deliveryChannel !== desiredChannel ||
    digest.deliveryStatus !== normalizedStatus ||
    digest.summary?.deliveryStatus !== normalizedStatus ||
    digest.summary?.deliveryChannel !== desiredChannel

  if (!needsUpdate) {
    return {
      ...digest,
      summary: nextSummary,
      deliveryChannel: desiredChannel,
      deliveryStatus: normalizedStatus,
    }
  }

  return upsertDailyDigest({
    ...digest,
    summary: nextSummary,
    deliveryStatus: normalizedStatus,
    target: bossInbox.discordTarget || null,
  })
}

export function buildBossInboxPayload({ skipDigest = false } = {}) {
  syncEvolutionArtifacts()
  const agents = getAgentsList()
  const agentMap = getAgentsMap()
  const requests = getRequests(200, false)
  const tasks = getRecentTasks(200)
  const allEvents = getEvents(300)
  const evolutionSnapshot = buildEvolutionSnapshot()
  const tasksByRequest = new Map(tasks.map((task) => [task.requestId, task]))
  const tasksById = new Map(tasks.map((task) => [task.id, task]))
  const requestsById = new Map(requests.map((request) => [request.id, request]))
  const eventsByRequest = {}

  for (const event of allEvents) {
    if (!event.requestId) continue
    if (!eventsByRequest[event.requestId]) eventsByRequest[event.requestId] = []
    eventsByRequest[event.requestId].push(event)
  }

  const requestItems = requests.map((request) =>
    buildRequestAttentionItem(request, tasksByRequest.get(request.id) || getTaskByRequestId(request.id), eventsByRequest, agentMap)
  )
  const cronItems = buildCronAttentionItems(agentMap)
  const staleItems = buildStaleAttentionItems()
  const evolutionItems = buildEvolutionAttentionItems({ snapshot: evolutionSnapshot })
  const attentionItems = syncAttentionItemsWithState(
    [...requestItems, ...cronItems, ...staleItems, ...evolutionItems],
    tasksById,
    requestsById,
    agentMap,
  ).sort((a, b) => {
    if ((b.unresolved ? 1 : 0) !== (a.unresolved ? 1 : 0)) {
      return (b.unresolved ? 1 : 0) - (a.unresolved ? 1 : 0)
    }
    if ((b.severity || 0) !== (a.severity || 0)) return (b.severity || 0) - (a.severity || 0)
    if ((b.commercialValue || 0) !== (a.commercialValue || 0)) {
      return (b.commercialValue || 0) - (a.commercialValue || 0)
    }
    return (b.updatedAt || 0) - (a.updatedAt || 0)
  })

  const unresolved = attentionItems.filter((item) => item.unresolved)
  const unresolvedCounts = {
    decision: unresolved.filter((item) => item.attentionType === ATTENTION_TYPES.DECISION).length,
    blocked: unresolved.filter((item) => item.attentionType === ATTENTION_TYPES.BLOCKED).length,
    risk: unresolved.filter((item) => item.attentionType === ATTENTION_TYPES.RISK).length,
    opportunity: unresolved.filter((item) => item.attentionType === ATTENTION_TYPES.OPPORTUNITY).length,
    digest_only: unresolved.filter((item) => item.attentionType === ATTENTION_TYPES.DIGEST_ONLY).length,
  }

  const requestsByAgent = {}
  for (const item of requestItems) {
    if (!requestsByAgent[item.agentId]) requestsByAgent[item.agentId] = []
    requestsByAgent[item.agentId].push(item)
  }
  for (const rows of Object.values(requestsByAgent)) {
    rows.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  }

  const evolutionByAgent = Object.fromEntries(
    (evolutionSnapshot.agentEvolutionStatus || []).map((entry) => [entry.agentId, entry]),
  )
  const agentSummaries = buildAgentSummaries(agents, attentionItems, requestsByAgent, evolutionByAgent)
  const bossInbox = getBossInboxConfig()
  const latestDailyDigest = normalizeDigestDeliveryState(skipDigest ? getLatestDailyDigest() : ensureDailyDigest(), bossInbox)
  const activeAgentSummaries = agentSummaries.filter((agent) => agent.activityState === 'active')
  const inactiveAgentSummaries = agentSummaries.filter((agent) => agent.activityState === 'inactive')
  const staleTaskThresholdMs = 24 * 60 * 60 * 1000
  const now = Date.now()
  const attentionActionHints = Object.fromEntries(
    attentionItems.map((item, index) => [
      item.id,
      {
        recommendedOwner: item.assignedOwner || defaultTargetAgentForAttention(item),
        suggestedAction: item.linkedTaskId ? (item.unresolved ? 'acknowledge' : 'reopen') : 'create_task',
        suggestedTargetAgent: defaultTargetAgentForAttention(item),
        priorityOrder: index + 1,
        shouldBlock: Boolean(item.attentionType === ATTENTION_TYPES.BLOCKED || item.attentionType === ATTENTION_TYPES.RISK),
      },
    ]),
  )
  const openAttentionWithStaleTask = attentionItems.filter((item) => (
    item.unresolved &&
    item.linkedTaskId &&
    !['completed', 'failed'].includes(String(item.linkedTaskStatus || '').toLowerCase()) &&
    (now - Number(item.linkedTaskUpdatedAt || item.lastSeenAt || item.updatedAt || 0) > staleTaskThresholdMs)
  )).length
  const governanceSummary = {
    escalatedSignalsCount: attentionItems.filter((item) => item.unresolved && item.source === 'evolution').length,
    actionableOpportunityCount: attentionItems.filter((item) => item.unresolved && item.attentionType === ATTENTION_TYPES.OPPORTUNITY).length,
    approvedNotAppliedCount: (evolutionSnapshot.candidatePatches || []).filter((item) => item.reviewStatus === 'approved' && item.applyStatus !== 'applied').length,
    openAttentionWithoutTask: attentionItems.filter((item) => item.unresolved && !item.linkedTaskId).length,
    openAttentionWithTask: attentionItems.filter((item) => item.unresolved && item.linkedTaskId).length,
    openWithStaleTask: openAttentionWithStaleTask,
    snoozedCount: attentionItems.filter((item) => !item.unresolved && item.status === ATTENTION_STATUS.OPEN && isAttentionSuppressed(item, now)).length,
    candidateNeedDryRun: (evolutionSnapshot.candidatePatches || []).filter((item) => item.evolutionStatus === 'needs_canary').length,
    candidateAutoEligible: (evolutionSnapshot.candidatePatches || []).filter((item) => item.autoApplyEligible).length,
    digestDeliveryStatus: latestDailyDigest?.deliveryStatus || 'pending',
  }

  return {
    generatedAt: Date.now(),
    attentionItems,
    agentSummaries,
    activeAgentSummaries,
    inactiveAgentSummaries,
    growthSignals: evolutionSnapshot.growthSignals || [],
    agentEvolutionStatus: evolutionSnapshot.agentEvolutionStatus || [],
    candidatePatches: evolutionSnapshot.candidatePatches || [],
    latestDailyDigest,
    unresolvedCounts,
    attentionActionHints,
    governanceSummary,
  }
}

export function getAttentionItemById(id) {
  const payload = buildBossInboxPayload({ skipDigest: true })
  return payload.attentionItems.find((item) => item.id === id) || null
}

export function runAttentionAction(id, {
  action,
  title,
  detail,
  targetAgent,
  note,
  owner,
  assignedOwner,
  closeReason,
  nextReviewAt,
  snoozedUntil,
  snoozeHours,
  reviewer = 'boss-inbox-ui',
} = {}) {
  const now = Date.now()
  const normalizedAction = String(action || '').toLowerCase()
  const item = getAttentionItemById(id)
  const existingState = getAttentionStateById(id)

  if (!item && !existingState) {
    return null
  }

  if (normalizedAction === 'create_task') {
    if (!item) {
      throw new Error('Attention item is no longer active; reopen it before creating a task.')
    }

    if (existingState?.linkedTaskId) {
      return {
        attentionItem: getAttentionItemById(id) || mergeAttentionItemWithState(item, existingState),
        linkedRequest: existingState.linkedRequestId ? getRequestById(existingState.linkedRequestId) : null,
        linkedTask: existingState.linkedTaskId ? getTaskById(existingState.linkedTaskId) : null,
      }
    }

    const { request, task } = createWorkflowTaskFromAttention(item, {
      title,
      detail,
      targetAgent,
      note,
    })

    upsertAttentionState({
      ...(existingState || toAttentionStateRow(item)),
      id,
      status: normalizeAttentionStatus(existingState?.status || ATTENTION_STATUS.OPEN),
      linkedRequestId: request.id,
      linkedTaskId: task.id,
      latestEventId: item.latestEventId || item.eventId || existingState?.latestEventId || null,
      signalCount: Number(existingState?.signalCount || item.signalCount || 1),
      signalScoreMax: Math.max(Number(existingState?.signalScoreMax || 0), attentionSignalScore(item)),
      categories: uniqueList([...(existingState?.categories || []), ...(item.categories || [])]),
      assignedOwner: existingState?.assignedOwner || request.assignedTo || targetAgent || item.agentId || null,
      snoozedUntil: null,
      nextReviewAt: null,
      firstSeenAt: existingState?.firstSeenAt || item.firstSeenAt || item.createdAt || Date.now(),
      lastSeenAt: Math.max(Number(existingState?.lastSeenAt || 0), Number(item.lastSeenAt || item.updatedAt || Date.now())),
      resolvedAt: existingState?.resolvedAt || null,
      closedReason: null,
      updatedAt: now,
    })

    return {
      attentionItem: getAttentionItemById(id),
      linkedRequest: request,
      linkedTask: task,
    }
  }

  if (normalizedAction === 'snooze') {
    const baseItem = item || {
      id,
      source: existingState?.source || 'attention-state',
      agentId: existingState?.agentId || null,
      attentionType: existingState?.attentionType || ATTENTION_TYPES.DIGEST_ONLY,
      createdAt: existingState?.firstSeenAt || now,
      updatedAt: existingState?.lastSeenAt || now,
      latestEventId: existingState?.latestEventId || null,
      signalCount: existingState?.signalCount || 1,
      signalScore: existingState?.signalScoreMax || 0,
      categories: existingState?.categories || [],
      unresolved: true,
    }
    const requestedUntil = toTimestampOrNull(snoozedUntil ?? nextReviewAt)
    const computedSnoozeHours = Number.isFinite(Number(snoozeHours)) ? Math.max(1, Number(snoozeHours)) : 24
    const nextSnoozedUntil = requestedUntil && requestedUntil > now
      ? requestedUntil
      : now + (computedSnoozeHours * 60 * 60 * 1000)
    const nextReview = toTimestampOrNull(nextReviewAt) || nextSnoozedUntil
    const savedState = upsertAttentionState({
      ...toAttentionStateRow(baseItem, existingState || null),
      status: ATTENTION_STATUS.OPEN,
      snoozedUntil: nextSnoozedUntil,
      nextReviewAt: nextReview,
      assignedOwner: (owner || assignedOwner || existingState?.assignedOwner || item?.assignedOwner || null),
      updatedAt: now,
    })
    return {
      attentionItem: item
        ? mergeAttentionItemWithState(item, savedState)
        : {
            id: savedState.id,
            source: savedState.source,
            agentId: savedState.agentId,
            attentionType: savedState.attentionType,
            status: savedState.status,
            signalCount: savedState.signalCount,
            signalScore: savedState.signalScoreMax,
            categories: savedState.categories,
            linkedRequestId: savedState.linkedRequestId,
            linkedTaskId: savedState.linkedTaskId,
            latestEventId: savedState.latestEventId,
            snoozedUntil: savedState.snoozedUntil,
            nextReviewAt: savedState.nextReviewAt,
            unresolved: false,
          },
      linkedRequest: savedState.linkedRequestId ? getRequestById(savedState.linkedRequestId) : null,
      linkedTask: savedState.linkedTaskId ? getTaskById(savedState.linkedTaskId) : null,
      note: note || null,
      reviewer,
    }
  }

  if (normalizedAction === 'set_owner') {
    const baseItem = item || {
      id,
      source: existingState?.source || 'attention-state',
      agentId: existingState?.agentId || null,
      attentionType: existingState?.attentionType || ATTENTION_TYPES.DIGEST_ONLY,
      createdAt: existingState?.firstSeenAt || now,
      updatedAt: existingState?.lastSeenAt || now,
      latestEventId: existingState?.latestEventId || null,
      signalCount: existingState?.signalCount || 1,
      signalScore: existingState?.signalScoreMax || 0,
      categories: existingState?.categories || [],
      unresolved: true,
    }
    const nextOwner = String(owner || assignedOwner || '').trim() || null
    const savedState = upsertAttentionState({
      ...toAttentionStateRow(baseItem, existingState || null),
      assignedOwner: nextOwner,
      updatedAt: now,
    })
    return {
      attentionItem: getAttentionItemById(id) || (item ? mergeAttentionItemWithState(item, savedState) : savedState),
      linkedRequest: savedState.linkedRequestId ? getRequestById(savedState.linkedRequestId) : null,
      linkedTask: savedState.linkedTaskId ? getTaskById(savedState.linkedTaskId) : null,
      note: note || null,
      reviewer,
    }
  }

  if (normalizedAction === 'set_next_review_at') {
    const baseItem = item || {
      id,
      source: existingState?.source || 'attention-state',
      agentId: existingState?.agentId || null,
      attentionType: existingState?.attentionType || ATTENTION_TYPES.DIGEST_ONLY,
      createdAt: existingState?.firstSeenAt || now,
      updatedAt: existingState?.lastSeenAt || now,
      latestEventId: existingState?.latestEventId || null,
      signalCount: existingState?.signalCount || 1,
      signalScore: existingState?.signalScoreMax || 0,
      categories: existingState?.categories || [],
      unresolved: true,
    }
    const requestedReviewAt = toTimestampOrNull(nextReviewAt)
    const nextReview = requestedReviewAt && requestedReviewAt > now ? requestedReviewAt : null
    const savedState = upsertAttentionState({
      ...toAttentionStateRow(baseItem, existingState || null),
      nextReviewAt: nextReview,
      snoozedUntil: nextReview,
      updatedAt: now,
    })
    return {
      attentionItem: getAttentionItemById(id) || (item ? mergeAttentionItemWithState(item, savedState) : savedState),
      linkedRequest: savedState.linkedRequestId ? getRequestById(savedState.linkedRequestId) : null,
      linkedTask: savedState.linkedTaskId ? getTaskById(savedState.linkedTaskId) : null,
      note: note || null,
      reviewer,
    }
  }

  const nextStatus = normalizedAction === 'acknowledge'
    ? ATTENTION_STATUS.ACKNOWLEDGED
    : normalizedAction === 'resolve'
      ? ATTENTION_STATUS.RESOLVED
      : normalizedAction === 'reopen'
        ? ATTENTION_STATUS.OPEN
        : null

  if (!nextStatus) {
    throw new Error('Unknown attention action')
  }

  const baseItem = item || {
    id,
    source: existingState?.source || 'attention-state',
    agentId: existingState?.agentId || null,
    attentionType: existingState?.attentionType || ATTENTION_TYPES.DIGEST_ONLY,
    createdAt: existingState?.firstSeenAt || Date.now(),
    updatedAt: existingState?.lastSeenAt || Date.now(),
    latestEventId: existingState?.latestEventId || null,
    signalCount: existingState?.signalCount || 1,
    signalScore: existingState?.signalScoreMax || 0,
    categories: existingState?.categories || [],
    unresolved: true,
  }

  const savedState = upsertAttentionState({
    ...toAttentionStateRow(baseItem, existingState || null),
    status: nextStatus,
    assignedOwner: owner || assignedOwner || existingState?.assignedOwner || null,
    linkedRequestId: existingState?.linkedRequestId || null,
    linkedTaskId: existingState?.linkedTaskId || null,
    resolvedAt: nextStatus === ATTENTION_STATUS.RESOLVED ? now : null,
    closedReason: nextStatus === ATTENTION_STATUS.RESOLVED
      ? (closeReason || note || existingState?.closedReason || null)
      : null,
    snoozedUntil: nextStatus === ATTENTION_STATUS.OPEN ? null : existingState?.snoozedUntil || null,
    nextReviewAt: nextStatus === ATTENTION_STATUS.OPEN ? null : existingState?.nextReviewAt || null,
    updatedAt: now,
  })

  return {
    attentionItem: item
      ? mergeAttentionItemWithState(item, savedState)
      : {
          id: savedState.id,
          source: savedState.source,
          agentId: savedState.agentId,
          attentionType: savedState.attentionType,
          status: savedState.status,
          signalCount: savedState.signalCount,
          signalScore: savedState.signalScoreMax,
          categories: savedState.categories,
          assignedOwner: savedState.assignedOwner,
          closedReason: savedState.closedReason,
          snoozedUntil: savedState.snoozedUntil,
          nextReviewAt: savedState.nextReviewAt,
          linkedRequestId: savedState.linkedRequestId,
          linkedTaskId: savedState.linkedTaskId,
          latestEventId: savedState.latestEventId,
          firstSeenAt: savedState.firstSeenAt,
          lastSeenAt: savedState.lastSeenAt,
          unresolved: savedState.status === ATTENTION_STATUS.OPEN && !isAttentionSuppressed(savedState, now),
        },
    linkedRequest: savedState.linkedRequestId ? getRequestById(savedState.linkedRequestId) : null,
    linkedTask: savedState.linkedTaskId ? getTaskById(savedState.linkedTaskId) : null,
    note: note || null,
    reviewer,
  }
}

export function recordAttentionTaskFeedback({
  taskId = null,
  requestId = null,
  taskResult = null,
  completionValue = null,
  didImprove = null,
  rollbackNeeded = null,
  reviewer = 'workflow-api',
  now = Date.now(),
} = {}) {
  const byTask = taskId ? listAttentionStatesByTaskId(taskId) : []
  const byRequest = requestId ? listAttentionStatesByRequestId(requestId) : []
  const uniqueStates = new Map([...byTask, ...byRequest].map((entry) => [entry.id, entry]))
  if (uniqueStates.size === 0) return []

  const updatedStates = []
  for (const state of uniqueStates.values()) {
    const shouldRollback = rollbackNeeded === null || rollbackNeeded === undefined
      ? Boolean(state.rollbackNeeded)
      : Boolean(rollbackNeeded)
    const nextStatus = shouldRollback ? ATTENTION_STATUS.OPEN : normalizeAttentionStatus(state.status)
    const saved = upsertAttentionState({
      ...state,
      status: nextStatus,
      taskResult: taskResult ?? state.taskResult ?? null,
      completionValue: toNumberOrNull(completionValue) ?? state.completionValue ?? null,
      didImprove: didImprove === null || didImprove === undefined ? Boolean(state.didImprove) : Boolean(didImprove),
      rollbackNeeded: shouldRollback,
      lastFeedbackAt: now,
      resolvedAt: shouldRollback ? null : state.resolvedAt,
      closedReason: shouldRollback ? `rollback-needed:${reviewer}` : state.closedReason,
      updatedAt: now,
    })
    updatedStates.push(saved)

    recordCandidatePatchOutcome({
      attentionState: saved,
      taskId: taskId || saved.linkedTaskId || null,
      requestId: requestId || saved.linkedRequestId || null,
      taskResult,
      completionValue,
      didImprove,
      rollbackNeeded: shouldRollback,
      reviewer,
      now,
    })
  }

  const payload = buildBossInboxPayload({ skipDigest: true })
  return updatedStates.map((state) => payload.attentionItems.find((item) => item.id === state.id)).filter(Boolean)
}

export function ensureDailyDigest({ force = false } = {}) {
  const today = localDateKey()
  const existing = getDailyDigestByDate(today)
  if (existing && existing.deliveredAt && !force) {
    return normalizeDigestDeliveryState(existing)
  }

  const payload = buildBossInboxPayload({ skipDigest: true })
  const summary = buildDailyDigestSummary(payload, today)
  const digest = upsertDailyDigest({
    date: today,
    generatedAt: Date.now(),
    content: renderDigest(summary, today),
    summary,
    deliveredAt: existing?.deliveredAt || null,
    deliveryStatus: existing?.deliveryStatus || summary.deliveryStatus || null,
    target: existing?.target || getBossInboxConfig().discordTarget || null,
  })
  return normalizeDigestDeliveryState(getDailyDigestByDate(today) || digest)
}

export async function maybeSendImmediateAttention(requestId) {
  const request = getRequestById(requestId)
  if (!request || request.state === 'completed' || request.attentionNotifiedAt) return null

  const item = buildRequestAttentionItem(
    request,
    getTaskByRequestId(request.id),
    Object.fromEntries([[request.id, getEventsByRequest(request.id)]]),
    getAgentsMap(),
  )
  const bossInbox = getBossInboxConfig()
  const immediateTypes = new Set(
    Array.isArray(bossInbox.immediateTypes) && bossInbox.immediateTypes.length > 0
      ? bossInbox.immediateTypes
      : [ATTENTION_TYPES.BLOCKED, ATTENTION_TYPES.RISK, ATTENTION_TYPES.OPPORTUNITY],
  )
  if (!immediateTypes.has(item.attentionType)) return null

  if (!bossInbox.deliveryEnabled || !bossInbox.discordTarget) return item

  const message = [
    `🚨 ${item.agentEmoji} ${item.agentName} / ${item.attentionType.toUpperCase()}`,
    item.title,
    item.detail,
  ].filter(Boolean).join('\n')

  const sent = await sendDiscordMessage({
    target: bossInbox.discordTarget,
    message,
    silent: false,
  })
  if (sent.ok) {
    updateRequest(request.id, { attentionNotifiedAt: Date.now() })
  }
  return item
}

export async function maybeDeliverDailyDigest(existingDigest = null) {
  const bossInbox = getBossInboxConfig()
  const digest = normalizeDigestDeliveryState(existingDigest || getDailyDigestByDate(localDateKey()), bossInbox)
  if (!digest) return null
  if (digest.deliveredAt || !bossInbox.deliveryEnabled) return digest
  if (!bossInbox.discordTarget) {
    return upsertDailyDigest({
      ...digest,
      deliveredAt: null,
      deliveryStatus: 'not-configured',
      target: null,
    })
  }

  const currentHour = new Date().getHours()
  if (currentHour < Number(bossInbox.digestHourLocal || 18)) {
    if (digest.deliveryStatus !== 'pending') {
      return upsertDailyDigest({
        ...digest,
        deliveryStatus: 'pending',
        target: bossInbox.discordTarget,
      })
    }
    return digest
  }

  const sent = await sendDiscordMessage({
    target: bossInbox.discordTarget,
    message: digest.content,
    silent: true,
  })

  return upsertDailyDigest({
    ...digest,
    deliveredAt: sent.ok ? Date.now() : null,
    deliveryStatus: sent.ok ? 'delivered' : `error:${sent.error || 'unknown'}`,
    target: bossInbox.discordTarget,
  })
}

export function runBossInboxNightlyEvolution() {
  return runNightlyEvolutionPromotion()
}
