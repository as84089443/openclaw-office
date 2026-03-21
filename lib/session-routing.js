import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { getAgentsList, getConfig } from './config.js'

const ROUTING_CACHE_TTL_MS = 5000

let routingCache = null

function normalizeToken(value) {
  const token = String(value || '').trim()
  return token || null
}

function titleizeAgentId(id) {
  return String(id || '')
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || 'Agent'
}

function inferAgentIdFromSessionKey(sessionKey) {
  const key = String(sessionKey || '').trim()
  if (!key.startsWith('agent:')) return null
  const parts = key.split(':')
  return normalizeToken(parts[1])
}

function parsePeerRef(value) {
  const raw = normalizeToken(value)
  if (!raw) return null
  const parts = raw.split(':')
  if (parts.length < 3) return null
  return {
    channel: normalizeToken(parts[0]),
    peerKind: normalizeToken(parts[1]),
    peerId: normalizeToken(parts.slice(2).join(':')),
  }
}

function parseSessionKeyBinding(sessionKey) {
  const key = String(sessionKey || '').trim()
  if (!key.startsWith('agent:')) return null
  const parts = key.split(':')
  if (parts.length < 5) return null
  return {
    channel: normalizeToken(parts[2]),
    peerKind: normalizeToken(parts[3]),
    peerId: normalizeToken(parts.slice(4).join(':')),
  }
}

function bindingKey(channel, peerKind, peerId) {
  const normalizedChannel = normalizeToken(channel)
  const normalizedPeerKind = normalizeToken(peerKind)
  const normalizedPeerId = normalizeToken(peerId)
  if (!normalizedChannel || !normalizedPeerKind || !normalizedPeerId) return null
  return `${normalizedChannel}:${normalizedPeerKind}:${normalizedPeerId}`
}

function loadRoutingIndex() {
  const now = Date.now()
  if (routingCache && routingCache.expiresAt > now) return routingCache

  const config = getConfig()
  const configPath = config?.openclaw?.configPath
  let parsed = null
  if (configPath && existsSync(configPath)) {
    try {
      parsed = JSON.parse(readFileSync(configPath, 'utf8'))
    } catch {
      parsed = null
    }
  }

  const bindings = Array.isArray(parsed?.bindings) ? parsed.bindings : []
  const bindingAgentByKey = new Map()
  for (const binding of bindings) {
    const key = bindingKey(
      binding?.match?.channel,
      binding?.match?.peer?.kind,
      binding?.match?.peer?.id,
    )
    const agentId = normalizeToken(binding?.agentId)
    if (!key || !agentId || bindingAgentByKey.has(key)) continue
    bindingAgentByKey.set(key, agentId)
  }

  const agentMetaById = new Map()
  for (const agent of getAgentsList()) {
    const agentId = normalizeToken(agent?.id)
    if (!agentId) continue
    agentMetaById.set(agentId, {
      id: agentId,
      name: normalizeToken(agent?.name) || titleizeAgentId(agentId),
      emoji: normalizeToken(agent?.emoji) || '🤖',
    })
  }

  routingCache = {
    expiresAt: now + ROUTING_CACHE_TTL_MS,
    bindingAgentByKey,
    agentMetaById,
  }

  return routingCache
}

function buildResolutionCandidates({ sessionKey, channel, groupId, origin }) {
  const out = []

  const push = (candidate) => {
    if (!candidate?.channel || !candidate?.peerKind || !candidate?.peerId) return
    const key = bindingKey(candidate.channel, candidate.peerKind, candidate.peerId)
    if (key && !out.includes(key)) out.push(key)
  }

  push(parseSessionKeyBinding(sessionKey))

  const normalizedChannel = normalizeToken(channel)
  const normalizedGroupId = normalizeToken(groupId)
  if (normalizedChannel && normalizedGroupId) {
    push({
      channel: normalizedChannel,
      peerKind: 'channel',
      peerId: normalizedGroupId,
    })
  }

  if (origin && typeof origin === 'object') {
    push(parsePeerRef(origin.from))
    const target = parsePeerRef(origin.to)
    if (target) {
      push(target)
    } else if (normalizedChannel) {
      const rawTo = normalizeToken(origin.to)
      if (rawTo?.startsWith('channel:')) {
        push({
          channel: normalizedChannel,
          peerKind: 'channel',
          peerId: rawTo.slice('channel:'.length),
        })
      }
    }
  }

  return out
}

