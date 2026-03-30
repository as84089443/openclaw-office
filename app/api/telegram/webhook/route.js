// Telegram Webhook Handler for OpenClaw Office
//
// Long-term architecture:
// Telegram → OpenClaw Office (public ingress) → formal workflow handoff OR local gateway webhook
//
// Office owns the public webhook so autonomous handoffs can become first-class tasks
// without passing through the main agent's direct chat path.

import { createRequest, getRequestById, updateRequest, incrementMessages, addEvent, findByTgMessageId } from '../../../../lib/db.js'
import { eventBus, EVENTS } from '../../../../lib/event-bus.js'
import { AGENTS } from '../../../../lib/workflow.js'
import { routeAutonomousHandoff } from '../../../../lib/autonomous-handoff.js'
import { getConfig } from '../../../../lib/config.js'
import { sendTelegramMessage } from '../../../../lib/telegram.js'
import { POST as workflowPost } from '../../workflow/route.js'

const SECRET_HEADER = 'x-telegram-bot-api-secret-token'

function timeStr() {
  return new Date().toLocaleTimeString('en-US', { 
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false 
  })
}

function getTelegramIngressConfig() {
  const telegram = getConfig().telegram || {}
  const webhookSecret = String(telegram.webhookSecret || process.env.TELEGRAM_WEBHOOK_SECRET || '').trim()
  const webhookHost = String(telegram.webhookHost || process.env.TELEGRAM_WEBHOOK_HOST || '127.0.0.1').trim() || '127.0.0.1'
  const webhookPort = Number(telegram.webhookPort || process.env.TELEGRAM_WEBHOOK_PORT || 8787)
  const webhookPathRaw = String(telegram.webhookPath || process.env.TELEGRAM_WEBHOOK_PATH || '/telegram-webhook').trim() || '/telegram-webhook'
  const webhookPath = webhookPathRaw.startsWith('/') ? webhookPathRaw : `/${webhookPathRaw}`

  return {
    webhookSecret,
    gatewayWebhookUrl: `http://${webhookHost}:${Number.isFinite(webhookPort) && webhookPort > 0 ? Math.round(webhookPort) : 8787}${webhookPath}`,
  }
}

function extractMessageText(update) {
  if (update.message?.text) return update.message.text
  if (update.edited_message?.text) return update.edited_message.text
  if (update.callback_query?.data) return `callback: ${update.callback_query.data}`
  if (update.message?.caption) return update.message.caption
  if (update.message?.photo) return '[Photo]'
  if (update.message?.video) return '[Video]'
  if (update.message?.document) return `[Document: ${update.message.document.file_name || 'file'}]`
  if (update.message?.voice) return '[Voice message]'
  if (update.message?.sticker) return `[Sticker: ${update.message.sticker.emoji || ''}]`
  return null
}

function extractMessageId(update) {
  return update.message?.message_id || 
         update.edited_message?.message_id || 
         update.callback_query?.message?.message_id ||
         null
}

function extractChatContext(update) {
  const chat =
    update.message?.chat ||
    update.edited_message?.chat ||
    update.callback_query?.message?.chat ||
    null

  return {
    chatId: chat?.id || null,
    messageThreadId:
      update.message?.message_thread_id ||
      update.edited_message?.message_thread_id ||
      update.callback_query?.message?.message_thread_id ||
      null,
  }
}

