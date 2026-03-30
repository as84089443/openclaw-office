import { appendFile, mkdir } from 'node:fs/promises'
import { parseAutonomousHandoff } from './autonomous-handoff.js'
import { getDiscordChannelPolicy } from './config.js'
import { maybeAdoptDiscordAutonomousHandoff } from './gateway-autonomous-handoff.js'
import { startGatewayAutonomousWorkflow } from './gateway-workflow-client.js'

const DISCORD_REST_BASE = 'https://discord.com/api/v10'
const OPERATOR_INGRESS_DIAGNOSTICS_PATH = '/Users/brian/.openclaw/runtime/diagnostics/gateway-discord-operator-ingress.jsonl'

function normalizeText(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildGatewaySessionKey(channelId) {
  return `agent:main:discord:channel:${channelId}`
}

function buildBlockingAck() {
  return [
    '阻塞',
    '- formal workflow 建立失敗，這則訊息沒有進入 direct chat。',
    '- 需要你決策的唯一事項：請檢查 Office workflow 是否可用，再重新交辦一次。',
  ].join('\n')
}

async function writeOperatorIngressDiagnostic(event = {}) {
  try {
    await mkdir('/Users/brian/.openclaw/runtime/diagnostics', { recursive: true })
    await appendFile(
      OPERATOR_INGRESS_DIAGNOSTICS_PATH,
      `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`,
      'utf8',
    )
  } catch {}
}

export async function sendDiscordOperatorAck({
  token,
  channelId,
  messageId,
  guildId = null,
  content,
  fetchImpl = fetch,
}) {
  const botToken = normalizeText(token)
  const targetChannelId = normalizeText(channelId)
  const replyToMessageId = normalizeText(messageId)
  const ackText = String(content || '').trim()

  if (!botToken || !targetChannelId || !replyToMessageId || !ackText) return false

  const response = await fetchImpl(`${DISCORD_REST_BASE}/channels/${targetChannelId}/messages`, {
    method: 'POST',
    headers: {
      authorization: `Bot ${botToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      content: ackText,
      allowed_mentions: {
        replied_user: false,
      },
      message_reference: {
        message_id: replyToMessageId,
        channel_id: targetChannelId,
        ...(guildId ? { guild_id: normalizeText(guildId) } : {}),
      },
    }),
  })

  if (!response.ok) {
    const payload = await response.text().catch(() => '')
    throw new Error(`discord ack failed (${response.status}): ${payload}`)
  }

  return true
}

export async function maybeHandleDiscordOperatorIngress(
  {
    text,
    guildId = null,
    channelId = null,
    messageId = null,
    senderName = 'Discord',
    token = '',
  } = {},
  deps = {},
) {
  const resolvePolicy = deps.getDiscordChannelPolicy || getDiscordChannelPolicy
  const parseHandoff = deps.parseAutonomousHandoff || parseAutonomousHandoff
  const adoptHandoff = deps.maybeAdoptDiscordAutonomousHandoff || maybeAdoptDiscordAutonomousHandoff
  const startWorkflow = deps.startGatewayAutonomousWorkflow || startGatewayAutonomousWorkflow
  const sendAck = deps.sendDiscordOperatorAck || sendDiscordOperatorAck

  const normalizedChannelId = normalizeText(channelId)
  if (!normalizedChannelId) {
    await writeOperatorIngressDiagnostic({ phase: 'missing_channel', guildId, channelId, messageId })
    return { mode: 'continue_chat' }
  }

  const channelPolicy = resolvePolicy({
    guildId: normalizeText(guildId) || null,
    channelId: normalizedChannelId,
  })

  await writeOperatorIngressDiagnostic({
    phase: 'start',
    guildId: normalizeText(guildId) || null,
    channelId: normalizedChannelId,
    messageId: normalizeText(messageId) || null,
    hasPolicy: Boolean(channelPolicy),
    operatorMode: channelPolicy?.operatorMode || null,
    workflowOnly: channelPolicy?.workflowOnly === true,
    textPreview: normalizeText(text).slice(0, 200),
  })

  if (channelPolicy?.operatorMode !== 'strict' || !channelPolicy?.workflowOnly) {
    await writeOperatorIngressDiagnostic({
      phase: 'policy_miss',
      guildId: normalizeText(guildId) || null,
      channelId: normalizedChannelId,
      messageId: normalizeText(messageId) || null,
      operatorMode: channelPolicy?.operatorMode || null,
      workflowOnly: channelPolicy?.workflowOnly === true,
    })
    return { mode: 'continue_chat' }
  }

  const parsed = parseHandoff(text, {
    defaultAutonomous: channelPolicy.autonomousByDefault !== false,
    allowBroadChatOptOut: false,
    allowChatShortcut: false,
    chatEscapePrefixes: channelPolicy.chatEscapePrefix ? [channelPolicy.chatEscapePrefix] : [],
  })

  if (!parsed.rawContent) {
    await writeOperatorIngressDiagnostic({
      phase: 'empty_raw_content',
      guildId: normalizeText(guildId) || null,
      channelId: normalizedChannelId,
      messageId: normalizeText(messageId) || null,
    })
    return { mode: 'continue_chat' }
  }

  if (!parsed.matched) {
    if (parsed.explicitOptOut) {
      await writeOperatorIngressDiagnostic({
        phase: 'chat_escape',
        guildId: normalizeText(guildId) || null,
        channelId: normalizedChannelId,
        messageId: normalizeText(messageId) || null,
      })
      return {
        mode: 'chat_escape',
        text: parsed.taskContent || '',
      }
    }

    await writeOperatorIngressDiagnostic({
      phase: 'parse_not_matched',
      guildId: normalizeText(guildId) || null,
      channelId: normalizedChannelId,
      messageId: normalizeText(messageId) || null,
      explicitOptOut: parsed.explicitOptOut === true,
    })
    return { mode: 'continue_chat' }
  }

  let adopted = null
  let ackText = ''
  let handoffError = null

  try {
    adopted = await adoptHandoff({
      sessionKey: buildGatewaySessionKey(normalizedChannelId),
      text,
      data: {
        guildId: normalizeText(guildId) || null,
        channelId: normalizedChannelId,
        messageId: normalizeText(messageId) || null,
        message: normalizeText(messageId) ? { id: normalizeText(messageId) } : undefined,
      },
      startWorkflow: async ({
        content,
        from,
        agent,
        routingReason,
        ...workflowSeed
      }) => startWorkflow({
        content,
        from: normalizeText(from) || normalizeText(senderName) || 'Discord',
        agent,
        messageId: normalizeText(messageId) || null,
        routingReason,
        source: 'discord_gateway_autonomous',
        researchLoop: 'reactive',
        operatorMode: 'strict',
        autonomyPolicy: 'no_prompt_until_human_gate',
        outputContract: 'research_operator_v1',
        ...workflowSeed,
      }),
    })
    ackText = String(adopted?.ackText || '').trim()
    await writeOperatorIngressDiagnostic({
      phase: 'handoff_adopted',
      guildId: normalizeText(guildId) || null,
      channelId: normalizedChannelId,
      messageId: normalizeText(messageId) || null,
      requestId: adopted?.requestId || null,
      taskId: adopted?.taskId || null,
    })
  } catch (error) {
    handoffError = error
    ackText = buildBlockingAck()
    await writeOperatorIngressDiagnostic({
      phase: 'handoff_error',
      guildId: normalizeText(guildId) || null,
      channelId: normalizedChannelId,
      messageId: normalizeText(messageId) || null,
      error: String(error),
    })
  }

  if (!ackText) {
    ackText = buildBlockingAck()
  }

  try {
    await sendAck({
      token,
      channelId: normalizedChannelId,
      messageId,
      guildId,
      content: ackText,
    })
    await writeOperatorIngressDiagnostic({
      phase: 'ack_sent',
      guildId: normalizeText(guildId) || null,
      channelId: normalizedChannelId,
      messageId: normalizeText(messageId) || null,
    })
  } catch (ackError) {
    if (!handoffError) {
      handoffError = ackError
    }
    await writeOperatorIngressDiagnostic({
      phase: 'ack_error',
      guildId: normalizeText(guildId) || null,
      channelId: normalizedChannelId,
      messageId: normalizeText(messageId) || null,
      error: String(ackError),
    })
  }

  await writeOperatorIngressDiagnostic({
    phase: 'return',
    guildId: normalizeText(guildId) || null,
    channelId: normalizedChannelId,
    messageId: normalizeText(messageId) || null,
    mode: 'workflow_handoff',
    requestId: adopted?.requestId || null,
    taskId: adopted?.taskId || null,
    error: handoffError ? String(handoffError) : null,
  })

  return {
    mode: 'workflow_handoff',
    requestId: adopted?.requestId || null,
    taskId: adopted?.taskId || null,
    error: handoffError ? String(handoffError) : null,
  }
}
