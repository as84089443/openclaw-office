/**
 * OpenClaw Office Configuration System
 *
 * Priority:
 * 1. openclaw-office.config.json for local UI overrides
 * 2. ../openclaw.json for the canonical agent roster + bindings
 * 3. env overrides
 * 4. defaults
 */

import { readFileSync, existsSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

let _config = null
const __dirname = dirname(fileURLToPath(import.meta.url))
const OFFICE_ROOT = resolve(__dirname, '..')
const DEFAULT_OPENCLAW_HOME = resolve(OFFICE_ROOT, '..')

const AGENT_COLORS = [
  '#ff6b6b',
  '#f97316',
  '#f59e0b',
  '#eab308',
  '#84cc16',
  '#22c55e',
  '#14b8a6',
  '#06b6d4',
  '#0ea5e9',
  '#3b82f6',
  '#6366f1',
  '#8b5cf6',
  '#a855f7',
  '#d946ef',
  '#ec4899',
  '#f43f5e',
]

const DEFAULTS = {
  office: {
    name: 'My AI Office',
    style: 'cyberpunk',
  },
  gateway: {
    url: 'ws://127.0.0.1:18789',
    token: '',
  },
  agents: {},
  image: {
    path: 'public/sprites/office.png',
    positions: {},
  },
  telegram: {
    botToken: '',
    chatId: '',
    webhookSecret: '',
  },
  bossInbox: {
    discordTarget: '',
    deliveryEnabled: true,
    immediateTypes: ['blocked', 'risk', 'opportunity'],
    digestHourLocal: 18,
  },
  license: 'MIT',
}

function loadConfigFile() {
  const candidates = [
    process.env.OPENCLAW_OFFICE_CONFIG_PATH,
    join(process.cwd(), 'openclaw-office.config.json'),
    join(OFFICE_ROOT, 'openclaw-office.config.json'),
  ].filter(Boolean)

  for (const configPath of candidates) {
    if (!existsSync(configPath)) continue
    try {
      return JSON.parse(readFileSync(configPath, 'utf8'))
    } catch (err) {
      console.error(`[config] Failed to parse ${configPath}:`, err.message)
    }
  }
  return null
}

function loadOpenClawConfigFile(openclawHome) {
  const configPath =
    process.env.OPENCLAW_CONFIG_PATH ||
    join(openclawHome || DEFAULT_OPENCLAW_HOME, 'openclaw.json')
  if (!existsSync(configPath)) {
    return { parsed: null, path: configPath }
  }
  try {
    return {
      parsed: JSON.parse(readFileSync(configPath, 'utf8')),
      path: configPath,
    }
  } catch (err) {
    console.error('[config] Failed to parse openclaw.json:', err.message)
    return { parsed: null, path: configPath }
  }
}

function deepMerge(target, source) {
  const result = { ...target }
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(result[key] || {}, source[key])
    } else {
      result[key] = source[key]
    }
  }
  return result
}

function titleizeAgentId(id) {
  return String(id || '')
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || 'Agent'
}

function hashString(input) {
  let hash = 0
  for (const ch of String(input || '')) {
    hash = ((hash << 5) - hash) + ch.charCodeAt(0)
    hash |= 0
  }
  return Math.abs(hash)
}

function colorForAgent(id, overrideColor) {
  if (overrideColor) return overrideColor
  return AGENT_COLORS[hashString(id) % AGENT_COLORS.length]
}

function normalizeBinding(binding) {
  const match = binding?.match || {}
  const peer = match.peer || {}
  const pieces = [match.channel].filter(Boolean)
  if (peer.kind && peer.id) pieces.push(`${peer.kind}:${peer.id}`)
  if (match.accountId) pieces.push(`account:${match.accountId}`)
  return pieces.join(' ')
}

function primaryAgentIdFrom(configList) {
  if (!Array.isArray(configList) || configList.length === 0) return 'main'
  const explicitDefault = configList.find((entry) => entry?.default === true)
  if (explicitDefault?.id) return String(explicitDefault.id)
  const main = configList.find((entry) => String(entry?.id || '') === 'main')
  if (main?.id) return 'main'
  return String(configList[0]?.id || 'main')
}

