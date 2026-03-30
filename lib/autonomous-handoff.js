import { getAgentsMap, getPrimaryAgentId, resolveAgentId } from './config.js'
import { analyzeTask } from './workflow.js'

const AUTONOMOUS_HANDOFF_RE = /^\s*幫我完成[:：]\s*/u
const AUTONOMOUS_OPTOUT_RE = /^\s*(先聊|只是聊天|先討論|不用交辦|不要交辦|純聊天|先回答|只要回答)[:：]?\s*/u
const RESEARCH_SHORTCUT_RE = /^\s*\/(?:研究|research)(?:@[A-Za-z0-9_]+)?(?:\s+|$)/iu
const CHAT_SHORTCUT_RE = /^\s*\/(?:先聊|chat)(?:@[A-Za-z0-9_]+)?(?:\s+|$)/iu
const DEFAULT_RESEARCH_TASK = '研究目前最值得優先處理的應用程式、魚群流程與可開發功能'
const DEFAULT_APP_RESEARCH_TASK = '研究目前最值得優先處理的應用程式與頁面流程'
const DEFAULT_FLEET_RESEARCH_TASK = '研究魚群 routing、handoff、workflow、治理與看板'
const DEFAULT_FEATURE_RESEARCH_TASK = '研究最值得開發的新功能、自動化與落地順序'
const OFFICE_OPENCLAW_URL = 'https://copilot.bw-space.com/office/openclaw'
const AUTOPEN_PATH_HINT = '/admin/autopen'
const AUTOPEN_VERIFICATION_URL = 'https://www.bw-space.com/admin/autopen'
const RESEARCH_SHORTCUTS = [
  {
    shortcut: 'research',
    pattern: RESEARCH_SHORTCUT_RE,
    defaultTask: DEFAULT_RESEARCH_TASK,
    scope: null,
  },
  {
    shortcut: 'research_app',
    pattern: /^\s*\/(?:research_app|研究應用)(?:@[A-Za-z0-9_]+)?(?:\s+|$)/iu,
    defaultTask: DEFAULT_APP_RESEARCH_TASK,
    scope: 'application',
  },
  {
    shortcut: 'research_fleet',
    pattern: /^\s*\/(?:research_fleet|研究魚群)(?:@[A-Za-z0-9_]+)?(?:\s+|$)/iu,
    defaultTask: DEFAULT_FLEET_RESEARCH_TASK,
    scope: 'fleet',
  },
  {
    shortcut: 'research_feature',
    pattern: /^\s*\/(?:research_feature|研究功能)(?:@[A-Za-z0-9_]+)?(?:\s+|$)/iu,
    defaultTask: DEFAULT_FEATURE_RESEARCH_TASK,
    scope: 'feature',
  },
]

function normalizeText(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
}

function hasAny(text, patterns = []) {
  return patterns.some((pattern) => pattern.test(text))
}

function startsWithSlashCommand(text) {
  return /^\s*\//u.test(String(text || ''))
}

function escapeRegExp(value = '') {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeChatEscapePrefixes(prefixes = []) {
  const values = Array.isArray(prefixes) ? prefixes : [prefixes]
  const normalized = new Set()
  for (const value of values) {
    const prefix = normalizeText(value)
    if (!prefix) continue
    normalized.add(prefix)
    if (prefix.endsWith(':')) normalized.add(`${prefix.slice(0, -1)}：`)
    if (prefix.endsWith('：')) normalized.add(`${prefix.slice(0, -1)}:`)
  }
  return [...normalized]
}

function matchExplicitChatEscape(text, prefixes = []) {
  const normalized = normalizeText(text)
  for (const prefix of normalizeChatEscapePrefixes(prefixes)) {
    const re = new RegExp(`^\\s*${escapeRegExp(prefix)}\\s*`, 'u')
    if (!re.test(normalized)) continue
    return {
      prefix,
      stripped: normalizeText(normalized.replace(re, '')),
    }
  }
  return null
}

function parseResearchShortcut(text) {
  const normalized = normalizeText(text)
  if (!normalized) return null
  for (const definition of RESEARCH_SHORTCUTS) {
    if (!definition.pattern.test(normalized)) continue
    const strippedTask = normalizeText(normalized.replace(definition.pattern, ''))
    return {
      shortcut: definition.shortcut,
      scopeOverride: definition.scope,
      taskContent: strippedTask || definition.defaultTask,
    }
  }
  return null
}

function extractExplicitUrl(text) {
  const match = normalizeText(text).match(/https?:\/\/[^\s)，。！？；、】【「」『』《》〈〉〔〕]+/iu)
  return match?.[0] || null
}