function extractSenderName(update) {
  const from = update.message?.from || update.edited_message?.from || update.callback_query?.from
  if (!from) return 'Unknown'
  return from.first_name || from.username || `User ${from.id}`
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function formatAutonomousHandoffAck({ agentId, taskContent }) {
  const agentInfo = AGENTS[agentId] || {}
  const agentName = agentInfo.name || agentId || '代理'
  const agentEmoji = agentInfo.emoji || '🤖'
  const summary = String(taskContent || '').trim()
  const shortSummary = summary.length > 72 ? `${summary.slice(0, 69)}...` : summary

  return [
    '🦞 <b>已交辦</b>',
    `• 由 ${agentEmoji} ${escapeHtml(agentName)} 接手：${escapeHtml(shortSummary)}`,
    '• 主代理保持待命，你可以繼續丟新訊息',
    '• 進度看板：<code>copilot.bw-space.com/office/openclaw</code>',
  ].join('\n')
}

async function sendAutonomousHandoffAck(update, payload, taskContent) {
  const { chatId, messageThreadId } = extractChatContext(update)
  const replyToMessageId = extractMessageId(update)
  if (!chatId) return false

  return sendTelegramMessage({
    message: formatAutonomousHandoffAck({
      agentId: payload?.agent,
      taskContent,
    }),
    chatId,
    replyToMessageId,
    messageThreadId,
    disableNotification: true,
  })
}

function isFromBot(update) {
  const from = update.message?.from || update.edited_message?.from
  return from?.is_bot === true
}

function isCommand(text) {
  return text && text.startsWith('/')
}

function isSystemMessage(text) {
  if (!text) return false
  if (text.startsWith('callback:')) return true
  if (text.includes('HEARTBEAT')) return true
  if (text.startsWith('Read HEARTBEAT.md')) return true
  return false
}

function getInternalOfficeToken() {
  return (
    process.env.OFFICE_ADMIN_TOKEN
    || process.env.OPENCLAW_OFFICE_TOKEN
    || process.env.X_OFFICE_TOKEN
    || ''
  )
}

function getAutonomousDispatchDelayMs() {
  const raw = Number(process.env.OPENCLAW_AUTONOMOUS_HANDOFF_DISPATCH_DELAY_MS || 15000)
  if (!Number.isFinite(raw) || raw <= 0) return 15000
  return Math.max(1000, Math.round(raw))
}

async function startAutonomousWorkflow({
  content,
  from,
  agent,
  messageId,
  routingReason,
  ...workflowSeed
}) {
  const headers = {
    'content-type': 'application/json',
  }
  const officeToken = getInternalOfficeToken()
  if (officeToken) {
    headers['x-office-token'] = officeToken
  }

  const response = await workflowPost(new Request('http://localhost/api/workflow', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      action: 'start_flow',
      content,
      from,
      agent,
      messageId,
      autonomousHandoff: true,
      deferDispatchUntilIdleMs: getAutonomousDispatchDelayMs(),
      routingReason,
      source: 'telegram_autonomous_handoff',
      ...workflowSeed,
    }),
  }))

  if (!response.ok) {
    const payload = await response.text()
    throw new Error(`workflow start_flow failed (${response.status}): ${payload}`)
  }

  return response.json()
}

async function forwardTelegramUpdateToGateway(rawBody, secret) {
  const { gatewayWebhookUrl } = getTelegramIngressConfig()
  const response = await fetch(gatewayWebhookUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(secret ? { [SECRET_HEADER]: secret } : {}),
    },
    body: rawBody,
  })

  if (!response.ok) {
    const payload = await response.text()
    throw new Error(`gateway webhook failed (${response.status}): ${payload}`)
  }
}

