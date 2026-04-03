// Workflow API for OpenClaw Office
// Refactored to task-driven architecture
// Request = incoming message record (immutable after creation)
// Task = work unit with independent lifecycle (pending → assigned → in_progress → completed/failed)

import { analyzeTask, AGENTS, STATE_CONFIG } from '../../../lib/workflow.js'
import { sendTelegramNotification, formatDelegationNotification } from '../../../lib/telegram.js'
import {
  createRequest, 
  updateRequest, 
  getRequestById, 
  getRequests, 
  addEvent, 
  getEvents,
  getEventsPaginated,
  incrementMessages,
  addTokens,
  recordTaskCompletion,
  findOldestReceived,
  findByTgMessageId,
  findLastCompletedInChain,
  completeAllActive,
  fixPlaceholderEvents,
  repairAllPlaceholderEvents,
  createTask,
  ensurePrimaryTask,
  updateTask,
  getTaskById,
  getTaskByRequestId,
  getActiveTaskByAgent,
  getActiveTasks,
  getRecentTasks,
  getChildTasks,
  completeAllActiveTasks,
  listLobsterRules,
  upsertLobsterRule,
} from '../../../lib/db.js'
import { eventBus, EVENTS } from '../../../lib/event-bus.js'
import { recordAttentionTaskFeedback } from '../../../lib/boss-inbox.js'
import { assertOfficeApiRequest, getOfficeRequestErrorStatus } from '../../../lib/office-route-auth.js'
import { gatewayCall } from '../../../lib/gateway-rpc.js'
import { getAgentsMap, resolveAgentId } from '../../../lib/config.js'
import { pickAutonomousWorkerAgent } from '../../../lib/autonomous-handoff.js'
import {
  buildWorkflowSidecarSessionKey,
  resolveWorkflowDispatchSessionKey,
} from '../../../lib/dispatch-session-key.js'
import {
  DEFAULT_OFFICE_INTERNAL_BASE_URL,
  extractTaskVerificationUrl,
  hasGstackBrowseBinary,
  isGstackBrowseAgent,
  spawnDetachedGstackTask,
} from '../../../lib/gstack-task-runner.js'

function timeStr() {
  return new Date().toLocaleTimeString('en-US', { 
    hour: '2-digit', 
    minute: '2-digit',
    second: '2-digit',
    hour12: false 
  })
}

function createEvent(requestId, state, agent, message, extra = {}) {
  if (requestId && !getRequestById(requestId)) return null

  const event = {
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    requestId,
    state,
    agent,
    agentColor: AGENTS[agent]?.color || '#888',
    agentName: AGENTS[agent]?.name || agent,
    message,
    time: timeStr(),
    timestamp: Date.now(),
    ...extra,
  }
  addEvent(event)
  eventBus.emit(EVENTS.WORKFLOW_EVENT, event)
  return event
}

const WORKFLOW_SYNC_MODE = process.env.OPENCLAW_WORKFLOW_SYNC === '1'

async function runPendingAction(task, now, logLabel) {
  if (!task) return null
  if (isTestLikeRuntime()) return task
  if (WORKFLOW_SYNC_MODE) return executePendingAction(task, now)
  void executePendingAction(task, now).catch((error) => {
    console.error(`[workflow] ${logLabel} failed:`, error?.message || error)
  })
  return task
}

function isPrimaryTask(task) {
  return !task?.taskType || task.taskType === 'primary'
}

function isChildTask(task) {
  return Boolean(task?.taskType) && task.taskType !== 'primary'
}

function emitRequestUpdate(requestId) {
  const req = getRequestById(requestId)
  if (req) {
    eventBus.emit(EVENTS.REQUEST_UPDATE, req)
  }
}

function emitTaskUpdate(taskId) {
  const task = getTaskById(taskId)
  if (task) {
    eventBus.emit(EVENTS.TASK_UPDATE, task)
    // Also emit request update for backward compat (syncs request state from task)
    if (task.requestId) {
      syncRequestStateFromTask(task)
      emitRequestUpdate(task.requestId)
    }
  }
}

function taskProgressMeta(status, body = {}, task = null) {
  const now = Date.now()
  if (status === 'assigned') {
    return {
      milestone: '已指派',
      nextStep: '等待代理開始處理',
      continuationRequired: true,
      pendingAction: 'start_work',
      continuationCheckedAt: null,
      lastUpdate: now,
      ...buildTaskBrainPatch(task, {
        mode: 'queued',
        focus: '等待代理正式接手',
        summary: '任務已建立，等待代理開始處理。',
        openLoops: ['等待代理開始處理'],
        nextCheckpoint: '代理回報第一個里程碑',
        delegation: {
          currentStatus: 'queued',
          nextHandoff: '代理開始處理後回報第一個里程碑',
          notes: '允許在任務需要時再加 reviewer / subagent。',
        },
      }, now),
    }
  }
  if (status === 'in_progress') {
    return {
      milestone: '執行中',
      nextStep: '持續處理與回報里程碑',
      continuationRequired: false,
      pendingAction: null,
      continuationCheckedAt: null,
      completionGateRequired: true,
      lastUpdate: now,
      ...buildTaskBrainPatch(task, {
        mode: 'execution',
        focus: '持續處理與驗證',
        summary: '代理已正式接手任務並進入自主執行。',
        openLoops: ['等待下一個可交付里程碑'],
        nextCheckpoint: '更新目前里程碑或回報完成結果',
        delegation: {
          currentStatus: 'running',
        },
      }, now),
    }
  }
  if (status === 'completed') {
    return {
      milestone: '已完成',
      nextStep: '等待你查看結果',
      continuationRequired: false,
      pendingAction: null,
      continuationCheckedAt: now,
      lastUpdate: now,
      ...buildTaskBrainPatch(task, {
        mode: 'review',
        focus: '等待人工驗收交付',
        summary: '任務已收斂到可交付結果，等待你查看。',
        openLoops: [],
        nextCheckpoint: '查看結果並決定是否追問或放行',
        delegation: {
          currentStatus: 'idle',
        },
      }, now),
    }
  }
  if (status === 'failed') {
    return {
      milestone: '已卡住',
      nextStep: '等待人工介入或改走替代方案',
      continuationRequired: false,
      pendingAction: null,
      continuationCheckedAt: now,
      lastUpdate: now,
      ...buildTaskBrainPatch(task, {
        mode: 'blocked',
        focus: '確認根因與替代方案',
        summary: '任務目前卡住，需要確認根因或改道。',
        blockers: ['任務未能順利完成，待確認根因'],
        nextCheckpoint: '補上根因與替代方案，再決定是否續跑',
        delegation: {
          currentStatus: 'blocked',
        },
      }, now),
    }
  }
  return {
    milestone: body.milestone || null,
    nextStep: body.nextStep || null,
    lastUpdate: now,
  }
}

async function notifyTaskMilestone(task, status) {
  if (!task) return
  const agentName = AGENTS[task.assignedAgent]?.name || task.assignedAgent || '代理'
  const title = cleanContent(task.title || task.detail || task.requestId || task.id || '任務')
  const summary = title.length > 60 ? `${title.slice(0, 60)}...` : title
  let message = null

  if (status === 'in_progress') {
    message = `🧩 <b>任務開始</b>\n• ${agentName}\n• ${escapeHtml(summary)}`
  } else if (status === 'completed') {
    message = `✅ <b>任務完成</b>\n• ${agentName}\n• ${escapeHtml(summary)}`
  } else if (status === 'failed') {
    message = `⚠️ <b>任務卡住</b>\n• ${agentName}\n• ${escapeHtml(summary)}`
  } else if (status === 'stale') {
    message = `⏰ <b>任務久未更新</b>\n• ${agentName}\n• ${escapeHtml(summary)}`
  } else if (status === 'continued') {
    message = `🔁 <b>任務續跑</b>\n• ${agentName}\n• ${escapeHtml(summary)}`
  } else if (status === 'blocked' || status === 'human_gate') {
    const reason = task.humanGateReason || task.blockerReason || '已達決策點'
    const shortReason = reason.length > 80 ? `${reason.slice(0, 77)}...` : reason
    message = `🛑 <b>需要你決定</b>\n• ${agentName}\n• ${escapeHtml(summary)}\n• ${escapeHtml(shortReason)}\n\n→ 到看板放行或給指示：https://copilot.bw-space.com/office/openclaw`
  }

  if (message) {
    try {
      await sendTelegramNotification(message)
    } catch (error) {
      console.error('[workflow] milestone notify failed:', error.message)
    }
  }
}

function needsContinuationFromText(text = '') {
  const normalized = String(text || '').trim()
  if (!normalized) return false
  return /(還沒做|還未做|下一步|還剩|可再補|接著做|繼續做|後續再做|待處理|待補|之後處理)/.test(normalized)
}

function hasConsultantStopSignal(text = '') {
  const normalized = String(text || '').trim()
  if (!normalized) return false
  return /(如果你要|如果需要|要不要我幫你|要不要我|建議下一步|建議是下一步|我下一則就|我可以下一步|我可以再幫你)/.test(normalized)
}

function needsRootCauseFollowup({ success = true, body = {}, task = null } = {}) {
  if (success) return false
  if (body?.stopAfterFailure === true || body?.noFollowup === true) return false

  const rootCause = sanitizeTextValue(body?.rootCause || body?.root_cause || task?.rootCause)
  const blockers = toStringArray(body?.blockers)
  const openLoops = toStringArray(body?.openLoops)
  const summary = sanitizeTextValue(body?.summary)
  const nextStep = sanitizeTextValue(body?.nextStep || body?.next_step)
  const followupSignal = [summary, nextStep, ...blockers, ...openLoops].filter(Boolean).join('\n')

  if (!rootCause) return true
  if (blockers.length > 0 || openLoops.length > 0) return true
  return /(待查|待釐清|待確認|需要調查|需要驗證|需要複盤|追根究底|根因|再跑一次|替代方案)/.test(followupSignal)
}

function buildTaskSessionKey(task) {
  return resolveWorkflowDispatchSessionKey(task)
}

function buildTaskDispatchMessage(task, { continuation = false } = {}) {
  const title = cleanContent(task?.title || task?.detail || task?.id || '未命名任務')
  const detail = cleanContent(task?.detail || '')
  const milestone = cleanContent(task?.milestone || '')
  const nextStep = cleanContent(task?.nextStep || '')
  const brain = normalizeBrainState(task?.brainState || {})
  const delegation = normalizeDelegationPlan(task?.delegationPlan || {}, task)
  const suggestedSubagents = delegation.suggestedSubagents.filter(Boolean)
  const rootCause = cleanContent(task?.rootCause || '')
  const evolutionNote = cleanContent(task?.evolutionNote || '')
  const researchOperator = isResearchOperatorTask(task)
  const lines = [
    '你現在是在 OpenClaw Office 的正式任務執行流程中。',
    continuation
      ? '這是一個 continuation。請依上一輪回報與未完成項目直接續跑，不要停在整理建議。'
      : '請直接開工並盡量自主完成交辦事項，不要只停在規劃或諮詢。',
    isChildTask(task) ? `子任務 taskId：${task?.id || 'unknown'}` : null,
    task?.requestId ? `對應 requestId：${task.requestId}` : null,
    task?.parentTaskId ? `parentTaskId：${task.parentTaskId}` : null,
    `任務標題：${title}`,
    detail && detail !== title ? `任務內容：${detail}` : null,
    milestone ? `目前里程碑：${milestone}` : null,
    nextStep ? `目前下一步：${nextStep}` : null,
    brain.objective ? `龍蝦記憶 / 目標：${brain.objective}` : null,
    brain.focus ? `龍蝦記憶 / 焦點：${brain.focus}` : null,
    brain.summary ? `龍蝦記憶 / 摘要：${brain.summary}` : null,
    brain.nextCheckpoint ? `龍蝦記憶 / 下一檢查點：${brain.nextCheckpoint}` : null,
    rootCause ? `目前已知根因：${rootCause}` : null,
    brain.blockers.length ? `目前 blockers：${brain.blockers.join(' / ')}` : null,
    brain.openLoops.length ? `目前 open loops：${brain.openLoops.join(' / ')}` : null,
    delegation.reviewerMode ? `建議 reviewer 模式：${delegation.reviewerMode}` : null,
    suggestedSubagents.length ? `建議優先使用的 subagents / reviewer：${suggestedSubagents.join(' / ')}` : null,
    delegation.nextHandoff ? `委派交接點：${delegation.nextHandoff}` : null,
    evolutionNote ? `最近演化備註：${evolutionNote}` : null,
    researchOperator ? '研究魚 strict operator 規則：不要回「如果你要 / 要不要我幫你 / 建議下一步」。低風險項目請直接續跑、派工、驗證。' : null,
    researchOperator ? '研究魚對外輸出只允許三種：已交辦 ACK、里程碑進度、完成/阻塞報告。' : null,
    '執行要求：',
    '1. 追到根因，不要只做表面修補。',
    '2. 能安全落地的就直接落地，只有高風險、不可逆、或需要老闆決策的項目才停下。',
    '3. 如需要專長或平行驗證，優先自行使用可用的 subagent / reviewer 能力，不要把任務丟回來等指示。',
    '4. 發現可安全吸收成規則、自動化、檢查點、或 guardrail 的改進時，順手提出或實作。',
    '5. 回報完成或卡住時，請一併提供：summary、nextStep、rootCause、blockers、openLoops、delegation.suggestedSubagents、evolutionNote。',
    researchOperator ? '6. 若這輪研究已收斂出後續 owner，請直接建立或推進 downstream child tasks，不要停在建議文字。' : null,
    continuation
      ? '7. 請把這個任務收斂到新的可交付結果，並延續既有 session 脈絡。'
      : '7. 請從現在開始一路推進到可交付結果。',
  ]
  return lines.filter(Boolean).join('\n\n')
}

function buildSidecarSessionKey(task, sidecarAgentId) {
  return buildWorkflowSidecarSessionKey(task, sidecarAgentId)
}

function buildSidecarDispatchMessage(task, sidecarAgentId, { reason = 'continuation-review' } = {}) {
  const title = cleanContent(task?.title || task?.detail || task?.id || '未命名任務')
  const detail = cleanContent(task?.detail || '')
  const brain = normalizeBrainState(task?.brainState || {})
  const delegation = normalizeDelegationPlan(task?.delegationPlan || {}, task)
  const primaryAgent = AGENTS[task?.assignedAgent] || null
  const sidecarAgent = AGENTS[sidecarAgentId] || null

  return [
    '你現在是 OpenClaw Office 主任務的 sidecar reviewer / subagent。',
    '這不是接管主任務；你的角色是提供 outside voice、平行驗證或根因分析，幫主任務代理更快收斂。',
    `主任務 taskId：${task?.id || 'unknown'}`,
    task?.requestId ? `對應 requestId：${task.requestId}` : null,
    `主任務代理：${primaryAgent?.name || task?.assignedAgent || '未指派'} (${task?.assignedAgent || 'unknown'})`,
    `本輪 sidecar：${sidecarAgent?.name || sidecarAgentId} (${sidecarAgentId})`,
    `sidecar 目的：${reason === 'root-cause' ? '追根因與替代方案' : reason === 'stale-review' ? '久未更新時的 outside voice / 催收斂' : '平行驗證與補位 review'}`,
    `任務標題：${title}`,
    detail && detail !== title ? `任務內容：${detail}` : null,
    brain.summary ? `目前摘要：${brain.summary}` : null,
    brain.focus ? `目前焦點：${brain.focus}` : null,
    brain.nextCheckpoint ? `下一檢查點：${brain.nextCheckpoint}` : null,
    task?.rootCause ? `已知根因：${task.rootCause}` : null,
    brain.blockers.length ? `目前 blockers：${brain.blockers.join(' / ')}` : null,
    brain.openLoops.length ? `目前 open loops：${brain.openLoops.join(' / ')}` : null,
    delegation.reviewerMode ? `預期 reviewer 模式：${delegation.reviewerMode}` : null,
    '請用你的專長做一輪聚焦協作：',
    '1. 指出最可能的根因、風險或盲點。',
    '2. 提供 1-3 個最值得優先驗證的切面或修正方向。',
    '3. 若你能在自己的範圍內直接完成一小段驗證，請直接做，不要只給抽象建議。',
    '4. 回報時請保留這些欄位：summary、rootCause、blockers、openLoops、evolutionNote。',
    '5. 回報時請沿用同一個 sidecar 完成回呼，不要自開新主任務；你的結果會被併回原 task。',
    '6. 如果你有能力額外回寫 OpenClaw Office 任務記憶，請攜帶 taskId/requestId 補進同一題，不要另開平行主線。',
  ].filter(Boolean).join('\n\n')
}

function pickSidecarAgents(task, { reason = 'continuation-review', now = Date.now() } = {}) {
  const agents = getAgentsMap()
  const delegation = normalizeDelegationPlan(task?.delegationPlan || {}, task, now)
  const recent = new Map(
    (delegation.sidecarDispatches || []).map((dispatch) => [dispatch.agentId, dispatch]),
  )

  const explicit = mergeStringArray([], delegation.suggestedSubagents)
    .map((agentId) => resolveAgentId(agentId))
    .filter((agentId) => agentId && agentId !== task?.assignedAgent && agents[agentId])
    .filter((agentId) => {
      const dispatch = recent.get(agentId)
      if (!dispatch) return true
      const updatedAt = Number(dispatch.updatedAt || dispatch.dispatchedAt || 0)
      return !updatedAt || now - updatedAt > SIDECAR_REDISPATCH_WINDOW_MS
    })

  if (explicit.length > 0) return explicit.slice(0, 2)

  if (reason === 'start-review') return []

  const defaults = []
  if (task?.assignedAgent !== 'analyst' && agents.analyst) defaults.push('analyst')
  if (task?.assignedAgent !== 'qa' && agents.qa) defaults.push('qa')
  if (reason === 'root-cause' && task?.assignedAgent !== 'memory-distiller' && agents['memory-distiller']) {
    defaults.push('memory-distiller')
  }

  return defaults
    .filter((agentId) => {
      const dispatch = recent.get(agentId)
      if (!dispatch) return true
      const updatedAt = Number(dispatch.updatedAt || dispatch.dispatchedAt || 0)
      return !updatedAt || now - updatedAt > SIDECAR_REDISPATCH_WINDOW_MS
    })
    .slice(0, 2)
}

async function dispatchSidecarReviewers(task, { reason = 'continuation-review', now = Date.now() } = {}) {
  if (!task?.id) return task
  if (!isPrimaryTask(task)) return task

  // 防重複派送守護：若此 task 的 sidecarDispatches 已有任何 completed/failed（含 auto-closed）記錄
  // 代表 reviewer 已嘗試過，無論結果如何都不再重派，避免無限循環
  const pastDispatches = (task.delegationPlan?.sidecarDispatches || [])
  const alreadyAttempted = pastDispatches.some(
    (d) => d.status === 'completed' || d.status === 'failed'
  )
  if (alreadyAttempted) {
    console.log(`[dispatchSidecarReviewers] skip re-dispatch for ${task.id}: alreadyAttempted=true (${pastDispatches.length} past dispatches)`)
    return task
  }

  const delegation = normalizeDelegationPlan(task?.delegationPlan || {}, task, now)
  if (delegation.allowSubagents === false) return task

  const sidecarAgents = pickSidecarAgents(task, { reason, now })
  if (sidecarAgents.length === 0) return task


  const existingChildren = getChildTasks(task.id, 100)
  const sidecarDispatches = []
  const evidence = []
  const failures = []

  for (const sidecarAgentId of sidecarAgents) {
    const sessionKey = buildSidecarSessionKey(task, sidecarAgentId)
    const message = buildSidecarDispatchMessage(task, sidecarAgentId, { reason })
    const idempotencyKey = crypto.randomUUID()
    const seed = buildSidecarTaskSeed(task, sidecarAgentId, { reason, now })
    let childTask = existingChildren.find((entry) => (
      entry.assignedAgent === sidecarAgentId
      && entry.taskType === 'sidecar_review'
      && !['completed', 'failed'].includes(String(entry.status || '').toLowerCase())
    )) || null

    if (!childTask) {
      childTask = createTask(seed)
      existingChildren.push(childTask)
    } else {
      childTask = updateTask(childTask.id, {
        ...seed,
        createdAt: childTask.createdAt,
        status: 'assigned',
        completedAt: null,
        result: null,
        closedByParent: false,
        resolutionSource: null,
      }) || childTask
    }
    emitTaskUpdate(childTask.id)

    try {
      const accepted = await gatewayCall(
        'chat.send',
        {
          sessionKey,
          message,
          deliver: false,
          idempotencyKey,
        },
        30000,
      )

      const runId = String(accepted?.runId || idempotencyKey)
      childTask = updateTask(childTask.id, {
        status: 'in_progress',
        startedAt: childTask.startedAt || now,
        dispatchSessionKey: sessionKey,
        dispatchRunId: runId,
        completedAt: null,
        result: null,
        closedByParent: false,
        resolutionSource: null,
        lastUpdate: now,
        ...buildTaskMemoryPatchFromBody(childTask, {}, {
          mode: 'execution',
          focus: reason === 'root-cause' ? '追根因與替代方案' : '提供 reviewer / outside voice',
          summary: `${AGENTS[sidecarAgentId]?.name || sidecarAgentId} 已收到 sidecar 任務。`,
          nextCheckpoint: '回報 sidecar 結果並回流主任務',
          openLoops: ['等待 sidecar reviewer 回報'],
          evidence: [`sidecar dispatched ${runId}`],
          delegation: {
            currentStatus: 'running',
            reviewerMode: reason,
            sessionKey,
            runId,
            nextHandoff: '回報 sidecar 結果給主任務',
            notes: '正式 child task 已派送成功。',
          },
          updatedBy: 'workflow-sidecar-dispatcher',
        }, now),
      }) || childTask
      emitTaskUpdate(childTask.id)

      sidecarDispatches.push({
        agentId: sidecarAgentId,
        taskId: childTask.id,
        purpose: reason,
        status: 'dispatched',
        sessionKey,
        runId,
        dispatchedAt: now,
        updatedAt: now,
        notes: 'sidecar reviewer 已收到任務',
      })
      evidence.push(`sidecar ${sidecarAgentId} dispatched ${runId}`)
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error)
      childTask = updateTask(childTask.id, {
        status: 'failed',
        completedAt: now,
        result: messageText,
        resolutionSource: 'dispatch_failed',
        closedByParent: false,
        lastUpdate: now,
        ...buildTaskMemoryPatchFromBody(childTask, {}, {
          mode: 'blocked',
          focus: 'sidecar 派送失敗，等待下一輪重試或人工介入',
          summary: 'sidecar reviewer 尚未成功收到任務。',
          nextCheckpoint: '等待下一次 sidecar 派送成功',
          blockers: [messageText],
          openLoops: ['等待 sidecar 派送成功'],
          evidence: [`sidecar dispatch error: ${messageText}`],
          rootCause: messageText,
          delegation: {
            currentStatus: 'dispatch_failed',
            reviewerMode: reason,
            nextHandoff: '等待下一輪重派或主任務改道',
            notes: messageText,
          },
          updatedBy: 'workflow-sidecar-dispatcher',
        }, now),
      }) || childTask
      emitTaskUpdate(childTask.id)

      sidecarDispatches.push({
        agentId: sidecarAgentId,
        taskId: childTask.id,
        purpose: reason,
        status: 'dispatch_failed',
        sessionKey,
        dispatchedAt: now,
        updatedAt: now,
        notes: messageText,
      })
      failures.push(`${sidecarAgentId}: ${messageText}`)
    }
  }

  const patched = updateTask(task.id, {
    ...buildTaskBrainPatch(task, {
      evidence,
      delegation: {
        currentStatus: task?.delegationPlan?.currentStatus
          || (failures.length === sidecarDispatches.length ? 'dispatch_failed' : 'running'),
        sidecarDispatches,
        lastSuggestedDispatchAt: now,
        notes: failures.length > 0
          ? `sidecar reviewer 部分派送失敗：${failures.join(' / ')}`
          : `sidecar reviewer 已派送：${sidecarAgents.join(' / ')}`,
      },
      updatedBy: 'workflow-sidecar-dispatcher',
    }, now),
    lastUpdate: now,
  })

  if (task.requestId) {
    const agentLabels = sidecarAgents.map((agentId) => AGENTS[agentId]?.name || agentId).join(' / ')
    createEvent(
      task.requestId,
      'in_progress',
      task.assignedAgent || 'wickedman',
      `🪝 已叫進 sidecar reviewer：${agentLabels}${reason === 'root-cause' ? ' / 追根因模式' : ''}`,
    )
  }

  emitTaskUpdate(task.id)
  return patched || getTaskById(task.id)
}