function firstAvailableAgent(candidateIds = [], agents = {}, { exclude = [] } = {}) {
  for (const candidateId of candidateIds) {
    const resolved = resolveAgentId(candidateId)
    if (!resolved || exclude.includes(resolved)) continue
    if (agents[resolved]) return resolved
  }
  return null
}

function listFallbackWorkerCandidates() {
  return [
    'research-fish',
    'analyst',
    'dev-fish',
    'qa',
    'bizdev',
    'seo',
    'marketing',
    'content',
    'admin',
    'crm',
    'cs',
  ]
}

function buildResearchWorkflowSeed(taskContent, { shortcut = null, scopeOverride = null } = {}) {
  const text = normalizeText(taskContent)
  const explicitUrl = extractExplicitUrl(text)
  const mentionsAutopen = hasAny(text, [/autopen/i, /自動筆/u])
  const mentionsApp = hasAny(text, [
    /app/i,
    /應用/u,
    /產品/u,
    /頁面/u,
    /網站/u,
    /ui/i,
    /copilot/i,
    /office/i,
    /openclaw/i,
    /autopen/i,
  ])
  const mentionsFleet = hasAny(text, [
    /魚群/u,
    /agent/i,
    /workflow/i,
    /routing/i,
    /handoff/i,
    /dashboard/i,
    /看板/u,
    /系統/u,
    /治理/u,
    /協作/u,
    /openclaw/i,
  ])
  const mentionsFeature = hasAny(text, [
    /功能/u,
    /feature/i,
    /開發/u,
    /自動化/u,
    /automation/i,
    /機會/u,
    /improve/i,
    /優化/u,
    /roadmap/i,
  ])

  let scope = scopeOverride || 'application'
  if (!scopeOverride) {
    if (mentionsFleet && !mentionsApp && !mentionsFeature) scope = 'fleet'
    else if (mentionsFeature && !mentionsApp && !mentionsFleet) scope = 'feature'
    else if (mentionsFleet && mentionsFeature && !mentionsApp) scope = 'fleet'
    else if (!mentionsApp && !mentionsFleet && mentionsFeature) scope = 'feature'
  }

  const verificationUrl = explicitUrl
    || (mentionsAutopen ? AUTOPEN_VERIFICATION_URL : null)
    || (hasAny(text, [/copilot/i, /office/i, /openclaw/i, /魚群/u, /workflow/i, /dashboard/i, /看板/u]) ? OFFICE_OPENCLAW_URL : null)

  const scopeConfig = {
    application: {
      focus: '盤點應用程式現況、真實可用性、頁面/流程摩擦與可開發缺口。',
      summary: '研究魚會先做應用盤點，再決定要叫哪些 reviewer / worker / verifier。',
      nextCheckpoint: '先完成 app 現況盤點，再補 verifier / reviewer 與建議的開發任務。',
      suggestedSubagents: ['dev-fish', 'qa', 'analyst'],
      riskTier: 'medium',
      attentionType: 'opportunity',
    },
    fleet: {
      focus: '盤點魚群 routing、handoff、workflow、看板與治理問題，找出最值得先修的系統缺口。',
      summary: '研究魚會先巡整個魚群與流程治理，再把需要的工作派出去。',
      nextCheckpoint: '先收斂魚群系統現況，再補 reviewer / verifier，必要時開正式修補任務。',
      suggestedSubagents: ['admin', 'analyst', 'qa'],
      riskTier: 'medium',
      attentionType: 'decision',
    },
    feature: {
      focus: '盤點值得開發的新功能、自動化機會與落地順序，必要時帶出原型或正式交辦。',
      summary: '研究魚會先整理 feature radar，再決定要分派哪條實作或驗證線。',
      nextCheckpoint: '先完成功能機會盤點與排序，再決定要不要拉進 reviewer / worker。',
      suggestedSubagents: ['dev-fish', 'analyst', 'qa'],
      riskTier: 'low',
      attentionType: 'opportunity',
    },
  }[scope]

  const evidence = [
    shortcut ? `trigger: /${shortcut}` : 'trigger: research autonomous routing',
    `research scope: ${scope}`,
    verificationUrl ? `verification target: ${verificationUrl}` : null,
    mentionsAutopen ? `route hint: ${AUTOPEN_PATH_HINT}` : null,
  ].filter(Boolean)

  const knownFacts = [
    mentionsAutopen ? 'Autopen 主要後台路徑提示為 /admin/autopen。' : null,
    verificationUrl ? `若需要 UI / route 驗證，優先使用 ${verificationUrl}` : null,
  ].filter(Boolean)

  const openLoops = [
    '等待研究魚完成第一輪盤點與 delegation plan',
    verificationUrl ? '等待 verifier 針對指定入口做真實巡檢' : null,
  ].filter(Boolean)

  return {
    scope,
    researchLoop: 'reactive',
    operatorMode: 'strict',
    autonomyPolicy: 'no_prompt_until_human_gate',
    outputContract: 'research_operator_v1',
    downstreamMatrix: {
      implementation: ['dev-fish'],
      validation: ['qa'],
      rootCause: ['analyst'],
      governance: ['admin'],
      verifier: ['gstack-browse'],
    },
    brainState: {
      objective: text || DEFAULT_RESEARCH_TASK,
      focus: scopeConfig.focus,
      summary: scopeConfig.summary,
      nextCheckpoint: scopeConfig.nextCheckpoint,
      scope,
      knownFacts,
      evidence,
      openLoops,
      researchLoop: 'reactive',
      operatorMode: 'strict',
      autonomyPolicy: 'no_prompt_until_human_gate',
      outputContract: 'research_operator_v1',
    },
    delegationPlan: {
      allowSubagents: true,
      reviewerMode: 'research-operator',
      suggestedSubagents: scopeConfig.suggestedSubagents,
      currentStatus: 'queued',
      scope,
      nextHandoff: '先完成研究盤點，再把合適的工作派給 reviewer / worker / verifier。',
      notes: mentionsAutopen
        ? `Autopen 研究題已附 route hint ${AUTOPEN_PATH_HINT}；若要真實驗證，請先確認可用入口。`
        : '研究題預設啟用 reviewer / worker 協作。',
      operatorMode: 'strict',
      autonomyPolicy: 'no_prompt_until_human_gate',
      outputContract: 'research_operator_v1',
      downstreamMatrix: {
        implementation: ['dev-fish'],
        validation: ['qa'],
        rootCause: ['analyst'],
        governance: ['admin'],
        verifier: ['gstack-browse'],
      },
    },
    suggestedSubagents: scopeConfig.suggestedSubagents,
    riskTier: scopeConfig.riskTier,
    attentionType: scopeConfig.attentionType,
  }
}

