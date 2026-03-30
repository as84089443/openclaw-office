import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

const DEFAULT_AUTOPEN_WORKER_HISTORY_LIMIT = 6

function toNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function toPositiveInteger(value, fallback = DEFAULT_AUTOPEN_WORKER_HISTORY_LIMIT) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : fallback
}

function normalizeTimestamp(value) {
  if (!value || typeof value !== 'string') return null
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }

  return null
}

function trimText(value, max = 240) {
  const text = firstNonEmptyString(value)
  return text ? text.slice(0, max) : null
}

function trimFirstNonEmpty(values, max = 240) {
  const text = firstNonEmptyString(...values)
  return text ? text.slice(0, max) : null
}

function normalizeErrorList(errors) {
  if (!Array.isArray(errors)) return []

  return errors
    .map(error => trimText(error, 320))
    .filter(Boolean)
}

function ensureParentDir(filePath) {
  mkdirSync(dirname(filePath), { recursive: true })
}

function getWorkerStateSortKey(snapshot) {
  return Date.parse(snapshot?.recordedAt || snapshot?.completedAt || snapshot?.triggeredAt || '') || 0
}

function getWorkerStateDedupKey(snapshot) {
  return [
    snapshot?.recordedAt || '',
    snapshot?.completedAt || '',
    snapshot?.triggeredAt || '',
    snapshot?.status || '',
    snapshot?.meta?.upstreamStatus || '',
    snapshot?.detail || '',
    snapshot?.queueImpact?.before?.queued ?? '',
    snapshot?.queueImpact?.after?.queued ?? '',
    snapshot?.queueImpact?.before?.processing ?? '',
    snapshot?.queueImpact?.after?.processing ?? '',
  ].join('|')
}

function normalizeAutopenWorkerQueueStats(stats, fallbackCapturedAt = null) {
  if (!stats || typeof stats !== 'object') return null

  const queued = toNumber(stats.queued)
  const processing = toNumber(stats.processing)
  const completed = toNumber(stats.completed)
  const failed = toNumber(stats.failed)
  const cancelled = toNumber(stats.cancelled)

  return {
    queued,
    processing,
    completed,
    failed,
    cancelled,
    total: toNumber(stats.total) || queued + processing + completed + failed + cancelled,
    capturedAt: normalizeTimestamp(stats.capturedAt) || normalizeTimestamp(fallbackCapturedAt) || null,
  }
}

export function createAutopenWorkerQueueImpact({ before = null, after = null } = {}) {
  const normalizedBefore = normalizeAutopenWorkerQueueStats(
    before?.stats || before,
    before?.capturedAt || before?.meta?.finishedAt || before?.meta?.startedAt,
  )
  const normalizedAfter = normalizeAutopenWorkerQueueStats(
    after?.stats || after,
    after?.capturedAt || after?.meta?.finishedAt || after?.meta?.startedAt,
  )

  if (!normalizedBefore && !normalizedAfter) return null

  if (!normalizedBefore || !normalizedAfter) {
    return {
      status: 'partial',
      before: normalizedBefore,
      after: normalizedAfter,
      delta: null,
    }
  }

  const delta = {
    queued: normalizedAfter.queued - normalizedBefore.queued,
    processing: normalizedAfter.processing - normalizedBefore.processing,
    completed: normalizedAfter.completed - normalizedBefore.completed,
    failed: normalizedAfter.failed - normalizedBefore.failed,
    cancelled: normalizedAfter.cancelled - normalizedBefore.cancelled,
    total: normalizedAfter.total - normalizedBefore.total,
  }
  const changed = Object.values(delta).some(value => value !== 0)

  return {
    status: changed ? 'changed' : 'unchanged',
    before: normalizedBefore,
    after: normalizedAfter,
    delta,
  }
}

function normalizeAutopenWorkerQueueImpact(queueImpact) {
  if (!queueImpact || typeof queueImpact !== 'object') return null

  if (queueImpact.before || queueImpact.after || queueImpact.delta) {
    return createAutopenWorkerQueueImpact(queueImpact)
  }

  return createAutopenWorkerQueueImpact({
    before: queueImpact,
    after: null,
  })
}

function normalizeAutopenWorkerTask(task) {
  if (!task || typeof task !== 'object') return null

  return {
    id: firstNonEmptyString(task.id),
    keyword: firstNonEmptyString(task.keyword, '未命名任務') || '未命名任務',
    status: firstNonEmptyString(task.status),
    processing_phase: firstNonEmptyString(task.processing_phase),
    failure_phase: firstNonEmptyString(task.failure_phase),
    failure_at: normalizeTimestamp(task.failure_at)
      || normalizeTimestamp(task.completed_at)
      || normalizeTimestamp(task.updated_at)
      || normalizeTimestamp(task.created_at),
    error_message: trimFirstNonEmpty([task.error_message, task.reason]),
    retry_count: toNumber(task.retry_count),
  }
}