function findActiveTaskBySidecarAgent(agentId, limit = 100) {
  const resolvedAgentId = resolveAgentId(agentId)
  if (!resolvedAgentId) return null

  const directChild = getActiveTasks(limit).find((task) => (
    task
    && task.assignedAgent === resolvedAgentId
    && task.taskType === 'sidecar_review'
  ))
  if (directChild) return directChild

  return getActiveTasks(limit).find((task) => {
    if (!task || !isPrimaryTask(task) || task.assignedAgent === resolvedAgentId) return false
    const delegation = normalizeDelegationPlan(task.delegationPlan || {}, task)
    return (delegation.sidecarDispatches || []).some((dispatch) => dispatch.agentId === resolvedAgentId)
  }) || null
}

async function handleSidecarCompletion(task, { agent, result, success = true, body = {}, completedAt = Date.now() } = {}) {
  if (!task?.id) return null

  const isFormalChildTask = isChildTask(task) && Boolean(task.parentTaskId)
  const parentTask = isFormalChildTask ? getTaskById(task.parentTaskId) : task
  if (!parentTask?.id) return null

  const resolvedAgentId = resolveAgentId(agent)
  const agentMeta = AGENTS[resolvedAgentId] || {}
  const agentName = agentMeta?.name || resolvedAgentId || agent || 'sidecar reviewer'
  const completionResult = result || (success ? 'Completed' : 'Failed')
  const blockers = toStringArray(body?.blockers)
  const openLoops = toStringArray(body?.openLoops)
  const rootCause = sanitizeTextValue(body?.rootCause || body?.root_cause)
  const summary = sanitizeTextValue(body?.summary)
  const nextStep = sanitizeTextValue(body?.nextStep || body?.next_step)
  const normalizedReviewerResults = normalizeReviewerResults(
    body?.reviewerResults,
    {
      sourceTaskId: task.id,
      sourceTaskType: task.taskType,
      sourceAgent: resolvedAgentId || task.assignedAgent,
      sourceKind: String(task.assignedAgent || '').startsWith('gstack') || task.sourceAgent === 'gstack' ? 'gstack' : 'local',
      mergePolicy: task.mergePolicy || 'advisory',
      summary: summary || completionResult,
      rootCause,
      blockers,
      openLoops,
      evidence: body?.evidence || [completionResult],
      findingType: task.taskType === 'verifier'
        ? 'verification'
        : (rootCause ? 'root_cause' : (blockers.length > 0 ? 'risk' : 'advisory')),
      severity: success
        ? (blockers.length > 0 ? 'warning' : 'info')
        : (task.mergePolicy === 'blocking_review' || task.taskType === 'verifier' ? 'blocking' : 'warning'),
      recommendedAction: body?.recommendedAction || nextStep || (success ? 'continue' : 'investigate_root_cause'),
      supportsRootCause: Boolean(rootCause),
      requiresHumanApproval: normalizeRiskTier(parentTask.riskTier || inferRiskTierFromTask(parentTask)) === 'irreversible',
      confidence: body?.confidence,
      createdAt: completedAt,
    },
  )
  const shouldWakePrimary = parentTask.status === 'in_progress' && (
    parentTask.continuationRequired
    || parentTask.pendingAction === 'continue_after_reply'
    || Boolean(rootCause)
    || blockers.length > 0
    || openLoops.length > 0
    || Boolean(nextStep)
    || normalizedReviewerResults.length > 0
  )

  let updatedChildTask = task
  if (isFormalChildTask) {
    updatedChildTask = updateTask(task.id, {
      status: success ? 'completed' : 'failed',
      completedAt,
      result: completionResult,
      closedByParent: false,
      resolutionSource: 'self',
      continuationRequired: false,
      pendingAction: null,
      completionGateRequired: false,
      reviewerResults: normalizedReviewerResults,
      lastUpdate: completedAt,
      ...buildTaskMemoryPatchFromBody(task, body, {
        mode: success ? 'review' : 'blocked',
        focus: success ? 'child task 已完成並等待主任務吸收' : 'child task 回報失敗或卡住',
        summary: summary || (success ? 'sidecar reviewer 已回報結果。' : 'sidecar reviewer 回報失敗。'),
        nextCheckpoint: shouldWakePrimary ? '主任務吸收結果後續跑' : '等待主任務查看',
        blockers,
        openLoops,
        evidence: [`sidecar ${resolvedAgentId} ${success ? 'completed' : 'failed'}: ${completionResult}`],
        rootCause: rootCause || task.rootCause || null,
        evolutionNote: body?.evolutionNote || task.evolutionNote,
        delegation: {
          currentStatus: success ? 'idle' : 'blocked',
          reviewerMode: task.delegationPlan?.reviewerMode || task.mergePolicy || 'sidecar-review',
          nextHandoff: '結果已回流主任務',
          notes: `${agentName} 已完成 sidecar child task。`,
        },
        updatedBy: `sidecar:${resolvedAgentId}`,
      }, completedAt),
    }) || task
    emitTaskUpdate(updatedChildTask.id)
  }

  const mergedReviewerResults = mergeReviewerResults(parentTask.reviewerResults || [], normalizedReviewerResults)
  const patched = updateTask(parentTask.id, {
    reviewerResults: mergedReviewerResults,
    ...buildTaskBrainPatch(parentTask, {
      knownFacts: summary ? [`${agentName}：${summary}`] : [],
      blockers,
      openLoops,
      evidence: [`sidecar ${resolvedAgentId} ${success ? 'completed' : 'failed'}: ${completionResult}`],
      rootCause: rootCause || parentTask.rootCause,
      evolutionNote: body?.evolutionNote || parentTask.evolutionNote,
      delegation: {
        currentStatus: parentTask.delegationPlan?.currentStatus || parentTask.status || 'in_progress',
        sidecarDispatches: [{
          agentId: resolvedAgentId,
          taskId: updatedChildTask?.id || task.id,
          purpose: 'sidecar-review',
          status: success ? 'completed' : 'failed',
          updatedAt: completedAt,
          notes: summary || completionResult,
        }],
        notes: `${agentName} 已回報 sidecar 結果`,
      },
      updatedBy: `sidecar:${resolvedAgentId}`,
    }, completedAt),
    lastUpdate: completedAt,
    nextStep: shouldWakePrimary
      ? (nextStep || '吸收 sidecar reviewer 結果後續跑')
      : (parentTask.nextStep || nextStep || null),
    continuationRequired: shouldWakePrimary ? true : parentTask.continuationRequired,
    pendingAction: shouldWakePrimary ? 'continue_after_reply' : parentTask.pendingAction,
    continuationCheckedAt: shouldWakePrimary ? null : parentTask.continuationCheckedAt,
    completionGateRequired: shouldWakePrimary ? false : parentTask.completionGateRequired,
  })

  if (parentTask.requestId) {
    createEvent(
      parentTask.requestId,
      'in_progress',
      resolvedAgentId,
      `🧠 ${agentName} 已回報 sidecar reviewer 結果${summary ? `：${summary}` : ''}`,
    )
  }

  emitTaskUpdate(parentTask.id)

  const currentParentSnapshot = patched || getTaskById(parentTask.id)
  const shouldPersistRule = ['completed', 'failed'].includes(String(currentParentSnapshot?.status || '').toLowerCase())
  const updatedTask = refreshPrimaryTaskIntelligence(currentParentSnapshot?.id || parentTask.id, {
    now: completedAt,
    persistRule: shouldPersistRule,
  }) || currentParentSnapshot
  if (shouldWakePrimary && updatedTask && !isTestLikeRuntime()) {
    void executePendingAction(updatedTask, completedAt).catch((error) => {
      console.error('[workflow] sidecar continuation dispatch failed:', error?.message || error)
    })
  }

  return updatedTask
}

function buildTestRuntimeDispatch(task, { continuation = false, now = Date.now() } = {}) {
  const sessionKey = buildTaskSessionKey(task)
  const runId = `test-dispatch-${task?.id || crypto.randomUUID()}-${continuation ? 'continue' : 'start'}`
  return {
    accepted: {
      ok: true,
      testRuntime: true,
      runId,
      sessionKey,
    },
    runId,
    sessionKey,
    dispatchedAt: now,
  }
}

async function dispatchTaskToAgent(task, { continuation = false, now = Date.now() } = {}) {
  if (!task?.assignedAgent) {
    throw new Error(`Task ${task?.id || 'unknown'} has no assigned agent`)
  }

  if (isTestLikeRuntime()) {
    return buildTestRuntimeDispatch(task, { continuation, now })
  }

  if (isGstackBrowseAgent(task.assignedAgent)) {
    return dispatchDetachedGstackTask(task, {
      reason: continuation ? 'continuation-review' : 'start-review',
      now,
    })
  }

  const sessionKey = buildTaskSessionKey(task)
  const message = buildTaskDispatchMessage(task, { continuation })
  const idempotencyKey = crypto.randomUUID()
  const accepted = await gatewayCall(
    'chat.send',
    {
      sessionKey,
      message,
      deliver: false,
      idempotencyKey,
    },
    30000,
  )

  const runId = String(accepted?.runId || idempotencyKey)
  return {
    accepted,
    runId,
    sessionKey,
    dispatchedAt: now,
  }
}

async function executePendingAction(task, now = Date.now()) {
  if (!task?.pendingAction) return null
  if (!isPrimaryTask(task)) return null

  let governedTask = refreshPrimaryTaskIntelligence(task.id, { now }) || task
  if (!governedTask?.id) return null
  if (governedTask.requestId && !getRequestById(governedTask.requestId)) return null

  if (governedTask.pendingAction === 'start_work') {
    if (normalizeRiskTier(governedTask.riskTier) === 'irreversible') {
      const gated = enforceHumanGate(
        governedTask,
        governedTask.humanGateReason || '這題屬於不可逆操作，先停在老闆面前確認後再執行。',
        { now, keepPendingAction: true },
      )
      emitTaskUpdate(governedTask.id)
      return gated
    }
  }

  if (governedTask.pendingAction === 'start_work') {
    try {
      const dispatch = await dispatchTaskToAgent(governedTask, { continuation: false, now })
      const patched = updateTask(governedTask.id, {
        status: 'in_progress',
        startedAt: governedTask.startedAt || now,
        dispatchSessionKey: dispatch.sessionKey,
        dispatchRunId: dispatch.runId,
        ...taskProgressMeta('in_progress', {}, governedTask),
        continuationRequired: false,
        pendingAction: null,
        continuationCheckedAt: now,
        nextStep: '代理已接手，持續自主執行',
        ...buildTaskMemoryPatchFromBody(governedTask, {}, {
          mode: 'execution',
          focus: '代理已正式接手並開始自主推進',
          summary: '任務已送達代理並進入正式執行。',
          nextCheckpoint: '等待下一個可交付里程碑',
          openLoops: ['等待代理回報第一個里程碑'],
          evidence: [`gateway dispatched ${dispatch.runId}`],
          delegation: {
            currentStatus: 'running',
            sessionKey: dispatch.sessionKey,
            runId: dispatch.runId,
            nextHandoff: '代理回報第一個里程碑或根因',
            notes: '正式任務已成功派發到代理。',
          },
          updatedBy: 'workflow-dispatcher',
        }, now),
      })
      if (governedTask.requestId) {
        updateRequest(governedTask.requestId, { state: 'in_progress', workStartedAt: governedTask.startedAt || now })
        createEvent(governedTask.requestId, 'in_progress', governedTask.assignedAgent, `⚡ ${AGENTS[governedTask.assignedAgent]?.name || governedTask.assignedAgent} 已收到正式任務，開始自主執行`)
      }
      let nextTask = refreshPrimaryTaskIntelligence((patched || getTaskById(governedTask.id))?.id || governedTask.id, { now }) || patched || getTaskById(governedTask.id)
      nextTask = await ensureReviewerCoverage(nextTask, { reason: 'start-review', now })
      nextTask = await dispatchSidecarReviewers(nextTask, { reason: 'start-review', now })
      nextTask = await dispatchGstackVerifier(nextTask || governedTask, { reason: 'start-review', now })
      emitTaskUpdate(governedTask.id)
      await notifyTaskMilestone(nextTask || getTaskById(governedTask.id), 'in_progress')
      return nextTask
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const patched = updateTask(governedTask.id, {
        milestone: '派工失敗',
        nextStep: `等待自動重試：${message}`,
        retryCount: Number(governedTask.retryCount || 0) + 1,
        continuationRequired: true,
        pendingAction: 'start_work',
        continuationCheckedAt: now,
        completionGateRequired: false,
        lastUpdate: governedTask.lastUpdate || now,
        ...buildTaskMemoryPatchFromBody(governedTask, {}, {
          mode: 'blocked',
          focus: '派工失敗，等待重試或人工介入',
          summary: '任務尚未成功派送到代理。',
          nextCheckpoint: '等待下一次派工成功',
          blockers: [message],
          openLoops: ['等待派工成功'],
          evidence: [`dispatch error: ${message}`],
          rootCause: message,
          evolutionNote: '可補強 gateway health check、dispatch retry 或任務續跑監控。',
          delegation: {
            currentStatus: 'dispatch_failed',
            notes: message,
          },
          updatedBy: 'workflow-dispatcher',
        }, now),
      })
      if (governedTask.requestId) {
        createEvent(governedTask.requestId, 'assigned', governedTask.assignedAgent || 'wickedman', `⚠️ 派工失敗，將自動重試：${message}`)
      }
      emitTaskUpdate(governedTask.id)
      throw error
    }
  }

  if (governedTask.pendingAction === 'continue_after_reply') {
    const activeReviewerChildren = getActiveReviewerChildren(governedTask)
    const activeResearchFollowups = getActiveResearchFollowupChildren(governedTask)
    if (
      activeReviewerChildren.length > 0
      && (!governedTask.humanGateReason || isAutoGeneratedHumanGateReason(governedTask.humanGateReason))
    ) {
      const waitingTask = updateTask(governedTask.id, {
        milestone: '等待 reviewer / verifier',
        nextStep: '先等 reviewer / verifier 結果回流，再決定是否續跑主線',
        continuationRequired: true,
        pendingAction: 'continue_after_reply',
        continuationCheckedAt: now,
        completionGateRequired: false,
        humanGateReason: null,
        autoContinueAllowed: normalizeRiskTier(governedTask.riskTier) !== 'irreversible',
        lastUpdate: governedTask.lastUpdate || now,
        ...buildTaskMemoryPatchFromBody(governedTask, {}, {
          mode: 'execution',
          focus: '先等 reviewer / verifier 結果回流',
          summary: '目前已有 reviewer / verifier 在背景執行，等結果回流後再決定主線下一步。',
          nextCheckpoint: '等待 reviewer / verifier 回報',
          openLoops: ['等待 reviewer / verifier 結果'],
          updatedBy: 'workflow-governor',
        }, now),
      }) || governedTask
      emitTaskUpdate(waitingTask.id)
      return waitingTask
    }

    if (
      activeResearchFollowups.length > 0
      && (!governedTask.humanGateReason || isAutoGeneratedHumanGateReason(governedTask.humanGateReason))
    ) {
      const waitingTask = updateTask(governedTask.id, {
        milestone: '等待 downstream follow-up',
        nextStep: '先等 downstream child tasks 回流，再自動續跑研究主線',
        continuationRequired: true,
        pendingAction: 'continue_after_reply',
        continuationCheckedAt: now,
        completionGateRequired: false,
        humanGateReason: null,
        autoContinueAllowed: normalizeRiskTier(governedTask.riskTier) !== 'irreversible',
        lastUpdate: governedTask.lastUpdate || now,
        ...buildTaskMemoryPatchFromBody(governedTask, {}, {
          mode: 'execution',
          focus: '先等 downstream child tasks 結果回流',
          summary: '研究題已自動派工，等 follow-up child tasks 回流後再決定下一步。',
          nextCheckpoint: '等待 downstream child tasks 回報',
          openLoops: ['等待 downstream child tasks 結果'],
          delegation: {
            currentStatus: 'delegating',
            nextAutoStep: '等待 downstream child tasks 回流後自動續跑',
            delegatedAgents: activeResearchFollowups.map((child) => child.assignedAgent),
          },
          updatedBy: 'workflow-governor',
        }, now),
      }) || governedTask
      emitTaskUpdate(waitingTask.id)
      return waitingTask
    }

    if (Number(governedTask.retryBudget || 0) >= 0 && Number(governedTask.retryCount || 0) >= Number(governedTask.retryBudget || 0)) {
      const gated = enforceHumanGate(
        governedTask,
        governedTask.humanGateReason || `這題已達 retry budget (${governedTask.retryCount}/${governedTask.retryBudget})，先停下來讓老闆決定。`,
        { now, keepPendingAction: false },
      )
      emitTaskUpdate(governedTask.id)
      notifyTaskMilestone(gated, 'blocked').catch(() => {})
      return gated
    }

    if (!governedTask.autoContinueAllowed || governedTask.humanGateReason) {
      const gated = enforceHumanGate(
        governedTask,
        governedTask.humanGateReason || '這題目前不允許自動續跑，需要人工確認後再往下。',
        { now, keepPendingAction: false },
      )
      emitTaskUpdate(governedTask.id)
      notifyTaskMilestone(gated, 'blocked').catch(() => {})
      return gated
    }

    const consensus = governedTask.consensus || buildTaskConsensus(governedTask)
    // 若 sidecarDispatches 中已有任何 completed 紀錄（包含 auto-closed），視為 reviewer coverage 已滿足
    // 避免：auto-close sidecar → executePendingAction → needsReviewerCoverage → 重派 sidecar → 無限循環
    const alreadyHadSidecarAttempt = (governedTask.delegationPlan?.sidecarDispatches || []).some(
      (d) => d.status === 'completed' || d.status === 'failed'
    )
    const needsReviewerCoverage = ['medium', 'high', 'irreversible'].includes(normalizeRiskTier(governedTask.riskTier))
      && Number(governedTask.reviewerResults?.length || 0) === 0
      && !alreadyHadSidecarAttempt

    if (needsReviewerCoverage) {
      let blockedTask = await ensureReviewerCoverage(governedTask, { reason: 'continuation-review', now })
      blockedTask = updateTask(blockedTask.id, {
        milestone: '等待 reviewer / verifier',
        nextStep: '先等 reviewer / verifier 結果回流，再決定是否續跑主線',
        continuationRequired: true,
        pendingAction: 'continue_after_reply',
        continuationCheckedAt: now,
        completionGateRequired: false,
        lastUpdate: blockedTask.lastUpdate || now,
        ...buildTaskMemoryPatchFromBody(blockedTask, {}, {
          mode: 'execution',
          focus: '先補 reviewer / verifier，再續跑主線',
          summary: '這題風險層級要求至少一個 reviewer / verifier 結果後，主線才續跑。',
          nextCheckpoint: '等待 reviewer / verifier 回報',
          openLoops: ['等待 reviewer / verifier 結果'],
          updatedBy: 'workflow-governor',
        }, now),
      }) || blockedTask
      emitTaskUpdate(blockedTask.id)
      return blockedTask
    }

    if (!alreadyHadSidecarAttempt && (consensus.requiresThirdReviewer || consensus.status === 'needs_more_review')) {
      let blockedTask = await dispatchSidecarReviewers(governedTask, { reason: 'root-cause', now })
      blockedTask = await dispatchGstackVerifier(blockedTask || governedTask, { reason: 'root-cause', now })
      blockedTask = updateTask((blockedTask || governedTask).id, {
        milestone: '等待更多 reviewer 共識',
        nextStep: '先補齊第三 reviewer / verifier，再決定是否續跑主線',
        continuationRequired: true,
        pendingAction: 'continue_after_reply',
        continuationCheckedAt: now,
        completionGateRequired: false,
        lastUpdate: (blockedTask || governedTask).lastUpdate || now,
        ...buildTaskMemoryPatchFromBody((blockedTask || governedTask), {}, {
          mode: 'execution',
          focus: '目前 reviewer 對根因或動作還未收斂',
          summary: consensus.summary || '目前共識不足，先補 outside voice。',
          nextCheckpoint: '等待更多 reviewer 結果',
          openLoops: ['等待更多 reviewer / verifier 回報'],
          updatedBy: 'workflow-governor',
        }, now),
      }) || blockedTask || governedTask
      emitTaskUpdate(blockedTask.id)
      return blockedTask
    }

    if (['blocked', 'human_gate', 'conflict'].includes(String(consensus.status || '').toLowerCase())) {
      const gated = enforceHumanGate(
        governedTask,
        consensus.summary || governedTask.humanGateReason || '目前共識不允許自動續跑，需要人工決策。',
        { now, keepPendingAction: false },
      )
      emitTaskUpdate(governedTask.id)
      return gated
    }

    try {
      const dispatch = await dispatchTaskToAgent(governedTask, { continuation: true, now })
      const patched = updateTask(governedTask.id, {
        status: 'in_progress',
        milestone: '續跑中',
        nextStep: '已依未完事項續跑，等待代理收斂新的可交付結果',
        dispatchSessionKey: dispatch.sessionKey,
        dispatchRunId: dispatch.runId,
        continuationRequired: false,
        pendingAction: null,
        continuationCheckedAt: now,
        completionGateRequired: true,
        lastUpdate: now,
        ...buildTaskMemoryPatchFromBody(governedTask, {}, {
          mode: 'execution',
          focus: '延續上一輪結果，把未完事項收斂成新交付',
          summary: '系統已依未完成項目重新派送續跑。',
          nextCheckpoint: '等待續跑結果或新的根因回報',
          openLoops: ['等待續跑完成'],
          evidence: [`continuation dispatched ${dispatch.runId}`],
          delegation: {
            currentStatus: 'running',
            sessionKey: dispatch.sessionKey,
            runId: dispatch.runId,
            nextHandoff: '代理完成續跑後回報新的可交付結果',
            notes: '此輪為 continuation dispatch。',
          },
          updatedBy: 'workflow-dispatcher',
        }, now),
      })
      if (governedTask.requestId) {
        createEvent(governedTask.requestId, 'in_progress', governedTask.assignedAgent, `🔁 ${AGENTS[governedTask.assignedAgent]?.name || governedTask.assignedAgent} 依未完成項目自動續跑`)
      }
      const continuationReason = String(governedTask?.milestone || '').includes('追根因') || String(governedTask?.nextStep || '').includes('根因')
        ? 'root-cause'
        : 'continuation-review'
      let nextTask = refreshPrimaryTaskIntelligence((patched || getTaskById(governedTask.id))?.id || governedTask.id, { now }) || patched || getTaskById(governedTask.id)
      nextTask = await ensureReviewerCoverage(nextTask, { reason: continuationReason, now })
      nextTask = await dispatchSidecarReviewers(nextTask, { reason: continuationReason, now })
      nextTask = await dispatchGstackVerifier(nextTask || governedTask, { reason: continuationReason, now })
      emitTaskUpdate(governedTask.id)
      await notifyTaskMilestone(nextTask || getTaskById(governedTask.id), 'continued')
      return nextTask
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const patched = updateTask(governedTask.id, {
        milestone: '續跑派送失敗',
        nextStep: `等待自動重試：${message}`,
        retryCount: Number(governedTask.retryCount || 0) + 1,
        continuationRequired: true,
        pendingAction: 'continue_after_reply',
        continuationCheckedAt: now,
        completionGateRequired: false,
        lastUpdate: governedTask.lastUpdate || now,
        ...buildTaskMemoryPatchFromBody(governedTask, {}, {
          mode: 'blocked',
          focus: '續跑派送失敗，等待重試',
          summary: '系統試圖續跑，但派送代理失敗。',
          nextCheckpoint: '等待下一次續跑派送成功',
          blockers: [message],
          openLoops: ['等待續跑成功'],
          evidence: [`continuation dispatch error: ${message}`],
          rootCause: message,
          evolutionNote: '可補強 continuation retry 與狀態觀察。',
          delegation: {
            currentStatus: 'dispatch_failed',
            notes: message,
          },
          updatedBy: 'workflow-dispatcher',
        }, now),
      })
      if (governedTask.requestId) {
        createEvent(governedTask.requestId, 'in_progress', governedTask.assignedAgent || 'wickedman', `⚠️ 續跑派送失敗，將自動重試：${message}`)
      }
      emitTaskUpdate(governedTask.id)
      throw error
    }
  }

  return null
}

