import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises'

export const OPENCLAW_HOME = process.env.OPENCLAW_HOME || process.env.OPENCLAW_STATE_DIR || join(homedir(), '.openclaw')
export const ARTIFACT_DIR = join(OPENCLAW_HOME, 'artifacts', 'autoresearch-mlx')
export const RUNS_DIR = join(ARTIFACT_DIR, 'runs')
export const STRATEGY_DIR = join(ARTIFACT_DIR, 'strategy')
export const STRATEGY_CONFIG_PATH = join(STRATEGY_DIR, 'strategy-config.json')
export const CONTROL_DIR = join(ARTIFACT_DIR, 'control-room')
export const CONTROL_STATE_PATH = join(CONTROL_DIR, 'runtime.json')
export const MANUAL_CONFIG_PATH = join(CONTROL_DIR, 'manual-config.json')
export const CRON_JOBS_PATH = join(OPENCLAW_HOME, 'cron', 'jobs.json')
export const STATUS_PATH = join(OPENCLAW_HOME, 'agent', 'status.json')
export const CONTROL_RUNNER_SCRIPT = join(OPENCLAW_HOME, 'scripts', 'autoresearch-mlx-control-runner.py')
export const NIGHTLY_JOB_NAME = 'research-fish-autoresearch-nightly'
export const WATCH_JOB_NAME = 'admin-autoresearch-nightly-watch'
export const DEFAULT_OVERNIGHT_SOFT_MINUTES = 480
export const DEFAULT_OVERNIGHT_HARD_MINUTES = 510
export const DEFAULT_OVERNIGHT_MAX_EXPERIMENTS = 24
export const DEFAULT_MANUAL_SOFT_MINUTES = 90
export const DEFAULT_MANUAL_HARD_MINUTES = 120
export const DEFAULT_MANUAL_MAX_EXPERIMENTS = 6
export const DEFAULT_AUTORESEARCH_PRIMARY_MODEL = 'gpt-5.3-codex'
export const DEFAULT_AUTORESEARCH_BREAKTHROUGH_MODEL = 'gpt-5.4'
export const DEFAULT_AUTORESEARCH_RESEARCH_KIND = 'mlx'
const MAX_EXPERIMENT_AUTO_RAISE_WINDOW = 3
const MAX_EXPERIMENT_AUTO_RAISE_MIN_HITS = 2
const MAX_EXPERIMENT_AUTO_RAISE_FLOOR_STEP = 2
const FLEET_READINESS_META_AGENTS = new Set(['main', 'dev-fish', 'research-fish', 'memory-distiller'])
const CODE_WORKSPACE_TARGETS = [
  {
    id: 'openclaw-agents',
    label: 'OpenClaw 魚群 Agents',
    path: OPENCLAW_HOME,
    keywords: ['openclaw 魚群', '魚群', 'agents', 'agent', 'workflow', '工作流', 'handoff'],
  },
  {
    id: 'autopen',
    label: 'AutoPen',
    path: join(OPENCLAW_HOME, 'openclaw-office'),
    keywords: ['autopen', 'bw-space.com', 'seo', '文章', '內容', 'content'],
  },
  {
    id: 'bw-copilot',
    label: 'BW Copilot',
    path: join(OPENCLAW_HOME, 'openclaw-office'),
    keywords: ['bw copilot', 'copilot', '/research', '控制台', 'research page'],
  },
  {
    id: 'contentforge',
    label: 'ContentForge',
    path: join(OPENCLAW_HOME, 'Projects', 'BW_ContentStudio'),
    keywords: ['contentforge', 'content studio', 'contentstudio', 'studio'],
  },
]
const MLX_TOPIC_HINTS = [
  'val_bpb',
  'warmup',
  'warmdown',
  'weight decay',
  'lr',
  'learning rate',
  'attention',
  'mlp',
  'dropout',
  'optimizer',
  'regularization',
  'gqa',
  'kv heads',
  'train.py',
]
export const AUTORESEARCH_MODEL_OPTIONS = [
  {
    id: 'gpt-5.3-codex',
    label: 'GPT-5.3 Codex',
    family: 'coding',
    note: '長時間 coding agent 的預設選項。',
  },
  {
    id: 'gpt-5.4',
    label: 'GPT-5.4',
    family: 'frontier',
    note: '適合卡關後突破或更複雜的推理。',
  },
  {
    id: 'gpt-5-codex',
    label: 'GPT-5 Codex',
    family: 'coding',
    note: 'GPT-5 的 Codex 版本，偏 agentic coding。',
  },
  {
    id: 'gpt-5.2-codex',
    label: 'GPT-5.2 Codex',
    family: 'coding',
    note: '較強的長時 coding 任務模型。',
  },
  {
    id: 'gpt-5.1-codex-max',
    label: 'GPT-5.1 Codex Max',
    family: 'coding',
    note: '偏深度與長時間任務。',
  },
  {
    id: 'gpt-5.1-codex-mini',
    label: 'GPT-5.1 Codex Mini',
    family: 'coding',
    note: '較省額度的 Codex 選項。',
  },
  {
    id: 'gpt-5.1',
    label: 'GPT-5.1',
    family: 'frontier',
    note: '通用型 coding / agentic 模型。',
  },
  {
    id: 'gpt-5',
    label: 'GPT-5',
    family: 'frontier',
    note: '較早一代的通用 reasoning / coding 模型。',
  },
  {
    id: 'gpt-5-mini',
    label: 'GPT-5 mini',
    family: 'frontier',
    note: '較便宜，適合成本敏感的測試。',
  },
]

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf-8'))
  } catch {
    return null
  }
}

async function writeJson(path, payload) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8')
}

function isValidModelId(value) {
  return /^[a-z0-9][a-z0-9._-]*$/i.test(String(value || '').trim())
}

function normalizeModelId(value, fallback = null) {
  const normalized = String(value || '').trim()
  if (!normalized) return fallback
  if (!isValidModelId(normalized)) {
    throw new Error(`模型 ID 格式不正確：${value}`)
  }
  return normalized
}

function normalizeResearchTopic(value) {
  const normalized = String(value || '').trim()
  if (!normalized) return null
  return normalized.slice(0, 240)
}

function normalizeResearchKind(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return DEFAULT_AUTORESEARCH_RESEARCH_KIND
  if (normalized === 'mlx' || normalized === 'program' || normalized === 'improve' || normalized === 'evolve') return normalized
  throw new Error('未知的研究類型')
}

function normalizeTargetLabel(value) {
  const normalized = String(value || '').trim()
  if (!normalized) return null
  return normalized.slice(0, 120)
}

async function normalizeTargetPath(value, { required = false } = {}) {
  const normalized = String(value || '').trim()
  if (!normalized) {
    if (required) {
      throw new Error('請先指定要研究的程式路徑')
    }
    return null
  }

  const resolved = await realpath(normalized).catch(() => null)
  if (!resolved) {
    throw new Error('指定的研究路徑不存在')
  }

  const fileStat = await stat(resolved).catch(() => null)
  if (!fileStat?.isDirectory?.()) {
    throw new Error('研究目標需要是一個資料夾')
  }

  return resolved
}

function normalizeContinuationKey(value) {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized || null
}

function normalizeDeliveryStatus(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return 'unknown'
  if (normalized === 'needs work') return 'needs-work'
  if (normalized === 'failed' || normalized === 'fail') return 'blocked'
  return normalized
}