function normalizeAutopenWorkerTaskList(tasks, status = null) {
  if (!Array.isArray(tasks)) return []

  return tasks
    .map(normalizeAutopenWorkerTask)
    .filter(Boolean)
    .filter(task => !status || task.status === status)
    .slice(0, 3)
}

export function createAutopenWorkerTaskWindow({
  tasks = [],
  failureHistory = [],
  capturedAt = null,
} = {}) {
  const queuedCandidates = normalizeAutopenWorkerTaskList(tasks, 'queued')
  const processingCandidates = normalizeAutopenWorkerTaskList(tasks, 'processing')
  const failedCandidates = normalizeAutopenWorkerTaskList(
    Array.isArray(failureHistory) && failureHistory.length > 0
      ? failureHistory
      : tasks,
    'failed',
  )

  if (
    queuedCandidates.length === 0 &&
    processingCandidates.length === 0 &&
    failedCandidates.length === 0 &&
    !capturedAt
  ) {
    return null
  }

  return {
    capturedAt: normalizeTimestamp(capturedAt),
    queuedCandidates,
    processingCandidates,
    failedCandidates,
  }
}

function normalizeAutopenWorkerTaskWindow(taskWindow) {
  if (!taskWindow || typeof taskWindow !== 'object') return null

  if (Array.isArray(taskWindow.tasks) || Array.isArray(taskWindow.failureHistory)) {
    return createAutopenWorkerTaskWindow({
      tasks: taskWindow.tasks,
      failureHistory: taskWindow.failureHistory,
      capturedAt: taskWindow.capturedAt,
    })
  }

  return createAutopenWorkerTaskWindow({
    tasks: [
      ...(Array.isArray(taskWindow.queuedCandidates) ? taskWindow.queuedCandidates : []),
      ...(Array.isArray(taskWindow.processingCandidates) ? taskWindow.processingCandidates : []),
    ],
    failureHistory: Array.isArray(taskWindow.failedCandidates) ? taskWindow.failedCandidates : [],
    capturedAt: taskWindow.capturedAt,
  })
}

export function getAutopenWorkerStatePath(env = process.env) {
  return env.AUTOPEN_WORKER_STATE_PATH || join(process.cwd(), 'data', 'autopen-worker-state.json')
}

export function normalizeAutopenWorkerState(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null

  const meta = snapshot.meta && typeof snapshot.meta === 'object'
    ? {
      upstreamPath: firstNonEmptyString(snapshot.meta.upstreamPath),
      method: firstNonEmptyString(snapshot.meta.method),
      upstreamStatus: Number.isFinite(Number(snapshot.meta.upstreamStatus))
        ? Number(snapshot.meta.upstreamStatus)
        : null,
      startedAt: normalizeTimestamp(snapshot.meta.startedAt),
      finishedAt: normalizeTimestamp(snapshot.meta.finishedAt),
      durationMs: Number.isFinite(Number(snapshot.meta.durationMs))
        ? Math.max(0, Number(snapshot.meta.durationMs))
        : null,
      detail: trimText(snapshot.meta.detail),
    }
    : null

  const errors = normalizeErrorList(snapshot.errors)
  const detail = trimFirstNonEmpty([
    snapshot.detail,
    meta?.detail,
    snapshot.error,
    errors[0],
  ])
  const ok = snapshot.ok === true || snapshot.status === 'success'
  const triggeredAt = normalizeTimestamp(snapshot.triggeredAt)
    || meta?.startedAt
    || normalizeTimestamp(snapshot.recordedAt)
  const completedAt = normalizeTimestamp(snapshot.completedAt)
    || meta?.finishedAt
    || triggeredAt

  return {
    ok,
    status: ok ? 'success' : 'error',
    origin: firstNonEmptyString(snapshot.origin, 'office-manual-trigger') || 'office-manual-trigger',
    triggeredAt,
    completedAt,
    recordedAt: normalizeTimestamp(snapshot.recordedAt) || completedAt || triggeredAt,
    processed: toNumber(snapshot.processed),
    succeeded: toNumber(snapshot.succeeded),
    failed: toNumber(snapshot.failed),
    errors,
    detail,
    queueImpact: normalizeAutopenWorkerQueueImpact(snapshot.queueImpact),
    taskWindow: normalizeAutopenWorkerTaskWindow(snapshot.taskWindow),
    meta,
  }
}