function normalizeAgents(config, officeOverrides) {
  const agentsConfig = config?.agents || {}
  const defaults = agentsConfig.defaults || {}
  const configList = Array.isArray(agentsConfig.list) ? agentsConfig.list : []
  const primaryAgentId = primaryAgentIdFrom(configList)
  const bindings = Array.isArray(config?.bindings) ? config.bindings : []
  const bindingsByAgent = new Map()

  for (const binding of bindings) {
    const agentId = String(binding?.agentId || primaryAgentId)
    const label = normalizeBinding(binding)
    if (!label) continue
    const current = bindingsByAgent.get(agentId) || []
    if (!current.includes(label)) current.push(label)
    bindingsByAgent.set(agentId, current)
  }

  const overrideAgents = officeOverrides?.agents && typeof officeOverrides.agents === 'object'
    ? officeOverrides.agents
    : {}

  if (configList.length === 0) {
    const fallbackAgents = {}
    for (const [id, override] of Object.entries(overrideAgents)) {
      fallbackAgents[id] = {
        id,
        name: override?.name || titleizeAgentId(id),
        role: override?.role || 'Agent',
        color: colorForAgent(id, override?.color),
        emoji: override?.emoji || '🤖',
        workspace: override?.workspace || null,
        agentDir: override?.agentDir || null,
        bindings: [],
        channels: [],
        model: defaults?.model?.primary || null,
        position: override?.position || null,
        keywords: Array.isArray(override?.keywords) ? override.keywords : [],
        isPrimary: id === primaryAgentId,
      }
    }
    return { agents: fallbackAgents, primaryAgentId }
  }

  const normalized = {}
  for (const raw of configList) {
    const id = String(raw?.id || '').trim()
    if (!id) continue
    const override = overrideAgents[id] || {}
    const identity = raw?.identity && typeof raw.identity === 'object' ? raw.identity : {}
    const agentBindings = bindingsByAgent.get(id) || []

    normalized[id] = {
      id,
      name: override?.name || identity?.name || raw?.name || titleizeAgentId(id),
      role: override?.role || identity?.role || titleizeAgentId(id),
      color: colorForAgent(id, override?.color),
      emoji: override?.emoji || identity?.emoji || '🤖',
      workspace: raw?.workspace || null,
      agentDir: raw?.agentDir || null,
      bindings: agentBindings,
      channels: [...new Set(agentBindings.map((binding) => String(binding).split(' ')[0]).filter(Boolean))],
      model: raw?.model || defaults?.model?.primary || null,
      position: override?.position || null,
      keywords: Array.isArray(override?.keywords) ? override.keywords : [],
      isPrimary: id === primaryAgentId,
    }
  }

  return { agents: normalized, primaryAgentId }
}

function buildConfig() {
  let config = { ...DEFAULTS }

  // Layer 1: Config file
  const fileConfig = loadConfigFile()
  if (fileConfig) {
    config = deepMerge(config, fileConfig)
  }

  const openclawHome = process.env.OPENCLAW_HOME || DEFAULT_OPENCLAW_HOME
  const openclawConfig = loadOpenClawConfigFile(openclawHome)
  const normalizedAgents = normalizeAgents(openclawConfig.parsed, fileConfig || {})
  config.agents = normalizedAgents.agents
  config.primaryAgentId = normalizedAgents.primaryAgentId
  config.agentAliases = { wickedman: normalizedAgents.primaryAgentId }
  config.openclaw = {
    home: openclawHome,
    configPath: openclawConfig.path,
  }

  // Layer 2: Environment variable overrides
  if (process.env.OPENCLAW_GATEWAY_URL) config.gateway.url = process.env.OPENCLAW_GATEWAY_URL
  if (process.env.OPENCLAW_GATEWAY_TOKEN) config.gateway.token = process.env.OPENCLAW_GATEWAY_TOKEN
  if (process.env.TELEGRAM_BOT_TOKEN) config.telegram.botToken = process.env.TELEGRAM_BOT_TOKEN
  if (process.env.TELEGRAM_CHAT_ID) config.telegram.chatId = process.env.TELEGRAM_CHAT_ID
  if (process.env.TELEGRAM_WEBHOOK_SECRET) config.telegram.webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET
  if (process.env.OFFICE_NAME) config.office.name = process.env.OFFICE_NAME
  if (process.env.OFFICE_STYLE) config.office.style = process.env.OFFICE_STYLE

  return config
}

/**
 * Get the resolved configuration. Cached after first call.
 */
export function getConfig() {
  if (!_config) _config = buildConfig()
  return _config
}

/**
 * Reload configuration (useful for testing or hot-reload)
 */
export function reloadConfig() {
  _config = null
  return getConfig()
}

/**
 * Validate that required fields are present.
 * Returns { valid: boolean, errors: string[] }
 */
export function validateConfig(config) {
  const errors = []
  if (!config) config = getConfig()

  if (!config.gateway?.url) errors.push('gateway.url is required')

  const agentKeys = Object.keys(config.agents || {})
  if (agentKeys.length === 0) errors.push('At least one agent must be defined in agents')

  return { valid: errors.length === 0, errors }
}

/**
 * Get agents as a lookup map: { id: { name, color, emoji, role } }
 */
export function getAgentsMap() {
  return getConfig().agents || {}
}

/**
 * Get agents as an array with id included
 */
export function getAgentsList() {
  const agents = getConfig().agents || {}
  return Object.entries(agents)
    .map(([id, data]) => ({ id, ...data }))
    .sort((a, b) => {
      if (a.isPrimary) return -1
      if (b.isPrimary) return 1
      return a.name.localeCompare(b.name)
    })
}

/**
 * Get label/animation positions from config
 */
export function getPositions() {
  const agents = getConfig().agents || {}
  const positions = {}
  for (const [id, agent] of Object.entries(agents)) {
    if (agent.position) positions[id] = agent.position
  }
  // Override with explicit image.positions
  const imgPositions = getConfig().image?.positions || {}
  return { ...positions, ...imgPositions }
}

export function getPrimaryAgentId() {
  return getConfig().primaryAgentId || 'main'
}

export function resolveAgentId(agentId) {
  const id = String(agentId || '').trim()
  if (!id) return getPrimaryAgentId()
  const aliases = getConfig().agentAliases || {}
  return aliases[id] || id
}

export function getAgentAliases() {
  return { ...(getConfig().agentAliases || {}) }
}

export function getBossInboxConfig() {
  return getConfig().bossInbox || { ...DEFAULTS.bossInbox }
}
