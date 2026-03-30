import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

import { getAgentsMap, getConfig } from './config.js'

const STRICT_OPERATOR_SESSION_HYGIENE_VERSION = '2026-03-30-research-control-plane-v1'

let cachedResult = null

function normalizeText(value = '') {
  return String(value || '').trim()
}

function loadJsonFile(filePath, fallback = null) {
  if (!filePath || !existsSync(filePath)) return fallback
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'))
  } catch (error) {
    console.error('[operator-session-hygiene] failed to parse json:', filePath, error?.message || error)
    return fallback
  }
}

function writeJsonFile(filePath, data) {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(data, null, 2))
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

function getStrictDiscordOperatorTargets() {
  const config = getConfig()
  const policies = config?.channelPolicies?.discord?.byChannel || {}
  const agentsMap = getAgentsMap()
  const targets = []

  for (const [channelId, policy] of Object.entries(policies)) {
    if (policy?.operatorMode !== 'strict') continue
    const agentId = resolveDiscordChannelBoundAgent(channelId, agentsMap)
    if (!agentId) continue
    targets.push({
      channelId,
      agentId,
      sessionKey: `agent:${agentId}:discord:channel:${channelId}`,
    })
  }

  return targets
}

function getSessionStorePath(openclawHome, agentId) {
  return join(openclawHome, 'agents', agentId, 'sessions', 'sessions.json')
}

export function ensureStrictOperatorSessionHygiene() {
  if (cachedResult) return cachedResult

  const config = getConfig()
  const openclawHome = config?.openclaw?.home
  const markerPath = openclawHome
    ? join(openclawHome, 'runtime', 'strict-operator-session-hygiene.json')
    : null
  const marker = loadJsonFile(markerPath, {})

  if (marker?.version === STRICT_OPERATOR_SESSION_HYGIENE_VERSION) {
    cachedResult = {
      skipped: true,
      reason: 'already-applied',
      rotated: Array.isArray(marker.rotated) ? marker.rotated : [],
      markerPath,
    }
    return cachedResult
  }

  const rotated = []
  for (const target of getStrictDiscordOperatorTargets()) {
    const storePath = getSessionStorePath(openclawHome, target.agentId)
    const store = loadJsonFile(storePath, null)
    if (!store || typeof store !== 'object') continue

    const entry = store[target.sessionKey]
    if (!entry || typeof entry !== 'object') continue

    delete store[target.sessionKey]
    writeJsonFile(storePath, store)
    rotated.push({
      agentId: target.agentId,
      channelId: target.channelId,
      sessionKey: target.sessionKey,
      previousSessionId: normalizeText(entry.sessionId) || null,
      previousSessionFile: normalizeText(entry.sessionFile) || null,
      rotatedAt: Date.now(),
    })
  }

  const result = {
    skipped: false,
    rotated,
    markerPath,
  }

  if (markerPath) {
    writeJsonFile(markerPath, {
      version: STRICT_OPERATOR_SESSION_HYGIENE_VERSION,
      appliedAt: new Date().toISOString(),
      rotated,
    })
  }

  cachedResult = result
  return result
}

export function resetStrictOperatorSessionHygieneCache() {
  cachedResult = null
}