function toStringSafe(value) {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

function normalizeMemoryKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[.,!?;:()[\]{}"'`~/_\\\-+=*&^%$#@|<>，。！？；：、（）「」『』【】《》]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function matchesContinuationTarget(manifest, targetPath, targetLabel) {
  const manifestPath = normalizeContinuationKey(manifest?.targetPath)
  const manifestLabel = normalizeContinuationKey(manifest?.targetLabel)
  const requestedPath = normalizeContinuationKey(targetPath)
  const requestedLabel = normalizeContinuationKey(targetLabel)

  if (requestedPath && manifestPath && requestedPath === manifestPath) return true
  if (requestedLabel && manifestLabel && requestedLabel === manifestLabel) return true
  return false
}

function summarizeContinuationItems(items, limit = 3) {
  if (!Array.isArray(items)) return null
  const summary = items
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      return String(item.summary || item.path || '').trim() || null
    })
    .filter(Boolean)
    .slice(0, limit)
    .join('；')
  return summary || null
}

function summarizeContinuationSteps(steps, limit = 3) {
  if (!Array.isArray(steps)) return null
  const summary = steps
    .map((step) => String(step || '').trim())
    .filter(Boolean)
    .slice(0, limit)
    .join('；')
  return summary || null
}

function uniqueStrings(items, limit = 5) {
  const seen = new Set()
  const values = []
  for (const item of items || []) {
    const normalized = String(item || '').trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    values.push(normalized)
    if (values.length >= limit) break
  }
  return values
}

function createEmptyCodeDeliveryMemory() {
  return {
    updatedAt: null,
    entryCount: 0,
    passCount: 0,
    needsWorkCount: 0,
    blockedCount: 0,
    passRate: null,
    latestRunTag: null,
    latestVerifiedRunTag: null,
    latestVerifiedHeadline: null,
    latestVerifiedProblem: null,
    verifiedPatterns: [],
    avoidPatterns: [],
    recentNextSteps: [],
  }
}

function createEmptyFleetReadinessCandidates() {
  return {
    updatedAt: null,
    sourcePath: STATUS_PATH,
    entryCount: 0,
    topCandidate: null,
    candidates: [],
  }
}

function targetUsesFleetReadiness(targetPath, targetLabel) {
  const normalizedPath = normalizeContinuationKey(targetPath)
  const normalizedLabel = normalizeContinuationKey(targetLabel)
  const normalizedHome = normalizeContinuationKey(OPENCLAW_HOME)
  if (normalizedPath && normalizedHome && normalizedPath === normalizedHome) return true
  if (!normalizedLabel) return false
  return normalizedLabel.includes('openclaw')
    || normalizedLabel.includes('魚群')
    || normalizedLabel.includes('agent')
}

function stripReadinessPrefix(value) {
  const text = String(value || '').trim()
  if (!text) return null
  const prefixes = [
    '最新有效執行訊號仍受阻：',
    '最新有效執行訊號需持續觀察：',
    '最新有效執行訊號正常：',
    '最新有效執行訊號未知：',
  ]
  for (const prefix of prefixes) {
    if (text.startsWith(prefix)) {
      return text.slice(prefix.length).trim() || text
    }
  }
  return text
}

function fleetCandidateSeverity(agent) {
  const phase = String(agent?.phase || '').trim().toUpperCase()
  const health = String(agent?.health || '').trim().toLowerCase()
  if (phase === 'BLOCKED') return { level: 'blocked', score: 300 }
  if (health === 'red') return { level: 'blocked', score: 250 }
  if (health === 'yellow') return { level: 'monitor', score: 200 }
  return null
}

function humanizeFleetBlockerCode(code) {
  const normalized = toStringSafe(code)
  if (!normalized) return null
  const mapping = {
    invoice_missing_tax_id: '缺客戶統編',
    invoice_handoff_not_ready: 'invoice handoff 尚未 ready',
    invoice_needs_brian_review: '待 Brian review',
    invoice_handoff_blocked: 'invoice handoff blocker 未解',
    invoice_missing_draft: '尚未生成 invoice draft',
    invoice_draft_not_ready: 'invoice draft 尚未 ready',
    invoice_missing_ledger_sync: '尚未同步 ledger',
    invoice_sheet_sync_pending: 'ledger sheet sync 未完成',
    booking_archive_failed: 'booking archive 處理失敗',
    booking_conflict_suggested: 'booking 衝堂待改期',
    booking_upstream_response_missing: 'booking 上游回應遺失',
    booking_calendar_conflict: 'booking 排程衝堂',
    booking_plan_only: 'booking 僅完成 plan-only',
    booking_calendar_action_unknown: 'booking 排程結果待確認',
    booking_pull_failed: 'booking pull 失敗',
    booking_pull_uncertain: 'booking pull 結果待確認',
  }
  return mapping[normalized] || normalized
}

function summarizeFleetReadinessCandidate(candidate) {
  if (!candidate) return null
  const parts = [
    `${candidate.agentId}：${candidate.summary || '需要人工確認'}`,
    candidate.blockerCode ? `結構化卡點：${candidate.blockerLabel || candidate.blockerCode} (${candidate.blockerCode})` : null,
    candidate.nextStep ? `下一步：${candidate.nextStep}` : null,
  ].filter(Boolean)
  return parts.join(' ')
}

export function buildFleetReadinessCandidateSignal(candidate) {
  if (!candidate || typeof candidate !== 'object') {
    return {
      readinessCandidateAgentId: null,
      readinessCandidateSeverity: null,
      readinessCandidateSummary: null,
      readinessCandidateBlockerCode: null,
      readinessCandidateBlockerLabel: null,
      readinessCandidateNextStep: null,
      readinessCandidatePreview: null,
      readinessCandidateSource: null,
    }
  }

  const blockerCode = toStringSafe(candidate.blockerCode)
  const blockerLabel = toStringSafe(candidate.blockerLabel) || humanizeFleetBlockerCode(blockerCode)
  const summary = toStringSafe(candidate.summary)
  const nextStep = toStringSafe(candidate.nextStep)
  const preview = toStringSafe(candidate.preview) || summarizeFleetReadinessCandidate(candidate)
  const source = toStringSafe(candidate.readinessCandidateSource)
    || toStringSafe(candidate.source)
    || 'fleet-readiness-top-candidate'

  return {
    readinessCandidateAgentId: toStringSafe(candidate.agentId),
    readinessCandidateSeverity: toStringSafe(candidate.severity),
    readinessCandidateSummary: summary,
    readinessCandidateBlockerCode: blockerCode,
    readinessCandidateBlockerLabel: blockerLabel,
    readinessCandidateNextStep: nextStep,
    readinessCandidatePreview: preview,
    readinessCandidateSource: source,
  }
}

function normalizeReadinessCandidateSignal(payload = {}) {
  return {
    readinessCandidateAgentId: toStringSafe(payload?.readinessCandidateAgentId),
    readinessCandidateSeverity: toStringSafe(payload?.readinessCandidateSeverity),
    readinessCandidateSummary: toStringSafe(payload?.readinessCandidateSummary),
    readinessCandidateBlockerCode: toStringSafe(payload?.readinessCandidateBlockerCode),
    readinessCandidateBlockerLabel: toStringSafe(payload?.readinessCandidateBlockerLabel),
    readinessCandidateNextStep: toStringSafe(payload?.readinessCandidateNextStep),
    readinessCandidatePreview: toStringSafe(payload?.readinessCandidatePreview),
    readinessCandidateSource: toStringSafe(payload?.readinessCandidateSource),
    readinessCandidateReason: toStringSafe(payload?.readinessCandidateReason),
  }
}