function buildAutonomousWorkflowSeed(taskContent, { shortcut = null, agentId = null, scopeOverride = null } = {}) {
  const text = normalizeText(taskContent)
  const isResearchTask = shortcut?.startsWith('research') || agentId === 'research-fish' || hasAny(text, [
    /autoresearch/i,
    /研究/u,
    /mlx/i,
    /train/i,
    /val_bpb/i,
    /plateau/i,
    /實驗/u,
    /夜跑/u,
    /功能/u,
    /魚群/u,
    /autopen/i,
  ])

  if (!isResearchTask) return {}
  const resolvedScope = scopeOverride || (
    shortcut === 'research_app'
      ? 'application'
      : shortcut === 'research_fleet'
        ? 'fleet'
        : shortcut === 'research_feature'
          ? 'feature'
          : null
  )
  return buildResearchWorkflowSeed(taskContent, { shortcut, scopeOverride: resolvedScope })
}

function chooseSpecialist(taskContent, agents, primaryAgentId) {
  const text = normalizeText(taskContent)
  if (!text) return null

  if (hasAny(text, [
    /autoresearch/i,
    /研究/u,
    /mlx/i,
    /train/i,
    /val_bpb/i,
    /plateau/i,
    /實驗/u,
    /夜跑/u,
  ])) {
    return firstAvailableAgent(['research-fish', 'analyst', 'qa'], agents, { exclude: [primaryAgentId] })
  }

  if (hasAny(text, [
    /巡檢/u,
    /驗證/u,
    /檢查/u,
    /檢視/u,
    /browser/i,
    /網址/u,
    /網站/u,
    /頁面/u,
    /route/i,
    /smoke/i,
    /dogfood/i,
    /qa/i,
    /monitor/i,
  ])) {
    return firstAvailableAgent(['qa', 'analyst', 'dev-fish'], agents, { exclude: [primaryAgentId] })
  }

  if (hasAny(text, [
    /bug/i,
    /錯誤/u,
    /修復/u,
    /修到好/u,
    /fix/i,
    /deploy/i,
    /build/i,
    /api/i,
    /database/i,
    /schema/i,
    /workflow/i,
    /copilot/i,
    /office/i,
    /根因/u,
  ])) {
    return firstAvailableAgent(['dev-fish', 'analyst', 'qa'], agents, { exclude: [primaryAgentId] })
  }

  if (hasAny(text, [
    /報價/u,
    /詢價/u,
    /crm/i,
    /客戶/u,
    /業務/u,
    /sales/i,
  ])) {
    return firstAvailableAgent(['bizdev', 'cs', 'crm'], agents, { exclude: [primaryAgentId] })
  }

  if (hasAny(text, [
    /seo/i,
    /排名/u,
    /流量/u,
    /搜尋/u,
    /關鍵字/u,
  ])) {
    return firstAvailableAgent(['seo', 'marketing', 'content'], agents, { exclude: [primaryAgentId] })
  }

  return null
}

