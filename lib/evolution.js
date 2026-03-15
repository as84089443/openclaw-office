import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'fs'
import { basename, join, resolve } from 'path'
import { getAgentsList, getAgentsMap, getConfig, resolveAgentId } from './config.js'

const DAY_MS = 24 * 60 * 60 * 1000
const EVENT_VERSION = 1
const GROWTH_AGENTS = new Set(['seo', 'marketing', 'bizdev', 'ai-biz', 'cs-quote', 'production'])
const GOVERNANCE_AGENTS = new Set(['admin', 'qa', 'analyst', 'memory-distiller'])
const META_AGENTS = new Set(['memory-distiller'])
const APPLYABLE_MARKDOWN_TARGETS = new Set(['SYSTEM_PROMPT.md', 'HEARTBEAT.md', 'AI_KNOWLEDGE_BASE.md', 'LEARNINGS.md'])
const DECISION_TEST_RE = /Brian|拍板|核准|批准|決策|要不要|是否先|是否要先|sign off|approve|choose|pick/i
const ESCALATION_BLOCKER_CATEGORIES = new Set(['login-permission', 'data-backfill', 'delivery-flow'])
const GROWTH_CATEGORY_LABELS = {
  'high-intent-conversion': '高意圖成長訊號',
  'repurchase-followup': '回購跟進訊號',
  'quote-readiness': '報價就緒訊號',
  'delivery-flow': '交付節點訊號',
  'data-backfill': '資料回填缺口',
  'login-permission': '登入或權限缺口',
  'safety-risk': '安全或治理風險',
  general: '一般營運訊號',
}

const SECTION_ALIASES = {
  progress: ['今日推進', '整體', 'workspace 完整性', '今日主題群', '可驗證訊號', '本週最強訊號', '今日 10 篇文章批次規劃'],
  watchNow: ['你現在要看', '結論', '一句話結論', '本週結論先講', '最優先先發順序', '待修項建議'],
  blockers: ['卡點 / 風險', '發現異常', '風險', '失敗模式', '缺什麼'],
  nextSteps: ['下一步', '今日寫作重點', '下週優先行動', '補完後我下一輪會做什麼'],
  learned: ['今天學到', '為什麼選這組', 'SERP 觀察重點', '成長洞察', '成功模式'],
  nextTests: ['下一輪要試', '待驗證假設', '下週要測', '補完後我下一輪會做什麼'],
  status: ['狀態'],
  missing: ['缺什麼'],
  owner: ['誰要補'],
}

const MAIN_SECTION_HEADERS = ['今日推進', '你現在要看', '卡點 / 風險', '下一步', '今天學到', '下一輪要試']
const SHORT_SECTION_HEADERS = ['狀態', '缺什麼', '誰要補', '補完後我下一輪會做什麼', '今天學到']
const AUTO_APPLY_CONFIDENCE_MIN = 0.8
const AUTO_APPLY_IMPACT_MIN = 78
const DEFAULT_MAX_LINE_DELTA = 80
const ATTENTION_CANARY_WINDOW_MS = DAY_MS

const TARGET_SCOPE_RULES = [
  {
    id: 'system-prompt',
    label: 'SYSTEM_PROMPT 指定段落',
    matches: (target) => basename(target) === 'SYSTEM_PROMPT.md',
    maxLineDelta: 80,
  },
  {
    id: 'heartbeat',
    label: 'HEARTBEAT checklist 區塊',
    matches: (target) => basename(target) === 'HEARTBEAT.md',
    maxLineDelta: 60,
  },
  {
    id: 'discord-report-contract',
    label: 'Discord report contract 區塊',
    matches: (target) => target === getPromptSourcePath(),
    maxLineDelta: 120,
  },
  {
    id: 'knowledge-promoted',
    label: 'AI_KNOWLEDGE_BASE promoted 區塊',
    matches: (target) => basename(target) === 'AI_KNOWLEDGE_BASE.md',
    maxLineDelta: 80,
  },
]

function getOpenClawHome() {
  return getConfig().openclaw?.home || process.env.OPENCLAW_HOME || resolve(process.cwd(), '..')
}

function getCronJobsPath() {
  return join(getOpenClawHome(), 'cron', 'jobs.json')
}

function getCronRunsDir() {
  return join(getOpenClawHome(), 'cron', 'runs')
}

function getStateDir() {
  return join(process.cwd(), 'data')
}

function getSyncStatePath() {
  return join(getStateDir(), 'evolution-sync-state.json')
}

function getAgentSystemDir() {
  return join(getOpenClawHome(), 'workspace', 'agent-system')
}

function getEvolutionPendingDir() {
  return join(getAgentSystemDir(), 'evolution-pending')
}

function getEvolutionReviewedDir() {
  return join(getAgentSystemDir(), 'evolution-reviewed')
}

function getKnowledgeBasePath() {
  return join(getAgentSystemDir(), 'AI_KNOWLEDGE_BASE.md')
}

function getPromptSourcePath() {
  return join(getOpenClawHome(), 'scripts', 'discord-report-prompts.mjs')
}

function ensureDir(path) {
  mkdirSync(path, { recursive: true })
}

function ensureEvolutionCandidateDirs() {
  const pendingDir = getEvolutionPendingDir()
  const reviewedDir = getEvolutionReviewedDir()
  const legacyDir = join(pendingDir, 'legacy')
  ensureDir(pendingDir)
  ensureDir(reviewedDir)
  ensureDir(legacyDir)

  for (const entry of readdirSync(pendingDir, { withFileTypes: true })) {
    if (entry.isDirectory()) continue
    if (entry.name === '.gitkeep' || entry.name.endsWith('.json')) continue
    const fromPath = join(pendingDir, entry.name)
    const toPath = join(legacyDir, entry.name)
    if (!existsSync(toPath)) renameSync(fromPath, toPath)
  }

  return { pendingDir, reviewedDir, legacyDir }
}

function safeReadJson(path, fallback) {
  try {
    if (!path || !existsSync(path)) return fallback
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return fallback
  }
}

function safeWriteJson(path, value) {
  if (!path) return
  ensureDir(join(path, '..'))
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n')
}

function trimText(text, max = 220) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim()
  if (!clean) return ''
  return clean.length > max ? `${clean.slice(0, max - 3)}...` : clean
}

function normalizeListEntry(line) {
  return String(line || '')
    .replace(/^\s*[-*•]\s*/, '')
    .replace(/^\s*\d+[.)、]\s*/, '')
    .trim()
}

function normalizeHeading(line) {
  return String(line || '').trim().replace(/[：:]\s*$/, '')
}

function readCronJobs() {
  return safeReadJson(getCronJobsPath(), { jobs: [] })?.jobs || []
}

function isReportJob(job) {
  return Boolean(
    job?.enabled &&
    job?.payload?.kind === 'agentTurn' &&
    job?.delivery?.channel === 'discord' &&
    job?.agentId &&
    job.agentId !== 'memory-distiller',
  )
}

function isManagedJob(job) {
  return isReportJob(job) || Boolean(job?.enabled && resolveAgentId(job.agentId) === 'memory-distiller')
}

function getManagedAgentIds() {
  const managed = new Set()
  for (const job of readCronJobs()) {
    if (isManagedJob(job)) {
      managed.add(resolveAgentId(job.agentId))
    }
  }
  return managed
}

export function getActiveReportAgentIds() {
  const active = new Set()
  for (const job of readCronJobs()) {
    if (!isReportJob(job)) continue
    active.add(resolveAgentId(job.agentId))
  }
  return active
}

function getManagedJobsByAgent() {
  const map = new Map()
  for (const job of readCronJobs()) {
    if (!isManagedJob(job)) continue
    const agentId = resolveAgentId(job.agentId)
    const current = map.get(agentId) || []
    current.push(job)
    map.set(agentId, current)
  }
  return map
}

function readJsonl(path) {
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter(Boolean)
}

function readRunEntries(jobId) {
  const runFile = join(getCronRunsDir(), `${jobId}.jsonl`)
  return readJsonl(runFile)
    .filter((entry) => entry.action === 'finished')
    .sort((a, b) => Number(a.runAtMs || 0) - Number(b.runAtMs || 0))
}

function detectSectionKey(line) {
  const heading = normalizeHeading(line)
  for (const [key, aliases] of Object.entries(SECTION_ALIASES)) {
    if (aliases.includes(heading)) return key
  }
  return null
}