function summarizeVerifiedPattern(group) {
  const lines = [
    `「${group.label}」近 ${group.passCount}/${group.runs} 輪驗證通過。`,
    group.latestHeadline && normalizeMemoryKey(group.latestHeadline) !== normalizeMemoryKey(group.label)
      ? `最近有效做法：${group.latestHeadline}。`
      : null,
    group.latestNextStep ? `下一輪可延續：${group.latestNextStep}。` : null,
  ].filter(Boolean)
  return lines.join(' ')
}

function summarizeAvoidPattern(group) {
  const notPassedCount = group.needsWorkCount + group.blockedCount
  return [
    `「${group.label}」近 ${notPassedCount}/${group.runs} 輪卡住或待補證據。`,
    group.latestHeadline && normalizeMemoryKey(group.latestHeadline) !== normalizeMemoryKey(group.label)
      ? `最近一次嘗試：${group.latestHeadline}。`
      : null,
    '下一輪先別重複投入同一路徑。',
  ].filter(Boolean).join(' ')
}

async function readCodeDeliveryRunEntries({
  targetPath,
  targetLabel,
  excludeRunTag = null,
} = {}) {
  const runEntries = await readdir(RUNS_DIR, { withFileTypes: true }).catch(() => [])
  const candidateNames = runEntries
    .filter((entry) => entry?.isDirectory?.() && (entry.name.includes('-improve-') || entry.name.includes('-evolve-')))
    .map((entry) => entry.name)
    .sort()
    .reverse()

  const items = []

  for (const dirName of candidateNames) {
    const dirPath = join(RUNS_DIR, dirName)
    const [dirStat, manifest, result] = await Promise.all([
      stat(dirPath).catch(() => null),
      readJson(join(dirPath, 'manifest.json')),
      readJson(join(dirPath, 'result.json')),
    ])

    if (!dirStat?.isDirectory?.() || !manifest || !result) continue
    if (excludeRunTag && manifest.runTag === excludeRunTag) continue
    if (!matchesContinuationTarget(manifest, targetPath, targetLabel)) continue

    const researchKind = normalizeResearchKind(
      manifest.researchKind
      || manifest.mode
      || result.mode
      || (dirName.includes('-improve-') ? 'improve' : 'evolve'),
    )
    if (researchKind !== 'improve' && researchKind !== 'evolve') continue

    items.push({
      runTag: String(manifest.runTag || dirName),
      researchKind,
      updatedAt: dirStat.mtime.toISOString(),
      status: normalizeDeliveryStatus(result.overallStatus),
      headline: String(result.headline || '').trim() || null,
      problem: String(result.problem || '').trim() || null,
      nextSteps: Array.isArray(result.nextSteps)
        ? result.nextSteps.map((step) => String(step || '').trim()).filter(Boolean)
        : [],
    })
  }

  return items
}

export async function getAutoResearchCodeDeliveryMemory({
  targetPath,
  targetLabel,
  excludeRunTag = null,
} = {}) {
  const entries = await readCodeDeliveryRunEntries({
    targetPath,
    targetLabel,
    excludeRunTag,
  })

  if (!entries.length) return createEmptyCodeDeliveryMemory()

  const memory = createEmptyCodeDeliveryMemory()
  memory.updatedAt = entries[0].updatedAt
  memory.entryCount = entries.length
  memory.latestRunTag = entries[0].runTag

  const verifiedGroups = new Map()
  const avoidGroups = new Map()

  for (const entry of entries) {
    if (entry.status === 'pass') memory.passCount += 1
    else if (entry.status === 'needs-work') memory.needsWorkCount += 1
    else if (entry.status === 'blocked') memory.blockedCount += 1

    const label = entry.problem || entry.headline || `${entry.researchKind} ${entry.runTag}`
    const key = normalizeMemoryKey(label) || `${entry.researchKind}:${entry.runTag}`

    const targetGroups = entry.status === 'pass'
      ? verifiedGroups
      : ((entry.status === 'needs-work' || entry.status === 'blocked') ? avoidGroups : null)
    if (!targetGroups) continue

    const existing = targetGroups.get(key) || {
      key,
      label,
      runs: 0,
      passCount: 0,
      needsWorkCount: 0,
      blockedCount: 0,
      latestRunTag: null,
      latestUpdatedAt: null,
      latestHeadline: null,
      latestProblem: null,
      latestNextStep: null,
    }

    existing.runs += 1
    if (entry.status === 'pass') existing.passCount += 1
    if (entry.status === 'needs-work') existing.needsWorkCount += 1
    if (entry.status === 'blocked') existing.blockedCount += 1
    if (!existing.latestUpdatedAt || Date.parse(entry.updatedAt) > Date.parse(existing.latestUpdatedAt)) {
      existing.latestRunTag = entry.runTag
      existing.latestUpdatedAt = entry.updatedAt
      existing.latestHeadline = entry.headline
      existing.latestProblem = entry.problem
      existing.latestNextStep = entry.nextSteps[0] || null
      existing.label = entry.problem || entry.headline || existing.label
    }

    targetGroups.set(key, existing)

    if (entry.status === 'pass' && !memory.latestVerifiedRunTag) {
      memory.latestVerifiedRunTag = entry.runTag
      memory.latestVerifiedHeadline = entry.headline
      memory.latestVerifiedProblem = entry.problem
    }
  }

  memory.passRate = memory.entryCount > 0
    ? Number((memory.passCount / memory.entryCount).toFixed(4))
    : null
  memory.verifiedPatterns = [...verifiedGroups.values()]
    .sort((left, right) => {
      if (right.passCount !== left.passCount) return right.passCount - left.passCount
      return Date.parse(right.latestUpdatedAt || 0) - Date.parse(left.latestUpdatedAt || 0)
    })
    .slice(0, 3)
    .map((group) => ({
      label: group.label,
      runCount: group.runs,
      passCount: group.passCount,
      lastRunTag: group.latestRunTag,
      summary: summarizeVerifiedPattern(group),
    }))
  memory.avoidPatterns = [...avoidGroups.values()]
    .sort((left, right) => {
      const rightCount = right.needsWorkCount + right.blockedCount
      const leftCount = left.needsWorkCount + left.blockedCount
      if (rightCount !== leftCount) return rightCount - leftCount
      return Date.parse(right.latestUpdatedAt || 0) - Date.parse(left.latestUpdatedAt || 0)
    })
    .slice(0, 3)
    .map((group) => ({
      label: group.label,
      runCount: group.runs,
      needsWorkCount: group.needsWorkCount,
      blockedCount: group.blockedCount,
      lastRunTag: group.latestRunTag,
      summary: summarizeAvoidPattern(group),
    }))
  memory.recentNextSteps = uniqueStrings(
    entries
      .filter((entry) => entry.status === 'pass')
      .flatMap((entry) => entry.nextSteps),
    5,
  )

  return memory
}