export function parseAutonomousHandoff(content, {
  defaultAutonomous = false,
  allowBroadChatOptOut = true,
  allowChatShortcut = true,
  chatEscapePrefixes = [],
} = {}) {
  const rawContent = normalizeText(content)
  if (!rawContent) {
    return {
      matched: false,
      rawContent: '',
      taskContent: '',
      shortcut: null,
    }
  }

  const explicitMatched = AUTONOMOUS_HANDOFF_RE.test(rawContent)
  const researchShortcut = parseResearchShortcut(rawContent)
  const researchShortcutMatched = Boolean(researchShortcut)
  const explicitPrefixOptOut = matchExplicitChatEscape(rawContent, chatEscapePrefixes)
  const explicitBroadOptOut = allowBroadChatOptOut && AUTONOMOUS_OPTOUT_RE.test(rawContent)
  const explicitChatShortcut = allowChatShortcut && CHAT_SHORTCUT_RE.test(rawContent)
  const explicitOptOut = Boolean(explicitPrefixOptOut || explicitBroadOptOut || explicitChatShortcut)
  const slashCommand = startsWithSlashCommand(rawContent)
  const matched = explicitMatched || researchShortcutMatched || (defaultAutonomous && !explicitOptOut && !slashCommand)
  const shortcut = researchShortcutMatched ? researchShortcut.shortcut : (explicitChatShortcut ? 'chat' : null)

  const strippedTask = explicitMatched
    ? normalizeText(rawContent.replace(AUTONOMOUS_HANDOFF_RE, ''))
    : researchShortcut
      ? researchShortcut.taskContent
      : explicitPrefixOptOut
        ? explicitPrefixOptOut.stripped
        : explicitBroadOptOut
        ? normalizeText(rawContent.replace(AUTONOMOUS_OPTOUT_RE, '').replace(CHAT_SHORTCUT_RE, ''))
        : explicitChatShortcut
          ? normalizeText(rawContent.replace(CHAT_SHORTCUT_RE, ''))
        : rawContent

  return {
    matched,
    rawContent,
    taskContent: researchShortcutMatched ? strippedTask : strippedTask,
    explicitMatched: explicitMatched || researchShortcutMatched,
    explicitOptOut,
    shortcut,
    scopeOverride: researchShortcut?.scopeOverride || null,
  }
}

