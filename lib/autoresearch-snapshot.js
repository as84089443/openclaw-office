import { execFile } from 'node:child_process'
import { open, readFile, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import {
  buildFleetReadinessCandidateSignal,
  DEFAULT_AUTORESEARCH_BREAKTHROUGH_MODEL,
  DEFAULT_AUTORESEARCH_PRIMARY_MODEL,
  getAutoResearchCodeDeliveryMemory,
  getAutoResearchControlSnapshot,
  getAutoResearchFleetReadinessCandidates,
  getAutoResearchManualConfigSnapshot,
  getAutoResearchScheduleSnapshot,
  getAutoResearchStrategyConfigSnapshot,
  listAutoResearchModelOptions,
} from './autoresearch-control.js'

const exec = promisify(execFile)

const OPENCLAW_HOME = process.env.OPENCLAW_HOME || process.env.OPENCLAW_STATE_DIR || join(homedir(), '.openclaw')
const PROJECT_DIR = join(OPENCLAW_HOME, 'Projects', 'autoresearch-mlx')
const ARTIFACT_DIR = join(OPENCLAW_HOME, 'artifacts', 'autoresearch-mlx')
const RUNS_DIR = join(ARTIFACT_DIR, 'runs')
const STRATEGY_DIR = join(ARTIFACT_DIR, 'strategy')
const OVERNIGHT_DIR = join(ARTIFACT_DIR, 'overnight')
const STATUS_PATH = join(OPENCLAW_HOME, 'agent', 'status.json')
const RESULTS_PATH = join(PROJECT_DIR, 'results.tsv')
const SEARCH_SPACE_PATH = join(STRATEGY_DIR, 'search-space.json')
const RESEARCH_MEMORY_PATH = join(STRATEGY_DIR, 'research-memory.json')
const PROXY_HEALTH_URL = 'http://127.0.0.1:3456/health'

const DEFAULT_OWNER_AGENT = 'research-fish'
const DEFAULT_ESCALATE_AFTER = 2
const DEFAULT_RESEARCH_KIND = 'mlx'

function isCodeResearchKind(kind) {
  return kind === 'program' || kind === 'improve' || kind === 'evolve'
}

function isDeliveryCodeResearchKind(kind) {
  return kind === 'improve' || kind === 'evolve'
}

function humanizeCodeResearchKind(kind) {
  if (kind === 'program') return '程式研究'
  if (kind === 'improve') return '程式改善'
  if (kind === 'evolve') return '程式進化'
  return '研究'
}

function hydrateActiveControlReadinessSignal(control, fleetReadinessCandidates) {
  const topCandidate = fleetReadinessCandidates?.topCandidate || null
  if (!control || !topCandidate || !control.isActive) return control
  if (control.readinessCandidateAgentId) {
    return {
      ...control,
      readinessCandidateSource: control.readinessCandidateSource || 'persisted-runtime',
    }
  }

  const signal = buildFleetReadinessCandidateSignal(topCandidate)
  if (!signal.readinessCandidateAgentId) return control

  return {
    ...control,
    ...signal,
    readinessCandidateReason: control.readinessCandidateReason
      || '這輪起跑於 readiness persistence 上線前，已從目前共享 fleet readiness 候選回補當前鎖定的 blocker。',
    readinessCandidateSource: 'live-fallback',
  }
}

function defaultSearchSpaceSnapshot() {
  return {
    version: 1,
    goalMetric: 'val_bpb',
    fixedBudgetMinutes: 5,
    allowedFiles: ['train.py', 'results.tsv'],
    lanes: [
      {
        id: 'optimizer',
        label: '最佳化與學習率',
        goal: '先從 learning rate 比例、weight decay 與 optimizer 係數找低風險改善。',
      },
      {
        id: 'schedule',
        label: '訓練節奏與收尾排程',
        goal: '調 warmup、warmdown、anneal 與訓練節奏，讓固定 5 分鐘預算更有效。',
      },
      {
        id: 'regularization',
        label: '正則化與泛化穩定度',
        goal: '調 dropout、normalization 或其他 regularization，換更穩的 val_bpb。',
      },
      {
        id: 'architecture',
        label: '模型結構與注意力配置',
        goal: '最後才動 architecture，爭取較大幅度改善，但維持可讀性與可回退。',
      },
    ],
    orchestration: {
      planner: 'research-fish-strategy-planner',
      executor: 'research-fish',
      revalidator: 'qa',
      distiller: 'memory-distiller',
    },
  }
}

function mergeSearchSpace(payload = null) {
  const fallback = defaultSearchSpaceSnapshot()
  if (!payload || typeof payload !== 'object') return fallback
  return {
    ...fallback,
    ...payload,
    allowedFiles: Array.isArray(payload.allowedFiles) && payload.allowedFiles.length ? payload.allowedFiles : fallback.allowedFiles,
    lanes: Array.isArray(payload.lanes) && payload.lanes.length ? payload.lanes : fallback.lanes,
    orchestration: {
      ...fallback.orchestration,
      ...(payload.orchestration || {}),
    },
  }
}

function normalizePatternList(list) {
  if (!Array.isArray(list)) return []
  return list
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      laneId: toStringSafe(item.laneId),
      label: toStringSafe(item.label),
      summary: toStringSafe(item.summary),
      confidence: toNumberSafe(item.confidence),
    }))
}

async function pathExists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf-8'))
  } catch {
    return null
  }
}

async function readText(path) {
  try {
    return await readFile(path, 'utf-8')
  } catch {
    return null
  }
}