export async function getAutoResearchFleetReadinessCandidates({
  targetPath,
  targetLabel,
  limit = 5,
} = {}) {
  if (!targetUsesFleetReadiness(targetPath, targetLabel)) {
    return createEmptyFleetReadinessCandidates()
  }

  const statusPayload = await readJson(STATUS_PATH)
  const fish = statusPayload?.fish && typeof statusPayload.fish === 'object'
    ? statusPayload.fish
    : {}

  const candidates = Object.entries(fish)
    .map(([agentId, agent]) => {
      if (!agent || typeof agent !== 'object' || FLEET_READINESS_META_AGENTS.has(agentId)) return null
      const severity = fleetCandidateSeverity(agent)
      if (!severity) return null

      const blockers = Array.isArray(agent.blockers)
        ? agent.blockers.map((item) => String(item || '').trim()).filter(Boolean)
        : []
      const blockerCode = toStringSafe(agent.blockerCode)
      const nextStep = toStringSafe(agent.nextStep)
      const lastAction = stripReadinessPrefix(agent.lastAction)
      const summary = blockers[0] || lastAction || nextStep
      if (!summary) return null

      return {
        agentId,
        phase: toStringSafe(agent.phase),
        health: toStringSafe(agent.health),
        lastAction,
        lastActionAt: toIso(agent.lastActionAt),
        blockerCode,
        blockerLabel: humanizeFleetBlockerCode(blockerCode),
        nextStep,
        summary,
        blockersPreview: blockers.slice(0, 3),
        blockersCount: blockers.length,
        severity: severity.level,
        priorityScore: severity.score + (nextStep ? 20 : 0) + (blockerCode ? 5 : 0) + Math.min(blockers.length, 3),
      }
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (right.priorityScore !== left.priorityScore) return right.priorityScore - left.priorityScore
      const rightTime = Date.parse(right.lastActionAt || 0)
      const leftTime = Date.parse(left.lastActionAt || 0)
      if (rightTime !== leftTime) return rightTime - leftTime
      return left.agentId.localeCompare(right.agentId)
    })
    .slice(0, Math.max(1, limit))
    .map((candidate, index) => ({
      ...candidate,
      rank: index + 1,
      preview: summarizeFleetReadinessCandidate(candidate),
    }))

  return {
    updatedAt: toIso(statusPayload?.lastUpdated) || new Date().toISOString(),
    sourcePath: STATUS_PATH,
    entryCount: candidates.length,
    topCandidate: candidates[0] || null,
    candidates,
  }
}

export async function getAutoResearchContinuationSeed({
  researchKind,
  targetPath,
  targetLabel,
  excludeRunTag = null,
} = {}) {
  if (researchKind !== 'evolve') return null

  const runEntries = await readdir(RUNS_DIR, { withFileTypes: true }).catch(() => [])
  const candidateNames = runEntries
    .filter((entry) => entry?.isDirectory?.() && entry.name.includes(`-${researchKind}-`))
    .map((entry) => entry.name)
    .sort()
    .reverse()

  for (const dirName of candidateNames) {
    const dirPath = join(RUNS_DIR, dirName)
    const [manifest, result] = await Promise.all([
      readJson(join(dirPath, 'manifest.json')),
      readJson(join(dirPath, 'result.json')),
    ])

    if (!manifest || !result) continue
    if (excludeRunTag && manifest.runTag === excludeRunTag) continue
    if (!matchesContinuationTarget(manifest, targetPath, targetLabel)) continue
    if (result.overallStatus !== 'pass') continue

    const headline = String(result.headline || '').trim() || null
    const problem = String(result.problem || '').trim() || null
    const changedFilesSummary = summarizeContinuationItems(result.changedFiles)
    const nextStepsSummary = summarizeContinuationSteps(result.nextSteps)

    if (!headline && !problem && !changedFilesSummary && !nextStepsSummary) continue

    return {
      runTag: String(manifest.runTag || dirName),
      targetLabel: String(manifest.targetLabel || targetLabel || '').trim() || null,
      headline,
      problem,
      changedFilesSummary,
      nextStepsSummary,
      overallStatus: String(result.overallStatus || '').trim() || null,
    }
  }

  return null
}

export function buildContinuedResearchTopic(
  researchKind,
  baseTopic,
  continuation = null,
  codeDeliveryMemory = null,
  fleetReadinessCandidates = null,
) {
  const normalizedBaseTopic = String(baseTopic || '').trim()
  const fallbackTopic = researchKind === 'evolve'
    ? '請先找出這個系統最值得做成可持續進化能力的一個 bottleneck，直接改碼、驗證效果，並整理下一輪可延續的進化方向。'
    : ''
  const initialTopic = normalizedBaseTopic || fallbackTopic
  const topVerifiedPattern = codeDeliveryMemory?.verifiedPatterns?.[0] || null
  const topAvoidPattern = codeDeliveryMemory?.avoidPatterns?.[0] || null
  const recentNextStep = codeDeliveryMemory?.recentNextSteps?.[0] || null
  const topFleetCandidate = fleetReadinessCandidates?.topCandidate || null
  const fleetCandidateLines = Array.isArray(fleetReadinessCandidates?.candidates)
    ? fleetReadinessCandidates.candidates
      .slice(0, 2)
      .map((candidate) => `- 候選 ${candidate.rank}：${summarizeFleetReadinessCandidate(candidate)}`)
    : []

  if (researchKind !== 'evolve' || (!continuation && !codeDeliveryMemory?.entryCount && !fleetReadinessCandidates?.entryCount)) {
    return initialTopic || null
  }

  const lines = [
    initialTopic,
    '',
    continuation ? `延續上下文（自動接續 ${continuation.targetLabel || '這個工作區'} 的 ${continuation.runTag}）：` : null,
    continuation?.problem ? `- 上一輪瓶頸：${continuation.problem}` : null,
    continuation?.headline ? `- 上一輪有效做法：${continuation.headline}` : null,
    continuation?.changedFilesSummary ? `- 上一輪保留變更：${continuation.changedFilesSummary}` : null,
    continuation?.nextStepsSummary ? `- 這輪優先延續：${continuation.nextStepsSummary}` : null,
    codeDeliveryMemory?.entryCount ? '' : null,
    codeDeliveryMemory?.entryCount ? `交付記憶（最近 ${codeDeliveryMemory.entryCount} 輪程式改善 / 進化）：` : null,
    topVerifiedPattern?.summary ? `- 最近最穩方向：${topVerifiedPattern.summary}` : null,
    topAvoidPattern?.summary ? `- 近期先避開：${topAvoidPattern.summary}` : null,
    recentNextStep ? `- 最近留下的下一步：${recentNextStep}` : null,
    fleetReadinessCandidates?.entryCount ? '' : null,
    fleetReadinessCandidates?.entryCount ? `目前魚群 readiness 候選（來自共享 status，優先看 blocked / yellow，並參考 blockerCode）：` : null,
    ...fleetCandidateLines,
    topFleetCandidate ? `- 如果上一輪有效方向已不值得延續，優先檢查：${summarizeFleetReadinessCandidate(topFleetCandidate)}` : null,
    '請優先沿著最近驗證通過的方向往前推，並避開最近反覆卡住的路線；只有在證據顯示這條線已不值得延續時，才改選新的進化 bottleneck。若需要改選，請從最新 fleet readiness 候選裡只挑一個最高槓桿 bottleneck。 ',
  ].filter(Boolean)

  return lines.join('\n')
}

function topicLooksLikeMlxResearch(topic) {
  const normalized = String(topic || '').trim().toLowerCase()
  if (!normalized) return false
  return MLX_TOPIC_HINTS.some((hint) => normalized.includes(hint))
}