export function routeAutonomousHandoff(content, options = {}) {
  const parsed = parseAutonomousHandoff(content, options)
  const agents = getAgentsMap()
  const primaryAgentId = resolveAgentId(getPrimaryAgentId())

  if (!parsed.matched || !parsed.taskContent) {
    return {
      ...parsed,
      agent: primaryAgentId,
      reason: parsed.explicitOptOut
        ? 'explicit-autonomous-opt-out'
        : 'not-an-autonomous-handoff',
    }
  }

  const specialist = parsed.shortcut?.startsWith('research')
    ? firstAvailableAgent(['research-fish', 'analyst', 'qa'], agents, { exclude: [primaryAgentId] })
    : chooseSpecialist(parsed.taskContent, agents, primaryAgentId)
  if (specialist) {
    return {
      ...parsed,
      agent: specialist,
      reason: parsed.shortcut === 'research'
        ? `研究快捷指令優先派給 ${agents[specialist]?.name || specialist}。`
        : parsed.shortcut?.startsWith('research')
          ? `研究快捷指令優先派給 ${agents[specialist]?.name || specialist}。`
        : `自治交辦依任務型態優先派給 ${agents[specialist]?.name || specialist}。`,
      workflowSeed: buildAutonomousWorkflowSeed(parsed.taskContent, {
        shortcut: parsed.shortcut,
        agentId: specialist,
        scopeOverride: parsed.scopeOverride,
      }),
    }
  }

  const analyzed = analyzeTask(parsed.taskContent)
  const analyzedAgent = resolveAgentId(analyzed?.agent || primaryAgentId)
  if (analyzedAgent && analyzedAgent !== primaryAgentId && agents[analyzedAgent]) {
    return {
      ...parsed,
      agent: analyzedAgent,
      reason: analyzed?.reason || `自治交辦由 ${agents[analyzedAgent]?.name || analyzedAgent} 接手。`,
      workflowSeed: buildAutonomousWorkflowSeed(parsed.taskContent, {
        shortcut: parsed.shortcut,
        agentId: analyzedAgent,
        scopeOverride: parsed.scopeOverride,
      }),
    }
  }

  const fallbackAgent = firstAvailableAgent(
    listFallbackWorkerCandidates(),
    agents,
    { exclude: [primaryAgentId] },
  ) || primaryAgentId

  return {
    ...parsed,
    agent: fallbackAgent,
    reason: `自治交辦預設派給 ${agents[fallbackAgent]?.name || fallbackAgent} 作為第一個可自主續跑的 worker。`,
    workflowSeed: buildAutonomousWorkflowSeed(parsed.taskContent, {
      shortcut: parsed.shortcut,
      agentId: fallbackAgent,
      scopeOverride: parsed.scopeOverride,
    }),
  }
}

export function pickAutonomousWorkerAgent(preferredAgentId) {
  const agents = getAgentsMap()
  const primaryAgentId = resolveAgentId(getPrimaryAgentId())
  const preferred = resolveAgentId(preferredAgentId)

  if (preferred && preferred !== primaryAgentId && agents[preferred]) {
    return preferred
  }

  return firstAvailableAgent(
    listFallbackWorkerCandidates(),
    agents,
    { exclude: [primaryAgentId] },
  ) || preferred || primaryAgentId
}