function queuePendingActionExecution(
  taskId,
  requestId,
  {
    delayMs = 3500,
    skipWhileRequestInProgress = false,
    remainingDeferrals = 0,
  } = {},
) {
  const timer = setTimeout(() => {
    const freshTask = getTaskById(taskId)
    if (!freshTask || !freshTask.pendingAction) return
    if (['completed', 'failed'].includes(String(freshTask.status || '').toLowerCase())) return

    const freshRequest = requestId ? getRequestById(requestId) : null
    const hasFormalDispatch = Boolean(freshTask.dispatchRunId || freshTask.dispatchSessionKey)
    const requestStillBusy = Boolean(
      skipWhileRequestInProgress
      && freshRequest
      && freshRequest.state === 'in_progress'
      && !hasFormalDispatch,
    )

    if (requestStillBusy && remainingDeferrals > 0) {
      queuePendingActionExecution(taskId, requestId, {
        delayMs,
        skipWhileRequestInProgress,
        remainingDeferrals: remainingDeferrals - 1,
      })
      return
    }

    void executePendingAction(freshTask, Date.now()).catch((error) => {
      console.error('[workflow] queued pending action dispatch failed:', error?.message || error)
    })
  }, delayMs)

  timer.unref?.()
  return timer
}

const STALE_TASK_THRESHOLD_MS = 15 * 60 * 1000
const STALE_TASK_SCAN_INTERVAL_MS = 60 * 1000
const CONTINUATION_CHECK_MS = 45 * 1000
const COMPLETION_GATE_CHECK_MS = 2 * 60 * 1000
const SIDECAR_REDISPATCH_WINDOW_MS = 10 * 60 * 1000

function isTestLikeRuntime() {
  return process.env.NODE_ENV === 'test' || process.env.OPENCLAW_OFFICE_DISABLE_BACKGROUND_CONTINUATIONS === '1'
}

if (!globalThis.__officeStaleTaskMonitorStarted && !isTestLikeRuntime()) {
  globalThis.__officeStaleTaskMonitorStarted = true
  let lastStaleMonitorErrorAt = 0
  const staleTaskMonitor = setInterval(async () => {
    try {
      const now = Date.now()
      const tasks = getActiveTasks(100)
      for (const task of tasks) {
        if (!isPrimaryTask(task)) continue
        const freshTask = refreshPrimaryTaskIntelligence(task.id, { now }) || task
        const updatedAt = Number(freshTask.lastUpdate || freshTask.startedAt || freshTask.createdAt || 0)
        if (!updatedAt) continue

        if (freshTask.continuationRequired && (!freshTask.continuationCheckedAt || now - Number(freshTask.continuationCheckedAt) > CONTINUATION_CHECK_MS)) {
          await executePendingAction(freshTask, now)
          continue
        }

        if (freshTask.status === 'in_progress' && freshTask.completionGateRequired && (now - updatedAt > COMPLETION_GATE_CHECK_MS)) {
          const patched = updateTask(freshTask.id, {
            continuationRequired: true,
            pendingAction: 'continue_after_reply',
            continuationCheckedAt: now,
            completionGateRequired: false,
            milestone: freshTask.milestone || '持續執行中',
            nextStep: freshTask.nextStep || '依未完成項目自動續跑',
            lastUpdate: updatedAt,
          })
          emitTaskUpdate(freshTask.id)
          continue
        }

        if (now - updatedAt < STALE_TASK_THRESHOLD_MS) continue
        if (freshTask.staleNotifiedAt && Number(freshTask.staleNotifiedAt) >= updatedAt) continue
        const patched = updateTask(freshTask.id, {
          staleNotifiedAt: now,
          milestone: freshTask.milestone || '等待更新',
          nextStep: freshTask.nextStep || '請補回最新進度',
          lastUpdate: updatedAt,
        })
        if (freshTask.status === 'in_progress') {
          let nextTask = await dispatchSidecarReviewers(patched || freshTask, { reason: 'stale-review', now })
          nextTask = await dispatchGstackVerifier(nextTask || freshTask, { reason: 'stale-review', now })
        }
        emitTaskUpdate(freshTask.id)
        await notifyTaskMilestone(patched || freshTask, 'stale')
      }
    } catch (error) {
      const now = Date.now()
      if (now - lastStaleMonitorErrorAt > 60_000) {
        lastStaleMonitorErrorAt = now
        console.error('[workflow] stale task monitor failed:', error.message)
      }
    }
  }, STALE_TASK_SCAN_INTERVAL_MS)
  staleTaskMonitor.unref?.()
}

// Keep request.state in sync with task.status for backward compatibility
// This ensures the frontend (which reads request state) still works
function syncRequestStateFromTask(task) {
  if (!task || !task.requestId) return
  if (!isPrimaryTask(task)) return
  const stateMap = {
    pending: 'received',
    assigned: 'assigned',
    in_progress: 'in_progress',
    completed: 'completed',
    failed: 'completed',
  }
  const newState = stateMap[task.status] || task.status
  const updates = {
    state: newState,
    assignedTo: task.assignedAgent,
    ...mergeAttentionMeta(task),
  }
  if (task.status === 'in_progress') updates.workStartedAt = task.startedAt || Date.now()
  if (task.status === 'completed' || task.status === 'failed') {
    updates.completedAt = task.completedAt || Date.now()
    updates.result = task.result
  }
  updateRequest(task.requestId, updates)
}

function cleanContent(content) {
  return (content || '').replace(/^\[Telegram[^\]]*\]\s*/s, '').replace(/\[message_id:\s*\d+\]\s*$/, '').trim()
}

function trimText(content, max = 160) {
  const normalized = cleanContent(content)
  if (!normalized) return ''
  return normalized.length > max ? `${normalized.slice(0, max - 3)}...` : normalized
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function mergeAttentionMeta(...sources) {
  const meta = {}
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue
    if (meta.attentionType === undefined && source.attentionType !== undefined) {
      meta.attentionType = source.attentionType || null
    }
    if (meta.priority === undefined && source.priority !== undefined) {
      const priority = Number(source.priority)
      meta.priority = Number.isFinite(priority) ? priority : 0
    }
    if (meta.needsDecision === undefined && source.needsDecision !== undefined) {
      meta.needsDecision = Boolean(source.needsDecision)
    }
    if (meta.estimatedValue === undefined && source.estimatedValue !== undefined) {
      const estimatedValue = Number(source.estimatedValue)
      meta.estimatedValue = Number.isFinite(estimatedValue) ? estimatedValue : null
    }
  }
  return meta
}

function sanitizeTextValue(value) {
  const normalized = String(value || '').trim()
  return normalized || null
}

function toStringArray(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => sanitizeTextValue(entry))
      .filter(Boolean)
  }
  const normalized = sanitizeTextValue(value)
  return normalized ? [normalized] : []
}

function mergeStringArray(existing = [], incoming = []) {
  return Array.from(new Set([...toStringArray(existing), ...toStringArray(incoming)]))
}

const DEFAULT_RESEARCH_DOWNSTREAM_MATRIX = {
  implementation: ['dev-fish'],
  validation: ['qa'],
  rootCause: ['analyst'],
  governance: ['admin'],
  verifier: ['gstack-browse'],
}

function normalizeResearchLoop(value, fallback = null) {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'proactive') return 'proactive'
  if (normalized === 'reactive') return 'reactive'
  return fallback
}

function normalizeOperatorMode(value, fallback = null) {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'strict') return 'strict'
  return fallback
}

function normalizeAutonomyPolicy(value, fallback = null) {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'no_prompt_until_human_gate') return 'no_prompt_until_human_gate'
  return fallback
}

function normalizeOutputContract(value, fallback = null) {
  const normalized = String(value || '').trim()
  if (!normalized) return fallback
  return normalized
}

function normalizeDownstreamMatrix(matrix = {}) {
  const normalized = {}
  for (const [key, defaults] of Object.entries(DEFAULT_RESEARCH_DOWNSTREAM_MATRIX)) {
    normalized[key] = mergeStringArray(defaults, matrix?.[key] || [])
      .map((agentId) => resolveAgentId(agentId))
      .filter(Boolean)
  }
  return normalized
}

function getResearchOperatorMeta(task = {}, body = {}) {
  const brain = task?.brainState || {}
  const delegation = task?.delegationPlan || {}
  return {
    researchLoop: normalizeResearchLoop(
      body?.researchLoop
      || task?.researchLoop
      || brain?.researchLoop
      || delegation?.researchLoop,
      null,
    ),
    operatorMode: normalizeOperatorMode(
      body?.operatorMode
      || task?.operatorMode
      || brain?.operatorMode
      || delegation?.operatorMode,
      null,
    ),
    autonomyPolicy: normalizeAutonomyPolicy(
      body?.autonomyPolicy
      || task?.autonomyPolicy
      || brain?.autonomyPolicy
      || delegation?.autonomyPolicy,
      null,
    ),
    outputContract: normalizeOutputContract(
      body?.outputContract
      || task?.outputContract
      || brain?.outputContract
      || delegation?.outputContract,
      null,
    ),
    scope: sanitizeTextValue(
      body?.scope
      || task?.scope
      || brain?.scope
      || delegation?.scope,
    ),
    downstreamMatrix: normalizeDownstreamMatrix(
      body?.downstreamMatrix
      || body?.delegationPlan?.downstreamMatrix
      || task?.downstreamMatrix
      || delegation?.downstreamMatrix
      || {},
    ),
  }
}

function isResearchOperatorTask(task = {}, body = {}) {
  const meta = getResearchOperatorMeta(task, body)
  const assignedAgent = resolveAgentId(body?.agent || task?.assignedAgent)
  return assignedAgent === 'research-fish'
    || meta.operatorMode === 'strict'
    || meta.outputContract === 'research_operator_v1'
    || Boolean(meta.researchLoop)
}

function normalizeSidecarDispatch(entry = {}) {
  const agentId = sanitizeTextValue(entry.agentId || entry.agent || entry.id)
  if (!agentId) return null
  return {
    agentId,
    taskId: sanitizeTextValue(entry.taskId),
    purpose: sanitizeTextValue(entry.purpose) || 'outside-voice-review',
    status: sanitizeTextValue(entry.status) || 'queued',
    sessionKey: sanitizeTextValue(entry.sessionKey),
    runId: sanitizeTextValue(entry.runId),
    dispatchedAt: entry.dispatchedAt ?? null,
    updatedAt: entry.updatedAt ?? entry.dispatchedAt ?? null,
    notes: sanitizeTextValue(entry.notes),
  }
}

function normalizeSidecarDispatches(list = []) {
  const items = Array.isArray(list) ? list : [list]
  return items
    .map((entry) => normalizeSidecarDispatch(entry))
    .filter(Boolean)
    .slice(0, 8)
}

function mergeSidecarDispatches(existing = [], incoming = []) {
  const merged = new Map()
  for (const entry of [...normalizeSidecarDispatches(existing), ...normalizeSidecarDispatches(incoming)]) {
    merged.set(entry.agentId, {
      ...(merged.get(entry.agentId) || {}),
      ...entry,
    })
  }
  return [...merged.values()].sort((a, b) => (b.updatedAt || b.dispatchedAt || 0) - (a.updatedAt || a.dispatchedAt || 0))
}

function mapSidecarReasonToMergePolicy(reason = '') {
  const normalized = String(reason || '').trim().toLowerCase()
  if (normalized === 'root-cause') return 'root_cause_support'
  if (normalized === 'stale-review') return 'blocking_review'
  return 'advisory'
}

function buildSidecarTaskSeed(parentTask, sidecarAgentId, { reason = 'continuation-review', now = Date.now() } = {}) {
  const parentTitle = cleanContent(parentTask?.title || parentTask?.detail || parentTask?.id || '未命名任務')
  const agentLabel = AGENTS[sidecarAgentId]?.name || sidecarAgentId
  const purposeLabel = reason === 'root-cause'
    ? '追根因'
    : reason === 'stale-review'
      ? '催收斂'
      : '平行驗證'

  return {
    requestId: parentTask?.requestId || null,
    parentTaskId: parentTask?.id || null,
    rootTaskId: parentTask?.rootTaskId || parentTask?.id || null,
    taskType: 'sidecar_review',
    sourceAgent: parentTask?.assignedAgent || 'wickedman',
    mergePolicy: mapSidecarReasonToMergePolicy(reason),
    graphDepth: Number(parentTask?.graphDepth || 0) + 1,
    title: `${purposeLabel}｜${agentLabel}｜${parentTitle}`.slice(0, 120),
    detail: `${agentLabel} 針對主任務「${parentTitle}」執行 sidecar reviewer / subagent 協作，目的：${purposeLabel}。`,
    assignedAgent: sidecarAgentId,
    status: 'assigned',
    brainMode: 'execution',
    brainState: {
      objective: `支援主任務：${parentTitle}`,
      focus: reason === 'root-cause' ? '追根因與替代方案' : '提供 reviewer / outside voice',
      summary: `${agentLabel} 已被叫進這題，準備提供 ${purposeLabel}。`,
      nextCheckpoint: '回報 sidecar 結果並回流主任務',
      openLoops: ['等待 sidecar reviewer 回報'],
      evidence: [`sidecar requested: ${reason}`],
      updatedBy: 'workflow-sidecar-dispatcher',
    },
    delegationPlan: {
      primaryAgent: parentTask?.assignedAgent || null,
      currentStatus: 'queued',
      reviewerMode: reason,
      nextHandoff: '回報 sidecar 結果給主任務',
      notes: '此題為正式 child task，結果會回流主任務。',
    },
    riskTier: maxRiskTier(parentTask?.riskTier || inferRiskTierFromTask(parentTask), reason === 'stale-review' ? 'medium' : 'low'),
    retryBudget: 1,
    autoContinueAllowed: false,
    autoApplyAllowed: false,
    createdAt: now,
    lastUpdate: now,
  }
}

function inferResearchDelegationKinds(task, body = {}) {
  const meta = getResearchOperatorMeta(task, body)
  const text = [
    task?.title,
    task?.detail,
    body?.summary,
    body?.nextStep,
    body?.rootCause,
    ...(body?.blockers || []),
    ...(body?.openLoops || []),
  ].filter(Boolean).join('\n')
  const kinds = new Set()

  if (meta.scope === 'fleet' || /routing|handoff|workflow|dashboard|governance|治理|設定|policy|權限|config/i.test(text)) {
    kinds.add('governance')
    kinds.add('rootCause')
  }
  if (/驗證|verify|verification|qa|測試|smoke|dogfood|browser|巡檢|check/i.test(text)) {
    kinds.add('validation')
    kinds.add('verifier')
  }
  if (/根因|diagnos|追根因|why|trace|schema drift|root cause/i.test(text)) {
    kinds.add('rootCause')
  }
  if (/實作|修復|修正|build|implement|feature|功能|開發|patch|route|ui|頁面|workflow/i.test(text)) {
    kinds.add('implementation')
  }

  if (kinds.size === 0) {
    if (meta.scope === 'feature' || meta.scope === 'application') kinds.add('implementation')
    else if (meta.scope === 'fleet') kinds.add('governance')
    else kinds.add('implementation')
  }

  return [...kinds]
}

function pickResearchDelegatedAgents(task, body = {}) {
  const meta = getResearchOperatorMeta(task, body)
  const explicitAgents = mergeStringArray(
    body?.delegatedAgents || body?.delegationTargets,
    body?.delegation?.delegatedAgents || body?.delegation?.targets || body?.suggestedSubagents || body?.delegation?.suggestedSubagents,
  )
    .map((agentId) => resolveAgentId(agentId))
    .filter((agentId) => agentId && agentId !== task?.assignedAgent)

  if (explicitAgents.length > 0) return explicitAgents

  const kinds = inferResearchDelegationKinds(task, body)
  const matrix = meta.downstreamMatrix || DEFAULT_RESEARCH_DOWNSTREAM_MATRIX
  const agents = new Set()
  for (const kind of kinds) {
    for (const agentId of matrix[kind] || []) {
      const resolved = resolveAgentId(agentId)
      if (!resolved || resolved === task?.assignedAgent) continue
      agents.add(resolved)
    }
  }
  return [...agents]
}

function buildResearchFollowupTaskSeed(parentTask, assignedAgent, { reason = 'research_followup', now = Date.now() } = {}) {
  const parentTitle = cleanContent(parentTask?.title || parentTask?.detail || parentTask?.id || '未命名研究題')
  const agentName = AGENTS[assignedAgent]?.name || assignedAgent
  return {
    requestId: parentTask?.requestId || null,
    parentTaskId: parentTask?.id || null,
    rootTaskId: parentTask?.rootTaskId || parentTask?.id || null,
    taskType: 'worker_subtask',
    sourceAgent: parentTask?.assignedAgent || 'research-fish',
    mergePolicy: assignedAgent === 'qa' ? 'blocking_review' : 'advisory',
    graphDepth: Number(parentTask?.graphDepth || 0) + 1,
    title: `跟進派工｜${agentName}｜${parentTitle}`.slice(0, 120),
    detail: `${agentName} 針對研究題「${parentTitle}」承接正式 follow-up，請直接把可落地工作推進到可驗證結果。`,
    assignedAgent,
    status: 'assigned',
    brainMode: 'queued',
    brainState: {
      objective: `承接研究 follow-up：${parentTitle}`,
      focus: '把研究結論轉成可落地工作、驗證或治理調整',
      summary: `${agentName} 已被研究魚正式派工。`,
      nextCheckpoint: '回報 follow-up 的第一個可驗證里程碑',
      openLoops: ['等待 downstream follow-up 回報'],
      evidence: [`research follow-up reason: ${reason}`],
      updatedBy: 'workflow-research-delegator',
    },
    delegationPlan: {
      primaryAgent: parentTask?.assignedAgent || 'research-fish',
      currentStatus: 'queued',
      reviewerMode: 'research-followup',
      nextHandoff: '回報 follow-up 結果給研究主線',
      notes: '這是 research-fish 自動建立的 downstream child task。',
    },
    riskTier: assignedAgent === 'qa' ? 'medium' : maxRiskTier(parentTask?.riskTier || inferRiskTierFromTask(parentTask), 'low'),
    retryBudget: 1,
    autoContinueAllowed: false,
    autoApplyAllowed: false,
    createdAt: now,
    lastUpdate: now,
  }
}