function inferCodeTargetFromTopic(topic) {
  const normalized = String(topic || '').trim().toLowerCase()
  if (!normalized) return null

  let best = null
  let bestScore = 0

  for (const target of CODE_WORKSPACE_TARGETS) {
    let score = 0
    for (const keyword of target.keywords) {
      if (normalized.includes(keyword)) score += keyword.length > 4 ? 2 : 1
    }
    if (score > bestScore) {
      best = target
      bestScore = score
    }
  }

  return bestScore > 0 ? best : null
}

function buildStrategyConfigSnapshot(payload = {}) {
  return {
    path: STRATEGY_CONFIG_PATH,
    primaryModel: normalizeModelId(payload?.primaryModel, DEFAULT_AUTORESEARCH_PRIMARY_MODEL),
    breakthroughModel: normalizeModelId(payload?.breakthroughModel, DEFAULT_AUTORESEARCH_BREAKTHROUGH_MODEL),
    updatedAt: toIso(payload?.updatedAt) || null,
  }
}

function normalizeInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER, label = '數值' } = {}) {
  if (value === undefined || value === null || value === '') return fallback
  const normalized = Number(value)
  if (!Number.isInteger(normalized)) {
    throw new Error(`${label} 需要是整數`)
  }
  if (normalized < min || normalized > max) {
    throw new Error(`${label} 需要介於 ${min} 到 ${max}`)
  }
  return normalized
}

function buildManualConfigSnapshot(payload = {}) {
  const softMinutes = normalizeInteger(payload?.softMinutes, DEFAULT_MANUAL_SOFT_MINUTES, {
    min: 15,
    max: 720,
    label: '手動建議停止時限',
  })
  const hardMinutes = normalizeInteger(payload?.hardMinutes, DEFAULT_MANUAL_HARD_MINUTES, {
    min: softMinutes,
    max: 1440,
    label: '手動最晚強制停止時限',
  })
  const maxExperiments = normalizeInteger(payload?.maxExperiments, DEFAULT_MANUAL_MAX_EXPERIMENTS, {
    min: 1,
    max: 48,
    label: '手動實驗上限',
  })

  return {
    path: MANUAL_CONFIG_PATH,
    softMinutes,
    hardMinutes,
    maxExperiments,
    updatedAt: toIso(payload?.updatedAt) || null,
    autoAdjustedAt: toIso(payload?.autoAdjustedAt) || null,
    autoAdjustedFrom: Number.isInteger(Number(payload?.autoAdjustedFrom)) ? Number(payload.autoAdjustedFrom) : null,
    autoAdjustedReason: String(payload?.autoAdjustedReason || '').trim() || null,
    lastAutoAdjustEvidenceRunTag: String(payload?.lastAutoAdjustEvidenceRunTag || '').trim() || null,
    recentFastCapHitRunTags: Array.isArray(payload?.recentFastCapHitRunTags)
      ? payload.recentFastCapHitRunTags.map((value) => String(value || '').trim()).filter(Boolean)
      : [],
  }
}

async function readLoopRunMeta(dirName) {
  const dir = join(RUNS_DIR, dirName)
  const [dirStat, manifest, result, startupContext] = await Promise.all([
    stat(dir).catch(() => null),
    readJson(join(dir, 'manifest.json')),
    readJson(join(dir, 'result.json')),
    readJson(join(dir, 'startup-context.json')),
  ])

  if (!dirStat?.isDirectory?.() || !manifest) return null

  const loop = manifest?.loop || result?.loop || startupContext?.loop || null
  if (!loop) return null

  const maxIterations = Number(loop?.maxIterations || loop?.maxExperiments || 0) || 0
  const completedIterations = Number(loop?.completedIterations || loop?.experimentCount || 0) || 0
  const stopReason = String(loop?.stopReason || '').trim() || null
  const remainingBudgetMinutes = Number(loop?.remainingBudgetMinutes ?? startupContext?.remainingBudgetMinutes ?? 0) || 0
  const timeBudgetMinutes = Number(loop?.timeBudgetMinutes || 0) || 0

  if (maxIterations <= 0 || completedIterations <= 0) return null

  return {
    dir,
    runTag: String(manifest?.runTag || dirName).trim(),
    researchKind: normalizeResearchKind(manifest?.researchKind || result?.mode || manifest?.mode),
    maxIterations,
    completedIterations,
    stopReason,
    remainingBudgetMinutes,
    timeBudgetMinutes,
    updatedAt: dirStat.mtime.toISOString(),
  }
}

function isFastCapHit(meta) {
  if (!meta) return false
  const hitCap = meta.stopReason === 'max-iterations-reached'
    || meta.stopReason === 'max-experiments-reached'
    || (meta.maxIterations > 0 && meta.completedIterations >= meta.maxIterations)
  if (!hitCap) return false

  const thresholdMinutes = meta.timeBudgetMinutes > 0
    ? Math.max(10, Math.floor(meta.timeBudgetMinutes * 0.25))
    : 10
  return meta.remainingBudgetMinutes >= thresholdMinutes
}

async function readRecentLoopRuns(limit = 6) {
  const runEntries = await readdir(RUNS_DIR, { withFileTypes: true }).catch(() => [])
  const candidateNames = runEntries
    .filter((entry) => entry?.isDirectory?.())
    .map((entry) => entry.name)
    .sort()
    .reverse()
    .slice(0, Math.max(limit, MAX_EXPERIMENT_AUTO_RAISE_WINDOW))

  const items = []
  for (const dirName of candidateNames) {
    const meta = await readLoopRunMeta(dirName)
    if (meta) items.push(meta)
  }
  return items
}

async function maybeAutoRaiseMaxExperiments(payload = {}) {
  const current = buildManualConfigSnapshot(payload)
  if (current.maxExperiments >= 48) return current

  const recentWindow = (await readRecentLoopRuns(MAX_EXPERIMENT_AUTO_RAISE_WINDOW)).slice(0, MAX_EXPERIMENT_AUTO_RAISE_WINDOW)
  const qualifyingRuns = recentWindow.filter(isFastCapHit)
  const newestQualifyingRun = qualifyingRuns[0] || null

  if (qualifyingRuns.length < MAX_EXPERIMENT_AUTO_RAISE_MIN_HITS || !newestQualifyingRun) {
    return current
  }

  if (current.lastAutoAdjustEvidenceRunTag && current.lastAutoAdjustEvidenceRunTag === newestQualifyingRun.runTag) {
    return current
  }

  const increment = Math.max(MAX_EXPERIMENT_AUTO_RAISE_FLOOR_STEP, Math.ceil(current.maxExperiments * 0.25))
  const nextMaxExperiments = clamp(current.maxExperiments + increment, 1, 48)
  if (nextMaxExperiments <= current.maxExperiments) return current

  const now = new Date().toISOString()
  const reason = `最近 ${recentWindow.length} 輪裡有 ${qualifyingRuns.length} 輪在還有時間餘裕時就撞到實驗上限（最新：${newestQualifyingRun.runTag}），已自動把上限提高到 ${nextMaxExperiments}。`
  const nextPayload = {
    ...payload,
    version: Number(payload?.version || 1),
    updatedAt: now,
    softMinutes: current.softMinutes,
    hardMinutes: current.hardMinutes,
    maxExperiments: nextMaxExperiments,
    autoAdjustedAt: now,
    autoAdjustedFrom: current.maxExperiments,
    autoAdjustedReason: reason,
    lastAutoAdjustEvidenceRunTag: newestQualifyingRun.runTag,
    recentFastCapHitRunTags: qualifyingRuns.map((item) => item.runTag),
  }

  await writeJson(MANUAL_CONFIG_PATH, nextPayload)
  return buildManualConfigSnapshot(nextPayload)
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function pad2(value) {
  return String(value).padStart(2, '0')
}

function formatTimeValue(hour, minute) {
  return `${pad2(hour)}:${pad2(minute)}`
}

function parseTimeValue(value) {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!match) throw new Error('時間格式需要是 HH:MM')
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error('時間超出可用範圍')
  }
  return { hour, minute }
}