async function readProxyHealth() {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 1200)
  try {
    const response = await fetch(PROXY_HEALTH_URL, {
      cache: 'no-store',
      signal: controller.signal,
    })
    if (!response.ok) return null
    const payload = await response.json().catch(() => null)
    return {
      ok: true,
      status: toStringSafe(payload?.status) || 'ok',
      defaultModel: toStringSafe(payload?.default_model),
      activeRequests: toNumberSafe(payload?.active_requests),
      maxConcurrent: toNumberSafe(payload?.max_concurrent),
      uptimeSeconds: toNumberSafe(payload?.uptime_seconds),
      openaiConfigured: typeof payload?.openai_configured === 'boolean' ? payload.openai_configured : null,
    }
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

async function tailLines(path, count) {
  try {
    const maxBytes = 256 * 1024
    const fileStat = await stat(path)
    if (fileStat.size <= 0) return []

    let content
    if (fileStat.size > maxBytes) {
      const fileHandle = await open(path, 'r')
      try {
        const buffer = Buffer.alloc(maxBytes)
        await fileHandle.read(buffer, 0, maxBytes, fileStat.size - maxBytes)
        content = buffer.toString('utf-8')
      } finally {
        await fileHandle.close()
      }
      const firstNewline = content.indexOf('\n')
      if (firstNewline !== -1) content = content.slice(firstNewline + 1)
    } else {
      content = await readFile(path, 'utf-8')
    }

    return content
      .split('\n')
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .slice(-count)
  } catch {
    return []
  }
}

function toStringSafe(value) {
  if (typeof value === 'string' && value.trim()) return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

function toNumberSafe(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function parseRunTag(raw) {
  if (!raw) return null
  const match = String(raw).match(/\(([^()]+)\)\s*$/)
  return match?.[1] || null
}

function parseMarkdownFact(content, label) {
  if (!content) return null
  const line = content
    .split('\n')
    .find((entry) => entry.trim().toLowerCase().startsWith(`- ${label.toLowerCase()}:`))
  if (!line) return null

  const boldMatch = line.match(/\*\*([^*]+)\*\*/)
  if (boldMatch?.[1]) return boldMatch[1]

  const codeMatches = Array.from(line.matchAll(/`([^`]+)`/g)).map((match) => match[1])
  if (codeMatches.length === 1) return codeMatches[0]
  if (codeMatches.length > 1) return codeMatches.join(' / ')

  const colonIndex = line.indexOf(':')
  if (colonIndex === -1) return null
  return line.slice(colonIndex + 1).trim() || null
}

function parseBestIdea(content) {
  if (!content) return null
  const lines = content.split('\n')
  const startIndex = lines.findIndex((line) => line.trim().toLowerCase() === '## key experiment idea kept')
  if (startIndex === -1) return null
  const candidate = lines
    .slice(startIndex + 1)
    .map((line) => line.trim())
    .find((line) => /^\d+\.\s/.test(line) || line.startsWith('- '))
  return candidate || null
}

function pickNewest(entries) {
  return [...entries].sort((left, right) => right.mtimeMs - left.mtimeMs)[0] || null
}

function pickMostRecentRun(...runs) {
  return runs
    .filter(Boolean)
    .sort((left, right) => {
      const leftTime = Date.parse(left?.updatedAt || 0)
      const rightTime = Date.parse(right?.updatedAt || 0)
      return rightTime - leftTime
    })[0] || null
}

async function newestPath(dir, predicate = () => true) {
  try {
    const names = await readdir(dir)
    const matches = await Promise.all(
      names
        .filter(predicate)
        .map(async (name) => {
          const path = join(dir, name)
          const fileStat = await stat(path)
          return { path, mtimeMs: fileStat.mtimeMs }
        }),
    )
    return pickNewest(matches)?.path || null
  } catch {
    return null
  }
}

async function newestRunDir(kind, runTag = null) {
  const exactPrefix = runTag ? `${runTag}-${kind}-` : null
  const exact = await newestPath(RUNS_DIR, (name) => name.includes(`-${kind}-`) && (!exactPrefix || name.startsWith(exactPrefix)))
  if (exact) return exact
  return newestPath(RUNS_DIR, (name) => name.includes(`-${kind}-`))
}

async function newestRunDirWithArtifact(kind, artifactName, runTag = null) {
  try {
    const names = await readdir(RUNS_DIR)
    const prefix = runTag ? `${runTag}-${kind}-` : null
    const matches = await Promise.all(
      names
        .filter((name) => name.includes(`-${kind}-`) && (!prefix || name.startsWith(prefix)))
        .map(async (name) => {
          const dir = join(RUNS_DIR, name)
          const dirStat = await stat(dir).catch(() => null)
          if (!dirStat?.isDirectory?.()) return null
          const artifactPath = join(dir, artifactName)
          const artifactStat = await stat(artifactPath).catch(() => null)
          if (!artifactStat?.isFile?.()) return null
          return { path: dir, mtimeMs: artifactStat.mtimeMs }
        }),
    )
    return pickNewest(matches.filter(Boolean))?.path || null
  } catch {
    return null
  }
}

function mergeArtifactView(primary, fallback, options = {}) {
  const pending = Boolean(options.pending)
  if (primary?.path) {
    return {
      ...primary,
      source: 'current',
      sourceLabel: options.currentLabel || '目前這輪',
      statusNote: options.currentNote || null,
    }
  }
  if (fallback?.path) {
    return {
      ...fallback,
      source: 'recent',
      sourceLabel: options.fallbackLabel || '上一輪已完成',
      statusNote: pending
        ? (options.pendingNote || '目前這輪還在跑，這份報告會在收尾後生成；先顯示上一輪已完成的版本。')
        : (options.fallbackNote || null),
    }
  }
  return {
    path: null,
    updatedAt: null,
    content: null,
    source: 'missing',
    sourceLabel: null,
    statusNote: pending
      ? (options.pendingMissingNote || '目前這輪還在進行，這份報告會在收尾後才產生。')
      : (options.missingNote || '尚未產生內容。'),
  }
}

async function readArtifact(path, lineLimit = null) {
  if (!(await pathExists(path))) return null
  const [fileStat, content] = await Promise.all([stat(path), readText(path)])
  const trimmed = lineLimit && content
    ? content.split('\n').slice(0, lineLimit).join('\n')
    : content
  return {
    path,
    updatedAt: fileStat.mtime.toISOString(),
    content: trimmed,
  }
}

function simplifyCodexEvent(rawLine, index) {
  try {
    const parsed = JSON.parse(rawLine)
    const item = parsed.item || {}
    const outputTail = item.aggregated_output
      ? String(item.aggregated_output).split('\n').filter(Boolean).slice(-2).join('\n')
      : null

    return {
      id: item.id || `event-${index}`,
      type: parsed.type || item.type || 'unknown',
      status: item.status || null,
      summary: item.text || item.command || outputTail || 'event',
      outputTail,
    }
  } catch {
    return {
      id: `event-${index}`,
      type: 'raw',
      status: null,
      summary: rawLine,
      outputTail: null,
    }
  }
}

async function readRunArtifact(dir) {
  if (!dir || !(await pathExists(dir))) return null

  const manifestPath = join(dir, 'manifest.json')
  const summaryPath = join(dir, 'summary.md')
  const qaPath = join(dir, 'qa-check.md')
  const revalidationReportPath = join(dir, 'revalidation.md')
  const revalidationJsonPath = join(dir, 'revalidation.json')
  const memoryPath = join(dir, 'memory-distiller-handoff.md')
  const lastMessagePath = join(dir, 'codex-last-message.md')
  const eventsPath = join(dir, 'codex-events.jsonl')
  const resultPath = join(dir, 'result.json')
  const startupContextPath = join(dir, 'startup-context.json')

  const [dirStat, manifest, summary, qa, revalidationReport, revalidation, memoryHandoff, codexLastMessage, eventLines, result, startupContext] = await Promise.all([
    stat(dir),
    readJson(manifestPath),
    readArtifact(summaryPath, 40),
    readArtifact(qaPath, 40),
    readArtifact(revalidationReportPath, 60),
    readJson(revalidationJsonPath),
    readArtifact(memoryPath, 40),
    readArtifact(lastMessagePath, 30),
    tailLines(eventsPath, 10),
    readJson(resultPath),
    readJson(startupContextPath),
  ])

  return {
    path: dir,
    runTag: toStringSafe(manifest?.runTag),
    updatedAt: dirStat.mtime.toISOString(),
    manifest,
    summary,
    qa,
    revalidationReport,
    revalidation,
    memoryHandoff,
    result,
    startupContext,
    codexLastMessage,
    codexEvents: eventLines.map(simplifyCodexEvent),
  }
}

function readAgentSnapshot(statusPayload, id) {
  const fish = statusPayload?.fish || {}
  const agent = fish[id] || {}
  return {
    id,
    phase: toStringSafe(agent.phase),
    currentTask: toStringSafe(agent.currentTask),
    lastAction: toStringSafe(agent.lastAction),
    lastActionAt: toStringSafe(agent.lastActionAt),
    nextStep: toStringSafe(agent.nextStep),
    health: toStringSafe(agent.health),
    blockers: Array.isArray(agent.blockers) ? agent.blockers.filter((value) => typeof value === 'string') : [],
  }
}

async function tryGit(...args) {
  try {
    const { stdout } = await exec('git', ['-C', PROJECT_DIR, ...args], { timeout: 4000 })
    const text = stdout.trim()
    return text || null
  } catch {
    return null
  }
}

async function readResultsHistory() {
  const raw = await readText(RESULTS_PATH)
  if (!raw) return []
  const lines = raw.split('\n').map((line) => line.trim()).filter(Boolean)
  if (lines.length < 2) return []

  const headers = lines[0].split('\t')
  return lines.slice(1).map((line, index) => {
    const values = line.split('\t')
    const row = Object.fromEntries(headers.map((header, headerIndex) => [header, values[headerIndex] || '']))
    return {
      index: index + 1,
      commit: row.commit || `row-${index + 1}`,
      valBpb: toNumberSafe(row.val_bpb),
      memoryGb: toNumberSafe(row.memory_gb),
      status: row.status || 'unknown',
      description: row.description || '',
    }
  })
}

export async function getAutoResearchSnapshot() {
  const statusPayload = await readJson(STATUS_PATH)
  const owner = readAgentSnapshot(statusPayload, DEFAULT_OWNER_AGENT)
  const qa = readAgentSnapshot(statusPayload, 'qa')
  const memoryDistiller = readAgentSnapshot(statusPayload, 'memory-distiller')
  const [control, manualControl, schedule] = await Promise.all([
    getAutoResearchControlSnapshot(),
    getAutoResearchManualConfigSnapshot(),
    getAutoResearchScheduleSnapshot(),
  ])
  const currentResearchKind = toStringSafe(control.researchKind) || DEFAULT_RESEARCH_KIND
  const strategyConfig = await getAutoResearchStrategyConfigSnapshot()
  const currentRunTag = parseRunTag(owner.currentTask) || parseRunTag(owner.nextStep) || control.runTag
  const currentRunStillEvolving = Boolean(
    control.isActive
    || ['queued', 'running', 'stopping'].includes(String(control.status || '').toLowerCase())
    || ['EXECUTING', 'RUNNING', 'IN_PROGRESS'].includes(String(owner.phase || '').toUpperCase()),
  )
  const taggedPlanPath = currentRunTag ? join(STRATEGY_DIR, `${currentRunTag}-plan.json`) : null

  const [
    strategyState,
    history,
    latestStrategyReportPath,
    latestPlanFallbackPath,
    searchSpaceRaw,
    researchMemoryRaw,
    proxyHealth,
    baselineRun,
    codexRun,
    programRun,
    improveRun,
    evolveRun,
    latestCompletedSummaryRun,
    latestCompletedQaRun,
    latestCompletedRevalidationRun,
    latestCompletedMemoryRun,
    latestCompletedProgramRun,
    latestCompletedImproveRun,
    latestCompletedEvolveRun,
    overnightLogPath,
    branch,
    head,
  ] = await Promise.all([
    readJson(join(STRATEGY_DIR, 'fleet-state.json')),
    readResultsHistory(),
    newestPath(STRATEGY_DIR, (name) => name.endsWith('-strategy.json')),
    newestPath(STRATEGY_DIR, (name) => name.endsWith('-plan.json')),
    readJson(SEARCH_SPACE_PATH),
    readJson(RESEARCH_MEMORY_PATH),
    readProxyHealth(),
    newestRunDir('baseline', currentRunTag).then(readRunArtifact),
    newestRunDir('codex', currentRunTag).then(readRunArtifact),
    newestRunDir('program', currentRunTag).then(readRunArtifact),
    newestRunDir('improve', currentRunTag).then(readRunArtifact),
    newestRunDir('evolve', currentRunTag).then(readRunArtifact),
    newestRunDirWithArtifact('codex', 'summary.md').then(readRunArtifact),
    newestRunDirWithArtifact('codex', 'qa-check.md').then(readRunArtifact),
    newestRunDirWithArtifact('codex', 'revalidation.md').then(readRunArtifact),
    newestRunDirWithArtifact('codex', 'memory-distiller-handoff.md').then(readRunArtifact),
    newestRunDirWithArtifact('program', 'summary.md').then(readRunArtifact),
    newestRunDirWithArtifact('improve', 'summary.md').then(readRunArtifact),
    newestRunDirWithArtifact('evolve', 'summary.md').then(readRunArtifact),
    newestPath(OVERNIGHT_DIR, (name) => (!currentRunTag || name.startsWith(`${currentRunTag}-`)) && name.endsWith('.log')),
    tryGit('branch', '--show-current'),
    tryGit('rev-parse', '--short', 'HEAD'),
  ])
  const latestPlanPath = taggedPlanPath && await pathExists(taggedPlanPath) ? taggedPlanPath : latestPlanFallbackPath

  const currentRun = currentResearchKind === 'program'
    ? programRun
    : (currentResearchKind === 'improve'
        ? improveRun
        : (currentResearchKind === 'evolve' ? evolveRun : codexRun))
  const latestCompletedSameKindRun = currentResearchKind === 'program'
    ? latestCompletedProgramRun
    : (currentResearchKind === 'improve'
        ? latestCompletedImproveRun
        : (currentResearchKind === 'evolve' ? latestCompletedEvolveRun : latestCompletedSummaryRun))
  const latestCompletedOverallRun = pickMostRecentRun(
    latestCompletedEvolveRun,
    latestCompletedImproveRun,
    latestCompletedProgramRun,
    latestCompletedSummaryRun,
    latestCompletedQaRun,
    latestCompletedRevalidationRun,
    latestCompletedMemoryRun,
    baselineRun,
  )
  const displayRun = currentRun || latestCompletedSameKindRun || latestCompletedOverallRun
  const displayResearchKind = toStringSafe(currentRun?.manifest?.researchKind) || toStringSafe(displayRun?.manifest?.researchKind) || currentResearchKind
  const isCodeMode = isCodeResearchKind(displayResearchKind)
  const revalidationData = isCodeMode
    ? null
    : (codexRun?.revalidation || latestCompletedRevalidationRun?.revalidation || null)
  const latestCompletedDisplayRun = displayResearchKind === 'program'
    ? latestCompletedProgramRun
    : (displayResearchKind === 'improve'
        ? latestCompletedImproveRun
        : (displayResearchKind === 'evolve' ? latestCompletedEvolveRun : latestCompletedSummaryRun))
  const summaryFallback = latestCompletedDisplayRun?.summary || (!isCodeMode ? baselineRun?.summary : null)
  const qaFallback = isCodeMode ? latestCompletedDisplayRun?.qa : latestCompletedQaRun?.qa
  const revalidationFallback = isCodeMode ? latestCompletedDisplayRun?.revalidationReport : latestCompletedRevalidationRun?.revalidationReport
  const memoryFallback = isCodeMode ? latestCompletedDisplayRun?.memoryHandoff : latestCompletedMemoryRun?.memoryHandoff

  const summaryPendingNote = displayResearchKind === 'program'
    ? '目前這輪還在研究程式，摘要會在收尾後寫出；先顯示上一輪已完成的程式研究摘要。'
    : (displayResearchKind === 'improve'
        ? '目前這輪正在改程式並驗證，摘要會在收尾後寫出；先顯示上一輪已完成的程式改善摘要。'
        : (displayResearchKind === 'evolve'
            ? '目前這輪正在推進程式進化，摘要會在收尾後寫出；先顯示上一輪已完成的程式進化摘要。'
            : (latestCompletedSummaryRun?.summary
                ? '目前這輪還在跑，摘要要等收尾後才會寫完；先顯示上一輪已完成的摘要。'
                : '目前這輪還在跑，摘要要等收尾後才會寫完；目前先顯示這輪 baseline。')))
  const summaryFallbackLabel = displayResearchKind === 'program'
    ? '上一輪程式研究'
    : (displayResearchKind === 'improve'
        ? '上一輪程式改善'
        : (displayResearchKind === 'evolve'
            ? '上一輪程式進化'
            : (latestCompletedSummaryRun?.summary ? '上一輪已完成' : '這輪 baseline')))
  const summaryMissingNote = displayResearchKind === 'program'
    ? '目前還沒有可顯示的程式研究摘要。'
    : (displayResearchKind === 'improve'
        ? '目前還沒有可顯示的程式改善摘要。'
        : (displayResearchKind === 'evolve' ? '目前還沒有可顯示的程式進化摘要。' : '目前還沒有可顯示的研究摘要。'))

  const qaPendingNote = displayResearchKind === 'program'
    ? '這輪是程式研究，完成後會補上一份「怎麼看摘要」的說明；先顯示上一輪版本。'
    : (displayResearchKind === 'improve'
        ? '這輪正在改程式並驗證，QA 驗證會在收尾後生成；先顯示上一輪程式改善的驗證結果。'
        : (displayResearchKind === 'evolve'
            ? '這輪正在推進程式進化，QA 驗證會在收尾後生成；先顯示上一輪程式進化的驗證結果。'
            : 'QA 只會在整輪研究結束後生成；先顯示上一輪已完成的 QA 報告。'))
  const qaPendingMissingNote = displayResearchKind === 'program'
    ? '這輪是程式研究，這一格會在收尾後補上閱讀重點。'
    : (displayResearchKind === 'improve'
        ? '這輪是程式改善，這一格會在收尾後補上驗證結果。'
        : (displayResearchKind === 'evolve'
            ? '這輪是程式進化，這一格會在收尾後補上驗證結果。'
            : 'QA 會在這輪收尾後才產生，目前還沒有可顯示的舊報告。'))
  const qaMissingNote = displayResearchKind === 'program'
    ? '目前還沒有任何已完成的程式研究閱讀重點。'
    : (displayResearchKind === 'improve'
        ? '目前還沒有任何已完成的程式改善驗證報告。'
        : (displayResearchKind === 'evolve' ? '目前還沒有任何已完成的程式進化驗證報告。' : '目前還沒有任何已完成的 QA 報告。'))

  const revalidationPendingNote = displayResearchKind === 'program'
    ? '這輪不是在跑分數，所以這裡會改放後續確認建議；先顯示上一輪版本。'
    : (displayResearchKind === 'improve'
        ? '這輪不是在跑模型分數，這裡會記錄之後怎麼再次確認這次改善是否真的有效。'
        : (displayResearchKind === 'evolve'
            ? '這輪不是在跑模型分數，這裡會記錄之後怎麼再次確認這次進化是否真的有效。'
            : '自動複驗只會在主體研究收尾後啟動；先顯示上一輪已完成的複驗結果。'))
  const revalidationPendingMissingNote = displayResearchKind === 'program'
    ? '這輪是程式研究，這裡會在收尾後補上後續確認建議。'
    : (displayResearchKind === 'improve'
        ? '這輪是程式改善，這裡會在收尾後補上之後怎麼複查的建議。'
        : (displayResearchKind === 'evolve'
            ? '這輪是程式進化，這裡會在收尾後補上之後怎麼複查的建議。'
            : '自動複驗會在這輪收尾後才開始，目前還沒有可顯示的舊結果。'))
  const revalidationMissingNote = displayResearchKind === 'program'
    ? '目前還沒有任何已完成的程式研究後續確認。'
    : (displayResearchKind === 'improve'
        ? '目前還沒有任何已完成的程式改善後續確認。'
        : (displayResearchKind === 'evolve' ? '目前還沒有任何已完成的程式進化後續確認。' : '目前還沒有任何已完成的自動複驗。'))

  const memoryPendingNote = displayResearchKind === 'program'
    ? '這輪還在整理程式研究結論；先顯示上一輪交接內容。'
    : (displayResearchKind === 'improve'
        ? '這輪還在整理程式改善結論；先顯示上一輪交接內容。'
        : (displayResearchKind === 'evolve'
            ? '這輪還在整理程式進化結論；先顯示上一輪交接內容。'
            : '記憶整理會在 QA 與複驗後收尾完成；先顯示上一輪的交接內容。'))
  const memoryMissingNote = displayResearchKind === 'program'
    ? '目前還沒有任何已完成的程式研究交接。'
    : (displayResearchKind === 'improve'
        ? '目前還沒有任何已完成的程式改善交接。'
        : (displayResearchKind === 'evolve' ? '目前還沒有任何已完成的程式進化交接。' : '目前還沒有任何已完成的記憶整理交接。'))

  const summaryArtifact = mergeArtifactView(currentRun?.summary, summaryFallback, {
    pending: currentRunStillEvolving,
    pendingNote: summaryPendingNote,
    fallbackLabel: summaryFallbackLabel,
    missingNote: summaryMissingNote,
  })
  const qaArtifact = mergeArtifactView(currentRun?.qa, qaFallback, {
    pending: currentRunStillEvolving,
    pendingNote: qaPendingNote,
    pendingMissingNote: qaPendingMissingNote,
    missingNote: qaMissingNote,
  })
  const revalidationArtifact = mergeArtifactView(currentRun?.revalidationReport, revalidationFallback, {
    pending: currentRunStillEvolving,
    pendingNote: revalidationPendingNote,
    pendingMissingNote: revalidationPendingMissingNote,
    missingNote: revalidationMissingNote,
  })
  const memoryArtifact = mergeArtifactView(currentRun?.memoryHandoff, memoryFallback, {
    pending: currentRunStillEvolving,
    pendingNote: memoryPendingNote,
    pendingMissingNote: '這輪還在進行，記憶整理交接會在最後才產生。',
    missingNote: memoryMissingNote,
  })

  const [latestStrategyReport, latestPlan, overnightTail, overnightStat, controlLogTail] = await Promise.all([
    latestStrategyReportPath ? readJson(latestStrategyReportPath) : Promise.resolve(null),
    latestPlanPath ? readJson(latestPlanPath) : Promise.resolve(null),
    overnightLogPath ? tailLines(overnightLogPath, 40) : Promise.resolve([]),
    overnightLogPath ? stat(overnightLogPath).catch(() => null) : Promise.resolve(null),
    control.outputLogPath ? tailLines(control.outputLogPath, 40) : Promise.resolve([]),
  ])

  const baselineRow = history.find((row) => row.description === 'baseline') || history[0] || null
  const keepRows = history.filter((row) => row.status === 'keep' && row.valBpb !== null)
  const bestKeep = keepRows.reduce((best, row) => {
    if (!best) return row
    if (row.valBpb < best.valBpb) return row
    return best
  }, null)
  const latestRow = history[history.length - 1] || null

  const summaryContent = summaryArtifact?.content || null
  const qaContent = qaArtifact?.content || null
  const revalidationContent = revalidationArtifact?.content || null
  const memoryContent = memoryArtifact?.content || null
  const manifest = displayRun?.manifest || latestCompletedQaRun?.manifest || baselineRun?.manifest || {}
  const searchSpace = mergeSearchSpace(searchSpaceRaw || latestPlan?.searchSpace)
  const researchMemory = researchMemoryRaw && typeof researchMemoryRaw === 'object'
    ? {
        path: RESEARCH_MEMORY_PATH,
        updatedAt: toStringSafe(researchMemoryRaw.updatedAt),
        entryCount: Array.isArray(researchMemoryRaw.entries) ? researchMemoryRaw.entries.length : 0,
        latestEntry: Array.isArray(researchMemoryRaw.entries) && researchMemoryRaw.entries.length
          ? researchMemoryRaw.entries[researchMemoryRaw.entries.length - 1]
          : null,
        laneStats: researchMemoryRaw.laneStats || {},
        recommendedPatterns: normalizePatternList(researchMemoryRaw.recommendedPatterns),
        avoidPatterns: normalizePatternList(researchMemoryRaw.avoidPatterns),
      }
    : {
        path: RESEARCH_MEMORY_PATH,
        updatedAt: null,
        entryCount: 0,
        latestEntry: null,
        laneStats: {},
        recommendedPatterns: [],
        avoidPatterns: [],
      }
  const activeTargetPath = toStringSafe(control.targetPath)
    || toStringSafe(displayRun?.manifest?.targetPath)
    || PROJECT_DIR
  const activeTargetLabel = toStringSafe(control.targetLabel)
    || toStringSafe(displayRun?.manifest?.targetLabel)
    || (isCodeMode ? activeTargetPath : 'AutoResearch MLX')
  const activeResearchTopic = toStringSafe(control.researchTopic)
    || toStringSafe(latestPlan?.userResearchTopic)
    || toStringSafe(manifest?.userResearchTopic)
  const [codeDeliveryMemory, fleetReadinessCandidates] = isCodeMode
    ? await Promise.all([
      getAutoResearchCodeDeliveryMemory({
        targetPath: activeTargetPath,
        targetLabel: activeTargetLabel,
      }),
      getAutoResearchFleetReadinessCandidates({
        targetPath: activeTargetPath,
        targetLabel: activeTargetLabel,
      }),
    ])
    : [
      {
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
      },
      {
        updatedAt: null,
        sourcePath: STATUS_PATH,
        entryCount: 0,
        topCandidate: null,
        candidates: [],
      },
    ]
  const hydratedControl = isCodeMode
    ? hydrateActiveControlReadinessSignal(control, fleetReadinessCandidates)
    : control

  const currentLane = displayResearchKind === 'program'
    ? {
        id: 'program-research',
        label: `程式研究：${activeTargetLabel}`,
        goal: activeResearchTopic
          ? `針對「${activeResearchTopic}」讀懂這個程式在做什麼、相關檔案在哪裡，以及接下來先做什麼。`
          : `先幫你讀懂「${activeTargetLabel}」這個程式在做什麼、主要流程怎麼走，以及接下來先做什麼。`,
        whyNow: '這輪不是在跑分數，而是在整理架構理解、關鍵檔案、風險與下一步。',
        focus: ['系統目的', '關鍵檔案', '主要流程', '風險與下一步'],
        avoid: ['直接改原始碼', '只丟一堆看不懂的術語'],
      }
    : displayResearchKind === 'improve'
      ? {
          id: 'program-improve',
          label: `程式改善：${activeTargetLabel}`,
          goal: activeResearchTopic
            ? `針對「${activeResearchTopic}」找出最值得先修的一個問題，實際改碼、跑驗證，再把結果留存。`
            : `先替「${activeTargetLabel}」找出一個最值得先修的問題，實際改碼並驗證。`,
          whyNow: '這輪不只是看懂程式，而是要把問題縮到單一改善點，真的動手修並留下證據。',
          focus: ['單一高槓桿問題', '小範圍改碼', 'build / test / browser 驗證'],
          avoid: ['一次大改很多模組', '沒驗證就宣布成功', '覆蓋掉既有使用者改動'],
        }
      : displayResearchKind === 'evolve'
        ? {
            id: 'program-evolve',
            label: `程式進化：${activeTargetLabel}`,
            goal: activeResearchTopic
              ? `針對「${activeResearchTopic}」找出最值得延續的進化瓶頸，實際改碼、跑驗證，再把下一輪可延續方向留下來。`
              : `先替「${activeTargetLabel}」找出一個最值得持續進化的瓶頸，實際改碼並驗證。`,
            whyNow: '這輪不是單次補洞，而是要做一個會讓後續每一輪都更好推進的高槓桿變化。',
            focus: ['高槓桿進化瓶頸', '小範圍可延續改動', 'feedback loop / automation / observability', 'build / test / browser 驗證'],
            avoid: ['一次大改很多模組', '只有 cosmetic 變更', '沒驗證就宣布進化成功'],
          }
      : (latestPlan?.selectedLaneId
          ? {
              id: latestPlan.selectedLaneId,
              label: latestPlan.selectedLaneLabel,
              goal: latestPlan.selectedLaneGoal,
              whyNow: latestPlan.selectedLaneWhyNow,
              focus: Array.isArray(latestPlan.selectedLaneFocus) ? latestPlan.selectedLaneFocus : [],
              avoid: Array.isArray(latestPlan.selectedLaneAvoid) ? latestPlan.selectedLaneAvoid : [],
            }
          : manifest?.lane || {
              id: toStringSafe(strategyState?.lastLaneId),
              label: toStringSafe(strategyState?.lastLaneLabel),
              goal: toStringSafe(strategyState?.lastLaneGoal),
              whyNow: null,
              focus: [],
              avoid: [],
            })
  const nextLane = displayResearchKind === 'program'
    ? {
        id: 'program-followup',
        label: '把研究主題縮小到單一流程或單一模組',
        goal: '下一輪把問題問得更具體，會更像一位懂你專案的技術顧問。',
      }
    : displayResearchKind === 'improve'
      ? {
          id: 'program-improve-followup',
          label: '沿著這次驗證結果，再修下一個最卡的點',
          goal: '先確認這次改善是否真的有效，再往相鄰流程或同一模組的下一個瓶頸推進。',
        }
      : displayResearchKind === 'evolve'
        ? {
            id: 'program-evolve-followup',
            label: '沿著這次進化結果，再推下一個會產生複利的 bottleneck',
            goal: '先確認這次進化是否真的讓系統更好演化，再往相鄰流程的下一個高槓桿瓶頸推進。',
          }
      : (latestPlan?.nextLaneId
          ? {
              id: latestPlan.nextLaneId,
              label: latestPlan.nextLaneLabel,
              goal: latestPlan.nextLaneGoal,
            }
          : manifest?.nextLane || {
              id: toStringSafe(strategyState?.nextLaneId),
              label: toStringSafe(strategyState?.nextLaneLabel),
              goal: toStringSafe(strategyState?.nextLaneGoal),
            })

  const overnightStartedAt = overnightTail.find((line) => line.startsWith('started_at='))?.split('=')[1] || null
  const overnightCommand = overnightTail.find((line) => line.startsWith('cmd='))?.slice(4) || null

  return {
    updatedAt: new Date().toISOString(),
    live: {
      ownerAgent: DEFAULT_OWNER_AGENT,
      isRunning: hydratedControl.isActive || owner.phase === 'EXECUTING' || owner.phase === 'RUNNING',
      runTag: currentRunTag || toStringSafe(displayRun?.manifest?.runTag) || toStringSafe(baselineRun?.manifest?.runTag),
      researchKind: displayResearchKind,
      phase: owner.phase,
      currentTask: owner.currentTask,
      lastAction: owner.lastAction,
      lastActionAt: owner.lastActionAt,
      nextStep: owner.nextStep,
      health: owner.health,
      blockers: owner.blockers,
      qa,
      memoryDistiller,
    },
    control: {
      ...hydratedControl,
      logTail: controlLogTail,
    },
    manualControl,
    schedule,
    strategy: {
      primaryModel: strategyConfig.primaryModel || toStringSafe(strategyState?.primaryModel) || toStringSafe(manifest.model) || DEFAULT_AUTORESEARCH_PRIMARY_MODEL,
      breakthroughModel: strategyConfig.breakthroughModel || toStringSafe(strategyState?.breakthroughModel) || DEFAULT_AUTORESEARCH_BREAKTHROUGH_MODEL,
      escalateAfter: DEFAULT_ESCALATE_AFTER,
      plateauCount: toNumberSafe(strategyState?.primaryPlateauCount) ?? 0,
      updatedAt: toStringSafe(strategyState?.updatedAt),
      configuredUpdatedAt: strategyConfig.updatedAt,
      configPath: strategyConfig.path,
      lastPrimaryRunTag: toStringSafe(strategyState?.lastPrimaryRunTag),
      lastPrimaryResult: toStringSafe(strategyState?.lastPrimaryResult),
      lastPromotionOk: Boolean(strategyState?.lastPromotionOk),
      lastRevalidationStatus: toStringSafe(strategyState?.lastRevalidationStatus),
      lastEscalationTriggered: Boolean(strategyState?.lastEscalationTriggered),
      lastEscalationRunTag: toStringSafe(strategyState?.lastEscalationRunTag),
      lastEscalationResult: toStringSafe(strategyState?.lastEscalationResult),
      latestPlanPath,
      latestPlan,
      latestStrategyReportPath,
      latestStrategyReport,
      researchKind: displayResearchKind,
      currentLane,
      nextLane,
      userResearchTopic: activeResearchTopic,
      planSummary: toStringSafe(latestPlan?.planSummary) || toStringSafe(strategyState?.planSummary),
      stableMemoryCallout: toStringSafe(latestPlan?.stableMemoryCallout),
      cautionMemoryCallout: toStringSafe(latestPlan?.cautionMemoryCallout),
      searchSpace,
      researchMemory,
      codeDeliveryMemory,
      fleetReadinessCandidates,
      availableModels: listAutoResearchModelOptions([
        strategyConfig.primaryModel,
        strategyConfig.breakthroughModel,
        toStringSafe(strategyState?.primaryModel),
        toStringSafe(strategyState?.breakthroughModel),
        toStringSafe(manifest.model),
      ]),
    },
    repo: {
      projectDir: PROJECT_DIR,
      resultsPath: RESULTS_PATH,
      researchKind: displayResearchKind,
      activeWorkspacePath: activeTargetPath,
      activeWorkspaceLabel: activeTargetLabel,
      branch: branch || toStringSafe(manifest.branch),
      head: head || toStringSafe(manifest.head),
      codexLogin: toStringSafe(manifest.codexLogin),
      proxyReady: proxyHealth?.ok === true ? true : (typeof manifest.proxyReady === 'boolean' ? manifest.proxyReady : null),
      proxyStatus: proxyHealth?.status || null,
      proxyDefaultModel: proxyHealth?.defaultModel || null,
      proxyActiveRequests: proxyHealth?.activeRequests ?? null,
      proxyMaxConcurrent: proxyHealth?.maxConcurrent ?? null,
      proxyConfigured: proxyHealth?.openaiConfigured ?? null,
      proxyStatusSource: proxyHealth?.ok === true ? 'live' : 'manifest',
    },
    metrics: {
      baselineValBpb: isCodeMode ? null : (typeof baselineRow?.valBpb === 'number' ? baselineRow.valBpb : null),
      bestKeepValBpb: isCodeMode ? null : (typeof bestKeep?.valBpb === 'number' ? bestKeep.valBpb : null),
      latestValBpb: isCodeMode ? null : (typeof latestRow?.valBpb === 'number' ? latestRow.valBpb : null),
      latestMemoryGb: isCodeMode ? null : (typeof latestRow?.memoryGb === 'number' ? latestRow.memoryGb : null),
      revalidationVerdict: toStringSafe(revalidationData?.verdict),
      revalidationMeanValBpb: toNumberSafe(revalidationData?.meanValBpb),
      revalidationSpread: toNumberSafe(revalidationData?.valSpread),
      revalidationMeanMemoryGb: toNumberSafe(revalidationData?.meanMemoryGb),
      deltaFromBaseline: isCodeMode
        ? null
        : (typeof baselineRow?.valBpb === 'number' && typeof bestKeep?.valBpb === 'number'
        ? Number((baselineRow.valBpb - bestKeep.valBpb).toFixed(6))
        : null),
      resultsCount: isCodeMode ? 0 : history.length,
      keepCount: isCodeMode ? 0 : keepRows.length,
      history: isCodeMode ? [] : history,
      changedFilesCount: Array.isArray(displayRun?.result?.changedFiles) ? displayRun.result.changedFiles.length : 0,
      verificationCount: Array.isArray(displayRun?.result?.verification) ? displayRun.result.verification.length : 0,
      verificationStatus: toStringSafe(displayRun?.result?.overallStatus),
      codeDeliveryRunCount: isCodeMode ? codeDeliveryMemory.entryCount : 0,
      codeDeliveryPassRate: isCodeMode ? codeDeliveryMemory.passRate : null,
      readinessCandidateCount: isCodeMode ? fleetReadinessCandidates.entryCount : 0,
    },
    artifacts: {
      baselineRun,
      codexRun,
      programRun,
      improveRun,
      evolveRun,
      latestCompletedCodexRun: latestCompletedSummaryRun,
      latestCompletedProgramRun,
      latestCompletedImproveRun,
      latestCompletedEvolveRun,
      latestCompletedQaRun,
      latestCompletedRevalidationRun,
      latestCompletedMemoryRun,
      summary: summaryArtifact,
      qaReport: qaArtifact,
      revalidationReport: revalidationArtifact,
      memoryHandoff: memoryArtifact,
      result: displayRun?.result || null,
      codexLastMessage: currentRun?.codexLastMessage || displayRun?.codexLastMessage || null,
      overnightLog: overnightLogPath
        ? {
            path: overnightLogPath,
            updatedAt: overnightStat?.mtime?.toISOString?.() || null,
            startedAt: overnightStartedAt,
            command: overnightCommand,
            tail: overnightTail,
          }
        : null,
    },
    highlights: {
      finalCommit: parseMarkdownFact(summaryContent, 'Final kept commit')
        || parseMarkdownFact(summaryContent, 'Final commit')
        || parseMarkdownFact(summaryContent, 'Best kept commit (train config)'),
      peakMemory: parseMarkdownFact(summaryContent, 'Peak memory') || parseMarkdownFact(summaryContent, 'peak memory'),
      qaVerdict: parseMarkdownFact(qaContent, 'QA verdict'),
      qaVerdictNote: parseMarkdownFact(qaContent, 'Verdict note'),
      revalidationVerdict: parseMarkdownFact(revalidationContent, 'Revalidation verdict'),
      revalidationNote: parseMarkdownFact(revalidationContent, 'Interpretation') || parseMarkdownFact(revalidationContent, 'Mean val_bpb'),
      bestIdea: parseBestIdea(summaryContent),
      improvementHeadline: toStringSafe(displayRun?.result?.headline),
      improvementProblem: toStringSafe(displayRun?.result?.problem),
      verificationStatus: toStringSafe(displayRun?.result?.overallStatus),
      changedFiles: Array.isArray(displayRun?.result?.changedFiles) ? displayRun.result.changedFiles : [],
      verificationItems: Array.isArray(displayRun?.result?.verification) ? displayRun.result.verification : [],
      improvementNextSteps: Array.isArray(displayRun?.result?.nextSteps) ? displayRun.result.nextSteps.filter(Boolean) : [],
      readinessTopCandidate: fleetReadinessCandidates.topCandidate,
      nextRunCandidates: fleetReadinessCandidates.candidates,
      memorySummary: memoryContent
        ?.split('\n')
        .find((line) => line.startsWith('- Best val_bpb:') || line.startsWith('- Baseline val_bpb:'))
        || null,
    },
  }
}
