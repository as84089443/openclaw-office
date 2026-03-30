import {
  normalizeAutopenWorkerHistory,
  normalizeAutopenWorkerState,
} from './autopen-worker-state.js'

function toNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
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

function trimText(value, max = 160) {
  const text = firstNonEmptyString(value)
  return text ? text.slice(0, max) : null
}

function pushUniqueValue(list, value, limit = 3) {
  if (!value) return
  if (list.includes(value)) return
  if (list.length >= limit) return
  list.push(value)
}

function normalizeErrorSignatureKey(value) {
  const text = firstNonEmptyString(value)
  if (!text) return null

  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '<url>')
    .replace(/\b[0-9a-f]{8,}\b/gi, '<id>')
    .replace(/\b\d+\b/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildSyncSegment(label, result) {
  const ok = Boolean(result?.ok)
  const meta = result?.meta || null

  return {
    label,
    ok,
    error: ok ? null : firstNonEmptyString(meta?.detail, `${label}同步失敗`),
    meta,
    lastOkAt: ok
      ? normalizeTimestamp(meta?.finishedAt) || normalizeTimestamp(meta?.startedAt)
      : null,
  }
}

function extractTaskCollection(result) {
  const payload = result?.ok && result?.data && typeof result.data === 'object'
    ? result.data
    : null

  return Array.isArray(payload?.tasks)
    ? payload.tasks.map(normalizeAutopenTask).filter(Boolean)
    : []
}

export function normalizeAutopenTask(task) {
  if (!task || typeof task !== 'object') return null

  const failureMeta = task.result_json?._failure && typeof task.result_json._failure === 'object'
    ? task.result_json._failure
    : null
  const resultJson = task.result_json && typeof task.result_json === 'object'
    ? task.result_json
    : null
  const errorMessage = firstNonEmptyString(task.error_message, failureMeta?.reason)
  const failurePhase = firstNonEmptyString(failureMeta?.phase, task.processing_phase)
  const failureAt = normalizeTimestamp(failureMeta?.at)
    || normalizeTimestamp(task.completed_at)
    || normalizeTimestamp(task.updated_at)
    || normalizeTimestamp(task.created_at)

  return {
    ...task,
    keyword: firstNonEmptyString(task.keyword, '未命名任務') || '未命名任務',
    article_slug: firstNonEmptyString(task.article_slug, resultJson?.slug, resultJson?.article_slug),
    error_message: errorMessage,
    failure_phase: failurePhase,
    failure_at: failureAt,
    retry_count: toNumber(task.retry_count) ?? 0,
  }
}

export function normalizeAutopenStats(stats, tasks = []) {
  const source = stats && typeof stats === 'object' ? stats : {}
  const countByStatus = status => tasks.filter(task => task?.status === status).length

  const queued = toNumber(source.queued) ?? countByStatus('queued')
  const processing = toNumber(source.processing) ?? countByStatus('processing')
  const completed = toNumber(source.completed) ?? countByStatus('completed')
  const failed = toNumber(source.failed) ?? countByStatus('failed')
  const cancelled = toNumber(source.cancelled) ?? countByStatus('cancelled')

  return {
    queued,
    processing,
    completed,
    failed,
    cancelled,
    total: queued + processing + completed + failed + cancelled,
    todayCompleted: toNumber(source.today_completed ?? source.today) ?? 0,
    avgDurationSeconds: toNumber(source.avg_duration_seconds ?? source.avgDurationSeconds),
    statsBacked: Boolean(stats && typeof stats === 'object'),
  }
}

function buildSyncRunbookItems(syncSegments) {
  const items = []

  for (const segment of syncSegments) {
    if (segment.ok) continue

    const upstreamStatus = Number(segment.meta?.upstreamStatus)
    const detail = String(segment.meta?.detail || '').toLowerCase()
    const references = []

    if (segment.meta?.upstreamPath) references.push(segment.meta.upstreamPath)
    if (Number.isFinite(upstreamStatus) && upstreamStatus > 0) references.push(`HTTP ${upstreamStatus}`)

    if (detail.includes('autopen_api_key') || detail.includes('invalid api key') || upstreamStatus === 401) {
      items.push({
        key: `${segment.label}-api-key`,
        title: `先確認 ${segment.label} 的 API key`,
        detail: `${segment.label} 目前拿不到上游資料，最常見是 openclaw-office 的 AUTOPEN_API_KEY 跟 BWS-WEB 不一致。`,
        steps: [
          '先確認 openclaw-office 的 AUTOPEN_API_KEY 與 BWS-WEB 上游設定一致。',
          '若 upstreamStatus 是 401，代表請求已到上游，但授權被拒絕。',
        ],
        references,
      })
      continue
    }

    if (detail.includes('timed out') || detail.includes('timeout') || upstreamStatus === 504) {
      items.push({
        key: `${segment.label}-timeout`,
        title: `${segment.label} 上游逾時時，先看 BWS-WEB 是否卡住`,
        detail: `${segment.label} 的 proxy 已經送到 BWS-WEB，但在 timeout 內沒有拿到回應。`,
        steps: [
          '先到 BWS-WEB `/admin/autopen` 看後台是否仍在載入或查詢過慢。',
          '若任務佇列很多但 processing 沒變化，再手動觸發一次 Worker 驗證是否只是排程沒跑到。',
        ],
        references,
      })
      continue
    }

    items.push({
      key: `${segment.label}-generic`,
      title: `${segment.label} 同步異常時，先確認上游 API 可用`,
      detail: `${segment.label} 目前沒有拿到完整資料，請先檢查 BWS-WEB 的 AutoPen API 與部署狀態。`,
      steps: [
        '先用上游 path 與 HTTP 狀態判斷是 API 失敗、授權失敗，還是回應格式異常。',
        '若只有單一路徑失敗，優先修該 API；若 stats、tasks 一起失敗，先查整體 BWS-WEB 健康度。',
      ],
      references,
    })
  }

  return items
}

function buildWorkerRunRunbookItem(workerRun) {
  if (!workerRun || workerRun.status !== 'error') return null

  const upstreamStatus = Number(workerRun.meta?.upstreamStatus)
  const detail = String(workerRun.detail || '').toLowerCase()
  const references = []

  if (workerRun.meta?.upstreamPath) references.push(workerRun.meta.upstreamPath)
  if (Number.isFinite(upstreamStatus) && upstreamStatus > 0) references.push(`HTTP ${upstreamStatus}`)

  if (detail.includes('unauthorized') || detail.includes('cron_secret') || upstreamStatus === 401) {
    return {
      key: 'worker-last-run-auth',
      title: '最近一次 Worker 觸發失敗，先確認 cron 授權',
      detail: 'Office 已送出 Worker 請求，但 BWS `/api/cron/autopen-worker` 沒接受，優先檢查 `BWS_CRON_SECRET` 是否與上游一致。',
      steps: [
        '先確認 openclaw-office 的 `BWS_CRON_SECRET` 是否與 BWS `CRON_SECRET` 一致。',
        '若上游回 401，代表請求已到 BWS，但 Bearer token 不被接受。',
      ],
      references,
    }
  }

  return {
    key: 'worker-last-run-failed',
    title: '最近一次 Worker 觸發失敗',
    detail: workerRun.detail || 'Worker 沒有順利完成，請先檢查上游 route 與執行紀錄。',
    steps: [
      '先看最近一次 Worker 結果卡，確認是授權問題、上游 500，還是執行途中失敗。',
      '若這次觸發失敗且 queued 任務持續累積，優先檢查 BWS `autopen-worker` route 與 task worker log。',
    ],
    references,
  }
}

function buildWorkerHistorySummary(workerHistory = []) {
  const recentRuns = Array.isArray(workerHistory) ? workerHistory : []
  let consecutiveFailures = 0
  let lastSuccessAt = null

  for (const run of recentRuns) {
    if (run?.status === 'error') {
      consecutiveFailures += 1
      continue
    }

    lastSuccessAt = run?.completedAt || run?.triggeredAt || null
    break
  }

  if (!lastSuccessAt) {
    lastSuccessAt = recentRuns.find(run => run?.status === 'success')?.completedAt
      || recentRuns.find(run => run?.status === 'success')?.triggeredAt
      || null
  }

  return {
    totalRuns: recentRuns.length,
    failureCount: recentRuns.filter(run => run?.status === 'error').length,
    successCount: recentRuns.filter(run => run?.status === 'success').length,
    consecutiveFailures,
    lastSuccessAt,
  }
}

function getWorkerFailureSignatureSource(run) {
  return firstNonEmptyString(
    run?.detail,
    ...(Array.isArray(run?.errors) ? run.errors : []),
    run?.meta?.detail,
    Number.isFinite(Number(run?.meta?.upstreamStatus)) ? `HTTP ${Number(run.meta.upstreamStatus)}` : null,
  )
}

function buildWorkerFailureSignatures(workerHistory = [], limit = 3) {
  const errorRuns = (Array.isArray(workerHistory) ? workerHistory : [])
    .filter(run => run?.status === 'error')

  if (errorRuns.length === 0) return []

  const groups = new Map()
  const latestKey = normalizeErrorSignatureKey(getWorkerFailureSignatureSource(errorRuns[0]))
  let latestConsecutiveCount = 0

  for (const run of errorRuns) {
    const label = trimText(getWorkerFailureSignatureSource(run), 180)
    const key = normalizeErrorSignatureKey(label)
    if (!key) continue

    if (key === latestKey) {
      latestConsecutiveCount += 1
    } else if (latestConsecutiveCount === 0) {
      break
    }

    const group = groups.get(key) || {
      key,
      label,
      count: 0,
      consecutiveCount: 0,
      latestAt: null,
      upstreamStatuses: [],
      references: [],
    }

    group.count += 1
    group.latestAt = group.latestAt || normalizeTimestamp(run?.recordedAt || run?.completedAt || run?.triggeredAt)
    pushUniqueValue(
      group.upstreamStatuses,
      Number.isFinite(Number(run?.meta?.upstreamStatus)) ? Number(run.meta.upstreamStatus) : null,
      3,
    )
    pushUniqueValue(group.references, firstNonEmptyString(run?.meta?.upstreamPath), 2)
    groups.set(key, group)
  }

  if (latestKey && groups.has(latestKey)) {
    groups.get(latestKey).consecutiveCount = latestConsecutiveCount
  }

  return Array.from(groups.values())
    .sort((left, right) => {
      if (right.count !== left.count) return right.count - left.count
      if (right.consecutiveCount !== left.consecutiveCount) return right.consecutiveCount - left.consecutiveCount
      return Date.parse(right.latestAt || '') - Date.parse(left.latestAt || '')
    })
    .slice(0, limit)
}

function getFailureSignatureSource(task) {
  return firstNonEmptyString(
    task?.error_message,
    task?.failure_phase,
    task?.processing_phase,
  )
}

function buildFailureSignatures(failureHistory = [], limit = 3) {
  const groups = new Map()

  for (const task of Array.isArray(failureHistory) ? failureHistory : []) {
    const label = trimText(getFailureSignatureSource(task), 180)
    const key = normalizeErrorSignatureKey(label)
    if (!key) continue

    const group = groups.get(key) || {
      key,
      label,
      count: 0,
      latestAt: null,
      keywords: [],
      phases: [],
    }

    group.count += 1
    group.latestAt = group.latestAt || normalizeTimestamp(task?.failure_at || task?.completed_at || task?.updated_at || task?.created_at)
    pushUniqueValue(group.keywords, firstNonEmptyString(task?.keyword), 3)
    pushUniqueValue(group.phases, firstNonEmptyString(task?.failure_phase, task?.processing_phase), 3)
    groups.set(key, group)
  }

  return Array.from(groups.values())
    .sort((left, right) => {
      if (right.count !== left.count) return right.count - left.count
      return Date.parse(right.latestAt || '') - Date.parse(left.latestAt || '')
    })
    .slice(0, limit)
}

function buildFailureSignatureRunbookItem(failureSignatures, retryHint) {
  const topSignature = Array.isArray(failureSignatures) ? failureSignatures[0] : null
  if (!topSignature || topSignature.count < 2) return null

  const phaseHint = topSignature.phases?.length > 0
    ? `常見 phase：${topSignature.phases.join(' / ')}。`
    : ''

  return {
    key: 'recent-failure-signature',
    title: `最近 ${topSignature.count} 筆 failed 任務都像「${topSignature.label}」`,
    detail: `${phaseHint}這比較像同一條上游鏈路反覆失敗，不是單篇內容各自出錯。`.trim(),
    steps: [
      `先對照這組 signature 相關任務：${(topSignature.keywords || []).join('、') || '最近 failed 任務'}。`,
      '先確認這組錯誤是否都卡在同一個上游 phase，再決定是修模型、配圖、發布，還是回 BWS 後台重排。',
    ],
    references: retryHint?.href ? [retryHint.href] : [],
  }
}

function buildWorkerHistoryRunbookItem(workerSummary, workerHistory, workerFailureSignatures = []) {
  if (!workerSummary || workerSummary.consecutiveFailures < 2) return null

  const latestRun = workerHistory[0] || null
  const topSignature = workerFailureSignatures[0] || null
  const references = []
  if (latestRun?.meta?.upstreamPath) references.push(latestRun.meta.upstreamPath)
  if (latestRun?.meta?.upstreamStatus) references.push(`HTTP ${latestRun.meta.upstreamStatus}`)
  if (topSignature?.references?.length > 0) {
    for (const reference of topSignature.references) pushUniqueValue(references, reference, 3)
  }

  const signatureDetail = topSignature?.count >= 2
    ? `最近重複出現的 Worker 失敗 signature 是「${topSignature.label}」${topSignature.consecutiveCount >= 2 ? `，而且已連續 ${topSignature.consecutiveCount} 次` : ''}。`
    : null

  return {
    key: 'worker-consecutive-failures',
    title: `最近 ${workerSummary.consecutiveFailures} 次 Worker 觸發都失敗`,
    detail: signatureDetail || '這比較像同一條鏈路持續故障，不是單次偶發失敗。請先看最近幾次 Worker 結果是否都卡在同一個 HTTP 狀態或同一種錯誤 detail。',
    steps: [
      '先比對最近幾次 Worker 歷史是否都回同一個 HTTP 狀態或同一段 detail。',
      '若都是 401，優先檢查 `BWS_CRON_SECRET`；若都是 500 或 timeout，再查 BWS `autopen-worker` route 與 task worker log。',
    ],
    references,
  }
}

function buildQueueDiagnosisTask(task) {
  if (!task || typeof task !== 'object') return null

  return {
    id: firstNonEmptyString(task.id),
    keyword: firstNonEmptyString(task.keyword, '未命名任務') || '未命名任務',
    status: firstNonEmptyString(task.status),
    processing_phase: firstNonEmptyString(task.processing_phase),
    failure_phase: firstNonEmptyString(task.failure_phase),
    failure_at: normalizeTimestamp(task.failure_at),
    error_message: firstNonEmptyString(task.error_message),
    retry_count: toNumber(task.retry_count) ?? 0,
  }
}

function formatQueueDiagnosisTask(task) {
  if (!task) return null

  const hints = []

  if (task.processing_phase) hints.push(`phase：${task.processing_phase}`)
  if (task.failure_phase) hints.push(`failure：${task.failure_phase}`)
  if (task.retry_count > 0) hints.push(`已重試 ${task.retry_count} 次`)

  return hints.length > 0
    ? `${task.keyword}（${hints.join('・')}）`
    : task.keyword
}

function getQueueDiagnosisTaskIdentity(task) {
  const id = firstNonEmptyString(task?.id)
  if (id) return `id:${id}`

  const keyword = firstNonEmptyString(task?.keyword)
  return keyword ? `keyword:${keyword.toLowerCase()}` : null
}

function findTaskInTaskWindow(taskWindow, identity) {
  if (!taskWindow || !identity) return null

  for (const [bucket, items] of [
    ['queued', taskWindow.queuedCandidates],
    ['processing', taskWindow.processingCandidates],
    ['failed', taskWindow.failedCandidates],
  ]) {
    if (!Array.isArray(items)) continue

    const matchedTask = items.find(item => getQueueDiagnosisTaskIdentity(item) === identity)
    if (!matchedTask) continue

    return {
      bucket,
      task: buildQueueDiagnosisTask(matchedTask),
    }
  }

  return null
}

function buildPersistentTaskTimeline(identity, workerHistory = []) {
  const points = []

  for (const run of Array.isArray(workerHistory) ? [...workerHistory].reverse() : []) {
    const taskWindow = run?.taskWindow
    const matched = findTaskInTaskWindow(taskWindow, identity)
    if (!matched) continue

    points.push({
      bucket: matched.bucket,
      at: normalizeTimestamp(
        taskWindow?.capturedAt
        || run?.recordedAt
        || run?.completedAt
        || run?.triggeredAt,
      ),
      runStatus: firstNonEmptyString(run?.status),
      processing_phase: matched.task?.processing_phase || null,
      failure_phase: matched.task?.failure_phase || null,
      error_message: matched.task?.error_message || null,
    })
  }

  return points
}

function getTimelineTransitionPath(timeline = [], fallbackBucket = null) {
  const transitionPath = Array.isArray(timeline)
    ? timeline
      .map(point => point?.bucket)
      .filter((bucket, index, buckets) => bucket && (index === 0 || buckets[index - 1] !== bucket))
    : []

  if (transitionPath.length > 0) return transitionPath
  return fallbackBucket ? [fallbackBucket] : []
}

function buildPersistentTaskTimelineSummary(timeline = [], keyword = '該任務') {
  const transitionPath = getTimelineTransitionPath(timeline)
  if (transitionPath.length === 0) return null

  if (transitionPath.length <= 1) {
    return `「${keyword}」最近 ${timeline.length} 次 snapshot 都停在 ${transitionPath[0] || '同一個視窗'}。`
  }

  return `「${keyword}」最近 ${timeline.length} 次 snapshot 的 bucket 變化是 ${transitionPath.join(' -> ')}。`
}

function buildPersistentTaskStuckType(timeline = [], currentBucket = null) {
  const transitionPath = getTimelineTransitionPath(timeline, currentBucket)
  const lastBucket = transitionPath.at(-1) || currentBucket || null
  const hasQueued = transitionPath.includes('queued')
  const hasProcessing = transitionPath.includes('processing')
  const hasFailed = transitionPath.includes('failed')

  if (transitionPath.length <= 1) {
    if (lastBucket === 'queued') {
      return {
        key: 'queued-only',
        label: '長期待在 queued',
        summary: '任務最近多次都停在 queued，較像 Worker claim / 排程沒有真正接手。',
      }
    }

    if (lastBucket === 'processing') {
      return {
        key: 'processing-only',
        label: '長期待在 processing',
        summary: '任務最近多次都停在 processing，較像同一個處理 phase 卡住。',
      }
    }

    if (lastBucket === 'failed') {
      return {
        key: 'failed-only',
        label: '反覆停在 failed',
        summary: '任務最近多次都停在 failed，較像上游錯誤還沒有真正解除。',
      }
    }
  }

  if (transitionPath.length === 2 && transitionPath[0] === 'queued' && transitionPath[1] === 'processing') {
    return {
      key: 'queued-to-processing-stuck',
      label: 'queued -> processing 後卡住',
      summary: '任務有從 queued 被 Worker 撿起來，但推進到 processing 後就沒有再往前。',
    }
  }

  if (hasQueued && hasProcessing && !hasFailed) {
    return {
      key: 'queued-processing-bounce',
      label: 'queued / processing 來回震盪',
      summary: '任務在 queued 與 processing 間反覆切換，較像 claim 後又回補到佇列，或 phase 進度不穩定。',
    }
  }

  if (hasFailed && hasProcessing) {
    return {
      key: 'processing-failed-bounce',
      label: 'processing / failed 來回震盪',
      summary: '任務進到 processing 後又反覆掉回 failed，較像中途某個 phase 一直失敗。',
    }
  }

  if (hasFailed && hasQueued) {
    return {
      key: 'queued-failed-bounce',
      label: 'queued / failed 來回震盪',
      summary: '任務在 queued 與 failed 間反覆出現，較像重試後又撞到同一種錯誤。',
    }
  }

  return {
    key: 'multi-stage-bounce',
    label: '多階段反覆震盪',
    summary: '任務跨多個 bucket 反覆震盪，建議直接對照完整 task log 與上游錯誤紀錄。',
  }
}

function getPersistentTaskTypeWeight(stuckTypeKey) {
  switch (stuckTypeKey) {
    case 'processing-failed-bounce':
      return 6
    case 'queued-failed-bounce':
      return 5
    case 'queued-to-processing-stuck':
    case 'queued-processing-bounce':
    case 'processing-only':
      return 4
    case 'failed-only':
      return 3
    case 'multi-stage-bounce':
      return 2
    case 'queued-only':
      return 1
    default:
      return 0
  }
}

function getPersistentTaskErrorSignatureSource(value) {
  if (!value || typeof value !== 'object') return null

  return firstNonEmptyString(
    value.error_message,
    value.failure_phase,
    value.processing_phase,
  )
}

function getPersistentTaskExplicitErrorMessage(value) {
  if (!value || typeof value !== 'object') return null
  return firstNonEmptyString(value.error_message)
}

function upsertPersistentTaskSignatureGroup(groups, {
  key,
  label,
  latestAt = null,
  bucket = null,
  phase = null,
  reference = null,
  source = 'task',
  inferred = false,
}) {
  if (!key || !label) return

  const group = groups.get(key) || {
    key,
    label,
    count: 0,
    latestAt: null,
    buckets: [],
    phases: [],
    references: [],
    source,
    inferred,
  }

  group.count += 1
  group.latestAt = group.latestAt || normalizeTimestamp(latestAt)
  pushUniqueValue(group.buckets, firstNonEmptyString(bucket), 3)
  pushUniqueValue(group.phases, firstNonEmptyString(phase), 3)
  pushUniqueValue(group.references, firstNonEmptyString(reference), 3)
  groups.set(key, group)
}

function normalizePersistentTaskEvidenceValue(value) {
  const normalized = trimText(value, 180)
  return normalized ? normalized.toLowerCase() : null
}

function collectPersistentTaskEvidencePhases(task) {
  const phases = []
  if (!task || typeof task !== 'object') return phases

  pushUniqueValue(phases, firstNonEmptyString(task.failure_phase, task.processing_phase), 6)

  for (const point of Array.isArray(task.timeline) ? task.timeline : []) {
    pushUniqueValue(phases, firstNonEmptyString(point?.failure_phase, point?.processing_phase), 6)
  }

  return phases
}

function collectPersistentTaskEvidenceBuckets(task) {
  const buckets = []
  if (!task || typeof task !== 'object') return buckets

  pushUniqueValue(buckets, firstNonEmptyString(task.currentBucket), 6)

  if (Array.isArray(task.matchedBuckets)) {
    for (const bucket of task.matchedBuckets) pushUniqueValue(buckets, firstNonEmptyString(bucket), 6)
  }

  for (const point of Array.isArray(task.timeline) ? task.timeline : []) {
    pushUniqueValue(buckets, firstNonEmptyString(point?.bucket), 6)
  }

  return buckets
}

function buildPersistentTaskSignatureConsistency(signature, task) {
  const defaultConsistency = {
    consistency: 'weak',
    consistencyLabel: 'bucket / phase 一致性弱',
    consistencySummary: '目前 bucket / phase 跟這個 signature 的對位較弱，先把它當提示，不要直接當定論。',
    bucketMatches: [],
    phaseMatches: [],
  }

  if (!signature || typeof signature !== 'object' || !task || typeof task !== 'object') {
    return defaultConsistency
  }

  const bucketContext = new Set(
    collectPersistentTaskEvidenceBuckets(task)
      .map(bucket => firstNonEmptyString(bucket))
      .filter(Boolean),
  )
  const phaseContext = new Set(
    collectPersistentTaskEvidencePhases(task)
      .map(normalizePersistentTaskEvidenceValue)
      .filter(Boolean),
  )

  const bucketMatches = (Array.isArray(signature.buckets) ? signature.buckets : [])
    .map(bucket => firstNonEmptyString(bucket))
    .filter(bucket => bucket && bucketContext.has(bucket))
  const phaseMatches = (Array.isArray(signature.phases) ? signature.phases : [])
    .map(phase => trimText(phase, 180))
    .filter(phase => phase && phaseContext.has(normalizePersistentTaskEvidenceValue(phase)))

  if (bucketMatches.length > 0 && phaseMatches.length > 0) {
    return {
      consistency: 'strong',
      consistencyLabel: 'bucket / phase 高度一致',
      consistencySummary: `目前卡點的 bucket（${bucketMatches.join(' / ')}）與 phase（${phaseMatches.join(' / ')}）都和這個 signature 對得上。`,
      bucketMatches,
      phaseMatches,
    }
  }

  if (phaseMatches.length > 0) {
    return {
      consistency: 'partial',
      consistencyLabel: 'phase 一致、bucket 待確認',
      consistencySummary: `目前至少 phase（${phaseMatches.join(' / ')}）跟這個 signature 一致，但 bucket 還需要更多樣本確認。`,
      bucketMatches,
      phaseMatches,
    }
  }

  if (bucketMatches.length > 0) {
    return {
      consistency: 'partial',
      consistencyLabel: 'bucket 一致、phase 待確認',
      consistencySummary: `目前至少 bucket（${bucketMatches.join(' / ')}）跟這個 signature 一致，但 phase 還不夠明確。`,
      bucketMatches,
      phaseMatches,
    }
  }

  return defaultConsistency
}

function buildPersistentTaskTimelineStability(task) {
  const defaultStability = {
    timelineStability: 'weak',
    timelineStabilityLabel: 'timeline 穩定度低',
    timelineStabilitySummary: '目前 snapshot 還不夠多，timeline 只能當輔助訊號。',
  }

  if (!task || typeof task !== 'object') return defaultStability

  const timeline = Array.isArray(task.timeline) ? task.timeline : []
  const transitionPath = getTimelineTransitionPath(timeline, task.currentBucket)

  if (timeline.length >= 2 && transitionPath.length <= 1) {
    return {
      timelineStability: 'strong',
      timelineStabilityLabel: 'timeline 高度穩定',
      timelineStabilitySummary: `最近 ${timeline.length} 次 snapshot 都維持同一個 bucket 模式，timeline 很穩定。`,
    }
  }

  if (timeline.length >= 2 && transitionPath.length <= 2) {
    return {
      timelineStability: 'medium',
      timelineStabilityLabel: 'timeline 模式穩定',
      timelineStabilitySummary: `最近 ${timeline.length} 次 snapshot 仍維持固定的 ${transitionPath.join(' -> ')} 模式。`,
    }
  }

  return defaultStability
}

function buildPersistentTaskRecentFailureConsistency(signature, matchingFailures = []) {
  const normalizedLabel = normalizePersistentTaskEvidenceValue(signature?.label)
  const normalizedPhases = new Set(
    (Array.isArray(signature?.phases) ? signature.phases : [])
      .map(normalizePersistentTaskEvidenceValue)
      .filter(Boolean),
  )

  let explicitMatches = 0
  let phaseMatches = 0

  for (const task of Array.isArray(matchingFailures) ? matchingFailures : []) {
    const explicitLabel = normalizePersistentTaskEvidenceValue(getPersistentTaskExplicitErrorMessage(task))
    if (normalizedLabel && explicitLabel === normalizedLabel) explicitMatches += 1

    const phase = normalizePersistentTaskEvidenceValue(firstNonEmptyString(task?.failure_phase, task?.processing_phase))
    if (phase && normalizedPhases.has(phase)) phaseMatches += 1
  }

  if (explicitMatches > 0) {
    return {
      recentFailureConsistency: 'strong',
      recentFailureConsistencyLabel: 'recent failure 高度一致',
      recentFailureConsistencySummary: `recent failure history 裡有 ${explicitMatches} 筆和這個 signature 相同的錯誤。`,
    }
  }

  if (phaseMatches > 0) {
    return {
      recentFailureConsistency: 'partial',
      recentFailureConsistencyLabel: 'recent failure phase 一致',
      recentFailureConsistencySummary: `recent failure history 裡有 ${phaseMatches} 筆 phase 和這個 signature 對得上。`,
    }
  }

  return {
    recentFailureConsistency: 'none',
    recentFailureConsistencyLabel: 'recent failure 尚未對位',
    recentFailureConsistencySummary: 'recent failure history 暫時沒有提供額外的同類錯誤對位。',
  }
}

function buildPersistentTaskSignatureEvidence(signature, task = null, matchingFailures = []) {
  if (!signature || typeof signature !== 'object') return null

  const consistency = buildPersistentTaskSignatureConsistency(signature, task)
  const timelineStability = buildPersistentTaskTimelineStability(task)
  const recentFailureConsistency = buildPersistentTaskRecentFailureConsistency(signature, matchingFailures)
  let evidenceScore = 1
  let evidenceSummary = ''

  if (signature.source === 'task') {
    evidenceScore = signature.count >= 2 ? 4 : 3
    evidenceSummary = `根據 ${signature.count} 次 task 自身錯誤訊息整理。`
  } else if (signature.source === 'worker') {
    evidenceScore = signature.count >= 2 ? 2 : 1
    if (consistency.consistency === 'strong') evidenceScore += 1
    evidenceSummary = `任務本身沒有明確錯誤訊息，這是根據 ${signature.count} 次帶到同一個 task 的 Worker failures 補推。`
  } else {
    evidenceScore = 1
    if (consistency.consistency === 'strong') evidenceScore += 1
    evidenceSummary = `目前只根據 ${signature.count} 次 phase 訊號推估，還沒有明確錯誤訊息。`
  }

  if (timelineStability.timelineStability === 'strong') evidenceScore += 1
  if (recentFailureConsistency.recentFailureConsistency === 'strong') evidenceScore += 1

  evidenceScore = Math.max(1, Math.min(5, evidenceScore))

  const confidence = evidenceScore >= 4 ? 'high' : evidenceScore >= 2 ? 'medium' : 'low'
  const phaseHint = signature.phases?.length > 0
    ? ` 常見 phase：${signature.phases.join(' / ')}。`
    : ''
  const referenceHint = signature.references?.length > 0
    ? ` 參考：${signature.references.join(' / ')}。`
    : ''

  return {
    confidence,
    confidenceLabel: confidence === 'high' ? '高可信度' : confidence === 'medium' ? '中可信度' : '低可信度',
    evidenceScore,
    ...consistency,
    ...timelineStability,
    ...recentFailureConsistency,
    evidenceSummary: `${evidenceSummary} ${consistency.consistencySummary} ${timelineStability.timelineStabilitySummary} ${recentFailureConsistency.recentFailureConsistencySummary}${phaseHint}${referenceHint}`.trim(),
  }
}

function selectTopPersistentTaskSignature(groups) {
  const topSignature = Array.from(groups.values())
    .sort((left, right) => {
      if (right.count !== left.count) return right.count - left.count
      return Date.parse(right.latestAt || '') - Date.parse(left.latestAt || '')
    })
    .at(0) || null

  if (!topSignature) return null

  return topSignature
}

function buildPersistentTaskWorkerFallbackSignature(identity, workerHistory = []) {
  if (!identity) return null

  const groups = new Map()
  const seenEntries = new Set()

  for (const run of Array.isArray(workerHistory) ? workerHistory : []) {
    if (run?.status !== 'error') continue

    const matched = findTaskInTaskWindow(run?.taskWindow, identity)
    if (!matched) continue

    const label = trimText(getWorkerFailureSignatureSource(run), 180)
    const key = normalizeErrorSignatureKey(label)
    if (!key) continue

    const seenKey = `${key}|${normalizeTimestamp(run?.recordedAt || run?.completedAt || run?.triggeredAt) || ''}|worker`
    if (seenEntries.has(seenKey)) continue
    seenEntries.add(seenKey)

    upsertPersistentTaskSignatureGroup(groups, {
      key,
      label,
      latestAt: run?.recordedAt || run?.completedAt || run?.triggeredAt,
      bucket: matched.bucket,
      phase: matched.task?.failure_phase || matched.task?.processing_phase,
      reference: firstNonEmptyString(
        run?.meta?.upstreamPath,
        Number.isFinite(Number(run?.meta?.upstreamStatus)) ? `HTTP ${Number(run.meta.upstreamStatus)}` : null,
      ),
      source: 'worker',
      inferred: true,
    })
  }

  return selectTopPersistentTaskSignature(groups)
}

function buildPersistentTaskErrorSignature(identity, timeline = [], failureHistory = [], workerHistory = []) {
  if (!identity) return null

  const explicitGroups = new Map()
  const phaseGroups = new Map()
  const seenEntries = new Set()

  for (const point of Array.isArray(timeline) ? timeline : []) {
    const explicitLabel = trimText(getPersistentTaskExplicitErrorMessage(point), 180)
    const explicitKey = normalizeErrorSignatureKey(explicitLabel)
    if (explicitKey) {
      const seenKey = `${explicitKey}|${point.at || ''}|timeline|explicit`
      if (!seenEntries.has(seenKey)) {
        seenEntries.add(seenKey)
        upsertPersistentTaskSignatureGroup(explicitGroups, {
          key: explicitKey,
          label: explicitLabel,
          latestAt: point.at,
          bucket: point.bucket,
          phase: firstNonEmptyString(point.failure_phase, point.processing_phase),
          source: 'task',
        })
      }
    }

    const label = trimText(firstNonEmptyString(point.failure_phase, point.processing_phase), 180)
    const key = normalizeErrorSignatureKey(label)
    if (!key) continue

    const seenKey = `${key}|${point.at || ''}|timeline|phase`
    if (seenEntries.has(seenKey)) continue
    seenEntries.add(seenKey)

    upsertPersistentTaskSignatureGroup(phaseGroups, {
      key,
      label,
      latestAt: point.at,
      bucket: point.bucket,
      phase: firstNonEmptyString(point.failure_phase, point.processing_phase),
      source: 'task-phase',
    })
  }

  for (const task of Array.isArray(failureHistory) ? failureHistory : []) {
    if (getQueueDiagnosisTaskIdentity(task) !== identity) continue

    const explicitLabel = trimText(getPersistentTaskExplicitErrorMessage(task), 180)
    const explicitKey = normalizeErrorSignatureKey(explicitLabel)
    if (explicitKey) {
      const seenKey = `${explicitKey}|${normalizeTimestamp(task.failure_at) || ''}|history|explicit`
      if (!seenEntries.has(seenKey)) {
        seenEntries.add(seenKey)
        upsertPersistentTaskSignatureGroup(explicitGroups, {
          key: explicitKey,
          label: explicitLabel,
          latestAt: task.failure_at || task.completed_at || task.updated_at || task.created_at,
          bucket: 'failed',
          phase: firstNonEmptyString(task.failure_phase, task.processing_phase),
          source: 'task',
        })
      }
    }

    const label = trimText(firstNonEmptyString(task.failure_phase, task.processing_phase), 180)
    const key = normalizeErrorSignatureKey(label)
    if (!key) continue

    const seenKey = `${key}|${normalizeTimestamp(task.failure_at) || ''}|history|phase`
    if (seenEntries.has(seenKey)) continue
    seenEntries.add(seenKey)

    upsertPersistentTaskSignatureGroup(phaseGroups, {
      key,
      label,
      latestAt: task.failure_at || task.completed_at || task.updated_at || task.created_at,
      bucket: 'failed',
      phase: firstNonEmptyString(task.failure_phase, task.processing_phase),
      source: 'task-phase',
    })
  }

  const directSignature = selectTopPersistentTaskSignature(explicitGroups)
  if (directSignature) return directSignature

  const workerFallbackSignature = buildPersistentTaskWorkerFallbackSignature(identity, workerHistory)
  if (workerFallbackSignature) return workerFallbackSignature

  return selectTopPersistentTaskSignature(phaseGroups)
}

function buildPersistentTaskRootCausePattern(task) {
  if (!task?.stuckTypeLabel) return null

  const topErrorSignature = task.topErrorSignature || null
  const label = topErrorSignature?.label
    ? `${task.stuckTypeLabel} + ${topErrorSignature.label}`
    : task.stuckTypeLabel
  const detailParts = []

  if (task.stuckTypeSummary) detailParts.push(task.stuckTypeSummary)
  if (topErrorSignature?.label) {
    const phaseHint = topErrorSignature.phases?.length > 0
      ? ` 常見 phase：${topErrorSignature.phases.join(' / ')}。`
      : ''
    detailParts.push(
      topErrorSignature.inferred
        ? `任務本身沒有明確錯誤訊息，改從最近對應的 Worker 失敗補推「${topErrorSignature.label}」${topErrorSignature.count > 1 ? `（${topErrorSignature.count} 次）` : ''}。${phaseHint}`.trim()
        : `最近重複錯誤是「${topErrorSignature.label}」${topErrorSignature.count > 1 ? `（${topErrorSignature.count} 次）` : ''}。${phaseHint}`.trim(),
    )
  }

  return {
    label,
    detail: detailParts.join(' ').trim() || task.timelineSummary || null,
  }
}

function classifyPersistentTaskSignature(task) {
  const signatureLabel = String(task?.topErrorSignature?.label || '').toLowerCase()
  const phases = Array.isArray(task?.topErrorSignature?.phases)
    ? task.topErrorSignature.phases.map(phase => String(phase || '').toLowerCase())
    : []

  if (
    signatureLabel.includes('unsplash')
    || signatureLabel.includes('quota')
    || signatureLabel.includes('rate limit')
    || phases.some(phase => phase.includes('配圖'))
  ) {
    return 'image-provider'
  }

  if (
    signatureLabel.includes('unauthorized')
    || signatureLabel.includes('invalid api key')
    || signatureLabel.includes('forbidden')
    || signatureLabel.includes('token')
    || signatureLabel.includes('secret')
    || phases.some(phase => phase.includes('授權'))
  ) {
    return 'auth'
  }

  if (
    signatureLabel.includes('publisher')
    || signatureLabel.includes('payload')
    || signatureLabel.includes('slug')
    || signatureLabel.includes('validation')
    || phases.some(phase => phase.includes('發布'))
  ) {
    return 'publish'
  }

  return 'generic'
}

function buildPersistentTaskRunbookFocus(task, signatureClass) {
  if (!task || typeof task !== 'object') return null

  if (
    signatureClass === 'publish'
    && (task.stuckType === 'processing-only' || task.stuckType === 'queued-to-processing-stuck')
  ) {
    return {
      key: 'publish-validation-stuck',
      label: '發布 validation 卡關',
      detail: '任務看起來已推進到發布 phase，但被 payload / slug / validation 規則擋住，還沒真正完成發布。',
    }
  }

  if (
    signatureClass === 'publish'
    && task.stuckType === 'processing-failed-bounce'
  ) {
    return {
      key: 'publish-validation-bounce',
      label: '發布失敗重試循環',
      detail: '任務反覆進到 processing 又掉回失敗，較像發布 payload 修正前就被不斷重試。',
    }
  }

  if (
    signatureClass === 'image-provider'
    && task.stuckType === 'queued-failed-bounce'
  ) {
    return {
      key: 'image-quota-bounce',
      label: '配圖 quota 重試循環',
      detail: '任務每次重試都又回到相同的配圖供應商限制，根因多半還在 Unsplash quota / API key。',
    }
  }

  if (
    signatureClass === 'image-provider'
    && (task.stuckType === 'processing-only' || task.stuckType === 'processing-failed-bounce')
  ) {
    return {
      key: 'image-phase-stuck',
      label: '配圖 phase 卡住',
      detail: '任務多半卡在配圖流程本身，優先查圖片供應商限制、素材取回與配圖 phase log。',
    }
  }

  if (
    signatureClass === 'auth'
    && (task.stuckType === 'queued-only' || task.stuckType === 'queued-failed-bounce')
  ) {
    return {
      key: 'auth-gate',
      label: '授權閘門阻塞',
      detail: '任務還沒真正往前推進，較像在進入上游鏈路前就被 API key / secret / token 擋住。',
    }
  }

  if (
    signatureClass === 'auth'
    && (task.stuckType === 'processing-only' || task.stuckType === 'processing-failed-bounce')
  ) {
    return {
      key: 'auth-midflow-failure',
      label: '中途授權失敗',
      detail: '任務已進到處理流程，但在某個需要授權的上游步驟被拒絕，較像 token 過期或 service auth 漏接。',
    }
  }

  return null
}

function buildPersistentTaskFocusSpecificSteps(task, focus) {
  if (!task || typeof task !== 'object' || !focus?.key) return []

  switch (focus.key) {
    case 'publish-validation-stuck':
      return [
        '先抓一筆代表任務，對照 article slug、payload schema 與必填欄位，確認是不是在發布前的 validation 就被擋下來。',
        '若最近 worker detail 都是 validation / payload 類訊息，先修 schema 或 slug，再只重試單一代表任務，不要先重排整批。',
      ]
    case 'publish-validation-bounce':
      return [
        '先比對每次 bounce 前後送出的 payload 是否其實沒有變；若沒變，代表同一份無效 payload 正在被反覆重送。',
        '先停掉這批任務的重試循環，修正發布 payload / validation 規則後，再恢復重試。',
      ]
    case 'image-quota-bounce':
      return [
        '先確認 Unsplash quota / rate limit 是否真的恢復；若 failure history 仍集中在配圖 phase，就不要先重排整批任務。',
        '先補圖片供應商額度、換圖源或等 quota reset，再重試一筆代表任務確認這條鏈路已解除。',
      ]
    case 'image-phase-stuck':
      return [
        '先檢查配圖 phase 的素材取回、圖片轉換與供應商回應時間，確認不是卡在單一步驟。',
        '若同一個 phase 長時間沒有往前，優先查圖片供應商限制與配圖 phase log，而不是先懷疑文章生成。',
      ]
    case 'auth-gate':
      return [
        '先確認是哪一路上游在 401/403：AutoPen stats/tasks、Worker，還是外部供應商；不要一次改所有 key。',
        '若任務還停在 queued，代表多半在真正處理前就被擋住，先核對對應 service 的 API key / secret / token。',
      ]
    case 'auth-midflow-failure':
      return [
        '先對照目前 processing phase 需要授權的上游步驟，確認是不是 token 過期或 service auth 漏接。',
        '若只有中途 phase 失敗，優先修該 phase 的授權，再回頭確認 queued / stats 其他鏈路是否其實正常。',
      ]
    default:
      return []
  }
}

function buildPersistentTaskRunbookSteps(task) {
  if (!task || typeof task !== 'object') return []

  const signatureClass = classifyPersistentTaskSignature(task)
  const focus = buildPersistentTaskRunbookFocus(task, signatureClass)
  const references = []
  const steps = []

  if (task.topErrorSignature?.label) {
    references.push(
      task.topErrorSignature.inferred
        ? `worker-signature：${task.topErrorSignature.label}`
        : `signature：${task.topErrorSignature.label}`,
    )
  }

  if (Array.isArray(task.topErrorSignature?.references)) {
    for (const reference of task.topErrorSignature.references) pushUniqueValue(references, reference, 3)
  }

  if (task.topErrorSignature?.inferred) {
    steps.push(
      task.topErrorSignature.confidence === 'low'
        ? '這組 signature 目前屬於低可信度補推，先對照對應 worker run 的 taskWindow 與 detail，避免把鄰近失敗誤配成同一個根因。'
        : '這組 signature 是由 matching Worker failures 補推，先對照對應 worker run 的 taskWindow 與 detail，確認不是鄰近失敗誤配。',
    )
  }

  if (focus?.label) {
    steps.push(`這批任務目前最像「${focus.label}」，先沿著這個焦點排查，不要同時散查多條鏈路。`)
  }

  const focusSpecificSteps = buildPersistentTaskFocusSpecificSteps(task, focus)
  if (focusSpecificSteps.length > 0) {
    steps.push(...focusSpecificSteps)
  }

  if (task.timeline?.length > 0) {
    const timelineText = task.timeline
      .map(point => firstNonEmptyString(point.bucket))
      .filter(Boolean)
      .join(' -> ')

    if (timelineText) references.push(`timeline：${timelineText}`)
  }

  if (task.stuckType === 'queued-only') {
    steps.push(
      `先確認 ${task.keyword} 這類任務是否一直沒有被 Worker claim；若最近幾次 run 的 processed 很低，優先查 BWS worker claim / cron。`,
    )
  } else if (
    task.stuckType === 'processing-only'
    || task.stuckType === 'queued-to-processing-stuck'
  ) {
    steps.push(
      `先回頭看 ${task.keyword} 最近停住的 processing phase，確認是不是同一段 phase 一直沒有完成。`,
    )
  } else if (
    task.stuckType === 'queued-failed-bounce'
    || task.stuckType === 'processing-failed-bounce'
  ) {
    steps.push(
      `先把 ${task.keyword} 這類 bounce 任務當成同一條錯誤鏈路，確認重試前是否已先解除根因；否則只會在 queued / failed 間反覆來回。`,
    )
  }

  if (signatureClass === 'image-provider') {
    steps.push('這組 pattern 比較像配圖來源或圖片額度問題，先檢查 Unsplash / 圖片供應商 quota、API key 與配圖 phase log。')
    steps.push('若 quota 或授權還沒恢復，不要急著重試；先修供應商限制，再回 BWS 後台重排失敗任務。')
    return { focus, steps, references }
  }

  if (signatureClass === 'auth') {
    steps.push('這組 pattern 比較像授權問題，先核對 openclaw-office 與 BWS 的 API key / secret 是否一致，再看上游 401/403。')
    steps.push('若 Worker 與 tasks/stats 只有其中一路授權失敗，優先修那一路的 service auth，不要先重跑整批任務。')
    return { focus, steps, references }
  }

  if (signatureClass === 'publish') {
    steps.push('這組 pattern 比較像發布 payload 或欄位驗證失敗，先對照 article slug、payload schema 與發布 phase 的錯誤訊息。')
    steps.push('先修 payload / validation 問題，再重試單一代表任務確認發布鏈路恢復。')
    return { focus, steps, references }
  }

  steps.push('若目前沒有明顯供應商或授權 signature，先對照這批任務的 phase 與最近 Worker detail，縮小到同一條上游鏈路再處理。')
  return { focus, steps, references }
}

function buildWorkerQueueDiagnosis(workerRun, tasks, recentFailures, summary) {
  if (!workerRun || workerRun.status !== 'success') return null
  if (workerRun.queueImpact?.status !== 'unchanged') return null
  if ((summary?.queued || 0) <= 0) return null

  const triggeredAt = Date.parse(workerRun.triggeredAt || workerRun.completedAt || '')
  const queuedCandidates = tasks
    .filter(task => task?.status === 'queued')
    .map(buildQueueDiagnosisTask)
    .filter(Boolean)
    .slice(0, 3)
  const processingCandidates = tasks
    .filter(task => task?.status === 'processing')
    .map(buildQueueDiagnosisTask)
    .filter(Boolean)
    .slice(0, 3)
  const failureCandidates = recentFailures
    .filter(task => {
      if (!Number.isFinite(triggeredAt)) return true

      const failureAt = Date.parse(task?.failure_at || task?.completed_at || task?.updated_at || task?.created_at || '')
      return !Number.isFinite(failureAt) || failureAt >= triggeredAt
    })
    .map(buildQueueDiagnosisTask)
    .filter(Boolean)
    .slice(0, 3)

  const suspectedCause = processingCandidates.length > 0
    ? 'processing-stuck'
    : failureCandidates.length > 0
      ? 'recent-failures'
      : queuedCandidates.length > 0
        ? 'queued-still-waiting'
        : 'window-miss'

  const summaryMessage = suspectedCause === 'processing-stuck'
    ? `最近視窗內仍有 ${processingCandidates.length} 筆 processing 任務，最像是某個 phase 卡住，queue 還沒真正往前推。`
    : suspectedCause === 'recent-failures'
      ? `Worker 觸發後附近又出現 ${failureCandidates.length} 筆 failed 任務，可能是 queue 被新的失敗補上。`
      : suspectedCause === 'queued-still-waiting'
        ? `最近視窗內仍有 ${queuedCandidates.length} 筆 queued 任務停在佇列，表示這次 Worker 沒有把它們往前推。`
        : '目前 recent tasks 視窗內看不出哪一批 task 沒往前推，可能需要回 BWS 後台追更完整歷史。'

  return {
    status: 'queue-unchanged',
    suspectedCause,
    summary: summaryMessage,
    queuedCandidates,
    processingCandidates,
    failedCandidates: failureCandidates,
  }
}

function buildPersistentQueueDiagnosis(queueDiagnosis, workerHistory = [], failureHistory = []) {
  if (!queueDiagnosis) return null

  const history = Array.isArray(workerHistory)
    ? workerHistory.filter(run => run?.taskWindow)
    : []
  const persistentCandidates = []

  for (const [currentBucket, candidates] of [
    ['queued', queueDiagnosis.queuedCandidates],
    ['processing', queueDiagnosis.processingCandidates],
    ['failed', queueDiagnosis.failedCandidates],
  ]) {
    for (const task of candidates || []) {
      const identity = getQueueDiagnosisTaskIdentity(task)
      if (!identity) continue

      const bucketMatches = new Set()
      let seenInRuns = 0

      for (const run of history) {
        const taskWindow = run.taskWindow || {}
        const matchedBucket = [
          ['queued', taskWindow.queuedCandidates],
          ['processing', taskWindow.processingCandidates],
          ['failed', taskWindow.failedCandidates],
        ].find(([, items]) => Array.isArray(items) && items.some(item => getQueueDiagnosisTaskIdentity(item) === identity))?.[0]

        if (!matchedBucket) continue

        seenInRuns += 1
        bucketMatches.add(matchedBucket)
      }

      if (seenInRuns < 2) continue

      const timeline = buildPersistentTaskTimeline(identity, history)
      const timelineSummary = buildPersistentTaskTimelineSummary(timeline, task.keyword)
      const stuckType = buildPersistentTaskStuckType(timeline, currentBucket)
      const matchingFailures = Array.isArray(failureHistory)
        ? failureHistory.filter(item => getQueueDiagnosisTaskIdentity(item) === identity)
        : []
      const matchedBuckets = Array.from(bucketMatches)
      const rawTopErrorSignature = buildPersistentTaskErrorSignature(identity, timeline, failureHistory, workerHistory)
      const topErrorSignature = rawTopErrorSignature
        ? {
            ...rawTopErrorSignature,
            ...buildPersistentTaskSignatureEvidence(rawTopErrorSignature, {
              ...task,
              currentBucket,
              matchedBuckets,
              timeline,
              stuckType: stuckType.key,
            }, matchingFailures),
          }
        : null
      const rootCausePattern = buildPersistentTaskRootCausePattern({
        ...task,
        stuckTypeLabel: stuckType.label,
        stuckTypeSummary: stuckType.summary,
        timelineSummary,
        topErrorSignature,
      })
      const patternRunbook = buildPersistentTaskRunbookSteps({
        ...task,
        timeline,
        stuckType: stuckType.key,
        topErrorSignature,
      })

      persistentCandidates.push({
        ...task,
        currentBucket,
        seenInRuns,
        matchedBuckets,
        timeline,
        timelineSummary,
        stuckType: stuckType.key,
        stuckTypeLabel: stuckType.label,
        stuckTypeSummary: stuckType.summary,
        topErrorSignature,
        rootCausePatternLabel: rootCausePattern?.label || null,
        rootCausePatternDetail: rootCausePattern?.detail || null,
        patternRunbookFocusKey: patternRunbook.focus?.key || null,
        patternRunbookFocusLabel: patternRunbook.focus?.label || null,
        patternRunbookFocusDetail: patternRunbook.focus?.detail || null,
        patternRunbookSteps: patternRunbook.steps,
      })
    }
  }

  if (persistentCandidates.length === 0) return null

  persistentCandidates.sort((left, right) => {
    if (right.seenInRuns !== left.seenInRuns) return right.seenInRuns - left.seenInRuns
    const typeWeightDelta = getPersistentTaskTypeWeight(right.stuckType) - getPersistentTaskTypeWeight(left.stuckType)
    if (typeWeightDelta !== 0) return typeWeightDelta
    return (left.keyword || '').localeCompare(right.keyword || '', 'zh-Hant')
  })

  const topCandidate = persistentCandidates[0]

  return {
    summary: topCandidate.rootCausePatternLabel
      ? `像「${topCandidate.keyword}」這類任務目前屬於「${topCandidate.rootCausePatternLabel}」型。${topCandidate.rootCausePatternDetail || topCandidate.timelineSummary || ''}`.trim()
      : topCandidate.stuckTypeLabel
        ? `像「${topCandidate.keyword}」這類任務目前屬於「${topCandidate.stuckTypeLabel}」型。${topCandidate.stuckTypeSummary || topCandidate.timelineSummary || ''}`.trim()
      : topCandidate.timelineSummary
        || `像「${topCandidate.keyword}」這類任務，已連續出現在最近 ${topCandidate.seenInRuns} 次 Worker snapshot，較像真的卡住，不是單次統計延遲。`,
    candidates: persistentCandidates.slice(0, 3),
  }
}

function buildWorkerQueueImpactRunbookItem(workerRun, summary, queueDiagnosis) {
  if (!workerRun || workerRun.status !== 'success') return null
  if (workerRun.queueImpact?.status !== 'unchanged') return null
  if ((summary?.queued || 0) <= 0) return null

  const beforeQueued = workerRun.queueImpact?.before?.queued
  const afterQueued = workerRun.queueImpact?.after?.queued
  const steps = [
    '先比對最近一次 Worker run 的 queue impact 與目前 summary，確認 queued 是否真的沒有下降。',
  ]

  if (queueDiagnosis?.processingCandidates?.length > 0) {
    steps.push(
      `最近視窗內仍在 processing 的任務：${queueDiagnosis.processingCandidates.map(formatQueueDiagnosisTask).join('、')}`,
    )
  }

  if (queueDiagnosis?.failedCandidates?.length > 0) {
    steps.push(
      `Worker 觸發後附近出現的 failed 任務：${queueDiagnosis.failedCandidates.map(formatQueueDiagnosisTask).join('、')}`,
    )
  }

  if (queueDiagnosis?.queuedCandidates?.length > 0) {
    steps.push(
      `仍停在 queued 的任務：${queueDiagnosis.queuedCandidates.map(formatQueueDiagnosisTask).join('、')}`,
    )
  }

  if (queueDiagnosis?.persistent?.candidates?.length > 0) {
    steps.push(
      `跨多次 Worker snapshot 都還在視窗內的任務：${queueDiagnosis.persistent.candidates.map(task => `${task.keyword}（${task.seenInRuns} 次）`).join('、')}`,
    )
  }

  if ((workerRun.processed || 0) === 0) {
    steps.push('若 processed 是 0 但 queued 仍大於 0，優先檢查 BWS worker claim / query 條件是否漏抓 queued 任務。')
  }

  return {
    key: 'worker-queue-unchanged',
    title: '最近一次 Worker 跑完，但佇列沒有明顯下降',
    detail: `Worker 回報處理 ${workerRun.processed || 0} 筆，但 queued 仍維持 ${beforeQueued ?? '未知'} -> ${afterQueued ?? '未知'}。${queueDiagnosis?.summary || '這可能代表上游統計延遲，或 Worker 沒有真正把待處理任務往前推。'}`,
    steps,
    references: workerRun.meta?.upstreamPath ? [workerRun.meta.upstreamPath] : [],
  }
}

function buildPersistentQueueDiagnosisRunbookItem(queueDiagnosis) {
  if (!queueDiagnosis?.persistent?.candidates?.length) return null

  const topCandidate = queueDiagnosis.persistent.candidates[0]
  const patternRunbook = buildPersistentTaskRunbookSteps(topCandidate)

  return {
    key: 'persistent-stuck-tasks',
    title: topCandidate.patternRunbookFocusLabel
      ? `${topCandidate.patternRunbookFocusLabel}：最近 ${topCandidate.seenInRuns} 次 Worker snapshot 都還看到同一批任務`
      : `最近 ${topCandidate.seenInRuns} 次 Worker snapshot 都還看到同一批任務`,
    detail: topCandidate.rootCausePatternLabel
      ? `「${topCandidate.keyword}」目前屬於「${topCandidate.rootCausePatternLabel}」型。${topCandidate.rootCausePatternDetail || topCandidate.timelineSummary || ''}`.trim()
      : topCandidate.stuckTypeLabel
      ? `「${topCandidate.keyword}」目前屬於「${topCandidate.stuckTypeLabel}」型。${topCandidate.stuckTypeSummary || topCandidate.timelineSummary || ''}`.trim()
      : topCandidate.timelineSummary || queueDiagnosis.persistent.summary,
    steps: [
      `先優先檢查 ${topCandidate.keyword} 這類跨多次 snapshot 都還在的任務，確認是不是同一個 processing phase 或同一種上游錯誤反覆卡住。`,
      ...patternRunbook.steps,
      '若這些任務跨多次 snapshot 都沒有離開 queued / processing / failed 視窗，較像真正 stuck task，而不是單次統計延遲。',
    ],
    references: patternRunbook.references,
  }
}

export function buildAutopenOverview({
  statsResult,
  tasksResult,
  failureHistoryResult = null,
  workerRun = null,
  workerHistory = [],
  failureHistoryLimit = 10,
  retryHint = null,
  now = new Date().toISOString(),
}) {
  const tasks = extractTaskCollection(tasksResult)
  const failureHistory = failureHistoryResult?.ok
    ? extractTaskCollection(failureHistoryResult)
    : tasks.filter(task => task.status === 'failed').slice(0, failureHistoryLimit)
  const summary = normalizeAutopenStats(
    statsResult?.ok && statsResult?.data && typeof statsResult.data === 'object' ? statsResult.data : null,
    tasks,
  )
  const normalizedWorkerRun = normalizeAutopenWorkerState(workerRun)
  const normalizedWorkerHistory = normalizeAutopenWorkerHistory(workerHistory, {
    latest: normalizedWorkerRun,
  })
  const workerSummary = buildWorkerHistorySummary(normalizedWorkerHistory)
  const workerFailureSignatures = buildWorkerFailureSignatures(normalizedWorkerHistory)

  const segments = {
    stats: buildSyncSegment('統計', statsResult),
    tasks: buildSyncSegment('任務列表', tasksResult),
    failures: buildSyncSegment('失敗歷史', failureHistoryResult),
  }

  const sync = {
    ok: Object.values(segments).every(segment => segment?.ok),
    fetchedAt: now,
    segments,
  }

  sync.lastOkAt = Object.values(sync.segments)
    .map(segment => segment?.lastOkAt)
    .filter(Boolean)
    .sort()
    .at(-1) || null

  const recentFailures = failureHistory
    .slice(0, 5)
  const failureSignatures = buildFailureSignatures(recentFailures)
  const runbook = buildSyncRunbookItems(Object.values(sync.segments))
  const hasMoreFailureHistory = summary.failed > failureHistory.length
  const queueDiagnosisBase = buildWorkerQueueDiagnosis(normalizedWorkerRun, tasks, recentFailures, summary)
  const queueDiagnosis = queueDiagnosisBase
    ? {
        ...queueDiagnosisBase,
        persistent: buildPersistentQueueDiagnosis(queueDiagnosisBase, normalizedWorkerHistory, failureHistory),
      }
    : null

  if (summary.queued > 0 && summary.processing === 0) {
    runbook.push({
      key: 'worker-idle',
      title: '佇列有任務但 Worker 目前沒有在跑',
      detail: `現在還有 ${summary.queued} 筆 queued 任務，但 processing 是 0，優先驗證是不是排程沒接上。`,
      steps: [
        '先在 `/writer` 按一次「觸發 Worker」，觀察 queued 是否開始下降。',
        '若 worker proxy 失敗，再檢查 BWS_CRON_SECRET 與 `/api/cron/autopen-worker`。',
      ],
      references: ['/api/cron/autopen-worker'],
    })
  }

  if (recentFailures.length > 0) {
    const failureSignatureRunbookItem = buildFailureSignatureRunbookItem(failureSignatures, retryHint)
    if (failureSignatureRunbookItem) {
      runbook.push(failureSignatureRunbookItem)
    } else {
      runbook.push({
        key: 'recent-failures',
        title: `先看最近 ${recentFailures.length} 筆 failed 任務的共同 failure reason`,
        detail: '若多筆都卡在同一個 phase 或同類型錯誤，通常代表不是單篇內容問題，而是上游模型、配圖或發布鏈路一起出錯。',
        steps: [
          '先比對 error_message 與 failure phase 是否重複出現。',
          '若需要重排 failed 任務，目前仍要回 BWS `/admin/autopen` 後台處理，Office 先提供定位資訊。',
        ],
        references: retryHint?.href ? [retryHint.href] : [],
      })
    }
  }

  if (hasMoreFailureHistory) {
    runbook.push({
      key: 'failure-history-window',
      title: '失敗歷史已從 recent tasks 視窗獨立，但目前仍是最近一段視窗',
      detail: `現在控制台顯示最近 ${failureHistory.length} 筆 failed 任務；若統計顯示的 failed 總數更高，代表還有更早的失敗需要到完整後台補看。`,
      steps: [
        '先用控制台看最近失敗是否集中在同一種錯誤。',
        '若要往更早的 failed 任務追，先進 BWS `/admin/autopen` 後台拉完整歷史。',
      ],
      references: retryHint?.href ? [retryHint.href] : [],
    })
  }

  const workerRunbookItem = buildWorkerRunRunbookItem(normalizedWorkerRun)
  if (workerRunbookItem) runbook.unshift(workerRunbookItem)
  const persistentQueueDiagnosisRunbookItem = buildPersistentQueueDiagnosisRunbookItem(queueDiagnosis)
  if (persistentQueueDiagnosisRunbookItem) runbook.unshift(persistentQueueDiagnosisRunbookItem)
  const workerQueueImpactRunbookItem = buildWorkerQueueImpactRunbookItem(normalizedWorkerRun, summary, queueDiagnosis)
  if (workerQueueImpactRunbookItem) runbook.unshift(workerQueueImpactRunbookItem)
  const workerHistoryRunbookItem = buildWorkerHistoryRunbookItem(
    workerSummary,
    normalizedWorkerHistory,
    workerFailureSignatures,
  )
  if (workerHistoryRunbookItem) runbook.unshift(workerHistoryRunbookItem)

  const attention = workerSummary.consecutiveFailures >= 2
    ? {
        level: 'warning',
        title: `最近 ${workerSummary.consecutiveFailures} 次 Worker 觸發都失敗`,
        message: workerFailureSignatures[0]?.count >= 2
          ? `最近重複出現的 Worker 失敗 signature 是「${workerFailureSignatures[0].label}」。`
          : normalizedWorkerRun?.detail || '請先看最近多次 Worker 歷史與 runbook。',
      }
    : normalizedWorkerRun?.status === 'error'
    ? {
        level: 'warning',
        title: '最近一次 Worker 觸發失敗',
        message: normalizedWorkerRun.detail || '請先檢查 Worker 結果卡與下方 runbook。',
      }
    : normalizedWorkerRun?.status === 'success' && normalizedWorkerRun?.queueImpact?.status === 'unchanged' && summary.queued > 0
      ? {
          level: 'info',
          title: 'Worker 剛跑完，但佇列沒有明顯下降',
          message: queueDiagnosis?.persistent?.summary
            || queueDiagnosis?.summary
            || '請先看 Worker queue impact，確認 queued 是統計延遲還是真的沒有往前推。',
        }
    : recentFailures.length > 0
      ? {
          level: 'warning',
          title: `最近 ${recentFailures.length} 筆任務失敗`,
          message: failureSignatures[0]?.count >= 2
            ? `最近重複出現的 failed signature 是「${failureSignatures[0].label}」。`
            : recentFailures[0]?.error_message || '請先檢查失敗任務摘要。',
        }
      : !sync.ok
        ? {
            level: 'warning',
            title: 'AutoPen overview 只拿到部分資料',
            message: '目前至少有一條同步鏈路失敗，請先看下方 runbook。',
          }
        : summary.queued > 0 && summary.processing === 0
          ? {
              level: 'info',
              title: '佇列待處理',
              message: '目前有 queued 任務，但 worker 沒有正在處理。',
            }
          : {
              level: 'ok',
              title: 'AutoPen overview 正常',
              message: 'stats 與 recent tasks 都成功同步。',
            }

  return {
    summary,
    tasks,
    failureHistory,
    hasMoreFailureHistory,
    failureHistoryLimit,
    recentFailures,
    failureSignatures,
    workerRun: normalizedWorkerRun,
    workerHistory: normalizedWorkerHistory,
    workerSummary,
    workerFailureSignatures,
    queueDiagnosis,
    sync,
    attention,
    runbook,
    retry: retryHint,
  }
}