function parseCronExpr(expr) {
  const match = String(expr || '').trim().match(/^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*$/)
  if (!match) return null
  return { minute: Number(match[1]), hour: Number(match[2]) }
}

function buildDailyCronExpr({ hour, minute }) {
  return `${minute} ${hour} * * *`
}

function computeNextRunAtMs({ hour, minute }, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const mapping = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]))
  const currentDate = `${mapping.year}-${mapping.month}-${mapping.day}`
  let next = new Date(`${currentDate}T${pad2(hour)}:${pad2(minute)}:00+08:00`)
  if (next.getTime() <= now.getTime()) {
    next = new Date(next.getTime() + 24 * 60 * 60 * 1000)
  }
  return next.getTime()
}

function toIso(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function createRunTag() {
  const date = new Date()
  const taipei = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const mapping = Object.fromEntries(taipei.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]))
  return `manual-${mapping.year}${mapping.month}${mapping.day}-${mapping.hour}${mapping.minute}`
}

function buildRuntimeSnapshot(payload) {
  const childPid = Number(payload?.childPid || 0) || null
  const runnerPid = Number(payload?.runnerPid || 0) || null
  const isActive = ['queued', 'running', 'stopping'].includes(String(payload?.status || '')) && processAlive(childPid)
  const startedAt = payload?.startedAt || null
  const finishedAt = payload?.finishedAt || null
  const hardMinutes = Number(payload?.hardMinutes || DEFAULT_OVERNIGHT_HARD_MINUTES)
  const softMinutes = Number(payload?.softMinutes || DEFAULT_OVERNIGHT_SOFT_MINUTES)
  const elapsedMs = startedAt ? Math.max(0, Date.now() - Date.parse(startedAt)) : 0
  const totalMs = hardMinutes > 0 ? hardMinutes * 60 * 1000 : 0
  const softTotalMs = softMinutes > 0 ? softMinutes * 60 * 1000 : 0
  const remainingMs = isActive && totalMs > 0 ? Math.max(totalMs - elapsedMs, 0) : 0
  const remainingToSoftMs = isActive && softTotalMs > 0 ? Math.max(softTotalMs - elapsedMs, 0) : 0

  return {
    exists: Boolean(payload && Object.keys(payload).length),
    status: payload?.status || 'idle',
    note: payload?.note || null,
    isActive,
    runTag: payload?.runTag || null,
    mode: payload?.mode || 'overnight',
    source: payload?.source || null,
    startedAt,
    finishedAt,
    updatedAt: payload?.updatedAt || null,
    requestedStopAt: payload?.requestedStopAt || null,
    exitCode: Number.isFinite(Number(payload?.exitCode)) ? Number(payload.exitCode) : null,
    softMinutes,
    hardMinutes,
    maxExperiments: Number(payload?.maxExperiments || DEFAULT_OVERNIGHT_MAX_EXPERIMENTS),
    runnerPid,
    childPid,
    childProcessGroupId: Number(payload?.childProcessGroupId || 0) || null,
    command: payload?.command || null,
    outputLogPath: payload?.outputLogPath || null,
    researchKind: normalizeResearchKind(payload?.researchKind),
    requestedResearchTopic: normalizeResearchTopic(payload?.requestedResearchTopic),
    researchTopic: normalizeResearchTopic(payload?.researchTopic),
    targetPath: payload?.targetPath || null,
    targetLabel: normalizeTargetLabel(payload?.targetLabel),
    continuationSourceRunTag: payload?.continuationSourceRunTag ? String(payload.continuationSourceRunTag).trim() || null : null,
    continuationPreview: payload?.continuationPreview ? String(payload.continuationPreview).trim() || null : null,
    continuationReason: payload?.continuationReason ? String(payload.continuationReason).trim() || null : null,
    codeMemoryEntryCount: Number(payload?.codeMemoryEntryCount || 0) || 0,
    codeMemoryPreview: payload?.codeMemoryPreview ? String(payload.codeMemoryPreview).trim() || null : null,
    codeMemoryReason: payload?.codeMemoryReason ? String(payload.codeMemoryReason).trim() || null : null,
    ...normalizeReadinessCandidateSignal(payload),
    elapsedMs,
    remainingMs,
    remainingToSoftMs,
    softProgressPct: softTotalMs > 0 ? clamp(Math.round((elapsedMs / softTotalMs) * 100), 0, 100) : 0,
    progressPct: totalMs > 0 ? clamp(Math.round((elapsedMs / totalMs) * 100), 0, 100) : 0,
    recommendedStopAt: isActive && softTotalMs > 0 && startedAt ? new Date(Date.parse(startedAt) + softTotalMs).toISOString() : null,
    estimatedFinishAt: isActive && totalMs > 0 && startedAt ? new Date(Date.parse(startedAt) + totalMs).toISOString() : null,
  }
}

export async function getAutoResearchControlSnapshot() {
  const payload = await readJson(CONTROL_STATE_PATH)
  return buildRuntimeSnapshot(payload || {})
}

export async function getAutoResearchScheduleSnapshot() {
  const payload = await readJson(CRON_JOBS_PATH)
  const jobs = Array.isArray(payload?.jobs) ? payload.jobs : []
  const nightly = jobs.find((job) => job?.name === NIGHTLY_JOB_NAME) || null
  const watch = jobs.find((job) => job?.name === WATCH_JOB_NAME) || null

  const mapJob = (job, fallbackName) => {
    const schedule = parseCronExpr(job?.schedule?.expr)
    return {
      id: job?.id || null,
      name: job?.name || fallbackName,
      enabled: Boolean(job?.enabled),
      timeValue: schedule ? formatTimeValue(schedule.hour, schedule.minute) : null,
      scheduleExpr: job?.schedule?.expr || null,
      timezone: job?.schedule?.tz || 'Asia/Taipei',
      nextRunAt: toIso(job?.state?.nextRunAtMs),
      lastRunAt: toIso(job?.state?.lastRunAtMs),
      lastStatus: job?.state?.lastStatus || job?.state?.lastRunStatus || null,
    }
  }

  return {
    nightly: mapJob(nightly, NIGHTLY_JOB_NAME),
    watch: mapJob(watch, WATCH_JOB_NAME),
  }
}

export async function getAutoResearchStrategyConfigSnapshot() {
  const payload = await readJson(STRATEGY_CONFIG_PATH)
  return buildStrategyConfigSnapshot(payload || {})
}

export async function getAutoResearchManualConfigSnapshot() {
  const payload = await readJson(MANUAL_CONFIG_PATH)
  return maybeAutoRaiseMaxExperiments(payload || {})
}