export function createAutopenWorkerStateSnapshot(result, options = {}) {
  const payload = result?.data && typeof result.data === 'object' ? result.data : {}

  return normalizeAutopenWorkerState({
    ok: Boolean(result?.ok),
    status: result?.ok ? 'success' : 'error',
    origin: options.origin || 'office-manual-trigger',
    triggeredAt: options.triggeredAt || result?.meta?.startedAt || new Date().toISOString(),
    completedAt: result?.meta?.finishedAt || new Date().toISOString(),
    recordedAt: options.recordedAt || result?.meta?.finishedAt || new Date().toISOString(),
    processed: payload.processed,
    succeeded: payload.succeeded,
    failed: payload.failed,
    errors: payload.errors,
    detail: result?.ok ? null : trimFirstNonEmpty([result?.meta?.detail, payload.error]),
    queueImpact: options.queueImpact || null,
    taskWindow: options.taskWindow || null,
    meta: result?.meta || null,
  })
}

export function normalizeAutopenWorkerHistory(history = [], options = {}) {
  const limit = toPositiveInteger(options.limit)
  const items = []

  if (options.latest) {
    const latest = normalizeAutopenWorkerState(options.latest)
    if (latest) items.push(latest)
  }

  for (const item of Array.isArray(history) ? history : []) {
    const normalized = normalizeAutopenWorkerState(item)
    if (normalized) items.push(normalized)
  }

  return items
    .sort((left, right) => getWorkerStateSortKey(right) - getWorkerStateSortKey(left))
    .filter((item, index, array) => {
      const dedupKey = getWorkerStateDedupKey(item)
      return array.findIndex(candidate => getWorkerStateDedupKey(candidate) === dedupKey) === index
    })
    .slice(0, limit)
}

export function normalizeAutopenWorkerStateStore(store, options = {}) {
  const limit = toPositiveInteger(options.limit ?? store?.limit)
  const hasStoreShape = Boolean(
    store &&
    typeof store === 'object' &&
    (Array.isArray(store.history) || store.latest),
  )

  if (!hasStoreShape) {
    const latest = normalizeAutopenWorkerState(store)
    const history = latest ? [latest] : []

    return {
      latest,
      history,
      updatedAt: latest?.recordedAt || latest?.completedAt || latest?.triggeredAt || null,
      limit,
    }
  }

  const history = normalizeAutopenWorkerHistory(store.history, {
    latest: store.latest,
    limit,
  })
  const latest = history[0] || normalizeAutopenWorkerState(store.latest)

  return {
    latest,
    history,
    updatedAt: normalizeTimestamp(store.updatedAt)
      || latest?.recordedAt
      || latest?.completedAt
      || latest?.triggeredAt
      || null,
    limit,
  }
}

export function readAutopenWorkerStateStore(options = {}) {
  const filePath = options.filePath || getAutopenWorkerStatePath(options.env)
  if (!filePath || !existsSync(filePath)) {
    return normalizeAutopenWorkerStateStore(null, options)
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'))
    return normalizeAutopenWorkerStateStore(parsed, options)
  } catch (error) {
    console.error('[autopen-worker-state] Failed to read snapshot:', error.message)
    return normalizeAutopenWorkerStateStore(null, options)
  }
}

export function readAutopenWorkerState(options = {}) {
  return readAutopenWorkerStateStore(options).latest
}

export function readAutopenWorkerHistory(options = {}) {
  return readAutopenWorkerStateStore(options).history
}

export function writeAutopenWorkerStateStore(store, options = {}) {
  const normalized = normalizeAutopenWorkerStateStore(store, options)
  const filePath = options.filePath || getAutopenWorkerStatePath(options.env)

  if (!filePath) return normalized

  ensureParentDir(filePath)
  writeFileSync(filePath, `${JSON.stringify(normalized, null, 2)}\n`)
  return normalized
}

export function writeAutopenWorkerState(snapshot, options = {}) {
  const normalized = normalizeAutopenWorkerState(snapshot)
  if (!normalized) return null

  return writeAutopenWorkerStateStore({
    latest: normalized,
    history: [normalized],
  }, options).latest
}

export function recordAutopenWorkerRun(result, options = {}) {
  const snapshot = createAutopenWorkerStateSnapshot(result, options)
  const currentStore = readAutopenWorkerStateStore(options)

  return writeAutopenWorkerStateStore({
    latest: snapshot,
    history: [snapshot, ...(currentStore.history || [])],
    updatedAt: snapshot?.recordedAt || snapshot?.completedAt || snapshot?.triggeredAt || new Date().toISOString(),
    limit: options.limit || currentStore.limit,
  }, options).latest
}