export function getAgentMeta(agentId) {
  const normalizedId = normalizeToken(agentId)
  if (!normalizedId) {
    return {
      id: 'unassigned',
      name: 'Unassigned',
      emoji: '🌀',
    }
  }
  const { agentMetaById } = loadRoutingIndex()
  return agentMetaById.get(normalizedId) || {
    id: normalizedId,
    name: titleizeAgentId(normalizedId),
    emoji: normalizedId === 'main' ? '🦞' : '🤖',
  }
}

export function resolveSessionAgent({ sessionKey, agentId, channel, groupId, origin }) {
  const storedAgentId = normalizeToken(agentId) || inferAgentIdFromSessionKey(sessionKey)
  if (storedAgentId && storedAgentId !== 'main') {
    return {
      agentId: storedAgentId,
      storedAgentId,
      source: agentId ? 'explicit' : 'session-key',
      bindingKey: null,
    }
  }

  const { bindingAgentByKey } = loadRoutingIndex()
  for (const key of buildResolutionCandidates({ sessionKey, channel, groupId, origin })) {
    const resolvedAgentId = bindingAgentByKey.get(key)
    if (resolvedAgentId) {
      return {
        agentId: resolvedAgentId,
        storedAgentId,
        source: 'binding',
        bindingKey: key,
      }
    }
  }

  return {
    agentId: storedAgentId || null,
    storedAgentId,
    source: storedAgentId ? (agentId ? 'explicit' : 'session-key') : 'unknown',
    bindingKey: null,
  }
}

export function listAgentSessionDirectories() {
  const config = getConfig()
  const openclawHome = config?.openclaw?.home
  const agentsDir = openclawHome ? join(openclawHome, 'agents') : null
  const discovered = []
  const seen = new Set()

  if (agentsDir && existsSync(agentsDir)) {
    const entries = readdirSync(agentsDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const dir = join(agentsDir, entry.name, 'sessions')
      if (!existsSync(dir) || seen.has(dir)) continue
      seen.add(dir)
      discovered.push({
        agentId: entry.name,
        dir,
      })
    }
  }

  const fallbackDir = normalizeToken(process.env.OPENCLAW_SESSIONS_DIR)
  if (fallbackDir && existsSync(fallbackDir) && !seen.has(fallbackDir)) {
    const parts = fallbackDir.split('/')
    const inferredAgentId = parts.length >= 3 ? parts[parts.length - 2] : getPrimaryAgentId()
    discovered.push({
      agentId: inferredAgentId,
      dir: fallbackDir,
    })
  }

  return discovered
}

export function buildConversationCategories(sessions) {
  const sessionList = Array.isArray(sessions) ? sessions : []
  const counts = new Map()
  for (const session of sessionList) {
    const agentId = normalizeToken(session?.agentId)
    if (!agentId) continue
    counts.set(agentId, (counts.get(agentId) || 0) + 1)
  }

  const configured = getAgentsList().map((agent) => ({
    agentId: agent.id,
    name: agent.name || titleizeAgentId(agent.id),
    emoji: agent.emoji || '🤖',
    sessionCount: counts.get(agent.id) || 0,
  }))

  const knownIds = new Set(configured.map((entry) => entry.agentId))
  for (const [agentId, sessionCount] of counts.entries()) {
    if (knownIds.has(agentId)) continue
    const meta = getAgentMeta(agentId)
    configured.push({
      agentId,
      name: meta.name,
      emoji: meta.emoji,
      sessionCount,
    })
  }

  return configured.sort((a, b) => {
    if (a.sessionCount !== b.sessionCount) return b.sessionCount - a.sessionCount
    return a.name.localeCompare(b.name)
  })
}