export function listAutoResearchModelOptions(extraModelIds = []) {
  const options = AUTORESEARCH_MODEL_OPTIONS.map((option) => ({ ...option }))
  const seen = new Set(options.map((option) => option.id))

  for (const modelId of extraModelIds) {
    const normalized = String(modelId || '').trim()
    if (!normalized || seen.has(normalized) || !isValidModelId(normalized)) continue
    seen.add(normalized)
    options.push({
      id: normalized,
      label: normalized,
      family: 'custom',
      note: '目前環境裡已經出現過的自訂模型 ID。',
    })
  }

  return options
}

export async function updateAutoResearchStrategyConfig({ primaryModel, breakthroughModel }) {
  const current = await getAutoResearchStrategyConfigSnapshot()
  const nextPrimary = primaryModel !== undefined
    ? normalizeModelId(primaryModel, DEFAULT_AUTORESEARCH_PRIMARY_MODEL)
    : current.primaryModel
  const nextBreakthrough = breakthroughModel !== undefined
    ? normalizeModelId(breakthroughModel, DEFAULT_AUTORESEARCH_BREAKTHROUGH_MODEL)
    : current.breakthroughModel

  await writeJson(STRATEGY_CONFIG_PATH, {
    version: 1,
    updatedAt: new Date().toISOString(),
    primaryModel: nextPrimary,
    breakthroughModel: nextBreakthrough,
  })

  return getAutoResearchStrategyConfigSnapshot()
}

export async function updateAutoResearchManualConfig({ softMinutes, hardMinutes, maxExperiments }) {
  const current = await getAutoResearchManualConfigSnapshot()
  const nextSoftMinutes = normalizeInteger(softMinutes, current.softMinutes, {
    min: 15,
    max: 720,
    label: '手動建議停止時限',
  })
  const nextHardMinutes = normalizeInteger(hardMinutes, current.hardMinutes, {
    min: nextSoftMinutes,
    max: 1440,
    label: '手動最晚強制停止時限',
  })
  const nextMaxExperiments = normalizeInteger(maxExperiments, current.maxExperiments, {
    min: 1,
    max: 48,
    label: '手動實驗上限',
  })

  await writeJson(MANUAL_CONFIG_PATH, {
    version: 1,
    updatedAt: new Date().toISOString(),
    softMinutes: nextSoftMinutes,
    hardMinutes: nextHardMinutes,
    maxExperiments: nextMaxExperiments,
    autoAdjustedAt: current.autoAdjustedAt,
    autoAdjustedFrom: current.autoAdjustedFrom,
    autoAdjustedReason: current.autoAdjustedReason,
    lastAutoAdjustEvidenceRunTag: current.lastAutoAdjustEvidenceRunTag,
    recentFastCapHitRunTags: current.recentFastCapHitRunTags,
  })

  return getAutoResearchManualConfigSnapshot()
}

export async function startAutoResearchRun(options = {}) {
  const current = await getAutoResearchControlSnapshot()
  if (current.isActive) {
    throw new Error('目前已經有一輪 AutoResearch 在跑，先停止或等它完成。')
  }

  const manualConfig = await getAutoResearchManualConfigSnapshot()
  const runTag = options.runTag || createRunTag()
  const softMinutes = normalizeInteger(options.softMinutes, manualConfig.softMinutes, {
    min: 15,
    max: 720,
    label: '手動建議停止時限',
  })
  const hardMinutes = normalizeInteger(options.hardMinutes, manualConfig.hardMinutes, {
    min: softMinutes,
    max: 1440,
    label: '手動最晚強制停止時限',
  })
  const maxExperiments = normalizeInteger(options.maxExperiments, manualConfig.maxExperiments, {
    min: 1,
    max: 48,
    label: '手動實驗上限',
  })
  const requestedResearchKind = normalizeResearchKind(options.researchKind)
  const requestedResearchTopic = normalizeResearchTopic(options.researchTopic)
  let researchTopic = requestedResearchTopic
  let researchKind = requestedResearchKind
  let autoRoutedFrom = null
  let autoRoutedReason = null
  let continuation = null
  let codeDeliveryMemory = null
  let fleetReadinessCandidates = null

  if (researchKind === 'mlx' && requestedResearchTopic && !topicLooksLikeMlxResearch(requestedResearchTopic)) {
    const inferredTarget = inferCodeTargetFromTopic(requestedResearchTopic)
    if (inferredTarget) {
      researchKind = 'evolve'
      autoRoutedFrom = 'mlx'
      autoRoutedReason = `偵測到這個主題更像「${inferredTarget.label}」的程式進化，所以已自動切換模式。`
      options = {
        ...options,
        targetPath: options.targetPath || inferredTarget.path,
        targetLabel: options.targetLabel || inferredTarget.label,
      }
    }
  }

  const mode = researchKind === 'mlx' ? (options.mode || 'overnight') : researchKind
  const source = options.source || 'ui'
  const targetPath = researchKind === 'mlx'
    ? null
    : await normalizeTargetPath(options.targetPath, { required: true })
  const targetLabel = researchKind === 'mlx'
    ? null
    : (normalizeTargetLabel(options.targetLabel) || targetPath)

  if (requestedResearchKind === 'mlx' && requestedResearchTopic && researchKind === 'mlx' && !topicLooksLikeMlxResearch(requestedResearchTopic)) {
    throw new Error('這個主題比較像程式研究、程式改善或程式進化，不適合用模型優化模式。請改用對應模式，或直接點選 AutoPen / ContentForge / OpenClaw 魚群 Agents。')
  }

  if (researchKind === 'evolve' && targetPath) {
    [continuation, codeDeliveryMemory, fleetReadinessCandidates] = await Promise.all([
      getAutoResearchContinuationSeed({
        researchKind,
        targetPath,
        targetLabel,
        excludeRunTag: runTag,
      }),
      getAutoResearchCodeDeliveryMemory({
        targetPath,
        targetLabel,
        excludeRunTag: runTag,
      }),
      getAutoResearchFleetReadinessCandidates({
        targetPath,
        targetLabel,
      }),
    ])
    researchTopic = buildContinuedResearchTopic(
      researchKind,
      requestedResearchTopic,
      continuation,
      codeDeliveryMemory,
      fleetReadinessCandidates,
    )
  }

  const readinessCandidateSignal = buildFleetReadinessCandidateSignal(fleetReadinessCandidates?.topCandidate)
  const readinessCandidateReason = fleetReadinessCandidates?.entryCount
    ? '已載入目前魚群 readiness 候選；如果上一輪有效方向已不值得延續，這輪會優先從最新 blocker 中只挑一個最高槓桿 bottleneck。'
    : null

  const child = spawn(
    'python3',
    [
      CONTROL_RUNNER_SCRIPT,
      '--root', OPENCLAW_HOME,
      '--run-tag', runTag,
      '--mode', mode,
      '--source', source,
      '--research-kind', researchKind,
      '--soft-minutes', String(softMinutes),
      '--hard-minutes', String(hardMinutes),
      '--max-experiments', String(maxExperiments),
      ...(requestedResearchTopic ? ['--requested-research-topic', requestedResearchTopic] : []),
      '--state-path', CONTROL_STATE_PATH,
      ...(researchTopic ? ['--research-topic', researchTopic] : []),
      ...(targetPath ? ['--target-path', targetPath] : []),
      ...(targetLabel ? ['--target-label', targetLabel] : []),
      ...(continuation?.runTag ? ['--continuation-source-run-tag', continuation.runTag] : []),
      ...(continuation?.nextStepsSummary || continuation?.headline || continuation?.problem
        ? ['--continuation-preview', continuation?.nextStepsSummary || continuation?.headline || continuation?.problem]
        : []),
      ...(continuation
        ? ['--continuation-reason', `已自動接續 ${continuation.targetLabel || '這個工作區'} 在 ${continuation.runTag} 的已驗證進化結果，這輪會先沿著有效做法與下一步往前推。`]
        : []),
      ...(codeDeliveryMemory?.entryCount ? ['--code-memory-entry-count', String(codeDeliveryMemory.entryCount)] : []),
      ...(codeDeliveryMemory?.verifiedPatterns?.[0]?.summary
        || codeDeliveryMemory?.recentNextSteps?.[0]
        || codeDeliveryMemory?.avoidPatterns?.[0]?.summary
        ? ['--code-memory-preview', codeDeliveryMemory?.verifiedPatterns?.[0]?.summary
          || codeDeliveryMemory?.recentNextSteps?.[0]
          || codeDeliveryMemory?.avoidPatterns?.[0]?.summary]
        : []),
      ...(codeDeliveryMemory?.entryCount
        ? ['--code-memory-reason', `已載入最近 ${codeDeliveryMemory.entryCount} 輪程式改善 / 進化記憶，這輪會優先沿著通過率較高的方向前進，並避開最近反覆卡住的路線。`]
        : []),
      ...(readinessCandidateSignal.readinessCandidateAgentId
        ? ['--readiness-candidate-agent-id', readinessCandidateSignal.readinessCandidateAgentId]
        : []),
      ...(readinessCandidateSignal.readinessCandidateSeverity
        ? ['--readiness-candidate-severity', readinessCandidateSignal.readinessCandidateSeverity]
        : []),
      ...(readinessCandidateSignal.readinessCandidateSummary
        ? ['--readiness-candidate-summary', readinessCandidateSignal.readinessCandidateSummary]
        : []),
      ...(readinessCandidateSignal.readinessCandidateBlockerCode
        ? ['--readiness-candidate-blocker-code', readinessCandidateSignal.readinessCandidateBlockerCode]
        : []),
      ...(readinessCandidateSignal.readinessCandidateBlockerLabel
        ? ['--readiness-candidate-blocker-label', readinessCandidateSignal.readinessCandidateBlockerLabel]
        : []),
      ...(readinessCandidateSignal.readinessCandidateNextStep
        ? ['--readiness-candidate-next-step', readinessCandidateSignal.readinessCandidateNextStep]
        : []),
      ...(readinessCandidateSignal.readinessCandidatePreview
        ? ['--readiness-candidate-preview', readinessCandidateSignal.readinessCandidatePreview]
        : []),
      ...(readinessCandidateSignal.readinessCandidateSource
        ? ['--readiness-candidate-source', readinessCandidateSignal.readinessCandidateSource]
        : []),
      ...(readinessCandidateReason
        ? ['--readiness-candidate-reason', readinessCandidateReason]
        : []),
    ],
    {
      cwd: OPENCLAW_HOME,
      env: process.env,
      detached: true,
      stdio: 'ignore',
    },
  )
  child.unref()

  return {
    ok: true,
    runTag,
    runnerPid: child.pid,
    softMinutes,
    hardMinutes,
    maxExperiments,
    requestedResearchKind,
    researchKind,
    researchTopic,
    requestedResearchTopic,
    targetPath,
    targetLabel,
    autoRoutedFrom,
    autoRoutedReason,
    continuationSourceRunTag: continuation?.runTag || null,
    continuationPreview: continuation?.nextStepsSummary || continuation?.headline || continuation?.problem || null,
    continuationReason: continuation
      ? `已自動接續 ${continuation.targetLabel || '這個工作區'} 在 ${continuation.runTag} 的已驗證進化結果，這輪會先沿著有效做法與下一步往前推。`
      : null,
    codeMemoryPreview: codeDeliveryMemory?.verifiedPatterns?.[0]?.summary
      || codeDeliveryMemory?.recentNextSteps?.[0]
      || codeDeliveryMemory?.avoidPatterns?.[0]?.summary
      || null,
    codeMemoryReason: codeDeliveryMemory?.entryCount
      ? `已載入最近 ${codeDeliveryMemory.entryCount} 輪程式改善 / 進化記憶，這輪會優先沿著通過率較高的方向前進，並避開最近反覆卡住的路線。`
      : null,
    ...readinessCandidateSignal,
    readinessCandidateReason,
  }
}

