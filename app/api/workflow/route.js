// Workflow API for OpenClaw Office
// Refactored to task-driven architecture
// Request = incoming message record (immutable after creation)
// Task = work unit with independent lifecycle (pending → assigned → in_progress → completed/failed)

import { analyzeTask, AGENTS, STATE_CONFIG } from '../../../lib/workflow'
import { sendTelegramNotification, formatDelegationNotification } from '../../../lib/telegram'
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
  updateTask,
  getTaskById,
  getTaskByRequestId,
  getActiveTaskByAgent,
  getActiveTasks,
  getRecentTasks,
  completeAllActiveTasks,
} from '../../../lib/db'
import { eventBus, EVENTS } from '../../../lib/event-bus'
import { recordAttentionTaskFeedback } from '../../../lib/boss-inbox.js'

function timeStr() {
  return new Date().toLocaleTimeString('en-US', { 
    hour: '2-digit', 
    minute: '2-digit',
    second: '2-digit',
    hour12: false 
  })
}

function createEvent(requestId, state, agent, message, extra = {}) {
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

function taskProgressMeta(status, body = {}) {
  if (status === 'assigned') {
    return { milestone: '已指派', nextStep: '等待代理開始處理', continuationRequired: true, pendingAction: 'start_work', continuationCheckedAt: null, lastUpdate: Date.now() }
  }
  if (status === 'in_progress') {
    return { milestone: '執行中', nextStep: '持續處理與回報里程碑', continuationRequired: false, pendingAction: null, continuationCheckedAt: null, completionGateRequired: true, lastUpdate: Date.now() }
  }
  if (status === 'completed') {
    return { milestone: '已完成', nextStep: '等待你查看結果', continuationRequired: false, pendingAction: null, continuationCheckedAt: Date.now(), lastUpdate: Date.now() }
  }
  if (status === 'failed') {
    return { milestone: '已卡住', nextStep: '等待人工介入或改走替代方案', continuationRequired: false, pendingAction: null, continuationCheckedAt: Date.now(), lastUpdate: Date.now() }
  }
  return {
    milestone: body.milestone || null,
    nextStep: body.nextStep || null,
    lastUpdate: Date.now(),
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
  }

  if (message) {
    try {
      await sendTelegramNotification(message)
    } catch (error) {
      console.error('[workflow] milestone notify failed:', error.message)
    }
  }
}

const STALE_TASK_THRESHOLD_MS = 15 * 60 * 1000
const STALE_TASK_SCAN_INTERVAL_MS = 60 * 1000
const CONTINUATION_CHECK_MS = 45 * 1000
const COMPLETION_GATE_CHECK_MS = 2 * 60 * 1000

if (!globalThis.__officeStaleTaskMonitorStarted) {
  globalThis.__officeStaleTaskMonitorStarted = true
  setInterval(async () => {
    try {
      const now = Date.now()
      const tasks = getActiveTasks(100)
      for (const task of tasks) {
        const updatedAt = Number(task.lastUpdate || task.startedAt || task.createdAt || 0)
        if (!updatedAt) continue

        if (task.status === 'assigned' && task.continuationRequired && (!task.continuationCheckedAt || now - Number(task.continuationCheckedAt) > CONTINUATION_CHECK_MS)) {
          const patched = updateTask(task.id, {
            status: 'in_progress',
            startedAt: task.startedAt || now,
            ...taskProgressMeta('in_progress'),
            continuationRequired: false,
            pendingAction: null,
            continuationCheckedAt: now,
          })
          emitTaskUpdate(task.id)
          await notifyTaskMilestone(patched || getTaskById(task.id), 'in_progress')
          continue
        }

        if (task.status === 'in_progress' && task.completionGateRequired && (now - updatedAt > COMPLETION_GATE_CHECK_MS)) {
          const patched = updateTask(task.id, {
            continuationRequired: true,
            pendingAction: 'continue_after_reply',
            continuationCheckedAt: now,
            completionGateRequired: false,
            milestone: task.milestone || '持續執行中',
            nextStep: task.nextStep || '里程碑回報後需自動續跑',
            lastUpdate: updatedAt,
          })
          emitTaskUpdate(task.id)
          continue
        }

        if (now - updatedAt < STALE_TASK_THRESHOLD_MS) continue
        if (task.staleNotifiedAt && Number(task.staleNotifiedAt) >= updatedAt) continue
        const patched = updateTask(task.id, {
          staleNotifiedAt: now,
          milestone: task.milestone || '等待更新',
          nextStep: task.nextStep || '請補回最新進度',
          lastUpdate: updatedAt,
        })
        emitTaskUpdate(task.id)
        await notifyTaskMilestone(patched || task, 'stale')
      }
    } catch (error) {
      console.error('[workflow] stale task monitor failed:', error.message)
    }
  }, STALE_TASK_SCAN_INTERVAL_MS)
}

// Keep request.state in sync with task.status for backward compatibility
// This ensures the frontend (which reads request state) still works
function syncRequestStateFromTask(task) {
  if (!task || !task.requestId) return
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
    const body = await request.json()
    const { action } = body
    
    // ─────────────────────────────────────────────────────────
    // ACTION: start_flow - Called when agent starts processing
    // Creates request + task. Returns both IDs.
    // ─────────────────────────────────────────────────────────
    if (action === 'start_flow') {
      const { content, from = 'Boss', agent = 'wickedman', messageId, delegatedTo } = body
      const attentionMeta = mergeAttentionMeta(body, body.task)
      
      if (!content) {
        return Response.json({ error: 'content is required' }, { status: 400 })
      }

      // Chain support: auto-generate chainId if not provided
      const chainId = body.chainId || `chain_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      
      // Check if this is a chain continuation (existing chainId with completed requests)
      const previousInChain = body.chainId ? findLastCompletedInChain(body.chainId) : null
      const isChainContinuation = !!previousInChain

      const finalAgent = delegatedTo || agent
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
          chainId,
          ...attentionMeta,
        })
        incrementMessages('received')
        createEvent(req.id, 'received', 'wickedman', `📥 Request from ${from}: "${cleanText.slice(0, 60)}${cleanText.length > 60 ? '...' : ''}"`)
      }

      emitRequestUpdate(req.id)

      // Create Task with proper initial status
      const taskStatus = delegatedTo ? 'pending' : 'in_progress'
      const taskStartedAt = delegatedTo ? null : Date.now()
      const task = createTask({
        requestId: req.id,
        title: cleanText.slice(0, 80) + (cleanText.length > 80 ? '...' : ''),
        detail: cleanText,
        assignedAgent: finalAgent,
        status: taskStatus,
        createdAt: Date.now(),
        startedAt: taskStartedAt,
        ...attentionMeta,
      })

      // Sync request state from task
      syncRequestStateFromTask(task)
      emitRequestUpdate(req.id)
      emitTaskUpdate(task.id)

      // Animation events (delayed for visual effect)
      // For chain continuations, add extra delay for return animation + reviewing
      const chainDelay = isChainContinuation ? 2500 : 0
      const previousAgent = previousInChain?.assignedTo || null

      if (delegatedTo && delegatedTo !== 'wickedman') {
        // Chain continuation: emit return animation event first
        if (isChainContinuation && previousAgent) {
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
          updateRequest(req.id, { state: 'task_created', task: { id: task.id, title: task.title, detail: task.detail, targetAgent: delegatedTo } })
          createEvent(req.id, 'task_created', 'wickedman', `📋 Task → ${AGENTS[delegatedTo]?.emoji || '🤖'} ${AGENTS[delegatedTo]?.name || delegatedTo}: "${task.title}"`)
          emitRequestUpdate(req.id)
        }, chainDelay + 1200)

        setTimeout(() => {
          const t = getTaskById(task.id)
          if (!t || t.status === 'completed' || t.status === 'failed') return
          updateTask(task.id, { status: 'assigned', ...taskProgressMeta('assigned') })
          updateRequest(req.id, { state: 'assigned', assignedTo: delegatedTo })
          createEvent(req.id, 'assigned', delegatedTo, `📧 ${AGENTS[delegatedTo]?.emoji || '🤖'} ${AGENTS[delegatedTo]?.name || delegatedTo} taking over`)
          emitRequestUpdate(req.id)
          emitTaskUpdate(task.id)
        }, chainDelay + 1800)

        setTimeout(() => {
          const t = getTaskById(task.id)
          if (!t || t.status === 'completed' || t.status === 'failed') return
          updateTask(task.id, { status: 'in_progress', startedAt: Date.now(), ...taskProgressMeta('in_progress') })
          syncRequestStateFromTask(getTaskById(task.id))
          createEvent(req.id, 'in_progress', delegatedTo, `⚡ ${AGENTS[delegatedTo]?.name || delegatedTo} working...`)
          emitRequestUpdate(req.id)
          emitTaskUpdate(task.id)
          notifyTaskMilestone(getTaskById(task.id), 'in_progress')
        }, chainDelay + 3500)
      } else {
        // SELF-HANDLED: analyzing animation then WS handles rest
        setTimeout(() => {
          const t = getTaskById(task.id)
          if (!t || t.status === 'completed' || t.status === 'failed') return
          updateRequest(req.id, { state: 'analyzing' })
          createEvent(req.id, 'analyzing', 'wickedman', `🔍 Analyzing: "${cleanText.slice(0, 50)}${cleanText.length > 50 ? '...' : ''}"`)
          emitRequestUpdate(req.id)
        }, 500)
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
      const { agent, result, success = true } = body
      if (!agent) return Response.json({ error: 'agent is required' }, { status: 400 })

      const task = getActiveTaskByAgent(agent)
      if (!task) return Response.json({ success: true, message: `No active task for ${agent}`, noop: true })
      if (task.status === 'completed' || task.status === 'failed') {
        return Response.json({ success: true, message: 'Task already completed', noop: true })
      }

      const completedAt = Date.now()
      const taskTimeMs = task.startedAt ? completedAt - task.startedAt : 5000
      const feedback = normalizeCompletionFeedback({ success, body, task, taskTimeMs })
      const completionResult = result || (success ? 'Completed' : 'Failed')
      
      updateTask(task.id, {
        status: success ? 'completed' : 'failed',
        completedAt,
        ...taskProgressMeta(success ? 'completed' : 'failed'),
        result: completionResult,
        completionValue: feedback.completionValue,
        businessDelta: feedback.businessDelta,
        processScore: feedback.processScore,
        businessScore: feedback.businessScore,
        didImproveScore: feedback.didImproveScore,
        didImprove: feedback.didImprove,
        rollbackNeeded: feedback.rollbackNeeded,
      })
      emitTaskUpdate(task.id)
      notifyTaskMilestone(getTaskById(task.id), success ? 'completed' : 'failed')
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

      const savings = recordTaskCompletion(agent, taskTimeMs)
      incrementMessages('sent')

      const agentName = AGENTS[agent]?.name || agent
      const emoji = success ? '✅' : '❌'
      const title = cleanContent(task.title || task.detail || '')
      createEvent(task.requestId, 'completed', agent, `${emoji} ${agentName} completed: "${title.slice(0, 50)}${title.length > 50 ? '...' : ''}"`)

      // Chain: emit return-to-WickedMan animation after agent completes
      // This shows the result flowing back to WickedMan (the orchestrator)
      if (task.requestId && agent !== 'wickedman') {
        const req = getRequestById(task.requestId)
        if (req) {
          setTimeout(() => {
            eventBus.emit(EVENTS.WORKFLOW_EVENT, {
              id: `evt_return_${Date.now()}`,
              requestId: task.requestId,
              state: 'chain_return',
              agent,
              agentColor: AGENTS[agent]?.color || '#888',
              agentName: AGENTS[agent]?.name || agent,
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

      if (task.status === 'completed' || task.status === 'failed') {
        return Response.json({ success: true, taskId: task.id, alreadyCompleted: true })
      }

      const completedAt = Date.now()
      const taskTimeMs = task.startedAt ? completedAt - task.startedAt : 5000
      const feedback = normalizeCompletionFeedback({ success, body, task, taskTimeMs })
      const completionResult = result || (success ? 'Completed' : 'Failed')

      updateTask(task.id, {
        status: success ? 'completed' : 'failed',
        completedAt,
        ...taskProgressMeta(success ? 'completed' : 'failed'),
        result: completionResult,
        completionValue: feedback.completionValue,
        businessDelta: feedback.businessDelta,
        processScore: feedback.processScore,
        businessScore: feedback.businessScore,
        didImproveScore: feedback.didImproveScore,
        didImprove: feedback.didImprove,
        rollbackNeeded: feedback.rollbackNeeded,
      })
      emitTaskUpdate(task.id)
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

      const effectiveAgent = agent || task.assignedAgent || 'wickedman'
      const savings = recordTaskCompletion(effectiveAgent, taskTimeMs)
      incrementMessages('sent')

      const agentName = AGENTS[effectiveAgent]?.name || effectiveAgent
      const emoji = success ? '✅' : '❌'
      createEvent(task.requestId, 'completed', effectiveAgent, `${emoji} ${agentName} completed: "${(task.title || '').slice(0, 50)}"`)

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
      const task = createTask({
        requestId,
        title: content.slice(0, 80) + (content.length > 80 ? '...' : ''),
        detail: content,
        assignedAgent: agent,
        status: 'pending',
        createdAt: Date.now(),
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
            result: completionResult,
            completionValue: feedback.completionValue,
            businessDelta: feedback.businessDelta,
            processScore: feedback.processScore,
            businessScore: feedback.businessScore,
            didImproveScore: feedback.didImproveScore,
            didImprove: feedback.didImprove,
            rollbackNeeded: feedback.rollbackNeeded,
          })
          syncRequestStateFromTask(getTaskById(task.id))
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
          result: completionResult,
          completionValue: feedback.completionValue,
          businessDelta: feedback.businessDelta,
          processScore: feedback.processScore,
          businessScore: feedback.businessScore,
          didImproveScore: feedback.didImproveScore,
          didImprove: feedback.didImprove,
          rollbackNeeded: feedback.rollbackNeeded,
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
          result: completionResult,
          completionValue: feedback.completionValue,
          businessDelta: feedback.businessDelta,
          processScore: feedback.processScore,
          businessScore: feedback.businessScore,
          didImproveScore: feedback.didImproveScore,
          didImprove: feedback.didImprove,
          rollbackNeeded: feedback.rollbackNeeded,
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
      const task = createTask({
        id: taskData.id,
        requestId,
        title: taskData.title,
        detail: taskData.detail,
        assignedAgent: analysis.agent,
        status: 'assigned',
        createdAt: Date.now(),
        ...attentionMeta,
      })
      updateRequest(requestId, { state: 'task_created', task: taskData, ...attentionMeta })
      emitRequestUpdate(requestId)
      emitTaskUpdate(task.id)
      createEvent(req.id, 'task_created', 'wickedman', `📋 Task created → ${AGENTS[analysis.agent]?.name || analysis.agent}: ${analysis.reason}`)
      return Response.json({ success: true, request: getRequestById(requestId), task: taskData, nextState: 'assigned', stateConfig: STATE_CONFIG.task_created })
    }

    if (action === 'assign') {
      const { requestId } = body
      const req = getRequestById(requestId)
      if (!req || !req.task) return Response.json({ error: 'Request/task not found' }, { status: 404 })
      updateRequest(requestId, { state: 'assigned', assignedTo: req.task.targetAgent })
      const task = getTaskByRequestId(requestId)
      if (task) { updateTask(task.id, { status: 'assigned', ...taskProgressMeta('assigned') }); emitTaskUpdate(task.id) }
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
      if (task) { updateTask(task.id, { status: 'in_progress', startedAt: Date.now(), ...taskProgressMeta('in_progress') }); emitTaskUpdate(task.id); notifyTaskMilestone(getTaskById(task.id), 'in_progress') }
      emitRequestUpdate(requestId)
      createEvent(req.id, 'in_progress', req.assignedTo, `⚡ Working on: "${req.task?.title}"`)
      return Response.json({ success: true, request: getRequestById(requestId), agent: req.assignedTo, stateConfig: STATE_CONFIG.in_progress })
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
