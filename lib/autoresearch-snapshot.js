import { execFile } from 'node:child_process'
import { open, readFile, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import {
  DEFAULT_AUTORESEARCH_BREAKTHROUGH_MODEL,
  DEFAULT_AUTORESEARCH_PRIMARY_MODEL,
  getAutoResearchControlSnapshot,
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

const DEFAULT_OWNER_AGENT = 'dev-fish'
const DEFAULT_ESCALATE_AFTER = 2

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
  const memoryPath = join(dir, 'memory-distiller-handoff.md')
  const lastMessagePath = join(dir, 'codex-last-message.md')
  const eventsPath = join(dir, 'codex-events.jsonl')

  const [dirStat, manifest, summary, qa, memoryHandoff, codexLastMessage, eventLines] = await Promise.all([
    stat(dir),
    readJson(manifestPath),
    readArtifact(summaryPath, 40),
    readArtifact(qaPath, 40),
    readArtifact(memoryPath, 40),
    readArtifact(lastMessagePath, 30),
    tailLines(eventsPath, 10),
  ])

  return {
    path: dir,
    updatedAt: dirStat.mtime.toISOString(),
    manifest,
    summary,
    qa,
    memoryHandoff,
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
  const strategyConfig = await getAutoResearchStrategyConfigSnapshot()
  const currentRunTag = parseRunTag(owner.currentTask) || parseRunTag(owner.nextStep) || control.runTag

  const [strategyState, history, latestStrategyReportPath, baselineRun, codexRun, overnightLogPath, branch, head] = await Promise.all([
    readJson(join(STRATEGY_DIR, 'fleet-state.json')),
    readResultsHistory(),
    newestPath(STRATEGY_DIR, (name) => name.endsWith('-strategy.json')),
    newestRunDir('baseline', currentRunTag).then(readRunArtifact),
    newestRunDir('codex', currentRunTag).then(readRunArtifact),
    newestPath(OVERNIGHT_DIR, (name) => (!currentRunTag || name.startsWith(`${currentRunTag}-`)) && name.endsWith('.log')),
    tryGit('branch', '--show-current'),
    tryGit('rev-parse', '--short', 'HEAD'),
  ])

  const [latestStrategyReport, overnightTail, overnightStat, controlLogTail] = await Promise.all([
    latestStrategyReportPath ? readJson(latestStrategyReportPath) : Promise.resolve(null),
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

  const summaryContent = codexRun?.summary?.content || baselineRun?.summary?.content || null
  const qaContent = codexRun?.qa?.content || null
  const memoryContent = codexRun?.memoryHandoff?.content || null
  const manifest = codexRun?.manifest || baselineRun?.manifest || {}

  const overnightStartedAt = overnightTail.find((line) => line.startsWith('started_at='))?.split('=')[1] || null
  const overnightCommand = overnightTail.find((line) => line.startsWith('cmd='))?.slice(4) || null

  return {
    updatedAt: new Date().toISOString(),
    live: {
      ownerAgent: DEFAULT_OWNER_AGENT,
      isRunning: control.isActive || owner.phase === 'EXECUTING' || owner.phase === 'RUNNING',
      runTag: currentRunTag || toStringSafe(codexRun?.manifest?.runTag) || toStringSafe(baselineRun?.manifest?.runTag),
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
      ...control,
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
      lastEscalationTriggered: Boolean(strategyState?.lastEscalationTriggered),
      lastEscalationRunTag: toStringSafe(strategyState?.lastEscalationRunTag),
      lastEscalationResult: toStringSafe(strategyState?.lastEscalationResult),
      latestStrategyReportPath,
      latestStrategyReport,
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
      branch: branch || toStringSafe(manifest.branch),
      head: head || toStringSafe(manifest.head),
      codexLogin: toStringSafe(manifest.codexLogin),
      proxyReady: typeof manifest.proxyReady === 'boolean' ? manifest.proxyReady : null,
    },
    metrics: {
      baselineValBpb: typeof baselineRow?.valBpb === 'number' ? baselineRow.valBpb : null,
      bestKeepValBpb: typeof bestKeep?.valBpb === 'number' ? bestKeep.valBpb : null,
      latestValBpb: typeof latestRow?.valBpb === 'number' ? latestRow.valBpb : null,
      latestMemoryGb: typeof latestRow?.memoryGb === 'number' ? latestRow.memoryGb : null,
      deltaFromBaseline: typeof baselineRow?.valBpb === 'number' && typeof bestKeep?.valBpb === 'number'
        ? Number((baselineRow.valBpb - bestKeep.valBpb).toFixed(6))
        : null,
      resultsCount: history.length,
      keepCount: keepRows.length,
      history,
    },
    artifacts: {
      baselineRun,
      codexRun,
      summary: codexRun?.summary || baselineRun?.summary || null,
      qaReport: codexRun?.qa || null,
      memoryHandoff: codexRun?.memoryHandoff || null,
      codexLastMessage: codexRun?.codexLastMessage || null,
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
      finalCommit: parseMarkdownFact(summaryContent, 'Final kept commit'),
      peakMemory: parseMarkdownFact(summaryContent, 'Peak memory') || parseMarkdownFact(summaryContent, 'peak memory'),
      qaVerdict: parseMarkdownFact(qaContent, 'QA verdict'),
      qaVerdictNote: parseMarkdownFact(qaContent, 'Verdict note'),
      bestIdea: parseBestIdea(summaryContent),
      memorySummary: memoryContent
        ?.split('\n')
        .find((line) => line.startsWith('- Best val_bpb:') || line.startsWith('- Baseline val_bpb:'))
        || null,
    },
  }
}
