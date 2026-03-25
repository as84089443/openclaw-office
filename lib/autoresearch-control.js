import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

export const OPENCLAW_HOME = process.env.OPENCLAW_HOME || process.env.OPENCLAW_STATE_DIR || join(homedir(), '.openclaw')
export const ARTIFACT_DIR = join(OPENCLAW_HOME, 'artifacts', 'autoresearch-mlx')
export const STRATEGY_DIR = join(ARTIFACT_DIR, 'strategy')
export const STRATEGY_CONFIG_PATH = join(STRATEGY_DIR, 'strategy-config.json')
export const CONTROL_DIR = join(ARTIFACT_DIR, 'control-room')
export const CONTROL_STATE_PATH = join(CONTROL_DIR, 'runtime.json')
export const MANUAL_CONFIG_PATH = join(CONTROL_DIR, 'manual-config.json')
export const CRON_JOBS_PATH = join(OPENCLAW_HOME, 'cron', 'jobs.json')
export const CONTROL_RUNNER_SCRIPT = join(OPENCLAW_HOME, 'scripts', 'autoresearch-mlx-control-runner.py')
export const NIGHTLY_JOB_NAME = 'dev-fish-autoresearch-nightly'
export const WATCH_JOB_NAME = 'admin-autoresearch-nightly-watch'
export const DEFAULT_OVERNIGHT_SOFT_MINUTES = 480
export const DEFAULT_OVERNIGHT_HARD_MINUTES = 510
export const DEFAULT_OVERNIGHT_MAX_EXPERIMENTS = 24
export const DEFAULT_MANUAL_SOFT_MINUTES = 90
export const DEFAULT_MANUAL_HARD_MINUTES = 120
export const DEFAULT_MANUAL_MAX_EXPERIMENTS = 6
export const DEFAULT_AUTORESEARCH_PRIMARY_MODEL = 'gpt-5.3-codex'
export const DEFAULT_AUTORESEARCH_BREAKTHROUGH_MODEL = 'gpt-5.4'
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
  }
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
  return buildManualConfigSnapshot(payload || {})
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
  const mode = options.mode || 'overnight'
  const source = options.source || 'ui'

  const child = spawn(
    'python3',
    [
      CONTROL_RUNNER_SCRIPT,
      '--root', OPENCLAW_HOME,
      '--run-tag', runTag,
      '--mode', mode,
      '--source', source,
      '--soft-minutes', String(softMinutes),
      '--hard-minutes', String(hardMinutes),
      '--max-experiments', String(maxExperiments),
      '--state-path', CONTROL_STATE_PATH,
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