export async function stopAutoResearchRun({ force = false } = {}) {
  const payload = await readJson(CONTROL_STATE_PATH)
  const runtime = buildRuntimeSnapshot(payload || {})
  if (!runtime.isActive || !runtime.childProcessGroupId) {
    throw new Error('目前沒有可停止的 AutoResearch 執行。')
  }

  const signal = force || runtime.status === 'stopping' ? 'SIGKILL' : 'SIGTERM'
  process.kill(-Math.abs(runtime.childProcessGroupId), signal)

  const nextPayload = {
    ...(payload || {}),
    status: 'stopping',
    requestedStopAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    note: signal === 'SIGKILL' ? '已強制停止 AutoResearch。' : '已送出停止指令，等待 AutoResearch 收尾。',
    stopSignal: signal,
  }
  await writeJson(CONTROL_STATE_PATH, nextPayload)

  return {
    ok: true,
    signal,
    runTag: runtime.runTag,
  }
}

export async function updateAutoResearchSchedules({ nightlyTime, watchTime, nightlyEnabled, watchEnabled }) {
  const payload = await readJson(CRON_JOBS_PATH)
  if (!payload || !Array.isArray(payload.jobs)) {
    throw new Error('讀不到 cron/jobs.json，暫時無法更新排程。')
  }

  const nowMs = Date.now()
  const jobs = payload.jobs.map((job) => ({ ...job }))

  const applyTime = (jobName, timeValue, enabledValue) => {
    const index = jobs.findIndex((job) => job?.name === jobName)
    if (index === -1) throw new Error(`找不到排程：${jobName}`)
    const job = { ...jobs[index] }
    const schedule = { ...(job.schedule || {}) }
    const state = { ...(job.state || {}) }

    if (timeValue) {
      const parsed = parseTimeValue(timeValue)
      schedule.expr = buildDailyCronExpr(parsed)
      schedule.tz = 'Asia/Taipei'
      state.nextRunAtMs = computeNextRunAtMs(parsed)
    }
    if (typeof enabledValue === 'boolean') {
      job.enabled = enabledValue
      if (!enabledValue) {
        state.nextRunAtMs = null
      } else if (timeValue) {
        const parsed = parseTimeValue(timeValue)
        state.nextRunAtMs = computeNextRunAtMs(parsed)
      }
    }

    job.schedule = schedule
    job.state = state
    job.updatedAtMs = nowMs
    jobs[index] = job
  }

  applyTime(NIGHTLY_JOB_NAME, nightlyTime, typeof nightlyEnabled === 'boolean' ? nightlyEnabled : undefined)
  applyTime(WATCH_JOB_NAME, watchTime, typeof watchEnabled === 'boolean' ? watchEnabled : undefined)

  await writeJson(CRON_JOBS_PATH, { ...payload, jobs })
  return getAutoResearchScheduleSnapshot()
}