async function dispatchResearchFollowupTasks(task, body = {}, now = Date.now()) {
  if (!task?.id || !isPrimaryTask(task) || !isResearchOperatorTask(task, body)) return task

  const delegatedAgents = pickResearchDelegatedAgents(task, body)
  if (delegatedAgents.length === 0) return task

  const existingChildren = getChildTasks(task.id, 100)
  const dispatchedAgents = []
  const sidecarDispatches = []

  for (const delegatedAgent of delegatedAgents) {
    if (delegatedAgent === 'gstack-browse') continue
    let childTask = existingChildren.find((entry) => (
      entry.assignedAgent === delegatedAgent
      && entry.taskType === 'worker_subtask'
      && !['completed', 'failed'].includes(String(entry.status || '').toLowerCase())
    )) || null
    const seed = buildResearchFollowupTaskSeed(task, delegatedAgent, {
      reason: body?.nextStep || body?.summary || 'research_followup',
      now,
    })
    if (!childTask) {
      childTask = createTask(seed)
      existingChildren.push(childTask)
    } else {
      childTask = updateTask(childTask.id, {
        ...seed,
        createdAt: childTask.createdAt,
        status: 'assigned',
        completedAt: null,
        result: null,
      }) || childTask
    }
    emitTaskUpdate(childTask.id)

    try {
      const dispatch = await dispatchTaskToAgent(childTask, { continuation: false, now })
      childTask = updateTask(childTask.id, {
        status: 'in_progress',
        startedAt: childTask.startedAt || now,
        dispatchSessionKey: dispatch.sessionKey,
        dispatchRunId: dispatch.runId,
        lastUpdate: now,
        ...buildTaskMemoryPatchFromBody(childTask, {}, {
          mode: 'execution',
          focus: '承接 research follow-up，直接往可落地結果推進',
          summary: `${AGENTS[delegatedAgent]?.name || delegatedAgent} 已接手研究後續任務。`,
          nextCheckpoint: '等待 downstream 任務的第一個里程碑',
          openLoops: ['等待 downstream follow-up 回報'],
          evidence: [`research follow-up dispatched ${dispatch.runId}`],
          delegation: {
            currentStatus: 'running',
            reviewerMode: 'research-followup',
            sessionKey: dispatch.sessionKey,
            runId: dispatch.runId,
            nextHandoff: '回報 follow-up 結果給研究主線',
            notes: 'research-fish 自動派工成功。',
          },
          updatedBy: 'workflow-research-delegator',
        }, now),
      }) || childTask
      emitTaskUpdate(childTask.id)
      dispatchedAgents.push(delegatedAgent)
      sidecarDispatches.push({
        agentId: delegatedAgent,
        taskId: childTask.id,
        purpose: 'research-followup',
        status: 'running',
        sessionKey: dispatch.sessionKey,
        runId: dispatch.runId,
        dispatchedAt: dispatch.dispatchedAt || now,
        updatedAt: now,
        notes: 'research follow-up 已派工',
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      updateTask(childTask.id, {
        status: 'failed',
        completedAt: now,
        result: message,
        resolutionSource: 'dispatch_failed',
        lastUpdate: now,
      })
      emitTaskUpdate(childTask.id)
      sidecarDispatches.push({
        agentId: delegatedAgent,
        taskId: childTask.id,
        purpose: 'research-followup',
        status: 'dispatch_failed',
        updatedAt: now,
        notes: message,
      })
    }
  }

  let nextTask = task
  if (delegatedAgents.includes('gstack-browse')) {
    nextTask = await dispatchGstackVerifier(task, { reason: 'research-followup', now })
  }

  const patched = updateTask((nextTask || task).id, {
    ...buildTaskBrainPatch((nextTask || task), {
      focus: '研究已收斂一輪，正在把結論轉成正式派工與驗證',
      summary: body?.summary || (nextTask || task)?.brainState?.summary || '研究魚已完成一輪研究，正在自動派工與驗證。',
      nextCheckpoint: '等待 downstream child tasks / verifier 回報',
      openLoops: mergeStringArray((nextTask || task)?.brainState?.openLoops, ['等待 downstream child tasks 回報']),
      delegation: {
        currentStatus: dispatchedAgents.length > 0 ? 'delegating' : ((nextTask || task)?.delegationPlan?.currentStatus || 'running'),
        delegatedAgents: delegatedAgents,
        sidecarDispatches,
        nextHandoff: '等待 downstream child tasks / verifier 結果回流',
        nextAutoStep: '等待 downstream child tasks / verifier 回流後自動續跑',
        notes: `research-fish 已自動派工：${delegatedAgents.join(' / ')}`,
      },
      updatedBy: 'workflow-research-delegator',
    }, now),
    milestone: '研究後自動派工',
    nextStep: '等待 downstream child tasks / verifier 結果回流，再自動續跑研究主線',
    continuationRequired: true,
    pendingAction: 'continue_after_reply',
    continuationCheckedAt: now,
    completionGateRequired: false,
    lastUpdate: now,
  }) || nextTask || task
  emitTaskUpdate(patched.id)
  return patched
}

function getActiveResearchFollowupChildren(task = null) {
  if (!task?.id) return []
  return getChildTasks(task.id, 100).filter((child) => (
    child?.taskType === 'worker_subtask'
    && !['completed', 'failed'].includes(String(child.status || '').toLowerCase())
  ))
}

function normalizeBrainState(state = {}) {
  return {
    objective: sanitizeTextValue(state.objective),
    focus: sanitizeTextValue(state.focus),
    summary: sanitizeTextValue(state.summary),
    nextCheckpoint: sanitizeTextValue(state.nextCheckpoint),
    scope: sanitizeTextValue(state.scope),
    researchLoop: normalizeResearchLoop(state.researchLoop, null),
    operatorMode: normalizeOperatorMode(state.operatorMode, null),
    autonomyPolicy: normalizeAutonomyPolicy(state.autonomyPolicy, null),
    outputContract: normalizeOutputContract(state.outputContract, null),
    knownFacts: mergeStringArray([], state.knownFacts),
    blockers: mergeStringArray([], state.blockers),
    openLoops: mergeStringArray([], state.openLoops),
    evidence: mergeStringArray([], state.evidence),
    updatedBy: sanitizeTextValue(state.updatedBy),
  }
}

function normalizeDelegationPlan(plan = {}, task = null, now = Date.now()) {
  const sessionKey = sanitizeTextValue(plan.sessionKey) || sanitizeTextValue(task?.dispatchSessionKey)
  const runId = sanitizeTextValue(plan.runId) || sanitizeTextValue(task?.dispatchRunId)
  return {
    primaryAgent: sanitizeTextValue(plan.primaryAgent) || sanitizeTextValue(task?.assignedAgent),
    currentStatus: sanitizeTextValue(plan.currentStatus),
    researchLoop: normalizeResearchLoop(plan.researchLoop || task?.researchLoop, null),
    operatorMode: normalizeOperatorMode(plan.operatorMode || task?.operatorMode, null),
    autonomyPolicy: normalizeAutonomyPolicy(plan.autonomyPolicy || task?.autonomyPolicy, null),
    outputContract: normalizeOutputContract(plan.outputContract || task?.outputContract, null),
    scope: sanitizeTextValue(plan.scope || task?.scope),
    sessionKey,
    runId,
    allowSubagents: plan.allowSubagents === undefined ? true : Boolean(plan.allowSubagents),
    reviewerMode: sanitizeTextValue(plan.reviewerMode) || 'verified-delegation',
    suggestedSubagents: mergeStringArray([], plan.suggestedSubagents),
    sidecarDispatches: normalizeSidecarDispatches(plan.sidecarDispatches),
    downstreamMatrix: normalizeDownstreamMatrix(plan.downstreamMatrix || task?.downstreamMatrix || {}),
    delegatedAgents: mergeStringArray([], plan.delegatedAgents),
    lastSuggestedDispatchAt: plan.lastSuggestedDispatchAt ?? null,
    nextHandoff: sanitizeTextValue(plan.nextHandoff),
    nextAutoStep: sanitizeTextValue(plan.nextAutoStep),
    notes: sanitizeTextValue(plan.notes),
    lastDispatchAt: plan.lastDispatchAt ?? ((sessionKey || runId) ? now : null),
  }
}

function buildTaskBrainPatch(task, patch = {}, now = Date.now()) {
  const existingBrain = normalizeBrainState(task?.brainState || {})
  const nextBrain = normalizeBrainState({
    objective: patch.objective ?? existingBrain.objective ?? sanitizeTextValue(task?.title || task?.detail),
    focus: patch.focus ?? existingBrain.focus,
    summary: patch.summary ?? existingBrain.summary,
    nextCheckpoint: patch.nextCheckpoint ?? existingBrain.nextCheckpoint ?? sanitizeTextValue(task?.nextStep),
    scope: patch.scope ?? existingBrain.scope,
    researchLoop: patch.researchLoop ?? existingBrain.researchLoop,
    operatorMode: patch.operatorMode ?? existingBrain.operatorMode,
    autonomyPolicy: patch.autonomyPolicy ?? existingBrain.autonomyPolicy,
    outputContract: patch.outputContract ?? existingBrain.outputContract,
    knownFacts: mergeStringArray(existingBrain.knownFacts, patch.knownFacts),
    blockers: mergeStringArray(existingBrain.blockers, patch.blockers),
    openLoops: mergeStringArray(existingBrain.openLoops, patch.openLoops),
    evidence: mergeStringArray(existingBrain.evidence, patch.evidence),
    updatedBy: patch.updatedBy ?? existingBrain.updatedBy ?? 'workflow-api',
  })

  const existingDelegation = task?.delegationPlan || {}
  const nextDelegation = normalizeDelegationPlan({
    ...existingDelegation,
    ...(patch.delegation || {}),
    suggestedSubagents: mergeStringArray(existingDelegation.suggestedSubagents, patch.delegation?.suggestedSubagents),
    sidecarDispatches: mergeSidecarDispatches(existingDelegation.sidecarDispatches, patch.delegation?.sidecarDispatches),
    delegatedAgents: mergeStringArray(existingDelegation.delegatedAgents, patch.delegation?.delegatedAgents),
    downstreamMatrix: {
      ...(existingDelegation.downstreamMatrix || {}),
      ...(patch.delegation?.downstreamMatrix || {}),
    },
  }, task, now)

  return {
    brainMode: patch.mode ?? task?.brainMode ?? null,
    brainState: nextBrain,
    rootCause: patch.rootCause ?? task?.rootCause ?? null,
    delegationPlan: nextDelegation,
    evolutionNote: patch.evolutionNote ?? task?.evolutionNote ?? null,
    memoryUpdatedAt: patch.memoryUpdatedAt ?? now,
  }
}

function buildTaskMemoryPatchFromBody(task, body = {}, fallback = {}, now = Date.now()) {
  const explicitBrain = body?.brainState && typeof body.brainState === 'object' ? body.brainState : {}
  const explicitDelegation = body?.delegationPlan && typeof body.delegationPlan === 'object'
    ? body.delegationPlan
    : (body?.delegation && typeof body.delegation === 'object' ? body.delegation : {})

  return buildTaskBrainPatch(task, {
    mode: body.brainMode ?? body.mode ?? fallback.mode ?? task?.brainMode ?? null,
    objective: body.objective ?? explicitBrain.objective ?? fallback.objective,
    focus: body.focus ?? explicitBrain.focus ?? fallback.focus,
    summary: body.summary ?? explicitBrain.summary ?? fallback.summary,
    nextCheckpoint: body.nextCheckpoint ?? explicitBrain.nextCheckpoint ?? fallback.nextCheckpoint,
    scope: body.scope ?? explicitBrain.scope ?? fallback.scope,
    researchLoop: body.researchLoop ?? explicitBrain.researchLoop ?? fallback.researchLoop,
    operatorMode: body.operatorMode ?? explicitBrain.operatorMode ?? fallback.operatorMode,
    autonomyPolicy: body.autonomyPolicy ?? explicitBrain.autonomyPolicy ?? fallback.autonomyPolicy,
    outputContract: body.outputContract ?? explicitBrain.outputContract ?? fallback.outputContract,
    knownFacts: mergeStringArray(explicitBrain.knownFacts, fallback.knownFacts || body.knownFacts),
    blockers: mergeStringArray(explicitBrain.blockers, fallback.blockers || body.blockers),
    openLoops: mergeStringArray(explicitBrain.openLoops, fallback.openLoops || body.openLoops),
    evidence: mergeStringArray(explicitBrain.evidence, fallback.evidence || body.evidence),
    updatedBy: sanitizeTextValue(body.updatedBy || body.agent || fallback.updatedBy || 'workflow-api'),
    rootCause: body.rootCause ?? body.root_cause ?? fallback.rootCause,
    evolutionNote: body.evolutionNote ?? body.evolution_note ?? fallback.evolutionNote,
    delegation: {
      ...(fallback.delegation || {}),
      ...explicitDelegation,
      suggestedSubagents: mergeStringArray(
        fallback.delegation?.suggestedSubagents,
        explicitDelegation.suggestedSubagents || body.suggestedSubagents,
      ),
      delegatedAgents: mergeStringArray(
        fallback.delegation?.delegatedAgents,
        explicitDelegation.delegatedAgents || body.delegatedAgents,
      ),
      downstreamMatrix: explicitDelegation.downstreamMatrix
        || fallback.delegation?.downstreamMatrix
        || body.downstreamMatrix
        || null,
      researchLoop: explicitDelegation.researchLoop ?? fallback.delegation?.researchLoop ?? body.researchLoop,
      operatorMode: explicitDelegation.operatorMode ?? fallback.delegation?.operatorMode ?? body.operatorMode,
      autonomyPolicy: explicitDelegation.autonomyPolicy ?? fallback.delegation?.autonomyPolicy ?? body.autonomyPolicy,
      outputContract: explicitDelegation.outputContract ?? fallback.delegation?.outputContract ?? body.outputContract,
      scope: explicitDelegation.scope ?? fallback.delegation?.scope ?? body.scope,
      nextAutoStep: explicitDelegation.nextAutoStep ?? fallback.delegation?.nextAutoStep ?? body.nextAutoStep,
      sessionKey: explicitDelegation.sessionKey ?? fallback.delegation?.sessionKey ?? task?.dispatchSessionKey,
      runId: explicitDelegation.runId ?? fallback.delegation?.runId ?? task?.dispatchRunId,
    },
    memoryUpdatedAt: body.memoryUpdatedAt ?? fallback.memoryUpdatedAt ?? now,
  }, now)
}

const RISK_TIER_ORDER = {
  low: 0,
  medium: 1,
  high: 2,
  irreversible: 3,
}

function normalizeRiskTier(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'irreversible') return 'irreversible'
  if (normalized === 'high') return 'high'
  if (normalized === 'medium') return 'medium'
  return 'low'
}

function maxRiskTier(...values) {
  return values
    .map((value) => normalizeRiskTier(value))
    .sort((left, right) => (RISK_TIER_ORDER[right] || 0) - (RISK_TIER_ORDER[left] || 0))[0] || 'low'
}

function defaultRetryBudgetForRiskTier(riskTier) {
  switch (normalizeRiskTier(riskTier)) {
    case 'irreversible':
      return 0
    case 'high':
      return 2
    case 'medium':
      return 4
    default:
      return 6
  }
}

function inferRiskTierFromTask(task = {}, body = {}) {
  if (task?.riskTier) return normalizeRiskTier(task.riskTier)
  if (body?.riskTier) return normalizeRiskTier(body.riskTier)

  const attentionType = String(body?.attentionType || task?.attentionType || '').trim().toLowerCase()
  const combined = [
    task?.title,
    task?.detail,
    task?.rootCause,
    task?.brainState?.focus,
    task?.brainState?.summary,
    body?.summary,
    body?.nextStep,
  ].filter(Boolean).join('\n')

  if (
    task?.needsDecision ||
    /deploy to prod|force push|delete production|drop table|refund|cancel subscription|irreversible|不可逆|上線到正式|正式環境|刪除資料|退款|取消訂閱/i.test(combined)
  ) {
    return 'irreversible'
  }

  if (
    attentionType === 'risk' ||
    /security|payment|invoice|billing|schema|migration|production|prod|權限|資安|帳務|金流|資料庫/i.test(combined)
  ) {
    return 'high'
  }

  if (
    attentionType === 'decision' ||
    attentionType === 'opportunity' ||
    /qa|verify|review|browser|驗證|reviewer|verifier|外腦|gstack|巡檢|網址|網站|smoke|dogfood|health|monitor|巡查/i.test(combined)
  ) {
    return 'medium'
  }

  return 'low'
}

function buildTaskGovernanceDefaults(task = {}, body = {}) {
  const riskTier = inferRiskTierFromTask(task, body)
  return {
    riskTier,
    retryBudget: Number.isFinite(task.retryBudget) ? Number(task.retryBudget) : defaultRetryBudgetForRiskTier(riskTier),
    retryCount: Number.isFinite(task.retryCount) ? Number(task.retryCount) : 0,
    escalationLevel: Number.isFinite(task.escalationLevel) ? Number(task.escalationLevel) : 0,
    autoContinueAllowed: task.autoContinueAllowed === undefined ? normalizeRiskTier(riskTier) !== 'irreversible' : Boolean(task.autoContinueAllowed),
    autoApplyAllowed: task.autoApplyAllowed === undefined ? normalizeRiskTier(riskTier) === 'low' : Boolean(task.autoApplyAllowed),
    humanGateReason: task.humanGateReason || (normalizeRiskTier(riskTier) === 'irreversible' ? '不可逆操作需要老闆確認後才能執行。' : null),
  }
}

function normalizeReviewerFindingType(value, fallback = 'advisory') {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'root_cause' || normalized === 'root-cause') return 'root_cause'
  if (normalized === 'risk') return 'risk'
  if (normalized === 'verification' || normalized === 'verify') return 'verification'
  if (normalized === 'implementation' || normalized === 'worker_subtask') return 'implementation'
  return fallback
}

function normalizeReviewerSeverity(value, fallback = 'info') {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'blocking' || normalized === 'blocker' || normalized === 'error') return 'blocking'
  if (normalized === 'warning' || normalized === 'warn') return 'warning'
  return fallback
}

function normalizeRecommendedAction(value, fallback = 'observe') {
  const normalized = String(value || '').trim()
  return normalized || fallback
}

function buildReviewerResultSignature(entry = {}) {
  return [
    entry.sourceTaskId || entry.sourceAgent || 'reviewer',
    entry.findingType || 'advisory',
    entry.severity || 'info',
    entry.recommendedAction || 'observe',
    entry.rootCause || '',
    entry.summary || '',
  ].join('|').toLowerCase()
}