function splitIntoSections(summary) {
  const rawLines = String(summary || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
  const sections = {}
  let current = null

  for (const rawLine of rawLines) {
    const line = rawLine.trim()
    if (!line) continue
    const key = detectSectionKey(line)
    if (key) {
      current = key
      sections[current] = sections[current] || []
      continue
    }
    if (!current) {
      sections.__intro = sections.__intro || []
      sections.__intro.push(normalizeListEntry(line))
      continue
    }
    const normalized = normalizeListEntry(line)
    if (normalized) sections[current].push(normalized)
  }

  return sections
}

function uniqCompact(items, limit = 4) {
  const seen = new Set()
  const output = []
  for (const item of items || []) {
    const normalized = trimText(item, 180)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    output.push(normalized)
    if (output.length >= limit) break
  }
  return output
}

function pickByRegex(lines, regex, limit = 3) {
  return uniqCompact(lines.filter((line) => regex.test(line)), limit)
}

function buildFallbackSections(summary) {
  const lines = String(summary || '')
    .split(/\r?\n/)
    .map((line) => normalizeListEntry(line))
    .filter(Boolean)

  const progress = uniqCompact(lines.slice(0, 3), 3)
  const blockers = pickByRegex(lines, /風險|異常|失敗|timeout|timed out|警告|缺|卡住|權限|登入|阻塞|待修/i)
  const watchNow = uniqCompact([
    ...pickByRegex(lines, /優先|結論|今天適合|最值得|第一優先|最先/i, 2),
    ...(blockers[0] ? [blockers[0]] : []),
  ], 2)
  const nextSteps = uniqCompact([
    ...pickByRegex(lines, /建議|下一步|先|補上|追進|發動|整理|確認|隔離|跟進|發|寫/i, 3),
  ], 3)
  const learned = uniqCompact([
    ...pickByRegex(lines, /因為|觀察|結論|模式|適合|代表|說明|高意圖|學到/i, 2),
    ...(watchNow[0] ? [watchNow[0]] : []),
  ], 2)
  const nextTests = uniqCompact([
    ...pickByRegex(lines, /明天|下週|先發順序|優先行動|要測|下一輪/i, 2),
    ...(nextSteps[0] ? [nextSteps[0]] : []),
  ], 2)

  return { progress, watchNow, blockers, nextSteps, learned, nextTests }
}

function inferFormat(summary) {
  const text = String(summary || '')
  const hasMain = MAIN_SECTION_HEADERS.every((header) => text.includes(header))
  if (hasMain) return 'hard'
  const hasShort = SHORT_SECTION_HEADERS.every((header) => text.includes(header))
  if (hasShort) return 'short'
  return 'legacy'
}

function parseReportSummary(summary, status = 'ok') {
  if (status !== 'ok') {
    const message = trimText(summary || 'cron: job execution timed out', 200)
    return {
      format: 'error',
      progress: [],
      watchNow: [message],
      blockers: [message],
      nextSteps: ['先恢復這條排程，再重新跑一次。'],
      learned: ['這條魚沒有完成回報，現況不能當成已驗證結果。'],
      nextTests: ['下輪先確認排程是否能在時限內完成。'],
      qualityRegression: true,
      missingRequired: ['summary'],
    }
  }

  const format = inferFormat(summary)
  const sections = splitIntoSections(summary)
  const fallback = buildFallbackSections(summary)
  const progress = uniqCompact(sections.progress || fallback.progress, 3)
  const watchNow = uniqCompact(
    sections.watchNow || (sections.status ? sections.status.concat(sections.owner || []) : fallback.watchNow),
    3,
  )
  const blockers = uniqCompact(sections.blockers || sections.missing || fallback.blockers, 4)
  const nextSteps = uniqCompact(sections.nextSteps || sections.owner || fallback.nextSteps, 4)
  const learned = uniqCompact(sections.learned || fallback.learned, 3)
  const nextTests = uniqCompact(sections.nextTests || sections.nextSteps || fallback.nextTests, 3)
  const missingRequired = []

  if (learned.length === 0) missingRequired.push('今天學到')
  if (nextTests.length === 0) missingRequired.push('下一輪要試')

  return {
    format,
    progress,
    watchNow,
    blockers,
    nextSteps,
    learned,
    nextTests,
    qualityRegression: missingRequired.length > 0 || format === 'legacy',
    missingRequired,
  }
}

function inferCategory(agentId, text) {
  const content = String(text || '')
  if (/安全|allowlist|sandbox|危險|security/i.test(content)) return 'safety-risk'
  if (
    GROWTH_AGENTS.has(agentId) &&
    /高意圖|內鏈|CTA|推薦怎麼選|報價與選擇|cluster|轉換|展店|開發信|最值得追|最值得發|最值得寫|詢問表單/i.test(content)
  ) return 'high-intent-conversion'
  if (/回購|followup|回訪|追單/i.test(content)) return 'repurchase-followup'
  if (/報價|詢價|成交|商機|lead|客戶|回購|升級/i.test(content)) return 'quote-readiness'
  if (/交付|備份|匯出|交件|專案骨架|delivery/i.test(content)) return 'delivery-flow'
  if (/權限|登入|cookie|Atlas|permission|login|未授權|授權失敗|授權狀態|token/i.test(content)) return 'login-permission'
  if (/CRM|回填|資料|log|來源別|追蹤|素材|缺資料|無資料/i.test(content)) return 'data-backfill'
  if (GROWTH_AGENTS.has(agentId)) return 'general'
  return 'general'
}

function inferCommercialSignal(agentId, parsed, summary) {
  const text = [parsed.watchNow, parsed.learned, parsed.nextTests, summary].flat().join(' ')
  const category = inferCategory(agentId, text)
  let score = 0

  if (GROWTH_AGENTS.has(agentId)) score += 20
  if (/報價|詢價|成交|商機|lead|回購|升級|展店|開發信|名單|窗口|聯名|檔期活動|最值得追|最值得發|最值得寫/i.test(text)) score += 40
  if (/高意圖|內鏈|CTA|報價與選擇|推薦怎麼選|詢問表單|cluster/i.test(text)) score += 28
  if (/交付|匯出|交件|備份/i.test(text) && agentId === 'production') score += 18
  if (/風險|失敗|timeout|timed out|警告|權限|登入|缺/i.test(text)) score -= 18

  score = Math.max(0, Math.min(100, score))
  return {
    category,
    score,
    label: GROWTH_CATEGORY_LABELS[category] || GROWTH_CATEGORY_LABELS.general,
    summary: trimText(parsed.watchNow[0] || parsed.learned[0] || parsed.progress[0] || '', 140),
  }
}

function inferEstimatedValue(summary) {
  const match = String(summary || '').match(/NT\$\s?([\d,]+)/i)
  if (!match) return null
  const value = Number(match[1].replace(/,/g, ''))
  return Number.isFinite(value) ? value : null
}

function getWorkspacePaths(agent) {
  const workspace = agent?.workspace
  if (!workspace) return null
  return {
    root: workspace,
    learningsDir: join(workspace, '.learnings'),
    eventsPath: join(workspace, '.learnings', 'events.jsonl'),
    learningsPath: join(workspace, '.learnings', 'LEARNINGS.md'),
    heartbeatPath: join(workspace, 'HEARTBEAT.md'),
    heartbeatStatePath: join(workspace, 'memory', 'heartbeat-state.json'),
  }
}

function getJobEvolutionBaseline(job, fallback = 0) {
  return Number(job?.evolutionBaselineAtMs || job?.createdAtMs || fallback || 0)
}

function readExistingEventIds(path) {
  if (!existsSync(path)) return new Set()
  const ids = new Set()
  for (const entry of readJsonl(path)) {
    if (entry?.id) ids.add(entry.id)
  }
  return ids
}

function appendEvent(path, event) {
  ensureDir(join(path, '..'))
  appendFileSync(path, `${JSON.stringify(event)}\n`)
}

function rewriteEvents(path, events) {
  ensureDir(join(path, '..'))
  const body = events.map((event) => JSON.stringify(event)).join('\n')
  writeFileSync(path, body ? `${body}\n` : '')
}

function readEventsForAgent(agent) {
  const paths = getWorkspacePaths(agent)
  if (!paths || !existsSync(paths.eventsPath)) return []
  return readJsonl(paths.eventsPath).sort((a, b) => Number(b.runAt || 0) - Number(a.runAt || 0))
}

function pruneAgentEvents(agent, jobs, now, lookbackMs) {
  const paths = getWorkspacePaths(agent)
  if (!paths || !existsSync(paths.eventsPath)) return []
  const baselineByJob = Object.fromEntries(
    jobs.map((job) => [job.id, Math.max(getJobEvolutionBaseline(job), now - lookbackMs)]),
  )
  const events = readJsonl(paths.eventsPath)
  const filtered = events.filter((event) => {
    const baseline = baselineByJob[event.sourceJobId]
    if (!baseline) return true
    return Number(event.runAt || 0) >= baseline
  })
  if (filtered.length !== events.length) {
    rewriteEvents(paths.eventsPath, filtered)
  }
  return filtered
}

function refreshLearningsView(agent, events) {
  const paths = getWorkspacePaths(agent)
  if (!paths) return
  ensureDir(paths.learningsDir)
  const recent = events.slice(0, 8)
  const learnings = uniqCompact(recent.flatMap((event) => event.learned || []), 8)
  const nextTests = uniqCompact(recent.flatMap((event) => event.nextTests || []), 6)
  const qualityRegressions = recent.filter((event) => event.qualityRegression).length

  const lines = [
    '# LEARNINGS',
    '',
    `來源：${paths.eventsPath}`,
    `更新時間：${new Date().toISOString()}`,
    '',
    '## 最近確認的學習',
  ]

  if (learnings.length === 0) {
    lines.push('- 目前尚無已蒸餾的學習，先看 events.jsonl。')
  } else {
    for (const item of learnings) lines.push(`- ${item}`)
  }

  lines.push('', '## 下一輪要試')
  if (nextTests.length === 0) {
    lines.push('- 目前尚無已整理的下一輪測試。')
  } else {
    for (const item of nextTests) lines.push(`- ${item}`)
  }

  lines.push('', '## 品質觀察')
  lines.push(`- 最近 ${recent.length} 筆事件中有 ${qualityRegressions} 次格式或學習品質回歸。`)

  writeFileSync(paths.learningsPath, `${lines.join('\n')}\n`)
}

function updateHeartbeatState(agent, event) {
  const paths = getWorkspacePaths(agent)
  if (!paths) return null
  ensureDir(join(paths.heartbeatStatePath, '..'))
  const current = safeReadJson(paths.heartbeatStatePath, {
    lastRunAt: null,
    lastCommercialCheckAt: null,
    lastBlockerCheckAt: null,
    lastLearningWriteAt: null,
    lastQuietAt: null,
  })

  current.lastRunAt = event.runAt
  if (Number(event.commercialSignal?.score || 0) > 0) current.lastCommercialCheckAt = event.runAt
  if (event.blockers?.length || event.status !== 'ok') current.lastBlockerCheckAt = event.runAt
  if (event.learned?.length || event.nextTests?.length) current.lastLearningWriteAt = event.runAt
  if (!event.progress?.length && !event.blockers?.length && !event.learned?.length) current.lastQuietAt = event.runAt

  safeWriteJson(paths.heartbeatStatePath, current)
  return current
}

function buildEventFromRun(job, agent, entry, existingEvent = null) {
  const parsed = parseReportSummary(entry.summary || entry.error || '', entry.status)
  const commercialSignal = inferCommercialSignal(agent.id, parsed, entry.summary || '')
  const estimatedValue = inferEstimatedValue(entry.summary || '')
  const evidenceRef = `cron/runs/${job.id}.jsonl#${entry.runAtMs || entry.ts || Date.now()}`

  return {
    id: `${job.id}:${entry.runAtMs || entry.ts}`,
    version: EVENT_VERSION,
    agentId: agent.id,
    agentName: agent.name,
    sourceJobId: job.id,
    sourceJobName: job.name,
    runAt: entry.runAtMs || entry.ts || Date.now(),
    status: entry.status || 'ok',
    format: parsed.format,
    qualityRegression: Boolean(parsed.qualityRegression),
    missingRequired: parsed.missingRequired,
    progress: parsed.progress,
    watchNow: parsed.watchNow,
    blockers: parsed.blockers,
    nextSteps: parsed.nextSteps,
    learned: parsed.learned,
    nextTests: parsed.nextTests,
    commercialSignal,
    estimatedValue,
    needsBrian: parsed.watchNow.length > 0 || parsed.blockers.length > 0,
    evidenceRefs: [evidenceRef],
    summaryExcerpt: trimText(entry.summary || entry.error || '', 520),
    createdAt: existingEvent?.createdAt || Date.now(),
  }
}

function loadSyncState() {
  return safeReadJson(getSyncStatePath(), { lastProcessedRunAtByJob: {} })
}

function saveSyncState(state) {
  safeWriteJson(getSyncStatePath(), state)
}

export function syncEvolutionArtifacts({ lookbackMs = 7 * DAY_MS, now = Date.now() } = {}) {
  const jobs = readCronJobs().filter(isReportJob)
  const agentMap = getAgentsMap()
  const state = loadSyncState()
  const touchedAgents = new Set()
  let processedRuns = 0
  const jobsByAgent = getManagedJobsByAgent()

  for (const job of jobs) {
    const agentId = resolveAgentId(job.agentId)
    const agent = agentMap[agentId]
    const paths = getWorkspacePaths(agent)
    if (!agent || !paths) continue

    ensureDir(paths.learningsDir)
    ensureDir(join(paths.heartbeatStatePath, '..'))
    let existingEvents = pruneAgentEvents(agent, jobsByAgent.get(agentId) || [job], now, lookbackMs)
    const existingById = new Map(existingEvents.map((event) => [event.id, event]))
    const baseline = Math.max(getJobEvolutionBaseline(job), now - lookbackMs)
    const runs = readRunEntries(job.id)
      .filter((entry) => Number(entry.runAtMs || 0) >= baseline)
    let agentDirty = false

    for (const entry of runs) {
      const eventId = `${job.id}:${entry.runAtMs || entry.ts}`
      const existingEvent = existingById.get(eventId) || null
      const event = buildEventFromRun(job, agent, entry, existingEvent)
      if (!existingEvent || JSON.stringify(existingEvent) !== JSON.stringify(event)) {
        existingById.set(eventId, event)
        existingEvents = [...existingById.values()].sort((a, b) => Number(b.runAt || 0) - Number(a.runAt || 0))
        agentDirty = true
        touchedAgents.add(agent.id)
        processedRuns += 1
      }
      updateHeartbeatState(agent, event)
    }

    if (agentDirty) rewriteEvents(paths.eventsPath, existingEvents)
  }

  for (const agent of getAgentsList()) {
    if (!touchedAgents.has(agent.id)) continue
    refreshLearningsView(agent, readEventsForAgent(agent))
  }

  saveSyncState(state)
  return { processedRuns, touchedAgents: [...touchedAgents] }
}

function classifyRecurringSignals(events) {
  const signals = []
  for (const event of events) {
    const sources = [
      ...(event.blockers || []).map((text) => ({ kind: 'blocker', text })),
      ...(event.learned || []).map((text) => ({ kind: 'learned', text })),
      ...(event.watchNow || []).map((text) => ({ kind: 'watch', text })),
    ]
    for (const source of sources) {
      signals.push({
        agentId: event.agentId,
        runAt: event.runAt,
        category: inferCategory(event.agentId, source.text),
        kind: source.kind,
        text: source.text,
        eventId: event.id,
        commercialScore: Number(event.commercialSignal?.score || 0),
      })
    }
  }
  return signals
}

function summarizeRecurringSignals(events) {
  const recurrenceByCategory = new Map()
  const eventIdsByCategory = new Map()
  for (const signal of classifyRecurringSignals(events)) {
    if (signal.kind !== 'blocker') continue
    const category = signal.category
    const eventIds = eventIdsByCategory.get(category) || new Set()
    if (eventIds.has(signal.eventId)) continue
    eventIds.add(signal.eventId)
    eventIdsByCategory.set(category, eventIds)
    recurrenceByCategory.set(category, (recurrenceByCategory.get(category) || 0) + 1)
  }
  return {
    counts: Object.fromEntries([...recurrenceByCategory.entries()].sort((a, b) => b[1] - a[1])),
    strongestCategory: [...recurrenceByCategory.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null,
    strongestCount: [...recurrenceByCategory.entries()].sort((a, b) => b[1] - a[1])[0]?.[1] || 0,
  }
}

function toNumberOrNull(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function findScopeRuleForTarget(target) {
  return TARGET_SCOPE_RULES.find((rule) => {
    try {
      return rule.matches(target)
    } catch {
      return false
    }
  }) || null
}

function estimateCandidateLineDelta(candidate) {
  const reasonLines = String(candidate?.reason || '').split(/\r?\n/).filter((line) => line.trim()).length
  const changeLines = String(candidate?.proposedChange || '').split(/\r?\n/).filter((line) => line.trim()).length
  const evidenceBonus = Math.min(Array.isArray(candidate?.evidenceRefs) ? candidate.evidenceRefs.length : 0, 8)
  return Math.max(1, reasonLines + changeLines + evidenceBonus)
}

function checkTargetSectionGuard(candidate, scopeRule) {
  if (!scopeRule) return false
  const target = String(candidate?.target || '')
  const proposed = String(candidate?.proposedChange || '').toLowerCase()
  const reason = String(candidate?.reason || '').toLowerCase()
  if (scopeRule.id === 'discord-report-contract') {
    return ['contract', '今日推進', '卡點', '今天學到', '下一輪要試', 'no-data']
      .some((token) => proposed.includes(token.toLowerCase()) || reason.includes(token.toLowerCase()))
  }
  if (scopeRule.id === 'knowledge-promoted') {
    return proposed.includes('promoted') || proposed.includes('規則') || reason.includes('promoted')
  }
  if (scopeRule.id === 'system-prompt') {
    return target.endsWith('SYSTEM_PROMPT.md')
  }
  if (scopeRule.id === 'heartbeat') {
    return target.endsWith('HEARTBEAT.md')
  }
  return false
}

function buildCandidateDryRunReport(candidate) {
  const target = String(candidate?.target || '')
  const targetInsideHome = Boolean(target && target.startsWith(getOpenClawHome()))
  const scopeRule = findScopeRuleForTarget(target)
  const scopeWhitelisted = Boolean(targetInsideHome && scopeRule)
  const sectionGuardPassed = checkTargetSectionGuard(candidate, scopeRule)
  const hasEvidence = Array.isArray(candidate?.evidenceRefs) && candidate.evidenceRefs.length > 0
  const hasDelta = Boolean(String(candidate?.reason || '').trim() && String(candidate?.proposedChange || '').trim())
  const recurrence = Number(candidate?.recurrence || 0)
  const hasRecurringGuard = candidate?.candidateKind === 'advisory' ? true : recurrence >= 2
  const lineDeltaEstimate = estimateCandidateLineDelta(candidate)
  const maxLineDelta = Number(scopeRule?.maxLineDelta || DEFAULT_MAX_LINE_DELTA)
  const lineDeltaWithinCap = lineDeltaEstimate <= maxLineDelta
  const targetText = existsSync(target) ? readFileSync(target, 'utf8') : ''
  const hasConflictMarker = /(^|\n)(<{7}|={7}|>{7})(\n|$)/.test(targetText)
  const rollbackCapable = isApplyableCandidateTarget(target)

  const checks = [
    {
      id: 'target-inside-openclaw-home',
      label: 'Target must stay inside OpenClaw workspace',
      passed: targetInsideHome,
      detail: targetInsideHome ? target : `invalid target: ${target || 'empty'}`,
    },
    {
      id: 'scope-whitelist',
      label: 'Target must be inside approved low-risk scope',
      passed: scopeWhitelisted,
      detail: scopeWhitelisted
        ? `${scopeRule?.label || basename(target)}`
        : `scope not approved: ${target || 'empty'}`,
    },
    {
      id: 'section-whitelist',
      label: 'Proposed change must stay inside allowed section',
      passed: sectionGuardPassed,
      detail: sectionGuardPassed ? (scopeRule?.id || 'ok') : 'missing scoped section signal',
    },
    {
      id: 'line-cap',
      label: 'Change size must stay below line delta cap',
      passed: lineDeltaWithinCap,
      detail: `delta=${lineDeltaEstimate} cap=${maxLineDelta}`,
    },
    {
      id: 'conflict-check',
      label: 'Target file must be conflict-free',
      passed: !hasConflictMarker,
      detail: hasConflictMarker ? 'merge conflict marker detected' : 'clean',
    },
    {
      id: 'rollback-check',
      label: 'Candidate must support deterministic rollback',
      passed: rollbackCapable,
      detail: rollbackCapable ? 'managed markdown block rollback ready' : 'manual-only target',
    },
    {
      id: 'evidence-present',
      label: 'Candidate must include evidence references',
      passed: hasEvidence,
      detail: hasEvidence ? `${candidate.evidenceRefs.length} refs` : 'missing evidenceRefs',
    },
    {
      id: 'expected-delta-defined',
      label: 'Candidate must define reason and expected delta',
      passed: hasDelta,
      detail: hasDelta ? 'reason + proposed change ready' : 'reason/proposedChange missing',
    },
    {
      id: 'recurrence-guard',
      label: 'Recurring candidate needs repeat evidence',
      passed: hasRecurringGuard,
      detail: hasRecurringGuard ? `recurrence=${recurrence}` : `recurrence too low: ${recurrence}`,
    },
  ]

  const failedCheckIds = checks.filter((check) => !check.passed).map((check) => check.id)
  return {
    generatedAt: Date.now(),
    target,
    scopeId: scopeRule?.id || null,
    scopeLabel: scopeRule?.label || null,
    maxLineDelta,
    lineDeltaEstimate,
    conflictDetected: hasConflictMarker,
    rollbackCapable,
    checks,
    failedCheckIds,
    allPassed: failedCheckIds.length === 0,
  }
}

function buildCandidatePrereqChecks(candidate, dryRunReport = null) {
  return (dryRunReport || buildCandidateDryRunReport(candidate)).checks
}

function classifyCandidateEvolutionStatus(candidate, prereqChecks, dryRunReport = null) {
  const report = dryRunReport || buildCandidateDryRunReport(candidate)
  const failed = (prereqChecks || report.checks).filter((check) => !check.passed).map((check) => check.id)
  if (
    failed.includes('target-inside-openclaw-home') ||
    failed.includes('scope-whitelist') ||
    failed.includes('section-whitelist') ||
    failed.includes('line-cap') ||
    failed.includes('conflict-check') ||
    failed.includes('rollback-check') ||
    failed.includes('evidence-present') ||
    failed.includes('expected-delta-defined')
  ) {
    return 'blocked_by_missing_guard'
  }

  const confidence = Number(candidate?.confidence || 0)
  const impact = Number(candidate?.estimatedImpact || 0)
  const advisory = candidate?.candidateKind === 'advisory'
  if (advisory || confidence < 0.8 || impact >= 92) {
    return 'needs_canary'
  }

  return 'ready'
}

function buildDryRunSummary(candidate, prereqChecks, evolutionStatus) {
  const report = buildCandidateDryRunReport(candidate)
  const checks = Array.isArray(prereqChecks) && prereqChecks.length > 0 ? prereqChecks : report.checks
  const passed = checks.filter((check) => check.passed).length
  const failed = checks.length - passed
  const statusLabel = evolutionStatus === 'ready'
    ? 'Ready'
    : evolutionStatus === 'needs_canary'
      ? 'Needs Canary'
      : 'Blocked By Missing Guard'
  const failedLabels = checks
    .filter((check) => !check.passed)
    .map((check) => check.id)
    .join(', ')

  return trimText(
    [
      `dry-run: ${statusLabel}`,
      `checks ${passed}/${checks.length} passed`,
      `scope=${report.scopeId || 'n/a'} lineDelta=${report.lineDeltaEstimate}/${report.maxLineDelta}`,
      `impact=${candidate.estimatedImpact} recurrence=${candidate.recurrence} confidence=${Number(candidate.confidence || 0).toFixed(2)}`,
      failed > 0 ? `failed=${failedLabels}` : 'failed=none',
    ].join(' | '),
    520,
  )
}

function enrichCandidateCandidate(candidate) {
  const dryRunReport = buildCandidateDryRunReport(candidate)
  const prereqChecks = buildCandidatePrereqChecks(candidate, dryRunReport)
  const evolutionStatus = classifyCandidateEvolutionStatus(candidate, prereqChecks, dryRunReport)
  const applyPrereqs = prereqChecks.filter((check) => !check.passed).map((check) => check.label)
  const dryRunSummary = buildDryRunSummary(candidate, prereqChecks, evolutionStatus)

  return {
    ...candidate,
    prereqChecks,
    applyPrereqs,
    dryRunReport,
    dryRunSummary,
    evolutionStatus,
  }
}

function buildCandidateRecords(events, now = Date.now()) {
  const agentMap = getAgentsMap()
  const promptSourcePath = getPromptSourcePath()
  const grouped = new Map()
  const groupedEventIds = new Map()
  const qualityByAgent = new Map()

  const recentEvents = events.filter(
    (event) => now - Number(event.runAt || 0) <= 7 * DAY_MS && !META_AGENTS.has(event.agentId),
  )

  for (const event of recentEvents) {
    if (event.qualityRegression) {
      qualityByAgent.set(event.agentId, Number(qualityByAgent.get(event.agentId) || 0) + 1)
    }
  }

  for (const signal of classifyRecurringSignals(recentEvents)) {
    const key = `${signal.agentId}:${signal.category}:${signal.kind}`
    const seenEventIds = groupedEventIds.get(key) || new Set()
    if (seenEventIds.has(signal.eventId)) continue
    seenEventIds.add(signal.eventId)
    groupedEventIds.set(key, seenEventIds)
    const bucket = grouped.get(key) || []
    bucket.push(signal)
    grouped.set(key, bucket)
  }

  const candidates = []
  const bestByAgent = new Map()
  const advisoryByAgent = new Map()

  for (const [agentId, count] of qualityByAgent.entries()) {
    if (count < 2) continue
    const agent = agentMap[agentId]
    if (!agent) continue
    candidates.push(enrichCandidateCandidate({
      id: `candidate-${new Date(now).toISOString().slice(0, 10)}-${agentId}-report-quality`,
      type: 'agent',
      candidateKind: 'recurring',
      agentId,
      agentName: agent.name,
      target: promptSourcePath,
      reason: `${agent.name} 最近 ${count} 次回報格式回歸，已影響 learning 萃取品質。`,
      proposedChange: `請強化 ${agent.id} 的 report prompt 與驗證規則，避免再次缺少「今天學到」或「下一輪要試」。`,
      evidenceRefs: recentEvents.filter((event) => event.agentId === agentId && event.qualityRegression).slice(0, 5).map((event) => event.id),
      confidence: 0.84,
      estimatedImpact: 74,
      recurrence: count,
      category: 'report-quality',
      reviewStatus: 'pending',
      createdAt: now,
      updatedAt: now,
    }))
  }

  for (const [key, bucket] of grouped.entries()) {
    const [agentId, category, kind] = key.split(':')
    const agent = agentMap[agentId]
    if (!agent || bucket.length < 2) continue
    if (category === 'general') continue

    const paths = getWorkspacePaths(agent)
    if (!paths) continue

    let target = paths.heartbeatPath
    let estimatedImpact = 68
    let confidence = 0.72
    let reason = `${agent.name} 最近 ${bucket.length} 次重複出現 ${GROWTH_CATEGORY_LABELS[category] || category}。`
    let proposedChange = `請在 ${agent.id} 的 heartbeat 補上這個 recurring check，避免同類問題等到回報才曝光。`

    if (category === 'high-intent-conversion' || category === 'quote-readiness' || category === 'repurchase-followup') {
      if (!GROWTH_AGENTS.has(agentId)) continue
      target = join(paths.root, 'SYSTEM_PROMPT.md')
      estimatedImpact = 88
      confidence = 0.82
      proposedChange = `請把「${bucket[0].text}」收斂成 ${agent.id} 的固定優先策略，讓它下輪先追這類高商業價值動作。`
    } else if (category === 'login-permission' || category === 'data-backfill' || category === 'delivery-flow' || category === 'safety-risk') {
      target = paths.heartbeatPath
      estimatedImpact = 76
      proposedChange = `請把 recurring blocker「${bucket[0].text}」補進 heartbeat checklist，並在回報前先做前置檢查。`
    }

    const current = bestByAgent.get(agentId)
    const candidate = enrichCandidateCandidate({
      id: `candidate-${new Date(now).toISOString().slice(0, 10)}-${agentId}-${category}`,
      type: 'agent',
      candidateKind: 'recurring',
      agentId,
      agentName: agent.name,
      target,
      reason,
      proposedChange,
      evidenceRefs: bucket.slice(0, 5).map((signal) => signal.eventId),
      confidence,
      estimatedImpact,
      recurrence: bucket.length,
      category,
      reviewStatus: 'pending',
      createdAt: now,
      updatedAt: now,
    })

    if (!current) {
      bestByAgent.set(agentId, candidate)
      continue
    }
    if (
      candidate.estimatedImpact > current.estimatedImpact ||
      (candidate.estimatedImpact === current.estimatedImpact && candidate.recurrence > current.recurrence)
    ) {
      bestByAgent.set(agentId, candidate)
    }
  }

  for (const event of recentEvents) {
    if (!GROWTH_AGENTS.has(event.agentId)) continue
    const score = Number(event.commercialSignal?.score || 0)
    const category = event.commercialSignal?.category || 'general'
    if (score < 75 || category === 'general') continue
    const agent = agentMap[event.agentId]
    if (!agent) continue
    const paths = getWorkspacePaths(agent)
    if (!paths) continue

    const current = advisoryByAgent.get(event.agentId)
    const estimatedImpact = Math.max(85, score + 10)
    const candidate = enrichCandidateCandidate({
      id: `candidate-${new Date(now).toISOString().slice(0, 10)}-${event.agentId}-${category}-advisory`,
      type: 'agent',
      candidateKind: 'advisory',
      agentId: event.agentId,
      agentName: agent.name,
      target: join(paths.root, 'SYSTEM_PROMPT.md'),
      reason: `${agent.name} 今天出現高分 ${GROWTH_CATEGORY_LABELS[category] || category}，建議先做低風險 prompt 收斂。`,
      proposedChange: `請把「${event.commercialSignal?.summary || event.watchNow?.[0] || event.learned?.[0] || event.progress?.[0] || '這個高分訊號'}」收斂成 ${agent.id} 的固定優先策略或檢查點。`,
      evidenceRefs: event.evidenceRefs || [event.id],
      confidence: Math.min(0.95, 0.66 + (score / 200)),
      estimatedImpact,
      recurrence: 1,
      category,
      reviewStatus: 'pending',
      createdAt: now,
      updatedAt: now,
    })

    if (!current || candidate.estimatedImpact > current.estimatedImpact) {
      advisoryByAgent.set(event.agentId, candidate)
    }
  }

  candidates.push(...bestByAgent.values())
  for (const [agentId, advisory] of advisoryByAgent.entries()) {
    const recurring = bestByAgent.get(agentId)
    if (recurring && recurring.estimatedImpact >= advisory.estimatedImpact) continue
    candidates.push(advisory)
  }
  return candidates.sort((a, b) => {
    if ((a.candidateKind === 'recurring' ? 0 : 1) !== (b.candidateKind === 'recurring' ? 0 : 1)) {
      return (a.candidateKind === 'recurring' ? 0 : 1) - (b.candidateKind === 'recurring' ? 0 : 1)
    }
    if (b.estimatedImpact !== a.estimatedImpact) return b.estimatedImpact - a.estimatedImpact
    if (b.recurrence !== a.recurrence) return b.recurrence - a.recurrence
    return b.confidence - a.confidence
  })
}

function candidateCoreKey(candidate) {
  return JSON.stringify({
    id: candidate.id,
    type: candidate.type,
    candidateKind: candidate.candidateKind || 'recurring',
    agentId: candidate.agentId,
    target: candidate.target,
    reason: candidate.reason,
    proposedChange: candidate.proposedChange,
    evidenceRefs: candidate.evidenceRefs,
    confidence: candidate.confidence,
    estimatedImpact: candidate.estimatedImpact,
    recurrence: candidate.recurrence,
    category: candidate.category,
    prereqChecks: candidate.prereqChecks,
    applyPrereqs: candidate.applyPrereqs,
    dryRunReport: candidate.dryRunReport,
    dryRunSummary: candidate.dryRunSummary,
    evolutionStatus: candidate.evolutionStatus,
  })
}

function decorateCandidatePatch(candidate) {
  if (!candidate) return candidate
  const dryRunReport = candidate.dryRunReport || buildCandidateDryRunReport(candidate)
  const prereqChecks = Array.isArray(candidate.prereqChecks) ? candidate.prereqChecks : buildCandidatePrereqChecks(candidate, dryRunReport)
  const evolutionStatus = candidate.evolutionStatus || classifyCandidateEvolutionStatus(candidate, prereqChecks, dryRunReport)
  const applyPrereqs = Array.isArray(candidate.applyPrereqs) ? candidate.applyPrereqs : prereqChecks.filter((check) => !check.passed).map((check) => check.label)
  const dryRunSummary = candidate.dryRunSummary || buildDryRunSummary(candidate, prereqChecks, evolutionStatus)
  const allChecksPassed = Boolean(dryRunReport?.allPassed ?? prereqChecks.every((check) => check.passed))
  const applyStatus = candidate.applyStatus || null
  const reviewStatus = candidate.reviewStatus || 'pending'
  const canaryStatus = candidate.canaryStatus || 'none'
  const confidence = Number(candidate?.confidence || 0)
  const impact = Number(candidate?.estimatedImpact || 0)
  const autoApplyEligible = Boolean(
    reviewStatus === 'approved' &&
    applyStatus !== 'applied' &&
    canaryStatus === 'none' &&
    evolutionStatus !== 'blocked_by_missing_guard' &&
    confidence >= AUTO_APPLY_CONFIDENCE_MIN &&
    impact >= AUTO_APPLY_IMPACT_MIN &&
    allChecksPassed,
  )
  const applyStatusLabel = applyStatus === 'applied'
    ? 'Applied'
    : applyStatus === 'rolled_back'
      ? 'Rolled Back'
      : reviewStatus === 'approved'
        ? 'Approved / Not Applied'
        : reviewStatus === 'rejected'
          ? 'Rejected'
          : 'Pending Review'
  const evolutionStatusLabel = evolutionStatus === 'ready'
    ? 'Ready'
    : evolutionStatus === 'needs_canary'
      ? 'Needs Canary'
      : 'Blocked By Missing Guard'
  const lifecycleUpdatedAt =
    candidate.canaryUpdatedAt ||
    candidate.unappliedAt ||
    candidate.appliedAt ||
    candidate.reviewedAt ||
    candidate.updatedAt ||
    candidate.createdAt ||
    null
  return {
    ...candidate,
    candidateKind: candidate.candidateKind || 'recurring',
    prereqChecks,
    applyPrereqs,
    dryRunReport,
    dryRunSummary,
    evolutionStatus,
    evolutionStatusLabel,
    canaryStatus,
    autoApplyEligible,
    applyStatusLabel,
    lifecycleUpdatedAt,
  }
}

function writeCandidatePatches(candidates) {
  const { pendingDir } = ensureEvolutionCandidateDirs()
  const allowedNames = new Set(candidates.map((candidate) => `${candidate.id}.json`))

  for (const file of readdirSync(pendingDir).filter((entry) => entry.startsWith('candidate-') && entry.endsWith('.json'))) {
    const existing = safeReadJson(join(pendingDir, file), null)
    if (!allowedNames.has(file) && (!existing?.reviewStatus || existing.reviewStatus === 'pending')) {
      unlinkSync(join(pendingDir, file))
    }
  }

  const written = []

  for (const candidate of candidates) {
    const filePath = join(pendingDir, `${candidate.id}.json`)
    const existing = safeReadJson(filePath, null)
    const coreChanged = !existing || candidateCoreKey(existing) !== candidateCoreKey(candidate)
    const next = {
      ...candidate,
      prereqChecks: candidate.prereqChecks,
      applyPrereqs: candidate.applyPrereqs,
      dryRunReport: candidate.dryRunReport,
      dryRunSummary: candidate.dryRunSummary,
      evolutionStatus: candidate.evolutionStatus,
      reviewStatus: existing?.reviewStatus || candidate.reviewStatus,
      reviewNote: existing?.reviewNote || null,
      reviewedAt: existing?.reviewedAt || null,
      reviewedBy: existing?.reviewedBy || null,
      reviewArtifactPath: existing?.reviewArtifactPath || null,
      applyStatus: existing?.applyStatus || null,
      appliedAt: existing?.appliedAt || null,
      appliedBy: existing?.appliedBy || null,
      unappliedAt: existing?.unappliedAt || null,
      unappliedBy: existing?.unappliedBy || null,
      applyMode: existing?.applyMode || null,
      autoAppliedAt: existing?.autoAppliedAt || null,
      canaryStatus: existing?.canaryStatus || 'none',
      canaryStartedAt: existing?.canaryStartedAt || null,
      canaryDeadlineAt: existing?.canaryDeadlineAt || null,
      canaryBaseline: existing?.canaryBaseline || null,
      canaryUpdatedAt: existing?.canaryUpdatedAt || null,
      rollbackReason: existing?.rollbackReason || null,
      didImproveScore: toNumberOrNull(existing?.didImproveScore) ?? null,
      businessDelta: toNumberOrNull(existing?.businessDelta) ?? null,
      processScore: toNumberOrNull(existing?.processScore) ?? null,
      businessScore: toNumberOrNull(existing?.businessScore) ?? null,
      createdAt: existing?.createdAt || candidate.createdAt,
      updatedAt: coreChanged ? Date.now() : (existing?.updatedAt || Date.now()),
    }
    if (coreChanged || !existing) {
      safeWriteJson(filePath, next)
    }
    written.push(decorateCandidatePatch(next))
  }

  return written
}

function getCandidateSortPriority(candidate) {
  const reviewStatus = candidate?.reviewStatus || 'pending'
  const applyStatus = candidate?.applyStatus || null
  if (reviewStatus === 'pending') return 0
  if (reviewStatus === 'approved' && applyStatus !== 'applied') return 1
  if (reviewStatus === 'approved' && applyStatus === 'applied') return 2
  if (reviewStatus === 'rejected') return 3
  return 4
}

function listCandidatePatchFiles() {
  const { pendingDir } = ensureEvolutionCandidateDirs()
  if (!existsSync(pendingDir)) return []
  return readdirSync(pendingDir)
    .filter((file) => file.endsWith('.json') && file.startsWith('candidate-'))
    .map((file) => safeReadJson(join(pendingDir, file), null))
    .filter(Boolean)
    .map((candidate) => decorateCandidatePatch(candidate))
    .sort((a, b) => {
      if (getCandidateSortPriority(a) !== getCandidateSortPriority(b)) {
        return getCandidateSortPriority(a) - getCandidateSortPriority(b)
      }
      if (b.estimatedImpact !== a.estimatedImpact) return b.estimatedImpact - a.estimatedImpact
      if (b.recurrence !== a.recurrence) return b.recurrence - a.recurrence
      if (b.confidence !== a.confidence) return b.confidence - a.confidence
      return Number(b.updatedAt || 0) - Number(a.updatedAt || 0)
    })
}

function renderCandidateReviewArtifact(candidate) {
  const lines = [
    `# ${candidate.agentName || candidate.agentId} / ${candidate.category}`,
    '',
    `- id: ${candidate.id}`,
    `- status: ${candidate.reviewStatus}`,
    `- target: ${candidate.target}`,
    `- impact: ${candidate.estimatedImpact}`,
    `- recurrence: ${candidate.recurrence}`,
    `- evolutionStatus: ${candidate.evolutionStatus || 'ready'}`,
    `- dryRunSummary: ${candidate.dryRunSummary || 'n/a'}`,
    `- autoApplyEligible: ${candidate.autoApplyEligible ? 'true' : 'false'}`,
    `- canaryStatus: ${candidate.canaryStatus || 'none'}`,
    candidate.canaryStartedAt ? `- canaryStartedAt: ${new Date(candidate.canaryStartedAt).toISOString()}` : null,
    candidate.canaryDeadlineAt ? `- canaryDeadlineAt: ${new Date(candidate.canaryDeadlineAt).toISOString()}` : null,
    candidate.rollbackReason ? `- rollbackReason: ${candidate.rollbackReason}` : null,
    candidate.didImproveScore === null || candidate.didImproveScore === undefined ? null : `- didImproveScore: ${candidate.didImproveScore}`,
    candidate.reviewedAt ? `- reviewedAt: ${new Date(candidate.reviewedAt).toISOString()}` : null,
    candidate.reviewedBy ? `- reviewedBy: ${candidate.reviewedBy}` : null,
    candidate.reviewNote ? `- reviewNote: ${candidate.reviewNote}` : null,
    candidate.applyStatus ? `- applyStatus: ${candidate.applyStatus}` : null,
    candidate.appliedAt ? `- appliedAt: ${new Date(candidate.appliedAt).toISOString()}` : null,
    candidate.appliedBy ? `- appliedBy: ${candidate.appliedBy}` : null,
    candidate.unappliedAt ? `- unappliedAt: ${new Date(candidate.unappliedAt).toISOString()}` : null,
    candidate.unappliedBy ? `- unappliedBy: ${candidate.unappliedBy}` : null,
    '',
    '## Reason',
    candidate.reason || 'n/a',
    '',
    '## Proposed Change',
    candidate.proposedChange || 'n/a',
    '',
    '## Evidence',
    ...(candidate.evidenceRefs || []).map((entry) => `- ${entry}`),
    '',
    '## Prereq Checks',
    ...(candidate.prereqChecks || []).map((check) => `- [${check.passed ? 'x' : ' '}] ${check.id}: ${check.detail || check.label}`),
    '',
    '## Manual Apply Checklist',
    `- Open target: ${candidate.target}`,
    '- Compare the proposed change against the current prompt / heartbeat / knowledge file.',
    '- Make a minimal manual patch that preserves existing structure and removes duplicated wording.',
    '- Re-run the relevant fish cron job and then re-run nightly evolution promotion to verify the signal improves.',
    '',
  ].filter(Boolean)

  return `${lines.join('\n')}\n`
}

function writeCandidateReviewArtifact(candidate) {
  if (!candidate?.reviewArtifactPath) return
  ensureEvolutionCandidateDirs()
  writeFileSync(candidate.reviewArtifactPath, renderCandidateReviewArtifact(candidate))
}

function escapeRegExp(input) {
  return String(input || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isApplyableCandidateTarget(target) {
  if (!target || typeof target !== 'string') return false
  if (!target.endsWith('.md')) return false
  if (!target.startsWith(getOpenClawHome())) return false
  return APPLYABLE_MARKDOWN_TARGETS.has(basename(target))
}

function renderAppliedPatchBlock(candidate) {
  const lines = [
    `<!-- OPENCLAW_EVOLUTION_APPLY:START ${candidate.id} -->`,
    `## Approved Evolution Patch: ${candidate.agentName || candidate.agentId} / ${candidate.category}`,
    '',
    `- id: ${candidate.id}`,
    `- appliedAt: ${candidate.appliedAt ? new Date(candidate.appliedAt).toISOString() : new Date().toISOString()}`,
    candidate.appliedBy ? `- appliedBy: ${candidate.appliedBy}` : null,
    candidate.reviewNote ? `- reviewNote: ${candidate.reviewNote}` : null,
    '',
    '### Standing Instruction',
    candidate.proposedChange || 'n/a',
    '',
    '### Why This Was Approved',
    candidate.reason || 'n/a',
    '',
    '### Evidence',
    ...(candidate.evidenceRefs || []).map((entry) => `- ${entry}`),
    `<!-- OPENCLAW_EVOLUTION_APPLY:END ${candidate.id} -->`,
    '',
  ].filter(Boolean)

  return `${lines.join('\n')}\n`
}

function upsertManagedMarkdownBlock(targetPath, candidateId, block) {
  const startMarker = `<!-- OPENCLAW_EVOLUTION_APPLY:START ${candidateId} -->`
  const endMarker = `<!-- OPENCLAW_EVOLUTION_APPLY:END ${candidateId} -->`
  const pattern = new RegExp(`${escapeRegExp(startMarker)}[\\s\\S]*?${escapeRegExp(endMarker)}\\n?`, 'g')
  const current = existsSync(targetPath) ? readFileSync(targetPath, 'utf8') : ''
  const next = current.includes(startMarker)
    ? current.replace(pattern, block)
    : `${current.replace(/\s*$/, '')}\n\n${block}`
  writeFileSync(targetPath, next.replace(/\n{3,}/g, '\n\n'))
}

function removeManagedMarkdownBlock(targetPath, candidateId) {
  if (!existsSync(targetPath)) return
  const startMarker = `<!-- OPENCLAW_EVOLUTION_APPLY:START ${candidateId} -->`
  const endMarker = `<!-- OPENCLAW_EVOLUTION_APPLY:END ${candidateId} -->`
  const pattern = new RegExp(`\\n*${escapeRegExp(startMarker)}[\\s\\S]*?${escapeRegExp(endMarker)}\\n*`, 'g')
  const current = readFileSync(targetPath, 'utf8')
  const next = current.replace(pattern, '\n\n').replace(/\n{3,}/g, '\n\n').trimEnd()
  writeFileSync(targetPath, next ? `${next}\n` : '')
}

function summarizeAgentCanaryPressure(agentId, now = Date.now(), events = null) {
  if (!agentId) {
    return {
      blockerPressure: 0,
      riskPressure: 0,
      qualityRegressionCount: 0,
      recentEventCount: 0,
    }
  }
  const sourceEvents = Array.isArray(events) ? events : loadAllEvolutionEvents()
  const recent = sourceEvents.filter((entry) => (
    entry.agentId === agentId &&
    now - Number(entry.runAt || 0) <= DAY_MS
  ))
  const blockerPressure = recent.reduce((sum, entry) => sum + Number(entry.blockers?.length || 0), 0)
  const qualityRegressionCount = recent.filter((entry) => Boolean(entry.qualityRegression)).length
  return {
    blockerPressure,
    riskPressure: blockerPressure + qualityRegressionCount,
    qualityRegressionCount,
    recentEventCount: recent.length,
  }
}

function applyRollbackToCandidateRecord(candidate, {
  now = Date.now(),
  actor = 'evolution-engine',
  reason = 'rollback',
  clearApplyTimestamp = true,
} = {}) {
  const next = {
    ...candidate,
    applyStatus: 'rolled_back',
    canaryStatus: 'rolled_back',
    canaryUpdatedAt: now,
    rollbackNeeded: true,
    rollbackReason: reason,
    unappliedAt: now,
    unappliedBy: actor,
    updatedAt: now,
  }
  if (clearApplyTimestamp) {
    next.appliedAt = null
    next.appliedBy = null
  }
  if (isApplyableCandidateTarget(candidate?.target)) {
    removeManagedMarkdownBlock(candidate.target, candidate.id)
  }
  return next
}

export function reviewCandidatePatch({
  id,
  reviewStatus,
  reviewNote = null,
  reviewer = 'boss-inbox-ui',
  now = Date.now(),
} = {}) {
  if (!id) throw new Error('Candidate patch id is required')
  if (!['pending', 'approved', 'rejected'].includes(reviewStatus)) {
    throw new Error(`Unsupported review status: ${reviewStatus}`)
  }

  const filePath = join(getEvolutionPendingDir(), `${id}.json`)
  const existing = safeReadJson(filePath, null)
  if (!existing) return null

  let reviewArtifactPath = existing.reviewArtifactPath || null
  const shouldRollbackApply = reviewStatus !== 'approved' && existing.appliedAt && isApplyableCandidateTarget(existing.target)
  if (reviewStatus === 'approved') {
    reviewArtifactPath = join(getEvolutionReviewedDir(), `${id}.md`)
    ensureEvolutionCandidateDirs()
  } else if (reviewArtifactPath && existsSync(reviewArtifactPath)) {
    unlinkSync(reviewArtifactPath)
    reviewArtifactPath = null
  }

  const next = {
    ...existing,
    dryRunReport: existing.dryRunReport || buildCandidateDryRunReport(existing),
    prereqChecks: existing.prereqChecks || buildCandidatePrereqChecks(existing, existing.dryRunReport || null),
    applyPrereqs: existing.applyPrereqs || [],
    dryRunSummary: existing.dryRunSummary || null,
    evolutionStatus: existing.evolutionStatus || 'ready',
    reviewStatus,
    reviewNote: reviewNote || null,
    reviewedAt: reviewStatus === 'pending' ? null : now,
    reviewedBy: reviewStatus === 'pending' ? null : reviewer,
    reviewArtifactPath,
    appliedAt: shouldRollbackApply ? null : (existing.appliedAt || null),
    appliedBy: shouldRollbackApply ? null : (existing.appliedBy || null),
    applyStatus: shouldRollbackApply ? 'rolled_back' : (existing.applyStatus || null),
    canaryStatus: shouldRollbackApply ? 'rolled_back' : (existing.canaryStatus || 'none'),
    canaryUpdatedAt: shouldRollbackApply ? now : (existing.canaryUpdatedAt || null),
    rollbackReason: shouldRollbackApply ? `review-status:${reviewStatus}` : (existing.rollbackReason || null),
    autoApplyEligible: null,
    unappliedAt: shouldRollbackApply ? now : (reviewStatus === 'pending' ? null : (existing.unappliedAt || null)),
    unappliedBy: shouldRollbackApply ? reviewer : (reviewStatus === 'pending' ? null : (existing.unappliedBy || null)),
    updatedAt: now,
  }
  safeWriteJson(filePath, next)
  if (reviewStatus === 'approved' && reviewArtifactPath) {
    writeCandidateReviewArtifact(next)
  }
  if (shouldRollbackApply) {
    removeManagedMarkdownBlock(existing.target, id)
  }
  return decorateCandidatePatch(next)
}

export function applyCandidatePatch({
  id,
  applier = 'boss-inbox-ui',
  mode = 'manual',
  now = Date.now(),
} = {}) {
  if (!id) throw new Error('Candidate patch id is required')

  const filePath = join(getEvolutionPendingDir(), `${id}.json`)
  const existing = safeReadJson(filePath, null)
  if (!existing) return null
  if (existing.reviewStatus !== 'approved') {
    throw new Error('Candidate patch must be approved before apply')
  }
  const decorated = decorateCandidatePatch(existing)
  if (!decorated.autoApplyEligible) {
    throw new Error(`Candidate patch is not apply-eligible: ${decorated.evolutionStatusLabel || decorated.evolutionStatus || 'guard failed'}`)
  }
  if (!isApplyableCandidateTarget(existing.target)) {
    throw new Error(`Unsupported apply target: ${existing.target}`)
  }

  const normalizedMode = mode === 'auto' ? 'auto' : 'manual'
  const canaryBaseline = normalizedMode === 'auto'
    ? summarizeAgentCanaryPressure(existing.agentId, now)
    : null

  const next = {
    ...existing,
    appliedAt: now,
    appliedBy: applier,
    applyStatus: 'applied',
    applyMode: normalizedMode,
    autoAppliedAt: normalizedMode === 'auto' ? now : (existing.autoAppliedAt || null),
    canaryStatus: normalizedMode === 'auto' ? 'running' : (existing.canaryStatus || 'none'),
    canaryStartedAt: normalizedMode === 'auto' ? now : (existing.canaryStartedAt || null),
    canaryDeadlineAt: normalizedMode === 'auto' ? (now + ATTENTION_CANARY_WINDOW_MS) : (existing.canaryDeadlineAt || null),
    canaryBaseline: normalizedMode === 'auto' ? canaryBaseline : (existing.canaryBaseline || null),
    canaryUpdatedAt: normalizedMode === 'auto' ? now : (existing.canaryUpdatedAt || null),
    rollbackReason: null,
    rollbackNeeded: false,
    unappliedAt: null,
    unappliedBy: null,
    updatedAt: now,
  }

  upsertManagedMarkdownBlock(existing.target, id, renderAppliedPatchBlock(next))
  safeWriteJson(filePath, next)
  writeCandidateReviewArtifact(next)
  return decorateCandidatePatch(next)
}

export function unapplyCandidatePatch({
  id,
  applier = 'boss-inbox-ui',
  now = Date.now(),
} = {}) {
  if (!id) throw new Error('Candidate patch id is required')

  const filePath = join(getEvolutionPendingDir(), `${id}.json`)
  const existing = safeReadJson(filePath, null)
  if (!existing) return null
  if (existing.reviewStatus !== 'approved') {
    throw new Error('Candidate patch must remain approved to manage apply state')
  }
  if (!existing.appliedAt || existing.applyStatus !== 'applied') {
    throw new Error('Candidate patch is not currently applied')
  }
  if (!isApplyableCandidateTarget(existing.target)) {
    throw new Error(`Unsupported apply target: ${existing.target}`)
  }

  removeManagedMarkdownBlock(existing.target, id)
  const next = {
    ...existing,
    applyStatus: 'rolled_back',
    unappliedAt: now,
    unappliedBy: applier,
    appliedAt: null,
    appliedBy: null,
    updatedAt: now,
  }

  safeWriteJson(filePath, next)
  writeCandidateReviewArtifact(next)
  return decorateCandidatePatch(next)
}

export function getCandidatePatchById(id) {
  if (!id) return null
  const filePath = join(getEvolutionPendingDir(), `${id}.json`)
  return decorateCandidatePatch(safeReadJson(filePath, null))
}

export function recordCandidatePatchOutcome({
  attentionState = null,
  taskId = null,
  requestId = null,
  taskResult = null,
  completionValue = null,
  didImprove = null,
  rollbackNeeded = null,
  reviewer = 'workflow-api',
  now = Date.now(),
} = {}) {
  const latestEventId = attentionState?.latestEventId || null
  const attentionId = attentionState?.id || null
  const pendingDir = getEvolutionPendingDir()
  if (!existsSync(pendingDir)) return []

  const files = readdirSync(pendingDir)
    .filter((file) => file.endsWith('.json') && file.startsWith('candidate-'))

  const updated = []
  for (const file of files) {
    const filePath = join(pendingDir, file)
    const existing = safeReadJson(filePath, null)
    if (!existing) continue

    const evidenceRefs = Array.isArray(existing.evidenceRefs) ? existing.evidenceRefs : []
    const matched = Boolean(
      (latestEventId && evidenceRefs.includes(latestEventId)) ||
      (attentionId && evidenceRefs.includes(attentionId)) ||
      (taskId && evidenceRefs.includes(taskId)) ||
      (requestId && evidenceRefs.includes(requestId)),
    )
    if (!matched) continue

    const feedback = {
      at: now,
      attentionId,
      latestEventId,
      taskId: taskId || null,
      requestId: requestId || null,
      taskResult: taskResult || null,
      completionValue: toNumberOrNull(completionValue),
      didImprove: didImprove === null || didImprove === undefined ? null : Boolean(didImprove),
      rollbackNeeded: rollbackNeeded === null || rollbackNeeded === undefined ? null : Boolean(rollbackNeeded),
      reviewer,
    }

    const feedbackHistory = Array.isArray(existing.feedbackHistory)
      ? [...existing.feedbackHistory.slice(-11), feedback]
      : [feedback]

    const next = {
      ...existing,
      taskResult: taskResult ?? existing.taskResult ?? null,
      completionValue: toNumberOrNull(completionValue) ?? existing.completionValue ?? null,
      didImprove: didImprove === null || didImprove === undefined ? (existing.didImprove ?? null) : Boolean(didImprove),
      rollbackNeeded: rollbackNeeded === null || rollbackNeeded === undefined ? (existing.rollbackNeeded ?? null) : Boolean(rollbackNeeded),
      lastFeedbackAt: now,
      feedbackHistory,
      updatedAt: now,
    }

    if (next.rollbackNeeded && next.applyStatus === 'applied' && isApplyableCandidateTarget(next.target)) {
      removeManagedMarkdownBlock(next.target, next.id)
      next.applyStatus = 'rolled_back'
      next.unappliedAt = now
      next.unappliedBy = reviewer
      next.appliedAt = null
      next.appliedBy = null
    }

    safeWriteJson(filePath, next)
    if (next.reviewArtifactPath) writeCandidateReviewArtifact(next)
    updated.push(decorateCandidatePatch(next))
  }

  return updated
}

export function refreshCandidatePatches({ now = Date.now() } = {}) {
  const events = loadAllEvolutionEvents()
  return writeCandidatePatches(buildCandidateRecords(events, now))
}

function buildPromotedPatterns(events) {
  const recent = events.filter(
    (event) => Number(event.runAt || 0) >= Date.now() - 14 * DAY_MS && !META_AGENTS.has(event.agentId),
  )
  const buckets = new Map()

  for (const event of recent) {
    const category = event.commercialSignal?.category || inferCategory(event.agentId, (event.learned || []).join(' '))
    const bucket = buckets.get(category) || { category, events: [], agents: new Set() }
    bucket.events.push(event)
    bucket.agents.add(event.agentId)
    buckets.set(category, bucket)
  }

  const promoted = []
  for (const bucket of buckets.values()) {
    const recurrence = bucket.events.length
    const uniqueAgents = bucket.agents.size
    const avgScore = Math.round(
      bucket.events.reduce((sum, event) => sum + Number(event.commercialSignal?.score || 0), 0) / Math.max(recurrence, 1),
    )

    const qualifies =
      recurrence >= 3 ||
      uniqueAgents >= 2 ||
      avgScore >= 85

    if (!qualifies) continue

    const rule = (() => {
      switch (bucket.category) {
        case 'high-intent-conversion':
          return '優先追高商業意圖題材，例如報價、怎麼選、checklist 與轉換型 CTA，再去擴散泛流量主題。'
        case 'data-backfill':
          return '資料回填若斷掉，整條漏斗就失真；先補來源別、追蹤與 handoff，再談優化。'
        case 'quote-readiness':
          return '報價與商機相關魚應先收斂到今天最值得推進的單一對象，而不是平鋪清單。'
        case 'repurchase-followup':
          return '回購跟進應以時間敏感與成交可能性排序，優先推單一高價值對象。'
        case 'delivery-flow':
          return 'production 要先攔截專案骨架、匯出與交付分流缺口，不能等日報才揭露。'
        case 'login-permission':
          return '登入與權限缺口應由 heartbeat 預先攔截，不應讓定時回報才第一次暴露 blocker。'
        case 'safety-risk':
          return '安全與權限收斂屬全魚 guardrail，發現高風險 skill 或 allowlist 漏洞時應列第一優先。'
        default:
          return null
      }
    })()

    if (!rule) continue

    promoted.push({
      category: bucket.category,
      label: GROWTH_CATEGORY_LABELS[bucket.category] || bucket.category,
      rule,
      evidenceCount: recurrence,
      agents: [...bucket.agents],
      confidence: Math.min(0.96, 0.65 + (Math.min(recurrence, 4) * 0.08) + (Math.min(uniqueAgents, 3) * 0.05)),
      evidenceRefs: bucket.events.slice(0, 6).map((event) => event.id),
    })
  }

  return promoted.sort((a, b) => b.evidenceCount - a.evidenceCount)
}

function recordMemoryDistillerEvent(result, now = Date.now()) {
  const agent = getAgentsMap()['memory-distiller']
  if (!agent) return null
  const paths = getWorkspacePaths(agent)
  if (!paths) return null

  const topCandidate = result.candidatePatches?.[0] || null
  const event = {
    id: `memory-distiller:promotion:${now}`,
    version: EVENT_VERSION,
    agentId: 'memory-distiller',
    agentName: agent.name,
    sourceJobId: 'nightly-evolution-promoter',
    sourceJobName: 'nightly-evolution-promoter',
    runAt: now,
    status: 'ok',
    format: 'system',
    qualityRegression: false,
    missingRequired: [],
    progress: [
      `同步 ${result.sync?.processedRuns || 0} 筆新事件`,
      `整理 ${result.candidatePatches?.length || 0} 件候選改進`,
      `升格 ${result.promotedPatterns?.length || 0} 條全域規則`,
    ],
    watchNow: topCandidate
      ? [`最值得 Brian 先看的改進是 ${topCandidate.agentName || topCandidate.agentId} / ${topCandidate.category}`]
      : ['今天沒有新的高優先候選改進'],
    blockers: [],
    nextSteps: topCandidate
      ? [`先審核 ${topCandidate.agentName || topCandidate.agentId} 的 ${topCandidate.category} 候選改進`]
      : ['等待下一輪有效 evidence 再產生候選改進'],
    learned: (result.promotedPatterns || []).slice(0, 2).map((pattern) => `${pattern.label}：${pattern.rule}`),
    nextTests: topCandidate
      ? [`觀察 ${topCandidate.agentName || topCandidate.agentId} 的 ${topCandidate.category} 是否持續重複出現`]
      : ['持續等待更多跨魚 evidence 形成 promoted rule'],
    commercialSignal: {
      category: 'general',
      score: topCandidate ? Math.max(40, Number(topCandidate.estimatedImpact || 0) - 10) : 0,
      label: GROWTH_CATEGORY_LABELS.general,
      summary: topCandidate ? topCandidate.reason : '今天沒有新的高優先候選改進',
    },
    estimatedValue: null,
    needsBrian: Boolean(topCandidate),
    evidenceRefs: [
      ...(topCandidate?.evidenceRefs || []),
      getKnowledgeBasePath(),
    ],
    summaryExcerpt: trimText(
      topCandidate
        ? `${topCandidate.reason} / ${topCandidate.proposedChange}`
        : '今天沒有新的高優先候選改進',
      520,
    ),
    createdAt: now,
  }

  const existingIds = readExistingEventIds(paths.eventsPath)
  if (!existingIds.has(event.id)) appendEvent(paths.eventsPath, event)
  updateHeartbeatState(agent, event)
  refreshLearningsView(agent, readEventsForAgent(agent))
  return event
}

function renderKnowledgeBase(promotedPatterns) {
  const lines = [
    '# AI_KNOWLEDGE_BASE',
    '',
    '> 本檔只收已被證據促成的全域規則。',
    '> 來源：workspace-*/.learnings/events.jsonl 與 nightly memory-distiller promoter。',
    `> 更新時間：${new Date().toISOString()}`,
    '',
    '## Promoted Rules',
  ]

  if (promotedPatterns.length === 0) {
    lines.push('- 目前尚無達到 promotion 門檻的全域規則。')
  } else {
    for (const pattern of promotedPatterns) {
      lines.push(`- ${pattern.label}：${pattern.rule}`)
      lines.push(`  - evidence: ${pattern.evidenceCount} / agents: ${pattern.agents.join(', ')} / confidence: ${pattern.confidence.toFixed(2)}`)
    }
  }

  lines.push('', '## Promotion Rules')
  lines.push('- 同一魚連續 3 次驗證有效，才可升格為全域規則。')
  lines.push('- 或至少 2 條魚都出現相近成功模式，才可視為跨魚規則。')
  lines.push('- 沒有證據的通用 AI 趨勢、外部筆記與靈感，不得直接寫入本檔。')

  return `${lines.join('\n')}\n`
}

function writeKnowledgeBase(promotedPatterns) {
  writeFileSync(getKnowledgeBasePath(), renderKnowledgeBase(promotedPatterns))
  return promotedPatterns
}

function loadAllEvolutionEvents() {
  return getAgentsList()
    .flatMap((agent) => readEventsForAgent(agent))
    .sort((a, b) => Number(b.runAt || 0) - Number(a.runAt || 0))
}

export function buildEvolutionSnapshot({ now = Date.now() } = {}) {
  const managedAgentIds = getManagedAgentIds()
  const activeAgentIds = getActiveReportAgentIds()
  const jobsByAgent = getManagedJobsByAgent()
  const agents = getAgentsList().filter((agent) => managedAgentIds.has(agent.id) && getWorkspacePaths(agent))
  const candidatePatches = refreshCandidatePatches({ now })
  const statuses = []
  const growthSignals = []

  for (const agent of agents) {
    const events = readEventsForAgent(agent)
    const heartbeatState = safeReadJson(getWorkspacePaths(agent)?.heartbeatStatePath, null)
    const latestEvent = events[0] || null
    const activityState = activeAgentIds.has(agent.id) ? 'active' : 'inactive'
    const baselineAt = Math.max(
      ...(jobsByAgent.get(agent.id) || []).map((job) => getJobEvolutionBaseline(job)),
      0,
    )
    const lastLearningAt = Number(heartbeatState?.lastLearningWriteAt || latestEvent?.runAt || 0)
    const staleReference = Math.max(lastLearningAt, baselineAt)
    const stale = activityState === 'active' && staleReference > 0 ? (now - staleReference > DAY_MS) : false
    const recurringSignals = summarizeRecurringSignals(events.filter((event) => Number(event.runAt || 0) >= Math.max(baselineAt, now - 7 * DAY_MS)))
    const latestCommercialSignal = latestEvent?.commercialSignal || null
    const latestCommercialSignalCount = latestCommercialSignal?.category
      ? events
        .filter((event) => Number(event.runAt || 0) >= Math.max(baselineAt, now - 7 * DAY_MS))
        .filter((event) => event?.commercialSignal?.category === latestCommercialSignal.category && Number(event?.commercialSignal?.score || 0) >= 50)
        .length
      : 0
    const status = {
      agentId: agent.id,
      agentName: agent.name,
      agentEmoji: agent.emoji,
      activityState,
      category: GROWTH_AGENTS.has(agent.id) ? 'growth' : (GOVERNANCE_AGENTS.has(agent.id) ? 'governance' : 'support'),
      baselineAt: baselineAt || null,
      lastRunAt: Number(heartbeatState?.lastRunAt || latestEvent?.runAt || 0) || null,
      lastLearningAt: lastLearningAt || null,
      lastCommercialCheckAt: Number(heartbeatState?.lastCommercialCheckAt || 0) || null,
      lastBlockerCheckAt: Number(heartbeatState?.lastBlockerCheckAt || 0) || null,
      lastQuietAt: Number(heartbeatState?.lastQuietAt || 0) || null,
      latestEventId: latestEvent?.id || null,
      lastLearned: latestEvent?.learned?.[0] || null,
      nextTest: latestEvent?.nextTests?.[0] || null,
      stale,
      qualityRegressionCount: events.slice(0, 7).filter((event) => event.qualityRegression).length,
      candidateCount: candidatePatches.filter((entry) => entry.agentId === agent.id && entry.reviewStatus === 'pending').length,
      eventCount24h: events.filter((event) => now - Number(event.runAt || 0) <= DAY_MS).length,
      strongestRecurringBlockerCategory: recurringSignals.strongestCategory,
      strongestRecurringBlockerCount: recurringSignals.strongestCount,
      recurringBlockers: recurringSignals.counts,
      latestCommercialSignal,
      latestCommercialSignalCount,
      needsDecision: Boolean(latestEvent?.nextTests?.some((entry) => DECISION_TEST_RE.test(entry))),
    }
    statuses.push(status)

    if (activityState === 'active' && GROWTH_AGENTS.has(agent.id) && latestEvent?.commercialSignal?.score >= 50) {
      growthSignals.push({
        id: `${agent.id}:${latestEvent.id}`,
        agentId: agent.id,
        agentName: agent.name,
        agentEmoji: agent.emoji,
        label: latestEvent.commercialSignal.label,
        summary: latestEvent.commercialSignal.summary || latestEvent.watchNow?.[0] || latestEvent.learned?.[0] || latestEvent.progress?.[0] || null,
        score: latestEvent.commercialSignal.score,
        category: latestEvent.commercialSignal.category,
        runAt: latestEvent.runAt,
        evidenceRefs: latestEvent.evidenceRefs,
      })
    }
  }

  growthSignals.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return Number(b.runAt || 0) - Number(a.runAt || 0)
  })

  statuses.sort((a, b) => {
    if ((a.stale ? 1 : 0) !== (b.stale ? 1 : 0)) return a.stale ? -1 : 1
    if ((b.candidateCount || 0) !== (a.candidateCount || 0)) return (b.candidateCount || 0) - (a.candidateCount || 0)
    return Number(b.lastRunAt || 0) - Number(a.lastRunAt || 0)
  })

  return {
    growthSignals: growthSignals.slice(0, 12),
    agentEvolutionStatus: statuses,
    candidatePatches,
  }
}

export function buildEvolutionAttentionItems({ now = Date.now(), snapshot = null } = {}) {
  const currentSnapshot = snapshot || buildEvolutionSnapshot({ now })
  const agentMap = getAgentsMap()
  const items = []

  for (const status of currentSnapshot.agentEvolutionStatus || []) {
    if (status.activityState !== 'active') continue
    const agent = agentMap[status.agentId] || {}
    const channel = agent.bindings?.find((binding) => String(binding).startsWith('discord')) || null

    if (GROWTH_AGENTS.has(status.agentId) && Number(status.latestCommercialSignal?.score || 0) >= 65) {
      items.push({
        id: `evolution:opportunity:${status.agentId}`,
        requestId: null,
        source: 'evolution',
        eventId: status.latestEventId,
        escalationReason: 'growth-signal',
        signalCount: Math.max(Number(status.latestCommercialSignalCount || 0), 1),
        signalScore: Number(status.latestCommercialSignal?.score || 0),
        categories: [status.latestCommercialSignal?.category || 'general'].filter(Boolean),
        agentId: status.agentId,
        agentName: status.agentName,
        agentEmoji: status.agentEmoji,
        agentColor: agent.color || '#888',
        bindings: agent.bindings || [],
        channel,
        attentionType: 'opportunity',
        priority: 72 + Math.min(Math.round(Number(status.latestCommercialSignal?.score || 0) / 5), 18),
        severity: 72 + Math.min(Math.round(Number(status.latestCommercialSignal?.score || 0) / 5), 18),
        commercialValue: 0,
        needsDecision: false,
        state: 'evolution',
        title: trimText(status.latestCommercialSignal?.summary || status.lastLearned || '新的商業成長訊號', 80),
        detail: trimText(status.nextTest || status.lastLearned || '請直接追這條高意圖商業訊號。', 200),
        createdAt: status.lastRunAt || now,
        updatedAt: status.lastRunAt || now,
        unresolved: true,
      })
    }

    if (ESCALATION_BLOCKER_CATEGORIES.has(status.strongestRecurringBlockerCategory) && Number(status.strongestRecurringBlockerCount || 0) >= 2) {
      items.push({
        id: `evolution:blocked:${status.agentId}`,
        requestId: null,
        source: 'evolution',
        eventId: status.latestEventId,
        escalationReason: 'recurring-blocker',
        signalCount: Number(status.strongestRecurringBlockerCount || 0),
        signalScore: Number(status.strongestRecurringBlockerCount || 0),
        categories: [status.strongestRecurringBlockerCategory].filter(Boolean),
        agentId: status.agentId,
        agentName: status.agentName,
        agentEmoji: status.agentEmoji,
        agentColor: agent.color || '#888',
        bindings: agent.bindings || [],
        channel,
        attentionType: 'blocked',
        priority: 95 + Math.min(Number(status.strongestRecurringBlockerCount || 0), 5),
        severity: 95 + Math.min(Number(status.strongestRecurringBlockerCount || 0), 5),
        commercialValue: 0,
        needsDecision: false,
        state: 'evolution',
        title: trimText(`${status.agentName} 連續卡在 ${GROWTH_CATEGORY_LABELS[status.strongestRecurringBlockerCategory] || status.strongestRecurringBlockerCategory}`, 80),
        detail: trimText(status.lastLearned || status.nextTest || '這條魚的 recurring blocker 已連續出現，應優先解鎖。', 200),
        createdAt: status.lastRunAt || now,
        updatedAt: status.lastRunAt || now,
        unresolved: true,
      })
    }

    if (Number(status.qualityRegressionCount || 0) >= 2) {
      items.push({
        id: `evolution:risk:${status.agentId}`,
        requestId: null,
        source: 'evolution',
        eventId: status.latestEventId,
        escalationReason: 'quality-regression',
        signalCount: Number(status.qualityRegressionCount || 0),
        signalScore: Number(status.qualityRegressionCount || 0),
        categories: ['quality-regression'],
        agentId: status.agentId,
        agentName: status.agentName,
        agentEmoji: status.agentEmoji,
        agentColor: agent.color || '#888',
        bindings: agent.bindings || [],
        channel,
        attentionType: 'risk',
        priority: 85 + Math.min(Number(status.qualityRegressionCount || 0), 5),
        severity: 85 + Math.min(Number(status.qualityRegressionCount || 0), 5),
        commercialValue: 0,
        needsDecision: false,
        state: 'evolution',
        title: trimText(`${status.agentName} 回報品質連續回歸`, 80),
        detail: trimText('這條魚連續缺少結構化學習或下一輪測試，會讓進化判定失真。', 200),
        createdAt: status.lastRunAt || now,
        updatedAt: status.lastRunAt || now,
        unresolved: true,
      })
    }

    if (status.needsDecision && status.nextTest) {
      items.push({
        id: `evolution:decision:${status.agentId}`,
        requestId: null,
        source: 'evolution',
        eventId: status.latestEventId,
        escalationReason: 'decision-next-test',
        signalCount: Math.max(Number(status.latestCommercialSignalCount || 0), 1),
        signalScore: Number(status.latestCommercialSignal?.score || 0),
        categories: [status.latestCommercialSignal?.category || 'decision-next-test'].filter(Boolean),
        agentId: status.agentId,
        agentName: status.agentName,
        agentEmoji: status.agentEmoji,
        agentColor: agent.color || '#888',
        bindings: agent.bindings || [],
        channel,
        attentionType: 'decision',
        priority: 80,
        severity: 80,
        commercialValue: 0,
        needsDecision: true,
        state: 'evolution',
        title: trimText(status.nextTest, 80),
        detail: trimText(status.lastLearned || status.nextTest, 200),
        createdAt: status.lastRunAt || now,
        updatedAt: status.lastRunAt || now,
        unresolved: true,
      })
    }
  }

  const deduped = new Map()
  for (const item of items) {
    const key = `${item.agentId}:${item.attentionType}`
    const current = deduped.get(key)
    if (!current || Number(item.severity || 0) > Number(current.severity || 0)) {
      deduped.set(key, item)
    }
  }

  return [...deduped.values()].sort((a, b) => {
    if ((b.severity || 0) !== (a.severity || 0)) return (b.severity || 0) - (a.severity || 0)
    return (b.updatedAt || 0) - (a.updatedAt || 0)
  })
}

export function buildStaleAttentionItems({ now = Date.now() } = {}) {
  return buildEvolutionSnapshot({ now }).agentEvolutionStatus
    .filter((entry) => entry.stale)
    .map((entry) => ({
      id: `stale-agent:${entry.agentId}`,
      requestId: null,
      source: 'stale-agent',
      latestEventId: entry.latestEventId || null,
      signalCount: 1,
      signalScore: 78,
      categories: ['stale-agent'],
      agentId: entry.agentId,
      agentName: entry.agentName,
      agentEmoji: entry.agentEmoji,
      attentionType: 'risk',
      priority: 78,
      severity: 78,
      commercialValue: 0,
      needsDecision: false,
      state: 'stale',
      title: `${entry.agentName} 超過 24h 沒有新學習`,
      detail: entry.lastLearned
        ? `最近一次學到：${entry.lastLearned}`
        : '這條魚在最近 24 小時內沒有新的 learning event。請先檢查 heartbeat、資料來源或回報品質。',
      createdAt: entry.lastRunAt || now,
      updatedAt: entry.lastLearningAt || entry.lastRunAt || now,
      unresolved: true,
    }))
}

export function runNightlyEvolutionPromotion({ now = Date.now() } = {}) {
  const sync = syncEvolutionArtifacts({ now })
  const events = loadAllEvolutionEvents()
  ensureEvolutionCandidateDirs()
  const candidates = writeCandidatePatches(buildCandidateRecords(events, now))
  const promotedPatterns = writeKnowledgeBase(buildPromotedPatterns(events))
  const memoryEvent = recordMemoryDistillerEvent({
    sync,
    candidatePatches: candidates,
    promotedPatterns,
  }, now)

  return {
    sync,
    candidatePatches: candidates,
    promotedPatterns,
    memoryEvent,
    knowledgeBasePath: getKnowledgeBasePath(),
    pendingDir: getEvolutionPendingDir(),
  }
}