export async function POST(request) {
  const { webhookSecret } = getTelegramIngressConfig()

  if (!webhookSecret) {
    console.error('[telegram-webhook] Missing TELEGRAM_WEBHOOK_SECRET configuration')
    return new Response('Service Unavailable', { status: 503 })
  }

  const secret = request.headers.get(SECRET_HEADER)
  if (secret !== webhookSecret) {
    console.warn('[telegram-webhook] Invalid secret, rejecting')
    return new Response('Unauthorized', { status: 401 })
  }

  try {
    const rawBody = await request.text()
    const update = JSON.parse(rawBody)
    
    const text = extractMessageText(update)
    const sender = extractSenderName(update)
    const fromBot = isFromBot(update)
    const tgMessageId = extractMessageId(update)
    const autonomousHandoff = routeAutonomousHandoff(text || '', {
      defaultAutonomous: Boolean(text && !fromBot && !isSystemMessage(text)),
    })
    const shouldMirrorToDashboard = text
      && !fromBot
      && !isSystemMessage(text)
      && (autonomousHandoff.matched || !isCommand(text))
    const existingRequest = tgMessageId ? findByTgMessageId(tgMessageId) : null
    
    // Only create dashboard entries for real user messages
    if (shouldMirrorToDashboard && !existingRequest) {
      const content = text.length > 120 ? text.slice(0, 120) + '...' : text
      
      // Create "received" request for dashboard
      const req = createRequest({
        id: `req_${Date.now()}`,
        content,
        from: sender,
        state: 'received',
        assignedTo: null,
        task: null,
        createdAt: Date.now(),
        source: 'telegram_webhook',
        tgMessageId,
      })
      
      incrementMessages('received')
      
      // Create activity event
      const event = {
        id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        requestId: req.id,
        state: 'received',
        agent: 'wickedman',
        agentColor: AGENTS.wickedman?.color || '#888',
        agentName: AGENTS.wickedman?.name || 'WickedMan',
        message: `📥 Message from ${sender}: "${content.slice(0, 60)}${content.length > 60 ? '...' : ''}"`,
        time: timeStr(),
        timestamp: Date.now(),
      }
      addEvent(event)
      
      // Push to SSE clients INSTANTLY
      eventBus.emit(EVENTS.WORKFLOW_EVENT, event)
      eventBus.emit(EVENTS.REQUEST_UPDATE, req)
      
      console.log(`[telegram-webhook] Dashboard: "${content.slice(0, 50)}..." from ${sender} (tg_id=${tgMessageId})`)

      // Auto-progress to "analyzing" after 800ms
      const reqId = req.id
      const contentForAnalyze = content // capture for closure
      if (!autonomousHandoff.matched) {
        setTimeout(() => {
          const current = getRequestById(reqId)
          if (current && current.state === 'received') {
            updateRequest(reqId, { state: 'analyzing' })
            
            const analyzeEvent = {
              id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              requestId: reqId,
              state: 'analyzing',
              agent: 'wickedman',
              agentColor: AGENTS.wickedman?.color || '#888',
              agentName: AGENTS.wickedman?.name || 'WickedMan',
              message: `🔍 Analyzing: "${contentForAnalyze.slice(0, 50)}${contentForAnalyze.length > 50 ? '...' : ''}"`,
              time: timeStr(),
              timestamp: Date.now(),
            }
            addEvent(analyzeEvent)
            eventBus.emit(EVENTS.WORKFLOW_EVENT, analyzeEvent)
            const updated = getRequestById(reqId)
            if (updated) eventBus.emit(EVENTS.REQUEST_UPDATE, updated)
          }
        }, 800)
      }
    }

    if (shouldMirrorToDashboard && existingRequest) {
      console.log(`[telegram-webhook] Reusing existing dashboard request for duplicate tg_message_id=${tgMessageId}`)
    }
    
    if (autonomousHandoff.matched && autonomousHandoff.taskContent && !fromBot) {
      const payload = await startAutonomousWorkflow({
        content: autonomousHandoff.taskContent,
        from: sender,
        agent: autonomousHandoff.agent,
        messageId: tgMessageId,
        routingReason: autonomousHandoff.reason,
        ...(autonomousHandoff.workflowSeed || {}),
      })
      await sendAutonomousHandoffAck(update, payload, autonomousHandoff.taskContent)
      console.log(`[telegram-webhook] Autonomous handoff adopted request=${payload.requestId} task=${payload.taskId} agent=${payload.agent}`)
      return new Response('OK', { status: 200 })
    }

    await forwardTelegramUpdateToGateway(rawBody, webhookSecret)
    
    return new Response('OK', { status: 200 })
    
  } catch (error) {
    console.error('[telegram-webhook] Error:', error)
    if (error instanceof SyntaxError) {
      return new Response('Bad Request', { status: 400 })
    }
    return new Response('Upstream Failure', { status: 502 })
  }
}

export async function GET() {
  return Response.json({ 
    status: 'ok', 
    service: 'OpenClaw Office Telegram Webhook',
    ingress: 'office-first',
    timestamp: new Date().toISOString(),
  })
}