function normalizeReviewerResult(entry = {}, fallback = {}) {
  const blockers = mergeStringArray([], entry.blockers || fallback.blockers)
  const openLoops = mergeStringArray([], entry.openLoops || fallback.openLoops)
  const summary = sanitizeTextValue(entry.summary || fallback.summary)
  const rootCause = sanitizeTextValue(entry.rootCause || entry.root_cause || fallback.rootCause)
  const findingType = normalizeReviewerFindingType(
    entry.findingType || fallback.findingType,
    rootCause ? 'root_cause' : (blockers.length > 0 ? 'risk' : 'advisory'),
  )
  const severity = normalizeReviewerSeverity(
    entry.severity || fallback.severity,
    blockers.length > 0 ? 'blocking' : (openLoops.length > 0 ? 'warning' : 'info'),
  )
  const confidenceNumber = Number(entry.confidence ?? fallback.confidence)
  const recommendedAction = normalizeRecommendedAction(
    entry.recommendedAction || fallback.recommendedAction || fallback.nextStep,
    severity === 'blocking' ? 'investigate_root_cause' : 'continue',
  )
  const normalized = {
    id: sanitizeTextValue(entry.id || fallback.id) || `review_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    sourceTaskId: sanitizeTextValue(entry.sourceTaskId || fallback.sourceTaskId),
    sourceTaskType: sanitizeTextValue(entry.sourceTaskType || fallback.sourceTaskType),
    sourceAgent: sanitizeTextValue(entry.sourceAgent || fallback.sourceAgent),
    sourceKind: sanitizeTextValue(entry.sourceKind || fallback.sourceKind) || 'local',
    mergePolicy: sanitizeTextValue(entry.mergePolicy || fallback.mergePolicy) || 'advisory',
    findingType,
    severity,
    confidence: Number.isFinite(confidenceNumber) ? clamp(confidenceNumber, 0, 1) : 0.65,
    recommendedAction,
    supportsRootCause: entry.supportsRootCause === undefined
      ? Boolean(rootCause)
      : Boolean(entry.supportsRootCause),
    requiresHumanApproval: entry.requiresHumanApproval === undefined
      ? Boolean(fallback.requiresHumanApproval)
      : Boolean(entry.requiresHumanApproval),
    summary,
    rootCause,
    blockers,
    openLoops,
    evidence: mergeStringArray([], entry.evidence || fallback.evidence),
    createdAt: entry.createdAt || fallback.createdAt || Date.now(),
  }
  normalized.signature = buildReviewerResultSignature(normalized)
  return normalized
}

function normalizeReviewerResults(list = [], fallback = {}) {
  const items = Array.isArray(list) ? list : [list]
  return items
    .map((entry) => normalizeReviewerResult(entry, fallback))
    .filter((entry) => Boolean(entry.summary || entry.rootCause || entry.blockers.length > 0 || entry.openLoops.length > 0 || entry.evidence.length > 0))
}

function mergeReviewerResults(existing = [], incoming = []) {
  const map = new Map()
  for (const entry of [...(existing || []), ...(incoming || [])]) {
    const normalized = normalizeReviewerResult(entry)
    const signature = normalized.signature || buildReviewerResultSignature(normalized)
    const previous = map.get(signature)
    map.set(signature, previous ? {
      ...previous,
      ...normalized,
      blockers: mergeStringArray(previous.blockers, normalized.blockers),
      openLoops: mergeStringArray(previous.openLoops, normalized.openLoops),
      evidence: mergeStringArray(previous.evidence, normalized.evidence),
      confidence: Math.max(Number(previous.confidence || 0), Number(normalized.confidence || 0)),
      createdAt: Math.min(Number(previous.createdAt || Date.now()), Number(normalized.createdAt || Date.now())),
    } : normalized)
  }
  return [...map.values()].sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0))
}

function rankSeverity(value) {
  const normalized = normalizeReviewerSeverity(value)
  if (normalized === 'blocking') return 2
  if (normalized === 'warning') return 1
  return 0
}

function isAutoGeneratedHumanGateReason(reason = '') {
  const normalized = String(reason || '').trim()
  return normalized === '不可逆操作需要老闆確認後才能執行。'
    || normalized === 'reviewer / verifier 要求人工核准。'
    || /已達 retry budget/i.test(normalized)
}

function getActiveReviewerChildren(task = null) {
  if (!task?.id) return []
  const SIDECAR_TIMEOUT_MS = 30 * 60 * 1000 // 30 分鐘超時
  const now = Date.now()
  return getChildTasks(task.id, 100).filter((child) => {
    const statusStr = String(child.status || '').toLowerCase()
    // 排除已完成或失敗
    if (['completed', 'failed'].includes(statusStr)) return false
    // 排除 auto-closed 標記（summary 或 milestone 含 [auto-closed]）
    const summaryStr = String(child.summary || '') + String(child.milestone || '')
    if (summaryStr.includes('[auto-closed]')) return false
    // 排除超過 30 分鐘仍未完成的殭屍 sidecar
    const createdMs = child.createdAt ? new Date(child.createdAt).getTime() : 0
    if (createdMs > 0 && (now - createdMs) > SIDECAR_TIMEOUT_MS) return false
    return ['sidecar_review', 'verifier'].includes(String(child.taskType || ''))
  })
}

function buildTaskConsensus(task = {}, incomingResults = []) {
  const reviewerResults = mergeReviewerResults(task.reviewerResults || [], incomingResults)
  const blockingResults = reviewerResults.filter((entry) => rankSeverity(entry.severity) >= 2)
  const warningResults = reviewerResults.filter((entry) => rankSeverity(entry.severity) === 1)
  const humanApprovalRequired = reviewerResults.some((entry) => entry.requiresHumanApproval)
  const rootCauseVotes = new Map()
  const actionVotes = new Map()
  const mergePolicies = new Set()

  for (const result of reviewerResults) {
    const rootCauseKey = sanitizeTextValue(result.rootCause)
    if (rootCauseKey) {
      rootCauseVotes.set(rootCauseKey, (rootCauseVotes.get(rootCauseKey) || 0) + 1)
    }
    const actionKey = sanitizeTextValue(result.recommendedAction)
    if (actionKey) {
      actionVotes.set(actionKey, (actionVotes.get(actionKey) || 0) + 1)
    }
    mergePolicies.add(String(result.mergePolicy || 'advisory'))
  }

  const sortedRootCauses = [...rootCauseVotes.entries()].sort((left, right) => right[1] - left[1])
  const sortedActions = [...actionVotes.entries()].sort((left, right) => right[1] - left[1])
  const topRootCause = sortedRootCauses[0]?.[0] || sanitizeTextValue(task.rootCause)
  const topRootCauseSupport = sortedRootCauses[0]?.[1] || 0
  const conflictingRootCauses = sortedRootCauses.length > 1
  const topAction = sortedActions[0]?.[0] || sanitizeTextValue(task.nextStep)
  const topActionSupport = sortedActions[0]?.[1] || 0
  const consensusRequired = mergePolicies.has('consensus_required')
  const rootCauseSupport = mergePolicies.has('root_cause_support')
  const blockingReview = mergePolicies.has('blocking_review')

  let status = 'pending_review'
  if (reviewerResults.length === 0) {
    status = 'pending_review'
  } else if (humanApprovalRequired) {
    status = 'human_gate'
  } else if (blockingReview && blockingResults.length > 0) {
    status = 'blocked'
  } else if (rootCauseSupport && conflictingRootCauses) {
    status = 'conflict'
  } else if (consensusRequired && topActionSupport < 2) {
    status = reviewerResults.length >= 2 ? 'conflict' : 'needs_more_review'
  } else if (blockingResults.length > 0) {
    status = 'blocked'
  } else if (warningResults.length > 0) {
    status = 'advisory_only'
  } else {
    status = 'clear'
  }

  return {
    status,
    resultCount: reviewerResults.length,
    blockingCount: blockingResults.length,
    warningCount: warningResults.length,
    infoCount: reviewerResults.filter((entry) => rankSeverity(entry.severity) === 0).length,
    humanApprovalRequired,
    requiresThirdReviewer: rootCauseSupport && conflictingRootCauses,
    topRootCause,
    topRootCauseSupport,
    conflictingRootCauses: sortedRootCauses.slice(1).map(([value, support]) => ({ value, support })),
    recommendedAction: topAction || null,
    recommendedActionSupport: topActionSupport,
    mergePolicies: [...mergePolicies],
    updatedAt: Date.now(),
    summary: reviewerResults.length === 0
      ? '目前還沒有 reviewer / verifier 結果。'
      : blockingResults.length > 0
        ? 'reviewer / verifier 發現 blocking issue，需要先處理。'
        : conflictingRootCauses
          ? 'reviewer 對根因有分歧，需要第三個 outside voice。'
          : consensusRequired && topActionSupport < 2
            ? '目前還沒有足夠共識，需更多 reviewer。'
            : humanApprovalRequired
              ? 'reviewer 要求人工核准後再往下。'
              : warningResults.length > 0
                ? '目前以 advisory 為主，可帶著注意事項續跑。'
                : 'reviewer / verifier 結果已收斂。',
  }
}

function buildReusableMemory(task = {}, consensus = null, reusableRule = null, now = Date.now()) {
  const brain = normalizeBrainState(task.brainState || {})
  return {
    episodic: {
      rootCause: sanitizeTextValue(task.rootCause || consensus?.topRootCause),
      blockers: mergeStringArray([], brain.blockers),
      openLoops: mergeStringArray([], brain.openLoops),
      summary: sanitizeTextValue(brain.summary || task.result),
      consensusStatus: consensus?.status || null,
      updatedAt: now,
    },
    candidateRule: reusableRule ? {
      id: reusableRule.id || null,
      category: reusableRule.category || 'guardrail',
      status: reusableRule.status || 'draft',
      title: reusableRule.title || null,
      summary: reusableRule.summary || null,
      triggerKey: reusableRule.triggerKey || null,
      confidence: reusableRule.confidence || 0,
    } : null,
    lastSyncedAt: now,
  }
}

function toTriggerKey(value = '') {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized.slice(0, 80) || 'general'
}

function deriveReusableRuleCandidate(task = {}, consensus = null) {
  const rootCause = sanitizeTextValue(task.rootCause || consensus?.topRootCause)
  const evolutionNote = sanitizeTextValue(task.evolutionNote)
  const triggerSource = rootCause || task.brainState?.blockers?.[0] || evolutionNote
  if (!triggerSource) return null

  const riskTier = normalizeRiskTier(task.riskTier)
  const category = consensus?.blockingCount > 0 || ['high', 'irreversible'].includes(riskTier)
    ? 'guardrail'
    : (consensus?.resultCount > 0 ? 'verification' : 'playbook')
  const triggerKey = toTriggerKey(triggerSource)
  const existingRule = listLobsterRules(200).find((entry) => entry.triggerKey === triggerKey && entry.category === category) || null
  const successCount = Number(existingRule?.successCount || 0) + (task.didImprove ? 1 : 0)
  const failureCount = Number(existingRule?.failureCount || 0) + (task.rollbackNeeded ? 1 : 0)
  const confidenceBase = clamp(
    0.4 +
    (consensus?.resultCount ? Math.min(consensus.resultCount * 0.08, 0.24) : 0) +
    (task.didImprove ? 0.2 : 0) -
    (task.rollbackNeeded ? 0.2 : 0),
    0.15,
    0.95,
  )
  return {
    id: existingRule?.id || null,
    category,
    ruleType: category === 'guardrail' ? 'guardrail' : 'advisory',
    title: trimText(`避免再次出現：${triggerSource}`, 80),
    summary: trimText(
      evolutionNote
        || task.brainState?.summary
        || (consensus?.summary ? `${consensus.summary} 建議動作：${consensus.recommendedAction || '持續觀察'}` : triggerSource),
      180,
    ),
    triggerKey,
    confidence: confidenceBase,
    status: task.rollbackNeeded
      ? 'rolled_back'
      : task.autoApplyAllowed && task.didImprove
        ? 'auto_applied'
        : task.didImprove
          ? 'canary'
          : 'draft',
    successCount,
    failureCount,
    sourceTaskId: task.id,
    sourceRootTaskId: task.rootTaskId || task.id,
    evidence: mergeStringArray(task.brainState?.evidence, [task.result, rootCause]).slice(0, 6),
    rule: {
      trigger: triggerSource,
      recommendedAction: consensus?.recommendedAction || task.nextStep || 'add reviewer / verifier and guardrail',
      riskTier: normalizeRiskTier(task.riskTier),
      consensusStatus: consensus?.status || null,
    },
    createdAt: existingRule?.createdAt || Date.now(),
    updatedAt: Date.now(),
    lastSeenAt: Date.now(),
  }
}

function refreshPrimaryTaskIntelligence(taskId, { now = Date.now(), persistRule = false } = {}) {
  const task = getTaskById(taskId)
  if (!task || !isPrimaryTask(task)) return task

  const consensus = buildTaskConsensus(task)
  const riskTier = inferRiskTierFromTask(task)
  const retryBudget = Number.isFinite(task.retryBudget) ? Number(task.retryBudget) : defaultRetryBudgetForRiskTier(riskTier)
  const retryCount = Number(task.retryCount || 0)
  const activeReviewerChildren = getActiveReviewerChildren(task)
  const manualHumanGateReason = task.humanGateReason && !isAutoGeneratedHumanGateReason(task.humanGateReason)
    ? task.humanGateReason
    : null
  const escalationLevel = Math.max(
    Number(task.escalationLevel || 0),
    consensus.status === 'blocked' ? 1 : 0,
    consensus.status === 'conflict' || consensus.status === 'needs_more_review' ? 2 : 0,
    normalizeRiskTier(riskTier) === 'irreversible' ? 3 : 0,
  )
  const humanGateReason = manualHumanGateReason
    || (normalizeRiskTier(riskTier) === 'irreversible' ? '不可逆操作需要老闆確認後才能執行。' : null)
    || (consensus.humanApprovalRequired ? 'reviewer / verifier 要求人工核准。' : null)
    || (retryCount >= retryBudget && retryBudget >= 0 && activeReviewerChildren.length === 0 ? '已達 retry budget，先停下來讓老闆決定。' : null)
  const autoContinueAllowed = normalizeRiskTier(riskTier) !== 'irreversible' && !humanGateReason
  const autoApplyAllowed = normalizeRiskTier(riskTier) === 'low'
  const reusableRule = deriveReusableRuleCandidate(task, consensus)
  const reusableMemory = buildReusableMemory(task, consensus, reusableRule, now)
  const patched = updateTask(task.id, {
    consensus,
    riskTier,
    retryBudget,
    escalationLevel,
    autoContinueAllowed,
    autoApplyAllowed,
    humanGateReason,
    reusableMemory,
    rootCause: task.rootCause || consensus.topRootCause || null,
    memoryUpdatedAt: now,
  }) || getTaskById(task.id)

  if (persistRule && reusableRule) {
    upsertLobsterRule({
      ...reusableRule,
      id: reusableRule.id || undefined,
    })
  }

  return patched
}

function shouldRunGstackVerifier(task, { reason = 'continuation-review' } = {}) {
  if (!task?.id || !isPrimaryTask(task)) return false
  if (!hasGstackBrowseBinary()) return false
  const url = extractTaskVerificationUrl(task)
  if (!url) return false
  const riskTier = normalizeRiskTier(task.riskTier || inferRiskTierFromTask(task))
  if (['medium', 'high', 'irreversible'].includes(riskTier)) return true
  return /verify|review|qa|ui|browser|route|頁面|驗證|巡檢|網址|網站|smoke|dogfood|health|monitor|巡查/i.test(`${reason}\n${task.title || ''}\n${task.detail || ''}`)
}

function getOfficeInternalBaseUrl() {
  return process.env.OPENCLAW_OFFICE_INTERNAL_BASE_URL || DEFAULT_OFFICE_INTERNAL_BASE_URL
}

async function dispatchDetachedGstackTask(task, { reason = 'continuation-review', now = Date.now() } = {}) {
  const url = extractTaskVerificationUrl(task)
  if (!url) {
    throw new Error(`gstack task ${task?.id || 'unknown'} has no verification URL`)
  }

  const dispatch = spawnDetachedGstackTask(task.id, {
    reason,
    officeBaseUrl: getOfficeInternalBaseUrl(),
  })

  return {
    ...dispatch,
    url,
    dispatchedAt: now,
  }
}

async function dispatchGstackVerifier(task, { reason = 'continuation-review', now = Date.now() } = {}) {
  if (!shouldRunGstackVerifier(task, { reason })) return task

  const url = extractTaskVerificationUrl(task)
  const existingChildren = getChildTasks(task.id, 100)
  const existingVerifier = existingChildren.find((entry) => (
    entry.taskType === 'verifier'
    && entry.assignedAgent === 'gstack-browse'
    && (
      !['completed', 'failed'].includes(String(entry.status || '').toLowerCase())
      || (Number(entry.lastUpdate || entry.memoryUpdatedAt || entry.completedAt || 0) > 0
        && now - Number(entry.lastUpdate || entry.memoryUpdatedAt || entry.completedAt || 0) < SIDECAR_REDISPATCH_WINDOW_MS)
    )
  ))

  if (existingVerifier) return task

  const childTask = createTask({
    requestId: task.requestId || null,
    parentTaskId: task.id,
    rootTaskId: task.rootTaskId || task.id,
    taskType: 'verifier',
    sourceAgent: 'gstack',
    mergePolicy: 'blocking_review',
    graphDepth: Number(task.graphDepth || 0) + 1,
    title: `外腦驗證｜gstack｜${cleanContent(task.title || task.detail || task.id || '未命名任務')}`.slice(0, 120),
    detail: `gstack verifier 針對主任務補一輪 outside voice / browser 驗證。URL: ${url}`,
    assignedAgent: 'gstack-browse',
    status: 'in_progress',
    brainMode: 'execution',
    brainState: {
      objective: `驗證主任務：${cleanContent(task.title || task.detail || task.id || '未命名任務')}`,
      focus: '用 gstack browse 補一輪 browser / route 驗證',
      summary: 'gstack verifier 已被叫進這題。',
      nextCheckpoint: '回報 verifier 結果並回流主任務',
      evidence: [`verification target: ${url}`],
      updatedBy: 'workflow-gstack-verifier',
    },
    riskTier: maxRiskTier(task.riskTier || inferRiskTierFromTask(task), 'medium'),
    retryBudget: 1,
    autoContinueAllowed: false,
    autoApplyAllowed: false,
    createdAt: now,
    lastUpdate: now,
  })
  emitTaskUpdate(childTask.id)

  let dispatch = null
  let runningChildTask = childTask
  try {
    dispatch = await dispatchDetachedGstackTask(childTask, { reason, now })
    runningChildTask = updateTask(childTask.id, {
      status: 'in_progress',
      startedAt: childTask.startedAt || now,
      dispatchSessionKey: dispatch.sessionKey,
      dispatchRunId: dispatch.runId,
      completedAt: null,
      result: null,
      closedByParent: false,
      resolutionSource: null,
      lastUpdate: now,
      ...buildTaskMemoryPatchFromBody(childTask, {}, {
        mode: 'execution',
        focus: '用 gstack browse 補一輪 browser / route 驗證',
        summary: 'gstack verifier 已在背景接手這題。',
        nextCheckpoint: '回報 verifier 結果並回流主任務',
        openLoops: ['等待 gstack verifier 回報'],
        evidence: [
          `verification target: ${url}`,
          `gstack verifier dispatched ${dispatch.runId}`,
        ],
        delegation: {
          currentStatus: 'running',
          reviewerMode: reason,
          sessionKey: dispatch.sessionKey,
          runId: dispatch.runId,
          nextHandoff: 'gstack verifier 回報結果並回流主任務',
          notes: `gstack verifier target ${url}`,
        },
        updatedBy: 'workflow-gstack-verifier',
      }, now),
    }) || childTask
    emitTaskUpdate(runningChildTask.id)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const failedChildTask = updateTask(childTask.id, {
      status: 'failed',
      completedAt: now,
      result: message,
      resolutionSource: 'dispatch_failed',
      closedByParent: false,
      lastUpdate: now,
      ...buildTaskMemoryPatchFromBody(childTask, {}, {
        mode: 'blocked',
        focus: 'gstack verifier 派送失敗，等待重試或人工介入',
        summary: 'gstack verifier 尚未成功收到任務。',
        nextCheckpoint: '等待下一次 gstack verifier 派送成功',
        blockers: [message],
        openLoops: ['等待 gstack verifier 派送成功'],
        evidence: [`gstack dispatch error: ${message}`],
        rootCause: message,
        delegation: {
          currentStatus: 'dispatch_failed',
          reviewerMode: reason,
          nextHandoff: '等待下一輪重派或由其他 reviewer 補位',
          notes: message,
        },
        updatedBy: 'workflow-gstack-verifier',
      }, now),
    }) || childTask
    emitTaskUpdate(failedChildTask.id)

    const failedParent = updateTask(task.id, {
      ...buildTaskBrainPatch(task, {
        evidence: [`gstack verifier dispatch failed: ${message}`],
        delegation: {
          currentStatus: task?.delegationPlan?.currentStatus || task?.status || 'in_progress',
          sidecarDispatches: [{
            agentId: 'gstack-browse',
            taskId: childTask.id,
            purpose: reason,
            status: 'dispatch_failed',
            dispatchedAt: now,
            updatedAt: now,
            notes: message,
          }],
          lastSuggestedDispatchAt: now,
          notes: `gstack verifier 派送失敗：${message}`,
        },
        updatedBy: 'workflow-gstack-verifier',
      }, now),
      lastUpdate: now,
    }) || task
    emitTaskUpdate(task.id)
    return failedParent
  }

  const patched = updateTask(task.id, {
    ...buildTaskBrainPatch(task, {
      evidence: [`gstack verifier queued for ${url}`],
      delegation: {
        currentStatus: task?.delegationPlan?.currentStatus || task?.status || 'in_progress',
        sidecarDispatches: [{
          agentId: 'gstack-browse',
          taskId: runningChildTask.id,
          purpose: reason,
          status: 'running',
          sessionKey: dispatch.sessionKey,
          runId: dispatch.runId,
          dispatchedAt: dispatch.dispatchedAt || now,
          updatedAt: now,
          notes: `gstack verifier target ${url}`,
        }],
        lastSuggestedDispatchAt: now,
        notes: `gstack verifier 已被叫進：${url}`,
      },
      updatedBy: 'workflow-gstack-verifier',
    }, now),
    lastUpdate: now,
  }) || task
  emitTaskUpdate(task.id)

  return patched
}

async function ensureReviewerCoverage(task, { reason = 'continuation-review', now = Date.now() } = {}) {
  if (!task?.id || !isPrimaryTask(task)) return task
  const riskTier = normalizeRiskTier(task.riskTier || inferRiskTierFromTask(task))
  if (!['medium', 'high', 'irreversible'].includes(riskTier)) return task

  // 若已有過 sidecar attempt（無論成功或 auto-closed），不再重派，避免無限循環
  const alreadyHadSidecarAttempt = (task.delegationPlan?.sidecarDispatches || []).some(
    (d) => d.status === 'completed' || d.status === 'failed'
  )
  if (alreadyHadSidecarAttempt) return task

  const reviewerCount = Array.isArray(task.reviewerResults) ? task.reviewerResults.length : 0
  const childTasks = getChildTasks(task.id, 100)
  const activeReviewers = childTasks.filter((child) => (
    ['sidecar_review', 'verifier'].includes(String(child.taskType || ''))
    && !['completed', 'failed'].includes(String(child.status || '').toLowerCase())
  ))

  if (reviewerCount > 0 || activeReviewers.length > 0) return task

  let nextTask = await dispatchSidecarReviewers(task, { reason, now })
  nextTask = await dispatchGstackVerifier(nextTask || task, { reason, now })
  return nextTask
}

function enforceHumanGate(task, reason, { now = Date.now(), keepPendingAction = true } = {}) {
  const patched = updateTask(task.id, {
    status: 'blocked',
    milestone: '等待人工 gate',
    nextStep: reason,
    continuationRequired: keepPendingAction,
    pendingAction: keepPendingAction ? (task.pendingAction || 'continue_after_reply') : null,
    continuationCheckedAt: now,
    completionGateRequired: true,
    lastUpdate: task.lastUpdate || now,
    humanGateReason: reason,
    autoContinueAllowed: false,
    escalationLevel: Math.max(Number(task.escalationLevel || 0), 2),
    ...buildTaskMemoryPatchFromBody(task, {}, {
      mode: 'blocked',
      focus: '等待老闆決策或人工放行',
      summary: reason,
      nextCheckpoint: '等待老闆放行或改道',
      blockers: [reason],
      openLoops: ['等待人工 gate'],
      evidence: [`human gate: ${reason}`],
      updatedBy: 'workflow-governor',
    }, now),
  }) || getTaskById(task.id)
  syncRequestStateFromTask(patched)
  return patched
}

function closeChildTasksForParent(parentTask, {
  status = 'completed',
  result = 'Closed by parent task',
  completedAt = Date.now(),
  resolutionSource = 'parent',
} = {}) {
  if (!parentTask?.id) return []

  const childTasks = getChildTasks(parentTask.id, 100)
    .filter((child) => !['completed', 'failed'].includes(String(child.status || '').toLowerCase()))

  for (const child of childTasks) {
    updateTask(child.id, {
      status,
      closedByParent: true,
      resolutionSource,
      completedAt,
      result: child.result || result,
      milestone: child.milestone || '主任務已收斂',
      nextStep: '由主任務結案時一併關閉',
      continuationRequired: false,
      pendingAction: null,
      completionGateRequired: false,
      lastUpdate: completedAt,
      ...buildTaskMemoryPatchFromBody(child, {}, {
        mode: status === 'completed' ? 'review' : 'blocked',
        summary: child.brainState?.summary || '主任務已收斂，此 child task 一併關閉。',
        nextCheckpoint: '無',
        openLoops: [],
        blockers: status === 'failed' ? ['主任務未收斂，child task 一併結束'] : [],
        evidence: [`closed by parent ${parentTask.id}`],
        updatedBy: 'workflow-parent-close',
      }, completedAt),
    })
    emitTaskUpdate(child.id)
  }

  return childTasks
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function normalizeCompletionFeedback({ success = true, body = {}, task = null, taskTimeMs = null } = {}) {
  const completionValue = Number(body?.completionValue)
  const completionValueNormalized = Number.isFinite(completionValue) ? completionValue : null
  const explicitRollback = body?.rollbackNeeded === undefined ? null : Boolean(body.rollbackNeeded)
  const reopenRate = Number(body?.reopenRate)
  const reopenPenalty = Number.isFinite(reopenRate)
    ? clamp(reopenRate, 0, 1)
    : (Number(body?.reopenCount || 0) > 0 ? 0.5 : 0)
  const rollbackRate = explicitRollback === true ? 1 : 0
  const defaultSlaMs = Number(body?.expectedDurationMs)
  const fallbackSlaMs = Number.isFinite(defaultSlaMs) && defaultSlaMs > 0 ? defaultSlaMs : (4 * 60 * 60 * 1000)
  const elapsedMs = Number.isFinite(taskTimeMs) ? taskTimeMs : null
  const timelinessScore = elapsedMs === null
    ? (success ? 0.25 : -0.25)
    : clamp(1 - (elapsedMs / fallbackSlaMs), -1, 1)
  const processScore = clamp(
    (timelinessScore * 0.6) +
    ((success ? 0.3 : -0.5) * 0.4) -
    (reopenPenalty * 0.5) -
    (rollbackRate * 0.7),
    -1,
    1,
  )

  const businessDelta = Number(body?.businessDelta)
  const effectiveBusinessDelta = Number.isFinite(businessDelta)
    ? businessDelta
    : (completionValueNormalized ?? 0)
  const valueScore = clamp(effectiveBusinessDelta / 100000, -1, 1)
  const recurringBlockerDelta = Number(body?.recurringBlockerDelta)
  const blockerReliefScore = Number.isFinite(recurringBlockerDelta)
    ? clamp((-recurringBlockerDelta) / 3, -1, 1)
    : 0
  const attentionType = String(body?.attentionType || task?.attentionType || '').toLowerCase()
  const conversionBias = ['opportunity', 'decision'].includes(attentionType)
    ? (success ? 0.35 : -0.35)
    : (success ? 0.18 : -0.22)
  const businessScore = clamp(
    (valueScore * 0.65) +
    (blockerReliefScore * 0.2) +
    (conversionBias * 0.15),
    -1,
    1,
  )

  const providedDidImproveScore = Number(body?.didImproveScore)
  const didImproveScore = Number.isFinite(providedDidImproveScore)
    ? clamp(providedDidImproveScore, -1, 1)
    : clamp((0.4 * processScore) + (0.6 * businessScore), -1, 1)
  const rollbackNeeded = explicitRollback === null ? didImproveScore < 0 : explicitRollback
  const didImprove = body?.didImprove === undefined
    ? didImproveScore >= 0.2
    : Boolean(body.didImprove)
  return {
    completionValue: completionValueNormalized,
    businessDelta: Number.isFinite(effectiveBusinessDelta) ? effectiveBusinessDelta : null,
    processScore,
    businessScore,
    didImproveScore,
    didImprove,
    rollbackNeeded,
  }
}

function writeCompletionFeedbackToAttention({
  taskId,
  requestId,
  result,
  completionValue,
  businessDelta,
  processScore,
  businessScore,
  didImproveScore,
  didImprove,
  rollbackNeeded,
}) {
  try {
    recordAttentionTaskFeedback({
      taskId: taskId || null,
      requestId: requestId || null,
      taskResult: result || null,
      completionValue,
      businessDelta,
      processScore,
      businessScore,
      didImproveScore,
      didImprove,
      rollbackNeeded,
      reviewer: 'workflow-api',
    })
  } catch (error) {
    console.error('[workflow] Failed to record attention feedback:', error.message)
  }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const type = searchParams.get('type')
  
  if (type === 'events') {
    const limit = parseInt(searchParams.get('limit') || '50', 10)
    const offset = parseInt(searchParams.get('offset') || '0', 10)
    const result = getEventsPaginated(limit, offset)
    return Response.json(result)
  }
  
  if (type === 'active') {
    const active = getRequests(10, true)
    return Response.json({ requests: active })
  }

  if (type === 'tasks') {
    const limit = parseInt(searchParams.get('limit') || '20', 10)
    const activeOnly = searchParams.get('active') === 'true'
    const tasks = activeOnly ? getActiveTasks(limit) : getRecentTasks(limit)
    return Response.json({ tasks })
  }
  
  return Response.json({ 
    requests: getRequests(20),
    events: getEvents(30),
    tasks: getRecentTasks(10),
  })
}

export async function POST(request) {
  try {
    assertOfficeApiRequest(request)
  } catch (error) {
    return Response.json({ error: error.message || 'Unauthorized office request' }, { status: getOfficeRequestErrorStatus(error, 401) })
  }

  try {
    const body = await request.json()
    const { action } = body
    
    // ─────────────────────────────────────────────────────────
    // ACTION: start_flow - Called when agent starts processing
    // Creates request + task. Returns both IDs.
    // ─────────────────────────────────────────────────────────
    if (action === 'start_flow') {
      const {
        content,
        from = 'Boss',
        agent = 'wickedman',
        messageId,
        delegatedTo,
        autonomousHandoff = false,
        source = 'api',
      } = body
      const attentionMeta = mergeAttentionMeta(body, body.task)
      const deferDispatchUntilIdleMs = Number(body.deferDispatchUntilIdleMs || 0)
      
      if (!content) {
        return Response.json({ error: 'content is required' }, { status: 400 })
      }

      // Chain support: auto-generate chainId if not provided
      const chainId = body.chainId || `chain_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      
      // Check if this is a chain continuation (existing chainId with completed requests)
      const previousInChain = body.chainId ? findLastCompletedInChain(body.chainId) : null
      const isChainContinuation = !!previousInChain

      const requestedAgent = delegatedTo || agent
      const finalAgent = autonomousHandoff
        ? pickAutonomousWorkerAgent(requestedAgent)
        : requestedAgent
      const shouldDispatchViaWorkflow = Boolean(delegatedTo) || autonomousHandoff || deferDispatchUntilIdleMs > 0 || isGstackBrowseAgent(finalAgent)
      const cleanText = cleanContent(content)
      
      // DEDUP: Check if we already have an entry for this message
      let req = null
      let adopted = false

      if (messageId) {
        req = findByTgMessageId(messageId)
        if (req) {
          adopted = true
          updateRequest(req.id, {
            assignedTo: finalAgent,
            content: content || req.content,
            chainId,
            source: source || req.source || 'api',
            ...attentionMeta,
          })
          if (content) {
            fixPlaceholderEvents(req.id, content)
            createEvent(req.id, 'received', 'wickedman', `📥 Request from ${from}: "${cleanText.slice(0, 60)}${cleanText.length > 60 ? '...' : ''}"`)
          }
        }
      }

      // FIFO fallback
      if (!req) {
        const placeholder = findOldestReceived()
        if (placeholder && (placeholder.state === 'received' || placeholder.state === 'analyzing')) {
          req = placeholder
          adopted = true
          updateRequest(placeholder.id, {
            assignedTo: finalAgent,
            content: content || placeholder.content,
            tgMessageId: messageId || null,
            chainId,
            source: source || placeholder.source || 'api',
            ...attentionMeta,
          })
          if (content) {
            fixPlaceholderEvents(placeholder.id, content)
            createEvent(placeholder.id, 'received', 'wickedman', `📥 Request from Boss: "${cleanText.slice(0, 60)}${cleanText.length > 60 ? '...' : ''}"`)
          }
        }
      }

      // Create new request if no adoption
      if (!req) {
        req = createRequest({
          id: `req_${Date.now()}`,
          content,
          from,
          state: 'received',
          assignedTo: finalAgent,
          task: null,
          createdAt: Date.now(),
          tgMessageId: messageId || null,
          source,
          chainId,
          ...attentionMeta,
        })
        incrementMessages('received')
        createEvent(req.id, 'received', 'wickedman', `📥 Request from ${from}: "${cleanText.slice(0, 60)}${cleanText.length > 60 ? '...' : ''}"`)
      }

      emitRequestUpdate(req.id)

      const taskSeed = {
        title: cleanText.slice(0, 80) + (cleanText.length > 80 ? '...' : ''),
        detail: cleanText,
        assignedAgent: finalAgent,
        nextStep: delegatedTo
          ? '等待代理開始處理'
          : (isResearchOperatorTask({ assignedAgent: finalAgent }, body)
            ? '先完成研究盤點，接著自動派工 / 驗證 / 續跑'
            : '持續處理與回報里程碑'),
      }
      const governanceSeed = buildTaskGovernanceDefaults({
        ...taskSeed,
        attentionType: attentionMeta.attentionType,
        needsDecision: attentionMeta.needsDecision,
      })
      const shouldGateBeforeStart = Boolean(governanceSeed.humanGateReason)
      const taskStatus = shouldDispatchViaWorkflow || shouldGateBeforeStart ? 'pending' : 'in_progress'
      const taskStartedAt = shouldDispatchViaWorkflow || shouldGateBeforeStart ? null : Date.now()
      let task = ensurePrimaryTask(req.id, {
        title: taskSeed.title,
        detail: taskSeed.detail,
        assignedAgent: taskSeed.assignedAgent,
        taskType: 'primary',
        sourceAgent: 'wickedman',
        status: taskStatus,
        createdAt: Date.now(),
        startedAt: taskStartedAt,
        ...taskProgressMeta(shouldDispatchViaWorkflow || shouldGateBeforeStart ? 'assigned' : 'in_progress', {}, taskSeed),
        brainMode: autonomousHandoff
          ? 'autonomous_handoff'
          : (shouldDispatchViaWorkflow || shouldGateBeforeStart ? 'queued' : 'execution'),
        ...governanceSeed,
        ...attentionMeta,
      })

      const memorySeed = {
        mode: autonomousHandoff ? 'autonomous_handoff' : (shouldDispatchViaWorkflow || shouldGateBeforeStart ? 'queued' : 'execution'),
        objective: cleanText,
        scope: body.scope || body.brainState?.scope || body.delegationPlan?.scope || null,
        researchLoop: body.researchLoop || body.brainState?.researchLoop || body.delegationPlan?.researchLoop || null,
        operatorMode: body.operatorMode || body.brainState?.operatorMode || body.delegationPlan?.operatorMode || null,
        autonomyPolicy: body.autonomyPolicy || body.brainState?.autonomyPolicy || body.delegationPlan?.autonomyPolicy || null,
        outputContract: body.outputContract || body.brainState?.outputContract || body.delegationPlan?.outputContract || null,
        focus: autonomousHandoff
          ? '自治交辦已正式建檔，等待 worker / reviewer / verifier 接手。'
          : (shouldDispatchViaWorkflow ? '等待正式 workflow 接手與推進。' : '直接進 execution mode 處理。'),
        summary: autonomousHandoff
          ? '已接手自治交辦，這題會持續追到收斂。'
          : (shouldDispatchViaWorkflow ? '任務已入 workflow 佇列。' : '任務已開始執行。'),
        nextCheckpoint: shouldGateBeforeStart
          ? '等待人工 gate'
          : (shouldDispatchViaWorkflow ? '等待第一輪 dispatch / reviewer / verifier 啟動' : taskSeed.nextStep),
        delegation: {
          currentStatus: shouldGateBeforeStart
            ? 'waiting_human_gate'
            : (shouldDispatchViaWorkflow ? 'queued' : 'running'),
          researchLoop: body.researchLoop || body.delegationPlan?.researchLoop || null,
          operatorMode: body.operatorMode || body.delegationPlan?.operatorMode || null,
          autonomyPolicy: body.autonomyPolicy || body.delegationPlan?.autonomyPolicy || null,
          outputContract: body.outputContract || body.delegationPlan?.outputContract || null,
          scope: body.scope || body.delegationPlan?.scope || null,
          downstreamMatrix: body.downstreamMatrix || body.delegationPlan?.downstreamMatrix || null,
          nextHandoff: shouldGateBeforeStart
            ? '等待老闆決策'
            : (shouldDispatchViaWorkflow ? '等待正式 worker / reviewer / verifier 接手' : '持續執行直到完成'),
          notes: sanitizeTextValue(body.routingReason || body.reason || ''),
        },
        updatedBy: 'workflow-start-flow',
      }

      task = updateTask(task.id, {
        lastUpdate: Date.now(),
        ...buildTaskMemoryPatchFromBody(task, body, memorySeed, Date.now()),
      }) || getTaskById(task.id) || task

      // Sync request state from task
      syncRequestStateFromTask(task)
      emitRequestUpdate(req.id)
      emitTaskUpdate(task.id)

      // Animation events (delayed for visual effect)
      // For chain continuations, add extra delay for return animation + reviewing
      const chainDelay = isChainContinuation ? 2500 : 0
      const previousAgent = previousInChain?.assignedTo || null

      if (shouldDispatchViaWorkflow && !shouldGateBeforeStart) {
        // Chain continuation: emit return animation event first
        if (delegatedTo && isChainContinuation && previousAgent) {
          // Immediately emit chain_continue event so frontend can show return mail
          eventBus.emit(EVENTS.WORKFLOW_EVENT, {
            id: `evt_chain_${Date.now()}`,
            requestId: req.id,
            state: 'chain_return',
            agent: previousAgent,
            agentColor: AGENTS[previousAgent]?.color || '#888',
            agentName: AGENTS[previousAgent]?.name || previousAgent,
            message: `📨 ${AGENTS[previousAgent]?.name || previousAgent} returning results to WickedMan`,
            targetAgent: 'wickedman',
            time: timeStr(),
            timestamp: Date.now(),
            chainId,
          })

          // After return animation, show WickedMan reviewing
          setTimeout(() => {
            const t = getTaskById(task.id)
            if (!t || t.status === 'completed' || t.status === 'failed') return
            updateRequest(req.id, { state: 'reviewing' })
            createEvent(req.id, 'reviewing', 'wickedman', `🔄 Reviewing results from ${AGENTS[previousAgent]?.name || previousAgent}...`)
            emitRequestUpdate(req.id)
          }, 1500)
        }

        // DELEGATION FLOW animations (with chainDelay offset)
        setTimeout(() => {
          const t = getTaskById(task.id)
          if (!t || t.status === 'completed' || t.status === 'failed') return
          updateRequest(req.id, { state: 'analyzing' })
          createEvent(req.id, 'analyzing', 'wickedman', `🔍 Analyzing: "${cleanText.slice(0, 50)}${cleanText.length > 50 ? '...' : ''}"`)
          emitRequestUpdate(req.id)
        }, chainDelay + 500)

        setTimeout(() => {
          const t = getTaskById(task.id)
          if (!t || t.status === 'completed' || t.status === 'failed') return
          updateRequest(req.id, {
            state: 'task_created',
            task: {
              id: task.id,
              title: task.title,
              detail: task.detail,
              targetAgent: finalAgent,
            },
          })
          createEvent(req.id, 'task_created', 'wickedman', `📋 Task → ${AGENTS[finalAgent]?.emoji || '🤖'} ${AGENTS[finalAgent]?.name || finalAgent}: "${task.title}"`)
          emitRequestUpdate(req.id)
        }, chainDelay + 1200)

        setTimeout(() => {
          const t = getTaskById(task.id)
          if (!t || t.status === 'completed' || t.status === 'failed') return
          updateTask(task.id, {
            status: 'assigned',
            ...taskProgressMeta('assigned', {}, t),
          })
          updateRequest(req.id, { state: 'assigned', assignedTo: finalAgent })
          createEvent(req.id, 'assigned', finalAgent, `📧 ${AGENTS[finalAgent]?.emoji || '🤖'} ${AGENTS[finalAgent]?.name || finalAgent} taking over`)
          emitRequestUpdate(req.id)
          emitTaskUpdate(task.id)
        }, chainDelay + 1800)

        queuePendingActionExecution(task.id, req.id, {
          delayMs: chainDelay + (deferDispatchUntilIdleMs > 0 ? deferDispatchUntilIdleMs : 3500),
          skipWhileRequestInProgress: autonomousHandoff,
          remainingDeferrals: autonomousHandoff ? 2 : 0,
        })
      } else if (!shouldGateBeforeStart) {
        // SELF-HANDLED: analyzing animation then WS handles rest
        setTimeout(() => {
          const t = getTaskById(task.id)
          if (!t || t.status === 'completed' || t.status === 'failed') return
          updateRequest(req.id, { state: 'analyzing' })
          createEvent(req.id, 'analyzing', 'wickedman', `🔍 Analyzing: "${cleanText.slice(0, 50)}${cleanText.length > 50 ? '...' : ''}"`)
          emitRequestUpdate(req.id)
        }, 500)
      } else {
        createEvent(req.id, 'assigned', 'wickedman', `🛑 這題先停在人工 gate：${governanceSeed.humanGateReason}`)
      }

      console.log(`[start_flow] ${adopted ? 'Adopted' : 'Created'} request ${req.id}, task ${task.id}: "${cleanText.slice(0, 50)}..." → ${finalAgent}${delegatedTo ? ' (delegated)' : ''}${isChainContinuation ? ` (chain continuation from ${previousAgent})` : ''}`)

      return Response.json({
        success: true,
        requestId: req.id,
        taskId: task.id,
        chainId,
        adopted,
        message: `Request created: ${content.slice(0, 50)}... → ${AGENTS[finalAgent]?.name || finalAgent}`,
        agent: finalAgent,
        delegated: !!delegatedTo,
        chainContinuation: isChainContinuation,
        previousAgent,
      })
    }

    // ─────────────────────────────────────────────────────────
    // ACTION: agent_complete - Complete active task by agent ID
    // Finds the active task for that agent and marks it completed.
    // ─────────────────────────────────────────────────────────
    if (action === 'agent_complete') {
      const { agent, result, success = true, taskId } = body
      let task = taskId ? getTaskById(taskId) : null
      const effectiveAgent = agent || task?.assignedAgent || null

      if (!task && !effectiveAgent) {
        return Response.json({ error: 'agent or taskId is required' }, { status: 400 })
      }

      if (!task && effectiveAgent) {
        task = getActiveTaskByAgent(effectiveAgent)
      }
      if (task && isChildTask(task)) {
        const updatedTask = await handleSidecarCompletion(task, {
          agent: effectiveAgent || task.assignedAgent,
          result,
          success,
          body,
          completedAt: Date.now(),
        })

        return Response.json({
          success: true,
          sidecar: true,
          requestId: task.requestId,
          taskId: task.id,
          parentTaskId: task.parentTaskId || null,
          task: updatedTask,
        })
      }
      if (!task) {
        const sidecarTask = findActiveTaskBySidecarAgent(effectiveAgent)
        if (!sidecarTask) return Response.json({ success: true, message: `No active task for ${effectiveAgent}`, noop: true })

        const updatedTask = await handleSidecarCompletion(sidecarTask, {
          agent: effectiveAgent || sidecarTask.assignedAgent,
          result,
          success,
          body,
          completedAt: Date.now(),
        })

        return Response.json({
          success: true,
          sidecar: true,
          requestId: sidecarTask.requestId,
          taskId: sidecarTask.id,
          parentTaskId: sidecarTask.parentTaskId || null,
          task: updatedTask,
        })
      }
      if (task.status === 'completed' || task.status === 'failed') {
        return Response.json({ success: true, message: 'Task already completed', noop: true })
      }

      const completedAt = Date.now()
      const taskTimeMs = task.startedAt ? completedAt - task.startedAt : 5000
      const feedback = normalizeCompletionFeedback({ success, body, task, taskTimeMs })
      const completionResult = result || (success ? 'Completed' : 'Failed')
      const shouldChaseRootCause = needsRootCauseFollowup({ success, body, task })
      const shouldAutoDelegateResearch = success && isResearchOperatorTask(task, body)
      const hasResearchConsultantStop = (
        success
        && isResearchOperatorTask(task, body)
        && hasConsultantStopSignal(`${completionResult}\n${body?.summary || ''}\n${body?.nextStep || ''}`)
      )
      const shouldContinue = (
        success
        && needsContinuationFromText(`${completionResult}\n${body?.summary || ''}\n${body?.nextStep || ''}`)
      ) || shouldChaseRootCause || shouldAutoDelegateResearch || hasResearchConsultantStop
      const completionAgent = effectiveAgent || task.assignedAgent || 'wickedman'
      const completionMemoryFallback = shouldChaseRootCause
        ? {
            mode: 'execution',
            focus: '上一輪失敗，先追根因與可行替代方案',
            summary: body?.summary || '代理上一輪未成功完成，系統要求繼續追根因，不在表面失敗點停止。',
            nextCheckpoint: body?.nextCheckpoint || body?.nextStep || '補上可驗證根因，並提出下一個安全可行方案',
            blockers: body?.blockers || ['上一輪未成功完成，需釐清根因'],
            openLoops: body?.openLoops || ['確認根因並提出替代方案'],
            evidence: body?.evidence || [completionResult],
            rootCause: body?.rootCause || task?.rootCause || null,
            evolutionNote: body?.evolutionNote || '若再次失敗，請一併提出 reviewer / verifier 與 guardrail 補強建議。',
            delegation: {
              currentStatus: 'awaiting-continuation',
              nextHandoff: body?.nextStep || '請先回報根因，再決定是否重跑或改道',
              notes: '系統判定上一輪失敗後仍需追根究底。',
              suggestedSubagents: body?.suggestedSubagents || body?.delegation?.suggestedSubagents,
            },
            updatedBy: completionAgent,
          }
        : hasResearchConsultantStop
        ? {
            mode: 'execution',
            focus: '研究魚不得停在顧問式收尾，請把研究壓成 control-plane artifact 並直接續跑',
            summary: body?.summary || '研究魚回報仍帶有顧問式停問訊號，系統要求改成正式 control-plane 輸出。',
            nextCheckpoint: body?.nextCheckpoint || body?.nextStep || '補上 decision brief / handoff brief / policy artifact，並直接派工或驗證',
            blockers: [],
            openLoops: body?.openLoops || ['把研究結論壓成可交辦 artifact 並直接續跑'],
            evidence: body?.evidence || [completionResult],
            rootCause: body?.rootCause || task?.rootCause || null,
            evolutionNote: body?.evolutionNote || '研究魚若再次出現 consultant 式停問，應補強 prompt、session hygiene 與 control-plane artifact 規範。',
            delegation: {
              currentStatus: 'awaiting-continuation',
              nextHandoff: body?.nextStep || '直接建立 downstream task / verifier 或治理 artifact',
              notes: '系統攔截到 consultant stop signal，要求 research-fish 續跑到 control-plane 輸出。',
              suggestedSubagents: body?.suggestedSubagents || body?.delegation?.suggestedSubagents,
            },
            updatedBy: completionAgent,
          }
        : shouldContinue
        ? {
            mode: 'execution',
            focus: '依上一輪回報中的未完事項繼續往下推',
            summary: body?.summary || '代理回報已有中間結果，但仍有未完成項目需要續跑。',
            nextCheckpoint: body?.nextCheckpoint || body?.nextStep || '等待續跑後的新結果',
            blockers: success ? [] : ['本輪回報未成功完成'],
            openLoops: body?.openLoops || [body?.nextStep || '等待續跑'],
            evidence: body?.evidence || [completionResult],
            rootCause: body?.rootCause || task?.rootCause || null,
            evolutionNote: body?.evolutionNote || null,
            delegation: {
              currentStatus: 'awaiting-continuation',
              nextHandoff: body?.nextStep || '續跑後回報新的可交付結果',
              notes: '系統已判定需要 continuation。',
              suggestedSubagents: body?.suggestedSubagents || body?.delegation?.suggestedSubagents,
            },
            updatedBy: completionAgent || 'workflow-api',
          }
        : {
            mode: success ? 'review' : 'blocked',
            focus: success ? '等待人工驗收交付' : '確認根因與替代方案',
            summary: body?.summary || (success ? '代理已完成任務並回報可交付結果。' : '代理回報任務卡住或失敗。'),
            nextCheckpoint: body?.nextCheckpoint || body?.nextStep || (success ? '查看結果並決定是否放行' : '補上根因與替代方案'),
            blockers: success ? [] : (body?.blockers || ['等待確認根因']),
            openLoops: success ? [] : (body?.openLoops || ['等待人工確認下一步']),
            evidence: body?.evidence || [completionResult],
            rootCause: body?.rootCause || (!success ? completionResult : task?.rootCause),
            evolutionNote: body?.evolutionNote || (success ? task?.evolutionNote : '可補強對應 guardrail 或 reviewer 覆核流程。'),
            delegation: {
              currentStatus: success ? 'idle' : 'blocked',
              nextHandoff: success ? '等待老闆驗收' : '確認根因後再決定是否重跑',
              notes: body?.delegationNote || null,
              suggestedSubagents: body?.suggestedSubagents || body?.delegation?.suggestedSubagents,
            },
            updatedBy: completionAgent || 'workflow-api',
          }
      
      updateTask(task.id, shouldContinue ? {
        status: 'in_progress',
        closedByParent: false,
        resolutionSource: null,
        milestone: shouldChaseRootCause ? '失敗後追根因' : '回報後續跑',
        nextStep: body?.nextStep || (shouldChaseRootCause ? '先補上根因與替代方案，再決定是否重跑' : '依回報中的未完項目繼續執行'),
        continuationRequired: true,
        pendingAction: 'continue_after_reply',
        continuationCheckedAt: null,
        completionGateRequired: false,
        lastUpdate: completedAt,
        result: completionResult,
        completionValue: feedback.completionValue,
        businessDelta: feedback.businessDelta,
        processScore: feedback.processScore,
        businessScore: feedback.businessScore,
        didImproveScore: feedback.didImproveScore,
        didImprove: feedback.didImprove,
        rollbackNeeded: feedback.rollbackNeeded,
        ...buildTaskMemoryPatchFromBody(task, body, completionMemoryFallback, completedAt),
      } : {
        status: success ? 'completed' : 'failed',
        closedByParent: false,
        resolutionSource: 'self',
        completedAt,
        ...taskProgressMeta(success ? 'completed' : 'failed', {}, task),
        result: completionResult,
        completionValue: feedback.completionValue,
        businessDelta: feedback.businessDelta,
        processScore: feedback.processScore,
        businessScore: feedback.businessScore,
        didImproveScore: feedback.didImproveScore,
        didImprove: feedback.didImprove,
        rollbackNeeded: feedback.rollbackNeeded,
        ...buildTaskMemoryPatchFromBody(task, body, completionMemoryFallback, completedAt),
      })
      const updatedTask = refreshPrimaryTaskIntelligence(task.id, {
        now: completedAt,
        persistRule: !shouldContinue,
      }) || getTaskById(task.id)
      const delegatedTask = shouldAutoDelegateResearch
        ? await dispatchResearchFollowupTasks(updatedTask || task, body, completedAt)
        : (updatedTask || task)
      if (!shouldContinue) {
        closeChildTasksForParent(updatedTask || task, {
          status: success ? 'completed' : 'failed',
          completedAt,
          result: success ? 'Closed by completed parent task' : 'Closed by failed parent task',
          resolutionSource: 'parent',
        })
      }
      emitTaskUpdate(task.id)
      notifyTaskMilestone(delegatedTask || updatedTask, shouldContinue ? 'continued' : (success ? 'completed' : 'failed'))
      writeCompletionFeedbackToAttention({
        taskId: task.id,
        requestId: task.requestId,
        result: completionResult,
        completionValue: feedback.completionValue,
        businessDelta: feedback.businessDelta,
        processScore: feedback.processScore,
        businessScore: feedback.businessScore,
        didImproveScore: feedback.didImproveScore,
        didImprove: feedback.didImprove,
        rollbackNeeded: feedback.rollbackNeeded,
      })

      const normalizedAgent = completionAgent || task.assignedAgent || 'wickedman'
      const savings = recordTaskCompletion(normalizedAgent, taskTimeMs)
      incrementMessages('sent')

      const agentName = AGENTS[normalizedAgent]?.name || normalizedAgent
      const emoji = success ? '✅' : '❌'
      const title = cleanContent(task.title || task.detail || '')
      createEvent(task.requestId, 'completed', normalizedAgent, `${emoji} ${agentName} completed: "${title.slice(0, 50)}${title.length > 50 ? '...' : ''}"`)

      // Chain: emit return-to-WickedMan animation after agent completes
      // This shows the result flowing back to WickedMan (the orchestrator)
      if (task.requestId && normalizedAgent !== 'wickedman') {
        const req = getRequestById(task.requestId)
        if (req) {
          setTimeout(() => {
            eventBus.emit(EVENTS.WORKFLOW_EVENT, {
              id: `evt_return_${Date.now()}`,
              requestId: task.requestId,
              state: 'chain_return',
              agent: normalizedAgent,
              agentColor: AGENTS[normalizedAgent]?.color || '#888',
              agentName: AGENTS[normalizedAgent]?.name || normalizedAgent,
              message: `📨 ${agentName} returning results to WickedMan`,
              targetAgent: 'wickedman',
              time: timeStr(),
              timestamp: Date.now(),
            })
          }, 500)

          // Show WickedMan receiving + delivering
          setTimeout(() => {
            createEvent(task.requestId, 'delivering', 'wickedman', `📬 WickedMan received results from ${agentName}`)
            emitRequestUpdate(task.requestId)
          }, 2500)
        }
      }

      if (shouldContinue) {
        await runPendingAction(delegatedTask || getTaskById(task.id), completedAt, 'immediate continuation dispatch')
      }

      return Response.json({ success: true, requestId: task.requestId, taskId: task.id, savings, taskTimeMs })
    }

    // ─────────────────────────────────────────────────────────
    // ACTION: delegate_complete - Mark a delegated task as complete
    // By request ID or task ID
    // ─────────────────────────────────────────────────────────
    if (action === 'delegate_complete') {
      const { requestId, taskId, agent, result, success = true } = body
      
      let task = null
      if (taskId) {
        task = getTaskById(taskId)
      } else if (requestId) {
        task = getTaskByRequestId(requestId)
      }
      if (!task) return Response.json({ error: 'Task not found' }, { status: 404 })

      if (isChildTask(task)) {
        const updatedTask = await handleSidecarCompletion(task, {
          agent: agent || task.assignedAgent,
          result,
          success,
          body,
          completedAt: Date.now(),
        })

        return Response.json({
          success: true,
          sidecar: true,
          requestId: task.requestId,
          taskId: task.id,
          parentTaskId: task.parentTaskId || null,
          task: updatedTask,
        })
      }

      if (task.status === 'completed' || task.status === 'failed') {
        return Response.json({ success: true, taskId: task.id, alreadyCompleted: true })
      }

      const completedAt = Date.now()
      const taskTimeMs = task.startedAt ? completedAt - task.startedAt : 5000
      const feedback = normalizeCompletionFeedback({ success, body, task, taskTimeMs })
      const completionResult = result || (success ? 'Completed' : 'Failed')
      const effectiveAgent = agent || task.assignedAgent || 'wickedman'
      const shouldChaseRootCause = needsRootCauseFollowup({ success, body, task })
      const shouldAutoDelegateResearch = success && isResearchOperatorTask(task, body)
      const hasResearchConsultantStop = (
        success
        && isResearchOperatorTask(task, body)
        && hasConsultantStopSignal(`${completionResult}\n${body?.summary || ''}\n${body?.nextStep || ''}`)
      )
      const shouldContinue = (
        success
        && needsContinuationFromText(`${completionResult}\n${body?.summary || ''}\n${body?.nextStep || ''}`)
      ) || shouldChaseRootCause || shouldAutoDelegateResearch || hasResearchConsultantStop
      const completionMemoryFallback = shouldChaseRootCause
        ? {
            mode: 'execution',
            focus: 'delegated 任務上一輪失敗，先追根因與替代方案',
            summary: body?.summary || 'delegated 任務未成功完成，系統要求繼續追根因，不先停在失敗結論。',
            nextCheckpoint: body?.nextCheckpoint || body?.nextStep || '補上 delegated 根因與下一個安全可行方案',
            blockers: body?.blockers || ['delegated 任務未成功完成，待釐清根因'],
            openLoops: body?.openLoops || ['確認 delegated 根因並提出替代方案'],
            evidence: body?.evidence || [completionResult],
            rootCause: body?.rootCause || task?.rootCause || null,
            evolutionNote: body?.evolutionNote || '若再次失敗，請補 delegated reviewer / verifier 與驗證切面建議。',
            delegation: {
              currentStatus: 'awaiting-continuation',
              nextHandoff: body?.nextStep || '請先回報 delegated 根因，再決定是否重跑或改道',
              notes: '系統判定 delegated 任務失敗後仍需追根究底。',
              suggestedSubagents: body?.suggestedSubagents || body?.delegation?.suggestedSubagents,
            },
            updatedBy: effectiveAgent,
          }
        : hasResearchConsultantStop
        ? {
            mode: 'execution',
            focus: '研究 follow-up 不得停在顧問式建議，請直接壓成 control-plane artifact 並續跑',
            summary: body?.summary || 'research delegated task 仍帶有顧問式停問訊號，系統要求繼續往可交付 artifact 推進。',
            nextCheckpoint: body?.nextCheckpoint || body?.nextStep || '補上可交辦 artifact 並直接推進下一個 owner',
            openLoops: body?.openLoops || ['把 delegated 研究結論壓成正式 artifact 並續跑'],
            evidence: body?.evidence || [completionResult],
            rootCause: body?.rootCause || task?.rootCause || null,
            evolutionNote: body?.evolutionNote || 'delegated research 若再次出現 consultant stop signal，應補強 artifact contract。',
            delegation: {
              currentStatus: 'awaiting-continuation',
              nextHandoff: body?.nextStep || '直接建立下一個 owner 的 task / verifier / policy artifact',
              notes: '系統攔截到 consultant stop signal，要求 delegated research 續跑。',
              suggestedSubagents: body?.suggestedSubagents || body?.delegation?.suggestedSubagents,
            },
            updatedBy: effectiveAgent || 'workflow-api',
          }
        : shouldContinue
        ? {
            mode: 'execution',
            focus: '延續 delegated 回報中的未完事項',
            summary: body?.summary || '已收到 delegated 結果，但仍有未完成項目待續跑。',
            nextCheckpoint: body?.nextCheckpoint || body?.nextStep || '等待下一輪 delegated 結果',
            openLoops: body?.openLoops || [body?.nextStep || '等待續跑'],
            evidence: body?.evidence || [completionResult],
            rootCause: body?.rootCause || task?.rootCause || null,
            evolutionNote: body?.evolutionNote || null,
            delegation: {
              currentStatus: 'awaiting-continuation',
              nextHandoff: body?.nextStep || '續跑後回報新的 delegated 結果',
              notes: 'delegated task 已被標記為需要續跑。',
              suggestedSubagents: body?.suggestedSubagents || body?.delegation?.suggestedSubagents,
            },
            updatedBy: effectiveAgent || 'workflow-api',
          }
        : {
            mode: success ? 'review' : 'blocked',
            focus: success ? '等待人工驗收 delegated 結果' : '確認 delegated 任務根因',
            summary: body?.summary || (success ? 'delegated 任務已完成並回報結果。' : 'delegated 任務回報失敗或卡住。'),
            nextCheckpoint: body?.nextCheckpoint || body?.nextStep || (success ? '查看結果並決定是否放行' : '確認根因與替代方案'),
            blockers: success ? [] : (body?.blockers || ['等待確認 delegated 任務根因']),
            openLoops: success ? [] : (body?.openLoops || ['等待下一步決策']),
            evidence: body?.evidence || [completionResult],
            rootCause: body?.rootCause || (!success ? completionResult : task?.rootCause),
            evolutionNote: body?.evolutionNote || (success ? task?.evolutionNote : '可補強 delegated reviewer / verifier 流程。'),
            delegation: {
              currentStatus: success ? 'idle' : 'blocked',
              nextHandoff: success ? '等待老闆驗收' : '確認 delegated 根因後決定是否重跑',
              notes: body?.delegationNote || null,
              suggestedSubagents: body?.suggestedSubagents || body?.delegation?.suggestedSubagents,
            },
            updatedBy: effectiveAgent || 'workflow-api',
          }

      updateTask(task.id, shouldContinue ? {
        status: 'in_progress',
        closedByParent: false,
        resolutionSource: null,
        milestone: shouldChaseRootCause ? '失敗後追根因' : '回報後續跑',
        nextStep: body?.nextStep || (shouldChaseRootCause ? '先補上 delegated 根因與替代方案，再決定是否重跑' : '依回報中的未完項目繼續執行'),
        continuationRequired: true,
        pendingAction: 'continue_after_reply',
        continuationCheckedAt: null,
        completionGateRequired: false,
        lastUpdate: completedAt,
        result: completionResult,
        completionValue: feedback.completionValue,
        businessDelta: feedback.businessDelta,
        processScore: feedback.processScore,
        businessScore: feedback.businessScore,
        didImproveScore: feedback.didImproveScore,
        didImprove: feedback.didImprove,
        rollbackNeeded: feedback.rollbackNeeded,
        ...buildTaskMemoryPatchFromBody(task, body, completionMemoryFallback, completedAt),
      } : {
        status: success ? 'completed' : 'failed',
        closedByParent: false,
        resolutionSource: 'self',
        completedAt,
        ...taskProgressMeta(success ? 'completed' : 'failed', {}, task),
        result: completionResult,
        completionValue: feedback.completionValue,
        businessDelta: feedback.businessDelta,
        processScore: feedback.processScore,
        businessScore: feedback.businessScore,
        didImproveScore: feedback.didImproveScore,
        didImprove: feedback.didImprove,
        rollbackNeeded: feedback.rollbackNeeded,
        ...buildTaskMemoryPatchFromBody(task, body, completionMemoryFallback, completedAt),
      })
      const updatedTask = refreshPrimaryTaskIntelligence(task.id, {
        now: completedAt,
        persistRule: !shouldContinue,
      }) || getTaskById(task.id)
      const delegatedTask = shouldAutoDelegateResearch
        ? await dispatchResearchFollowupTasks(updatedTask || task, body, completedAt)
        : (updatedTask || task)
      if (!shouldContinue) {
        closeChildTasksForParent(updatedTask || task, {
          status: success ? 'completed' : 'failed',
          completedAt,
          result: success ? 'Closed by completed parent task' : 'Closed by failed parent task',
          resolutionSource: 'parent',
        })
      }
      emitTaskUpdate(task.id)
      notifyTaskMilestone(delegatedTask || updatedTask, shouldContinue ? 'continued' : (success ? 'completed' : 'failed'))
      writeCompletionFeedbackToAttention({
        taskId: task.id,
        requestId: task.requestId,
        result: completionResult,
        completionValue: feedback.completionValue,
        businessDelta: feedback.businessDelta,
        processScore: feedback.processScore,
        businessScore: feedback.businessScore,
        didImproveScore: feedback.didImproveScore,
        didImprove: feedback.didImprove,
        rollbackNeeded: feedback.rollbackNeeded,
      })

      const savings = recordTaskCompletion(effectiveAgent, taskTimeMs)
      incrementMessages('sent')

      const agentName = AGENTS[effectiveAgent]?.name || effectiveAgent
      const emoji = success ? '✅' : '❌'
      createEvent(task.requestId, 'completed', effectiveAgent, `${emoji} ${agentName} completed: "${(task.title || '').slice(0, 50)}"`)

      if (shouldContinue) {
        await runPendingAction(delegatedTask || getTaskById(task.id), completedAt, 'immediate delegated continuation dispatch')
      }

      return Response.json({ success: true, requestId: task.requestId, taskId: task.id, savings, taskTimeMs })
    }

    // ─────────────────────────────────────────────────────────
    // ACTION: quick_flow - Full workflow in one call (for AI use)
    // Backward compatible — creates request + task
    // ─────────────────────────────────────────────────────────
    if (action === 'quick_flow') {
      const { content, from = 'Boss', agent, reason, autoComplete = true, workDurationMs = 5000, tokensInput = 0, tokensOutput = 0, notify = false, notifyDetails = [], messageId } = body
      const attentionMeta = mergeAttentionMeta(body, body.task)
      
      if (!content || !agent) {
        return Response.json({ error: 'content and agent are required' }, { status: 400 })
      }
      
      // Send Telegram notification when delegating
      if (notify && agent !== 'wickedman') {
        const agentInfo = AGENTS[agent] || { name: agent, emoji: '🤖' }
        const notifyMsg = formatDelegationNotification(agentInfo.name, agentInfo.emoji, content.slice(0, 100), notifyDetails)
        sendTelegramNotification(notifyMsg).catch(err => console.error('[quick_flow] Notification failed:', err))
      }
      
      // Adopt or create request
      let req = null
      let webhookAdopted = false
      
      if (messageId) {
        req = findByTgMessageId(messageId)
        if (req) {
          webhookAdopted = true
          updateRequest(req.id, { assignedTo: agent, ...attentionMeta })
        }
      }
      
      if (!req) {
        const pending = findOldestReceived()
        if (pending && (pending.state === 'received' || pending.state === 'analyzing')) {
          req = pending
          webhookAdopted = true
          updateRequest(req.id, { assignedTo: agent, ...attentionMeta })
        }
      }
      
      if (!req) {
        req = createRequest({
          id: `req_${Date.now()}`,
          content, from,
          state: 'received',
          assignedTo: agent,
          task: null,
          createdAt: Date.now(),
          ...attentionMeta,
        })
        incrementMessages('received')
        createEvent(req.id, 'received', 'wickedman', `📥 Request from ${from}: "${content.slice(0, 60)}${content.length > 60 ? '...' : ''}"`)
        emitRequestUpdate(req.id)
      }
      
      if (tokensInput > 0 || tokensOutput > 0) addTokens(tokensInput, tokensOutput)
      
      const requestId = req.id
      
      // Create task
      const taskSeed = {
        title: content.slice(0, 80) + (content.length > 80 ? '...' : ''),
        detail: content,
        assignedAgent: agent,
        nextStep: '等待代理開始處理',
      }
      const governanceSeed = buildTaskGovernanceDefaults({
        ...taskSeed,
        attentionType: attentionMeta.attentionType,
        needsDecision: attentionMeta.needsDecision,
      })
      const task = ensurePrimaryTask(requestId, {
        title: taskSeed.title,
        detail: taskSeed.detail,
        assignedAgent: taskSeed.assignedAgent,
        taskType: 'primary',
        sourceAgent: 'wickedman',
        status: 'pending',
        createdAt: Date.now(),
        ...taskProgressMeta('assigned', {}, taskSeed),
        ...governanceSeed,
        ...attentionMeta,
      })
      
      const alreadyAnalyzing = webhookAdopted && req.state === 'analyzing'
      const baseDelay = alreadyAnalyzing ? 0 : (webhookAdopted ? 200 : 800)
      
      // Guard: check task status before advancing
      function canAdvanceTask(taskId) {
        const t = getTaskById(taskId)
        return t && t.status !== 'completed' && t.status !== 'failed'
      }

      // Analyzing
      if (!alreadyAnalyzing) {
        setTimeout(() => {
          if (!canAdvanceTask(task.id)) return
          updateRequest(requestId, { state: 'analyzing' })
          emitRequestUpdate(requestId)
          createEvent(requestId, 'analyzing', 'wickedman', `🔍 Analyzing: "${content.slice(0, 50)}${content.length > 50 ? '...' : ''}"`)
        }, baseDelay)
      }
      
      // Task created
      setTimeout(() => {
        if (!canAdvanceTask(task.id)) return
        updateTask(task.id, { status: 'assigned', assignedAgent: agent })
        updateRequest(requestId, { state: 'task_created', task: { id: task.id, title: task.title, detail: task.detail, targetAgent: agent, reason: reason || 'Assigned by WickedMan' } })
        emitRequestUpdate(requestId)
        emitTaskUpdate(task.id)
        createEvent(requestId, 'task_created', 'wickedman', `📋 Task created → ${AGENTS[agent]?.name || agent}: ${reason || 'Assigned by WickedMan'}`)
      }, baseDelay + 1500)
      
      // Assigned
      setTimeout(() => {
        if (!canAdvanceTask(task.id)) return
        updateRequest(requestId, { state: 'assigned', assignedTo: agent })
        emitRequestUpdate(requestId)
        const isSelf = agent === 'wickedman'
        const r = getRequestById(requestId)
        createEvent(requestId, 'assigned', 'wickedman', 
          isSelf ? `📧 Taking this one myself: "${r?.task?.title}"` : `📧 Delegating to ${AGENTS[agent]?.name || agent}: "${r?.task?.title}"`,
          { targetAgent: agent }
        )
      }, baseDelay + 2300)
      
      // In progress
      setTimeout(() => {
        if (governanceSeed.humanGateReason) return
        if (!canAdvanceTask(task.id)) return
        updateTask(task.id, { status: 'in_progress', startedAt: Date.now() })
        syncRequestStateFromTask(getTaskById(task.id))
        emitRequestUpdate(requestId)
        emitTaskUpdate(task.id)
        createEvent(requestId, 'in_progress', agent, `⚡ Working on: "${task.title}"`)
      }, baseDelay + 3300)
      
      // Complete (only if autoComplete)
      if (autoComplete) {
        setTimeout(() => {
          if (governanceSeed.humanGateReason) return
          if (!canAdvanceTask(task.id)) return
          const t = getTaskById(task.id)
          const completedAt = Date.now()
          const taskTimeMs = t?.startedAt ? completedAt - t.startedAt : workDurationMs
          const completionResult = 'Auto completed'
          const feedback = normalizeCompletionFeedback({
            success: true,
            body: { didImprove: true, rollbackNeeded: false, completionValue: null },
            task: t,
            taskTimeMs,
          })
          updateTask(task.id, {
            status: 'completed',
            completedAt,
            ...taskProgressMeta('completed', {}, t),
            result: completionResult,
            completionValue: feedback.completionValue,
            businessDelta: feedback.businessDelta,
            processScore: feedback.processScore,
            businessScore: feedback.businessScore,
            didImproveScore: feedback.didImproveScore,
            didImprove: feedback.didImprove,
            rollbackNeeded: feedback.rollbackNeeded,
            ...buildTaskMemoryPatchFromBody(t, {}, {
              mode: 'review',
              focus: '等待人工確認 auto-complete 結果',
              summary: '任務由 quick_flow 自動收斂為完成。',
              nextCheckpoint: '查看 auto-complete 結果是否需要再開 task',
              evidence: ['quick_flow autoComplete'],
              delegation: {
                currentStatus: 'idle',
              },
              updatedBy: 'quick-flow',
            }, completedAt),
          })
          const updatedTask = refreshPrimaryTaskIntelligence(task.id, { now: completedAt, persistRule: true }) || getTaskById(task.id)
          closeChildTasksForParent(updatedTask || t, {
            status: 'completed',
            completedAt,
            result: 'Closed by quick_flow completed parent task',
            resolutionSource: 'parent',
          })
          syncRequestStateFromTask(updatedTask || getTaskById(task.id))
          emitRequestUpdate(requestId)
          emitTaskUpdate(task.id)
          writeCompletionFeedbackToAttention({
            taskId: task.id,
            requestId,
            result: completionResult,
            completionValue: feedback.completionValue,
            businessDelta: feedback.businessDelta,
            processScore: feedback.processScore,
            businessScore: feedback.businessScore,
            didImproveScore: feedback.didImproveScore,
            didImprove: feedback.didImprove,
            rollbackNeeded: feedback.rollbackNeeded,
          })
          recordTaskCompletion(agent, taskTimeMs)
          incrementMessages('sent')
          createEvent(requestId, 'completed', agent, `✅ Completed: "${task.title}"`)
        }, baseDelay + 3300 + workDurationMs)
      }

      if (governanceSeed.humanGateReason) {
        createEvent(requestId, 'assigned', 'wickedman', `🛑 quick_flow 先停在人工 gate：${governanceSeed.humanGateReason}`)
      }
      
      return Response.json({
        success: true,
        requestId,
        taskId: task.id,
        message: `Workflow started: ${content.slice(0, 50)}... → ${AGENTS[agent]?.name || agent}`,
        agent,
        estimatedCompletionMs: autoComplete ? 4100 + workDurationMs : null,
      })
    }

    // ─────────────────────────────────────────────────────────
    // ACTION: new_request - Legacy: start the workflow pipeline
    // ─────────────────────────────────────────────────────────
    if (action === 'new_request') {
      const { content, from = 'Boss', tokensInput = 0, tokensOutput = 0 } = body
      const attentionMeta = mergeAttentionMeta(body, body.task)
      
      const req = createRequest({
        id: `req_${Date.now()}`,
        content, from,
        state: 'received',
        assignedTo: null,
        task: null,
        createdAt: Date.now(),
        ...attentionMeta,
      })
      
      incrementMessages('received')
      if (tokensInput > 0 || tokensOutput > 0) addTokens(tokensInput, tokensOutput)
      
      createEvent(req.id, 'received', 'wickedman', `📥 Request from ${from}: "${content.slice(0, 60)}${content.length > 60 ? '...' : ''}"`)
      emitRequestUpdate(req.id)
      
      return Response.json({ success: true, request: req, nextState: 'analyzing', stateConfig: STATE_CONFIG.received })
    }
    
    // ─────────────────────────────────────────────────────────
    // ACTION: complete - Legacy: task finished by requestId
    // ─────────────────────────────────────────────────────────
    if (action === 'complete') {
      const { requestId, result, tokensInput = 0, tokensOutput = 0 } = body
      const req = getRequestById(requestId)
      if (!req) return Response.json({ error: 'Request not found' }, { status: 404 })
      
      const completedAt = Date.now()
      const taskTimeMs = req.workStartedAt ? completedAt - req.workStartedAt : 5000
      const task = getTaskByRequestId(requestId)
      const feedback = normalizeCompletionFeedback({ success: true, body, task, taskTimeMs })
      const completionResult = result || 'Completed'
      
      // Complete the task if one exists
      if (task && task.status !== 'completed' && task.status !== 'failed') {
        updateTask(task.id, {
          status: 'completed',
          completedAt,
          ...taskProgressMeta('completed', {}, task),
          result: completionResult,
          completionValue: feedback.completionValue,
          businessDelta: feedback.businessDelta,
          processScore: feedback.processScore,
          businessScore: feedback.businessScore,
          didImproveScore: feedback.didImproveScore,
          didImprove: feedback.didImprove,
          rollbackNeeded: feedback.rollbackNeeded,
          ...buildTaskMemoryPatchFromBody(task, body, {
            mode: 'review',
            focus: '等待人工驗收交付',
            summary: body?.summary || '任務已由 legacy complete 流程標記為完成。',
            nextCheckpoint: body?.nextCheckpoint || '查看結果並決定是否放行',
            evidence: body?.evidence || [completionResult],
            delegation: { currentStatus: 'idle' },
            updatedBy: req.assignedTo || 'workflow-api',
          }, completedAt),
        })
        const updatedTask = refreshPrimaryTaskIntelligence(task.id, { now: completedAt, persistRule: true }) || getTaskById(task.id)
        closeChildTasksForParent(updatedTask || task, {
          status: 'completed',
          completedAt,
          result: 'Closed by completed parent task',
          resolutionSource: 'parent',
        })
        emitTaskUpdate(task.id)
        writeCompletionFeedbackToAttention({
          taskId: task.id,
          requestId,
          result: completionResult,
          completionValue: feedback.completionValue,
          businessDelta: feedback.businessDelta,
          processScore: feedback.processScore,
          businessScore: feedback.businessScore,
          didImproveScore: feedback.didImproveScore,
          didImprove: feedback.didImprove,
          rollbackNeeded: feedback.rollbackNeeded,
        })
      }
      if (!task) {
        writeCompletionFeedbackToAttention({
          taskId: null,
          requestId,
          result: completionResult,
          completionValue: feedback.completionValue,
          businessDelta: feedback.businessDelta,
          processScore: feedback.processScore,
          businessScore: feedback.businessScore,
          didImproveScore: feedback.didImproveScore,
          didImprove: feedback.didImprove,
          rollbackNeeded: feedback.rollbackNeeded,
        })
      }
      
      updateRequest(requestId, { state: 'completed', completedAt, result: completionResult })
      emitRequestUpdate(requestId)
      
      const savings = recordTaskCompletion(req.assignedTo || 'wickedman', taskTimeMs)
      incrementMessages('sent')
      if (tokensInput > 0 || tokensOutput > 0) addTokens(tokensInput, tokensOutput)
      
      createEvent(req.id, 'completed', req.assignedTo, `✅ Completed: "${req.task?.title}"`, { result: completionResult })
      
      return Response.json({ success: true, request: getRequestById(requestId), stateConfig: STATE_CONFIG.completed, savings, taskTimeMs })
    }

    // ─────────────────────────────────────────────────────────
    // ACTION: manual_complete - Mark a task as complete manually
    // ─────────────────────────────────────────────────────────
    if (action === 'manual_complete') {
      const { requestId, result, tokensInput = 0, tokensOutput = 0 } = body
      const req = getRequestById(requestId)
      if (!req) return Response.json({ error: 'Request not found' }, { status: 404 })
      if (req.state === 'completed') {
        return Response.json({ success: true, request: req, savings: 0, taskTimeMs: 0, alreadyCompleted: true })
      }
      
      const completedAt = Date.now()
      const taskTimeMs = req.workStartedAt ? completedAt - req.workStartedAt : 5000
      const task = getTaskByRequestId(requestId)
      const feedback = normalizeCompletionFeedback({ success: true, body, task, taskTimeMs })
      const completionResult = result || 'Done'
      
      // Complete associated task
      if (task && task.status !== 'completed' && task.status !== 'failed') {
        updateTask(task.id, {
          status: 'completed',
          completedAt,
          ...taskProgressMeta('completed', {}, task),
          result: completionResult,
          completionValue: feedback.completionValue,
          businessDelta: feedback.businessDelta,
          processScore: feedback.processScore,
          businessScore: feedback.businessScore,
          didImproveScore: feedback.didImproveScore,
          didImprove: feedback.didImprove,
          rollbackNeeded: feedback.rollbackNeeded,
          ...buildTaskMemoryPatchFromBody(task, body, {
            mode: 'review',
            focus: '等待人工確認 manual complete 結果',
            summary: body?.summary || '任務已由人工標記為完成。',
            nextCheckpoint: body?.nextCheckpoint || '查看結果並決定是否需要補追問',
            evidence: body?.evidence || [completionResult],
            delegation: { currentStatus: 'idle' },
            updatedBy: req.assignedTo || 'workflow-api',
          }, completedAt),
        })
        const updatedTask = refreshPrimaryTaskIntelligence(task.id, { now: completedAt, persistRule: true }) || getTaskById(task.id)
        closeChildTasksForParent(updatedTask || task, {
          status: 'completed',
          completedAt,
          result: 'Closed by manually completed parent task',
          resolutionSource: 'parent',
        })
        emitTaskUpdate(task.id)
        writeCompletionFeedbackToAttention({
          taskId: task.id,
          requestId,
          result: completionResult,
          completionValue: feedback.completionValue,
          businessDelta: feedback.businessDelta,
          processScore: feedback.processScore,
          businessScore: feedback.businessScore,
          didImproveScore: feedback.didImproveScore,
          didImprove: feedback.didImprove,
          rollbackNeeded: feedback.rollbackNeeded,
        })
      }
      if (!task) {
        writeCompletionFeedbackToAttention({
          taskId: null,
          requestId,
          result: completionResult,
          completionValue: feedback.completionValue,
          businessDelta: feedback.businessDelta,
          processScore: feedback.processScore,
          businessScore: feedback.businessScore,
          didImproveScore: feedback.didImproveScore,
          didImprove: feedback.didImprove,
          rollbackNeeded: feedback.rollbackNeeded,
        })
      }
      
      updateRequest(requestId, { state: 'completed', completedAt, result: completionResult })
      emitRequestUpdate(requestId)
      
      const savings = recordTaskCompletion(req.assignedTo || 'wickedman', taskTimeMs)
      incrementMessages('sent')
      if (tokensInput > 0 || tokensOutput > 0) addTokens(tokensInput, tokensOutput)
      
      createEvent(req.id, 'completed', req.assignedTo || 'wickedman', `✅ Completed: "${req.task?.title}" - ${completionResult}`)
      
      return Response.json({ success: true, request: getRequestById(requestId), savings, taskTimeMs })
    }

    // ─────────────────────────────────────────────────────────
    // ACTION: update_task_memory - Update lobster brain memory without changing lifecycle
    // ─────────────────────────────────────────────────────────
    if (action === 'update_task_memory') {
      const { taskId, requestId } = body
      const task = taskId ? getTaskById(taskId) : (requestId ? getTaskByRequestId(requestId) : null)
      if (!task) return Response.json({ error: 'Task not found' }, { status: 404 })

      const now = Date.now()
      const updates = {
        ...buildTaskMemoryPatchFromBody(task, body, {
          mode: body.brainMode || task.brainMode || 'execution',
          focus: body.focus || task.brainState?.focus || task.nextStep || '持續追蹤中',
          summary: body.summary || task.brainState?.summary || '任務記憶已更新。',
          nextCheckpoint: body.nextCheckpoint || task.brainState?.nextCheckpoint || task.nextStep || '等待下一個里程碑',
          updatedBy: body.updatedBy || body.agent || 'workflow-api',
        }, now),
        lastUpdate: body.touchLastUpdate === false
          ? (task.lastUpdate || now)
          : now,
      }
      const patched = updateTask(task.id, updates)
      const intelligentTask = refreshPrimaryTaskIntelligence(task.id, { now }) || patched || getTaskById(task.id)
      emitTaskUpdate(task.id)

      return Response.json({
        success: true,
        taskId: task.id,
        requestId: task.requestId,
        task: intelligentTask,
      })
    }

    // ─────────────────────────────────────────────────────────
    // ACTION: clear_pipeline - Complete all active requests + tasks
    // ─────────────────────────────────────────────────────────
    if (action === 'clear_pipeline') {
      const { reason = 'Session reset' } = body
      const clearedRequests = completeAllActive(reason)
      const clearedTasks = completeAllActiveTasks(reason)
      
      if (clearedRequests > 0 || clearedTasks > 0) {
        createEvent(null, 'system', 'wickedman', `🔄 Pipeline cleared: ${clearedRequests} request${clearedRequests !== 1 ? 's' : ''}, ${clearedTasks} task${clearedTasks !== 1 ? 's' : ''} completed (${reason})`)
        const recent = getRequests(clearedRequests + 5)
        for (const req of recent) {
          if (req.result === reason) eventBus.emit(EVENTS.REQUEST_UPDATE, req)
        }
      }
      
      return Response.json({ success: true, cleared: clearedRequests, clearedTasks })
    }

    // ─────────────────────────────────────────────────────────
    // ACTION: cleanup_stale - Removed. Tasks complete ONLY via explicit API calls.
    // Kept as no-op for backward compatibility.
    // ─────────────────────────────────────────────────────────
    if (action === 'cleanup_stale') {
      return Response.json({ success: true, cleaned: 0, message: 'Timer-based cleanup removed. Use agent_complete or delegate_complete.' })
    }

    // ─────────────────────────────────────────────────────────
    // Legacy actions kept for backward compat
    // ─────────────────────────────────────────────────────────
    if (action === 'analyze') {
      const { requestId } = body
      const req = getRequestById(requestId)
      if (!req) return Response.json({ error: 'Request not found' }, { status: 404 })
      updateRequest(requestId, { state: 'analyzing' })
      emitRequestUpdate(requestId)
      const analysis = analyzeTask(req.content)
      createEvent(req.id, 'analyzing', 'wickedman', `🔍 Analyzing: "${req.content.slice(0, 40)}..."`)
      return Response.json({ success: true, request: getRequestById(requestId), analysis, nextState: 'task_created', stateConfig: STATE_CONFIG.analyzing })
    }

    if (action === 'create_task') {
      const { requestId, analysis } = body
      const req = getRequestById(requestId)
      if (!req) return Response.json({ error: 'Request not found' }, { status: 404 })
      const attentionMeta = mergeAttentionMeta(body, analysis)
      const taskData = {
        id: `task_${Date.now()}`,
        title: req.content.slice(0, 50) + (req.content.length > 50 ? '...' : ''),
        detail: req.content,
        targetAgent: analysis.agent,
        reason: analysis.reason,
        createdAt: Date.now(),
      }
      // Create real task
      const task = ensurePrimaryTask(requestId, {
        title: taskData.title,
        detail: taskData.detail,
        assignedAgent: analysis.agent,
        taskType: 'primary',
        sourceAgent: 'wickedman',
        status: 'assigned',
        createdAt: Date.now(),
        ...taskProgressMeta('assigned', {}, {
          title: taskData.title,
          detail: taskData.detail,
          assignedAgent: analysis.agent,
          nextStep: '等待代理開始處理',
        }),
        ...buildTaskGovernanceDefaults({
          title: taskData.title,
          detail: taskData.detail,
          assignedAgent: analysis.agent,
          attentionType: attentionMeta.attentionType,
          needsDecision: attentionMeta.needsDecision,
        }),
        ...attentionMeta,
      })
      updateRequest(requestId, {
        state: 'task_created',
        task: {
          id: task.id,
          title: task.title,
          detail: task.detail,
          targetAgent: analysis.agent,
          reason: analysis.reason,
        },
        ...attentionMeta,
      })
      emitRequestUpdate(requestId)
      emitTaskUpdate(task.id)
      createEvent(req.id, 'task_created', 'wickedman', `📋 Task created → ${AGENTS[analysis.agent]?.name || analysis.agent}: ${analysis.reason}`)
      return Response.json({
        success: true,
        request: getRequestById(requestId),
        task: {
          id: task.id,
          title: task.title,
          detail: task.detail,
          targetAgent: analysis.agent,
          reason: analysis.reason,
        },
        nextState: 'assigned',
        stateConfig: STATE_CONFIG.task_created,
      })
    }

    if (action === 'assign') {
      const { requestId } = body
      const req = getRequestById(requestId)
      if (!req || !req.task) return Response.json({ error: 'Request/task not found' }, { status: 404 })
      updateRequest(requestId, { state: 'assigned', assignedTo: req.task.targetAgent })
      const task = getTaskByRequestId(requestId)
      if (task) {
        updateTask(task.id, {
          status: 'assigned',
          ...taskProgressMeta('assigned', {}, task),
          ...buildTaskMemoryPatchFromBody(task, {}, {
            mode: 'queued',
            focus: '已完成指派，等待代理開始處理',
            summary: '任務已正式指派給對應代理。',
            nextCheckpoint: '等待代理開始處理',
            delegation: {
              currentStatus: 'queued',
              nextHandoff: '代理開始處理後回報第一個里程碑',
            },
            updatedBy: 'workflow-api',
          }),
        })
        emitTaskUpdate(task.id)
      }
      emitRequestUpdate(requestId)
      const isSelf = req.task.targetAgent === 'wickedman'
      createEvent(req.id, 'assigned', 'wickedman', isSelf ? `📧 Taking this one myself: "${req.task.title}"` : `📧 Delegating to ${AGENTS[req.task.targetAgent]?.name}: "${req.task.title}"`, { targetAgent: req.task.targetAgent })
      return Response.json({ success: true, request: getRequestById(requestId), assignedTo: req.task.targetAgent, isSelfAssigned: isSelf, nextState: 'in_progress', stateConfig: STATE_CONFIG.assigned, animation: { from: 'wickedman', to: req.task.targetAgent, taskTitle: req.task.title } })
    }

    if (action === 'start_work') {
      const { requestId } = body
      const req = getRequestById(requestId)
      if (!req) return Response.json({ error: 'Request not found' }, { status: 404 })
      updateRequest(requestId, { state: 'in_progress', workStartedAt: Date.now() })
      const task = getTaskByRequestId(requestId)
      if (task) {
        const startedAt = Date.now()
        updateTask(task.id, {
          status: 'in_progress',
          startedAt,
          ...taskProgressMeta('in_progress', {}, task),
          ...buildTaskMemoryPatchFromBody(task, {}, {
            mode: 'execution',
            focus: '代理已開始處理',
            summary: 'legacy start_work 已將任務推進到執行中。',
            nextCheckpoint: '等待下一個可交付里程碑',
            evidence: ['legacy start_work'],
            delegation: {
              currentStatus: 'running',
            },
            updatedBy: req.assignedTo || 'workflow-api',
          }, startedAt),
        })
        emitTaskUpdate(task.id)
        notifyTaskMilestone(getTaskById(task.id), 'in_progress')
      }
      emitRequestUpdate(requestId)
      createEvent(req.id, 'in_progress', req.assignedTo, `⚡ Working on: "${req.task?.title}"`)
      return Response.json({ success: true, request: getRequestById(requestId), agent: req.assignedTo, stateConfig: STATE_CONFIG.in_progress })
    }

    // ─────────────────────────────────────────────────────────
    // ACTION: retry_task - Clear human gate, reset retry count, re-dispatch
    // ─────────────────────────────────────────────────────────
    if (action === 'retry_task') {
      const { taskId } = body
      const task = getTaskById(taskId)
      if (!task) return Response.json({ error: 'Task not found' }, { status: 404 })
      if (['completed', 'failed'].includes(String(task.status || ''))) {
        return Response.json({ error: 'Cannot retry completed/failed task' }, { status: 400 })
      }
      const now = Date.now()
      const newBudget = Math.max(Number(task.retryBudget || 0), Number(task.retryCount || 0) + 3)
      const updatedTask = updateTask(task.id, {
        status: 'in_progress',
        humanGateReason: null,
        completionGateRequired: false,
        retryCount: 0,
        retryBudget: newBudget,
        autoContinueAllowed: true,
        pendingAction: 'start_work',
        milestone: '重新派工',
        nextStep: '老闆手動重試，重新開工',
        ...buildTaskMemoryPatchFromBody(task, {}, {
          mode: 'execution',
          focus: '老闆手動重試',
          summary: '老闆從看板手動觸發重試，清除 gate 並重新派工。',
          nextCheckpoint: '等待代理回報',
          blockers: [],
          openLoops: [],
          delegation: { currentStatus: 'pending_dispatch' },
          updatedBy: 'boss-dashboard',
        }, now),
      }) || task
      syncRequestStateFromTask(updatedTask)
      emitTaskUpdate(task.id)
      const kicked = await executePendingAction(updatedTask, now)
      return Response.json({
        success: true,
        taskId: task.id,
        requestId: task.requestId,
        kicked: Boolean(kicked),
        status: kicked?.status || updatedTask.status,
      })
    }

    if (action === 'kick_pending_action') {
      const { requestId, taskId } = body
      const task = taskId ? getTaskById(taskId) : (requestId ? getTaskByRequestId(requestId) : null)
      if (!task) {
        return Response.json({ error: 'Task not found' }, { status: 404 })
      }

      if (!task.pendingAction) {
        return Response.json({
          success: true,
          requestId: task.requestId,
          taskId: task.id,
          kicked: false,
          reason: 'no-pending-action',
        })
      }

      const updatedTask = await executePendingAction(task, Date.now())
      return Response.json({
        success: true,
        requestId: updatedTask?.requestId || task.requestId,
        taskId: updatedTask?.id || task.id,
        kicked: true,
        pendingAction: updatedTask?.pendingAction || null,
        status: updatedTask?.status || task.status,
      })
    }

    // ─────────────────────────────────────────────────────────
    // Debug/repair actions (unchanged)
    // ─────────────────────────────────────────────────────────
    if (action === 'debug_events') {
      const { limit: dbLimit = 50 } = body
      const result = getEventsPaginated(dbLimit, 0)
      const broken = result.events.filter(e => e.message?.includes('Processing...') || e.message?.includes('"task"') || e.message?.includes('"response"'))
      return Response.json({ total: result.total, checked: result.events.length, brokenCount: broken.length, broken: broken.map(e => ({ id: e.id, requestId: e.requestId, message: e.message, time: e.time })) })
    }

    if (action === 'repair_events') {
      const fixed = repairAllPlaceholderEvents()
      return Response.json({ success: true, fixed })
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 })
    
  } catch (error) {
    console.error('Workflow API error:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
}

