import { routeAutonomousHandoff } from './autonomous-handoff.js'
import { getAgentsMap, getDiscordChannelPolicy } from './config.js'

const DISCORD_SESSION_RE = /^agent:[^:]+:discord:(channel|dm):/i

function parseDiscordSessionTarget(sessionKey) {
  const match = String(sessionKey || '').trim().match(/^agent:[^:]+:discord:(channel|dm):(.+)$/i)
  if (!match) return null
  return {
    peerKind: normalizeText(match[1]).toLowerCase(),
    peerId: normalizeText(match[2]),
  }
}

function extractPeerId(value) {
  const raw = normalizeText(value)
  if (!raw) return null
  const match = raw.match(/^(?:discord:)?(?:channel|dm|user):(.+)$/i)
  if (match?.[1]) return normalizeText(match[1])
  return raw
}

function extractSnowflake(value) {
  const raw = normalizeText(value)
  if (!raw) return null
  return /^\d{8,32}$/.test(raw) ? raw : null
}

function normalizeText(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
}

function resolveDiscordChannelBoundAgent(channelId, agentsMap = {}) {
  const normalizedChannelId = normalizeText(channelId)
  if (!normalizedChannelId) return null

  for (const [agentId, agent] of Object.entries(agentsMap || {})) {
    const bindings = Array.isArray(agent?.bindings) ? agent.bindings : []
    if (bindings.some((binding) => normalizeText(binding) === `discord channel:${normalizedChannelId}`)) {
      return agentId
    }
  }

  return null
}

export function isDiscordGatewaySession(sessionKey) {
  return DISCORD_SESSION_RE.test(String(sessionKey || '').trim())
}

export function extractGatewaySenderName(data, fallback = 'Discord') {
  const record = data && typeof data === 'object' ? data : {}
  const candidates = [
    record.senderName,
    record.authorName,
    record.userName,
    record.username,
    record.displayName,
    record.name,
    record.author,
    record.sender,
    record.from,
  ]

  for (const candidate of candidates) {
    const value = normalizeText(candidate)
    if (value) return value
  }

  return fallback
}

export function formatDiscordAutonomousHandoffAck({ agentId, taskContent, agents = {} }) {
  const agentInfo = agents[agentId] || {}
  const agentName = agentInfo.name || agentId || '代理'
  const agentEmoji = agentInfo.emoji || '🤖'
  const summary = normalizeText(taskContent)
  const shortSummary = summary.length > 96 ? `${summary.slice(0, 93)}...` : summary

  return [
    '已交辦',
    `- 接手：${agentEmoji} ${agentName}｜${shortSummary}`,
    '- 進度：已建立 formal workflow，會先自動研究 / 派工 / 驗證再回報',
    '- 進度看板：https://copilot.bw-space.com/office/openclaw',
  ].join('\n')
}

export function extractDiscordAutonomousAckDelivery({ sessionKey, data }) {
  const record = data && typeof data === 'object' ? data : {}
  const parsedSession = parseDiscordSessionTarget(sessionKey)

  const targetCandidates = [
    extractPeerId(record?.origin?.to),
    extractPeerId(record?.origin?.from),
    extractSnowflake(record.channelId),
    extractSnowflake(record.groupId),
    extractSnowflake(record.chatId),
    parsedSession?.peerId || null,
  ]

  const replyCandidates = [
    extractSnowflake(record.messageId),
    extractSnowflake(record.discordMessageId),
    extractSnowflake(record.sourceMessageId),
    extractSnowflake(record?.message?.id),
    extractSnowflake(record?.event?.messageId),
    extractSnowflake(record?.event?.id),
  ]

  return {
    target: targetCandidates.find(Boolean) || null,
    replyToMessageId: replyCandidates.find(Boolean) || null,
  }
}

export async function maybeAdoptDiscordAutonomousHandoff({
  sessionKey,
  text,
  data,
  agents,
  startWorkflow,
  defaultAutonomous = true,
}) {
  if (!isDiscordGatewaySession(sessionKey)) return null

  const configAgents = getAgentsMap()
  const resolvedAgents = { ...configAgents }
  for (const [agentId, partial] of Object.entries(agents || {})) {
    resolvedAgents[agentId] = {
      ...(configAgents[agentId] || {}),
      ...(partial || {}),
    }
  }
  const channelPolicy = getDiscordChannelPolicy({
    guildId: data?.guildId || data?.serverId || null,
    channelId: data?.channelId || parseDiscordSessionTarget(sessionKey)?.peerId || null,
  })
  const routed = routeAutonomousHandoff(text, {
    defaultAutonomous: channelPolicy?.autonomousByDefault ?? defaultAutonomous,
    allowBroadChatOptOut: channelPolicy?.operatorMode === 'strict' ? false : true,
    allowChatShortcut: channelPolicy?.operatorMode === 'strict' ? false : true,
    chatEscapePrefixes: channelPolicy?.chatEscapePrefix ? [channelPolicy.chatEscapePrefix] : [],
  })
  if (!routed.matched || !routed.taskContent) return null

  const boundOperatorAgent = channelPolicy?.operatorMode === 'strict'
    ? resolveDiscordChannelBoundAgent(
        data?.channelId || parseDiscordSessionTarget(sessionKey)?.peerId || null,
        resolvedAgents,
      )
    : null
  const strictOperatorSeed = boundOperatorAgent
    ? routeAutonomousHandoff(`/research ${routed.taskContent}`, {
        defaultAutonomous: false,
        allowBroadChatOptOut: false,
        allowChatShortcut: false,
      }).workflowSeed || routed.workflowSeed
    : routed.workflowSeed
  const effectiveRouting = boundOperatorAgent
    ? {
        ...routed,
        agent: boundOperatorAgent,
        reason: `自治交辦在 operator-only channel 直接交給 ${resolvedAgents[boundOperatorAgent]?.name || boundOperatorAgent}。`,
        workflowSeed: strictOperatorSeed,
      }
    : routed

  const payload = await startWorkflow({
    content: effectiveRouting.taskContent,
    from: extractGatewaySenderName(data),
    agent: effectiveRouting.agent,
    routingReason: effectiveRouting.reason,
    ...(effectiveRouting.workflowSeed || {}),
  })

  return {
    ...payload,
    routed: effectiveRouting,
    ackText: formatDiscordAutonomousHandoffAck({
      agentId: payload?.agent || effectiveRouting.agent,
      taskContent: effectiveRouting.taskContent,
      agents: resolvedAgents,
    }),
    ackDelivery: extractDiscordAutonomousAckDelivery({ sessionKey, data }),
  }
}

export function shouldKickGatewayAutonomousTask(task) {
  if (!task || typeof task !== 'object') return false
  if (String(task.brainMode || '') !== 'autonomous_handoff') return false
  if (String(task.pendingAction || '') !== 'start_work') return false
  if (task.dispatchRunId || task.dispatchSessionKey) return false
  const status = String(task.status || '').toLowerCase()
  return status === 'pending' || status === 'assigned' || status === 'in_progress'
}

export function shouldCompleteGatewayDelegatedTask(task) {
  if (!task || typeof task !== 'object') return false
  if (!task.dispatchRunId && !task.dispatchSessionKey) return false
  if (!task.assignedAgent || task.assignedAgent === 'wickedman') return false
  const status = String(task.status || '').toLowerCase()
  if (status === 'completed' || status === 'failed') return false
  if (String(task.brainMode || '') !== 'autonomous_handoff') return false
  return true
}
