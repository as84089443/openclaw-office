'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import {
  PenLine,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Zap,
  RefreshCw,
  ExternalLink,
  BarChart3,
  Brain,
  Plus,
  AlertTriangle,
} from 'lucide-react'

// 引擎顯示名稱
const ENGINE_NAMES = {
  'gpt-proxy': 'GPT-5.4',
  'geo-dual': 'GEO 雙引擎 (Kimi)',
  'gemini': 'Gemini',
  'openai': 'OpenAI',
}

// 狀態顯示
const STATUS_CONFIG = {
  queued: { label: '排隊中', color: '#ffb703', icon: Clock },
  processing: { label: '產文中', color: '#00f5ff', icon: Loader2 },
  completed: { label: '完成', color: '#39ff14', icon: CheckCircle2 },
  failed: { label: '失敗', color: '#ff4d4d', icon: XCircle },
  cancelled: { label: '已取消', color: '#666', icon: XCircle },
}

const ACCENT = '#ff6b35' // 橘色系 — 自動筆模組專屬色

async function readJsonPayload(response) {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function buildApiMessage(payload, fallback) {
  if (!payload || typeof payload !== 'object') return fallback

  const error = typeof payload.error === 'string' ? payload.error.trim() : ''
  const detail = typeof payload.detail === 'string' ? payload.detail.trim() : ''

  if (error && detail && detail !== error) return `${error}：${detail}`
  if (error) return error
  if (detail) return `${fallback}：${detail}`

  return fallback
}

function formatSyncTime(value) {
  if (!value) return null

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null

  return date.toLocaleTimeString('zh-TW', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function formatDateTime(value) {
  if (!value) return null

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null

  return date.toLocaleString('zh-TW', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatSignedDelta(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  if (number > 0) return `+${number}`
  return String(number)
}

function buildQueueDiagnosisHint(task) {
  if (!task || typeof task !== 'object') return null

  const hints = []

  if (task.processing_phase) hints.push(`phase：${task.processing_phase}`)
  if (task.failure_phase) hints.push(`failure：${task.failure_phase}`)
  if (task.retry_count > 0) hints.push(`已重試 ${task.retry_count} 次`)
  if (task.error_message) hints.push(task.error_message)

  return hints.length > 0 ? hints.join(' · ') : null
}

function formatQueueBucket(bucket) {
  switch (bucket) {
    case 'queued':
      return 'queued'
    case 'processing':
      return 'processing'
    case 'failed':
      return 'failed'
    default:
      return '視窗'
  }
}

function formatQueueTimelineStep(step) {
  if (!step || typeof step !== 'object') return null

  const bucket = formatQueueBucket(step.bucket)
  const time = formatDateTime(step.at)

  return time ? `${bucket} @ ${time}` : bucket
}

function mergeSyncSegment(previousSegment, nextSegment) {
  if (!nextSegment) return previousSegment || null

  const nextLastOkAt = nextSegment.ok
    ? nextSegment.lastOkAt || nextSegment.meta?.finishedAt || nextSegment.meta?.startedAt || null
    : previousSegment?.lastOkAt || nextSegment.lastOkAt || null

  return {
    ...previousSegment,
    ...nextSegment,
    lastOkAt: nextLastOkAt,
  }
}

function mergeSyncSegments(previousSegments = {}, nextSegments = {}) {
  const mergedSegments = {}
  const keys = new Set([
    ...Object.keys(previousSegments || {}),
    ...Object.keys(nextSegments || {}),
  ])

  for (const key of keys) {
    mergedSegments[key] = mergeSyncSegment(previousSegments?.[key], nextSegments?.[key])
  }

  return mergedSegments
}

function mergeOverviewSnapshot(previousOverview, nextOverview) {
  if (!previousOverview) return nextOverview

  const previousWorkerKey = previousOverview.workerRun?.recordedAt
    || previousOverview.workerRun?.completedAt
    || previousOverview.workerRun?.triggeredAt
    || null
  const nextWorkerKey = nextOverview.workerRun?.recordedAt
    || nextOverview.workerRun?.completedAt
    || nextOverview.workerRun?.triggeredAt
    || null
  const sameWorkerRun = Boolean(previousWorkerKey && nextWorkerKey && previousWorkerKey === nextWorkerKey)
  const mergedSync = {
    ...previousOverview.sync,
    ...nextOverview.sync,
    segments: mergeSyncSegments(previousOverview.sync?.segments, nextOverview.sync?.segments),
  }

  mergedSync.lastOkAt = Object.values(mergedSync.segments || {})
    .map(segment => segment?.lastOkAt)
    .filter(Boolean)
    .sort()
    .at(-1) || null

  const failureHistoryOk = nextOverview.sync?.segments?.failures?.ok

  return {
    ...previousOverview,
    ...nextOverview,
    summary: nextOverview.sync?.segments?.stats?.ok
      ? nextOverview.summary
      : (previousOverview.summary || nextOverview.summary),
    tasks: nextOverview.sync?.segments?.tasks?.ok
      ? nextOverview.tasks
      : (previousOverview.tasks || nextOverview.tasks || []),
    failureHistory: failureHistoryOk
      ? nextOverview.failureHistory
      : (previousOverview.failureHistory || nextOverview.failureHistory || []),
    hasMoreFailureHistory: failureHistoryOk
      ? nextOverview.hasMoreFailureHistory
      : (previousOverview.hasMoreFailureHistory ?? nextOverview.hasMoreFailureHistory ?? false),
    recentFailures: failureHistoryOk
      ? nextOverview.recentFailures
      : (previousOverview.recentFailures || nextOverview.recentFailures || []),
    failureSignatures: failureHistoryOk
      ? nextOverview.failureSignatures
      : (previousOverview.failureSignatures || nextOverview.failureSignatures || []),
    workerRun: nextOverview.workerRun || previousOverview.workerRun || null,
    workerHistory: nextOverview.workerHistory || previousOverview.workerHistory || [],
    workerSummary: nextOverview.workerSummary || previousOverview.workerSummary || null,
    workerFailureSignatures: nextOverview.workerFailureSignatures || previousOverview.workerFailureSignatures || [],
    queueDiagnosis: nextOverview.queueDiagnosis
      || (sameWorkerRun && (!nextOverview.sync?.segments?.tasks?.ok || !nextOverview.sync?.segments?.failures?.ok)
        ? previousOverview.queueDiagnosis || null
        : null),
    sync: mergedSync,
  }
}

export default function AutopenDashboard() {
  const [overview, setOverview] = useState(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [titles, setTitles] = useState('')
  const [wordCount, setWordCount] = useState(3000)
  const [engine, setEngine] = useState('gpt-proxy')
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  const [workerRunning, setWorkerRunning] = useState(false)
  const [refreshError, setRefreshError] = useState(null)
  // 全部走 server-side proxy，不需要 API key 在前端

  const fetchOverview = useCallback(async () => {
    try {
      const response = await fetch('/api/autopen/overview', { cache: 'no-store' })
      const payload = await readJsonPayload(response)

      if (!payload || typeof payload !== 'object') {
        throw new Error('AutoPen overview 回傳格式異常')
      }

      setOverview(current => mergeOverviewSnapshot(current, payload))
      setRefreshError(null)
    } catch (fetchError) {
      setRefreshError(fetchError?.message || 'AutoPen overview 載入失敗')
    } finally {
      setLoading(false)
    }
  }, [])

  const refreshAll = useCallback(async () => {
    await fetchOverview()
  }, [fetchOverview])

  useEffect(() => {
    refreshAll()
    const interval = setInterval(() => {
      refreshAll()
    }, 15000)
    return () => clearInterval(interval)
  }, [refreshAll])

  const handleGenerate = async () => {
    const titleList = titles.split('\n').map(t => t.trim()).filter(Boolean)
    if (titleList.length === 0) {
      setError('請輸入至少一個主題（每行一個）')
      return
    }
    setGenerating(true)
    setError(null)
    setSuccess(null)
    try {
      const r = await fetch('/api/autopen/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          titles: titleList,
          word_count: wordCount,
          engine,
          schedule: 'immediate',
          competitor_analysis: false,
          publish_to_bws: true,
        }),
      })
      const d = await readJsonPayload(r)

      if (!r.ok) throw new Error(buildApiMessage(d, '建立 AutoPen 任務失敗'))

      setSuccess(`✅ 已建立 ${Array.isArray(d?.tasks) ? d.tasks.length : 0} 筆任務，Worker 即將開始產文`)
      setTitles('')
      await refreshAll()
    } catch (e) {
      setError(e.message)
    }
    setGenerating(false)
  }

  const handleTriggerWorker = async () => {
    setWorkerRunning(true)
    setError(null)
    setSuccess('⏳ 觸發 Worker 中（可能需 1-5 分鐘）...')
    try {
      const r = await fetch('/api/autopen/worker', { method: 'POST' })
      const d = await readJsonPayload(r)

      if (!r.ok) throw new Error(buildApiMessage(d, 'AutoPen Worker 觸發失敗'))

      const failedCount = Number(d?.failed || 0)
      setSuccess(
        failedCount > 0
          ? `⚠️ Worker 完成：處理 ${d?.processed || 0} 筆，成功 ${d?.succeeded || 0}，失敗 ${failedCount}`
          : `✅ Worker 完成：處理 ${d?.processed || 0} 筆，成功 ${d?.succeeded || 0}`,
      )
      await refreshAll()
    } catch (e) {
      setError(e.message)
      setSuccess(null)
    } finally {
      setWorkerRunning(false)
    }
  }

  const stats = overview?.summary || null
  const tasks = Array.isArray(overview?.tasks) ? overview.tasks : []
  const failureHistory = Array.isArray(overview?.failureHistory) ? overview.failureHistory : []
  const hasMoreFailureHistory = Boolean(overview?.hasMoreFailureHistory)
  const recentFailures = Array.isArray(overview?.recentFailures) ? overview.recentFailures : []
  const failureSignatures = Array.isArray(overview?.failureSignatures) ? overview.failureSignatures : []
  const workerRun = overview?.workerRun || null
  const workerHistory = Array.isArray(overview?.workerHistory) ? overview.workerHistory : []
  const workerSummary = overview?.workerSummary || null
  const workerFailureSignatures = Array.isArray(overview?.workerFailureSignatures) ? overview.workerFailureSignatures : []
  const queueDiagnosis = overview?.queueDiagnosis || null
  const attention = overview?.attention || null
  const retryHint = overview?.retry || null
  const runbook = Array.isArray(overview?.runbook) ? overview.runbook : []
  const syncSegments = overview?.sync?.segments ? Object.values(overview.sync.segments) : []
  const syncIssues = syncSegments.filter(segment => !segment.ok)
  const lastHealthySyncAt = overview?.sync?.lastOkAt || null
  const workerRunBadgeColor = workerRun?.status === 'error' ? '#ff4d4d' : '#39ff14'
  const workerRunBadgeText = workerRun?.status === 'error' ? '失敗' : '成功'
  const syncStatusItems = syncSegments.map(segment => ({
    label: segment.label,
    ok: segment.ok,
    value: segment.ok
      ? (formatSyncTime(segment.lastOkAt) || '等待首次同步')
      : '同步異常',
  }))

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-4 py-6 md:py-8">
      <div className="space-y-5">

        {/* 標題 */}
        <div className="glass-card rounded-[30px] p-5 md:p-7">
          <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
            <div>
              <div
                className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] uppercase tracking-[0.22em]"
                style={{ borderColor: `${ACCENT}40`, background: `${ACCENT}10`, color: ACCENT }}
              >
                <PenLine className="h-3.5 w-3.5" />
                AI 自動筆
              </div>
              <h1 className="mt-4 font-display text-3xl leading-none text-white md:text-[2.8rem]">
                GPT-5.4<br />
                <span style={{ color: ACCENT }}>自動產文中台</span>
              </h1>
              <p className="mt-3 text-sm leading-7 text-gray-400">
                輸入主題，GPT-5.4 自動產出 SEO 文章，直接發布到 BWS 找棚網。
              </p>
            </div>

            {/* 統計 */}
            {stats && (
              <div className="flex gap-3 flex-wrap">
                {[
                  { label: '今日完成', value: stats.todayCompleted || 0, color: '#39ff14' },
                  { label: '佇列中', value: stats.queued || 0, color: '#ffb703' },
                  { label: '產文中', value: stats.processing || 0, color: '#00f5ff' },
                  { label: '總計', value: stats.total || 0, color: ACCENT },
                ].map(s => (
                  <div
                    key={s.label}
                    className="flex flex-col items-center rounded-2xl border px-5 py-3 min-w-[80px]"
                    style={{ borderColor: `${s.color}25`, background: `${s.color}08` }}
                  >
                    <span className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</span>
                    <span className="mt-0.5 text-[10px] uppercase tracking-wider text-gray-500">{s.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="glass-card rounded-[30px] p-5 md:p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="text-sm font-medium text-white">資料流狀態</div>
              <div className="mt-1 text-xs text-gray-500">
                `/writer` 現在先打 single overview snapshot，由 server 端整合統計、近期任務與失敗歷史，再回報哪一段同步失敗。
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {syncStatusItems.map(item => (
                <div
                  key={item.label}
                  className="rounded-2xl border px-3 py-2 text-xs"
                  style={{
                    borderColor: item.ok ? 'rgba(57,255,20,0.16)' : 'rgba(255,183,3,0.24)',
                    background: item.ok ? 'rgba(57,255,20,0.08)' : 'rgba(255,183,3,0.10)',
                  }}
                >
                  <div className="text-[10px] uppercase tracking-[0.16em] text-gray-500">{item.label}</div>
                  <div className={item.ok ? 'mt-1 text-green-300' : 'mt-1 text-amber-300'}>{item.value}</div>
                </div>
              ))}
            </div>
          </div>

          {refreshError && (
            <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/8 px-4 py-3 text-sm text-red-200">
              {refreshError}
            </div>
          )}

          {attention && (
            <div
              className="mt-4 rounded-2xl border px-4 py-3 text-sm"
              style={{
                borderColor: attention.level === 'ok' ? 'rgba(57,255,20,0.16)' : 'rgba(255,183,3,0.24)',
                background: attention.level === 'ok' ? 'rgba(57,255,20,0.08)' : 'rgba(255,183,3,0.10)',
                color: attention.level === 'ok' ? '#d9ffe0' : '#fde68a',
              }}
            >
              <div className="font-medium">{attention.title}</div>
              <div className="mt-1 text-xs opacity-80">{attention.message}</div>
            </div>
          )}

          {syncIssues.length > 0 ? (
            <div className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/8 px-4 py-3 text-sm text-amber-100">
              <div className="flex items-center gap-2 font-medium">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-300" />
                目前卡點
              </div>
              <div className="mt-3 space-y-2 text-amber-100/95">
                {syncIssues.map(segment => (
                  <div key={segment.label}>
                    <span className="font-medium text-amber-200">{segment.label}</span>
                    <span>：{segment.error || '同步異常'}</span>
                    {segment.meta?.upstreamPath && (
                      <span className="text-xs text-amber-200/80"> · {segment.meta.upstreamPath}</span>
                    )}
                    {segment.meta?.upstreamStatus && (
                      <span className="text-xs text-amber-200/80"> · HTTP {segment.meta.upstreamStatus}</span>
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-3 text-xs text-amber-200/80">
                {lastHealthySyncAt
                  ? `畫面保留最近一次成功同步的資料，最後成功時間：${formatSyncTime(lastHealthySyncAt)}`
                  : '目前還沒有成功同步紀錄，請先檢查上游 API 與憑證設定。'}
              </div>
            </div>
          ) : (
            <div className="mt-4 text-xs text-gray-500">
              {lastHealthySyncAt
                ? `最近成功同步時間：${formatSyncTime(lastHealthySyncAt)}`
                : '等待第一輪同步結果。'}
            </div>
          )}

          <div className="mt-5 rounded-2xl border border-white/8 bg-white/4 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-white">最近一次 Worker 觸發結果</div>
                <div className="mt-1 text-xs text-gray-500">
                  這張卡會保留 Office 最近一次手動觸發的結果，方便分辨是 worker 真的跑過，還是只有按鈕被按下去。
                </div>
              </div>
              {workerRun && (
                <div
                  className="rounded-full border px-3 py-1 text-[11px]"
                  style={{ borderColor: `${workerRunBadgeColor}30`, color: workerRunBadgeColor }}
                >
                  {workerRunBadgeText}
                </div>
              )}
            </div>

            {!workerRun ? (
              <div className="mt-4 text-sm text-gray-500">
                目前還沒有 Office 端的 Worker 觸發紀錄，先按一次「觸發 Worker」建立第一筆執行證據。
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                <div className="flex flex-wrap gap-3">
                  {[
                    { label: '處理', value: workerRun.processed || 0, color: ACCENT },
                    { label: '成功', value: workerRun.succeeded || 0, color: '#39ff14' },
                    { label: '失敗', value: workerRun.failed || 0, color: '#ff4d4d' },
                  ].map(item => (
                    <div
                      key={item.label}
                      className="min-w-[72px] rounded-2xl border px-4 py-3"
                      style={{ borderColor: `${item.color}25`, background: `${item.color}08` }}
                    >
                      <div className="text-lg font-semibold" style={{ color: item.color }}>{item.value}</div>
                      <div className="mt-1 text-[10px] uppercase tracking-[0.16em] text-gray-500">{item.label}</div>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap gap-3 text-xs text-gray-400">
                  <div>觸發時間：{formatDateTime(workerRun.triggeredAt) || '未知'}</div>
                  <div>完成時間：{formatDateTime(workerRun.completedAt) || '未知'}</div>
                  {workerRun.meta?.upstreamStatus && <div>HTTP {workerRun.meta.upstreamStatus}</div>}
                  {workerRun.meta?.durationMs !== null && workerRun.meta?.durationMs !== undefined && (
                    <div>{Math.round(workerRun.meta.durationMs / 1000)} 秒</div>
                  )}
                </div>

                {workerRun.queueImpact && (
                  <div className="rounded-2xl border border-white/8 bg-black/10 px-4 py-3">
                    <div className="text-xs uppercase tracking-[0.16em] text-gray-500">Queue Impact</div>
                    <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-300">
                      {workerRun.queueImpact.before && workerRun.queueImpact.after ? (
                        <>
                          <div>佇列 {workerRun.queueImpact.before.queued}{' -> '}{workerRun.queueImpact.after.queued}</div>
                          <div>產文中 {workerRun.queueImpact.before.processing}{' -> '}{workerRun.queueImpact.after.processing}</div>
                          {workerRun.queueImpact.delta?.completed !== null && workerRun.queueImpact.delta?.completed !== undefined && (
                            <div>完成差值 {formatSignedDelta(workerRun.queueImpact.delta.completed)}</div>
                          )}
                          {workerRun.queueImpact.delta?.failed !== null && workerRun.queueImpact.delta?.failed !== undefined && (
                            <div>失敗差值 {formatSignedDelta(workerRun.queueImpact.delta.failed)}</div>
                          )}
                        </>
                      ) : (
                        <div>這次 Worker 缺少完整的前後 stats 快照，暫時無法判斷佇列有沒有往前推。</div>
                      )}
                    </div>
                  </div>
                )}

                {queueDiagnosis && (
                  <div className="rounded-2xl border border-amber-500/20 bg-amber-500/8 px-4 py-3">
                    <div className="text-xs uppercase tracking-[0.16em] text-amber-200/80">Queue 卡點線索</div>
                    <div className="mt-2 text-sm leading-6 text-amber-50">
                      {queueDiagnosis.summary}
                    </div>

                    <div className="mt-3 grid gap-3 lg:grid-cols-3">
                      {queueDiagnosis.processingCandidates?.length > 0 && (
                        <div className="rounded-2xl border border-cyan-400/16 bg-cyan-400/8 px-3 py-3">
                          <div className="text-[11px] uppercase tracking-[0.16em] text-cyan-100/80">仍在 processing</div>
                          <div className="mt-2 space-y-2">
                            {queueDiagnosis.processingCandidates.map(task => (
                              <div key={task.id || task.keyword} className="text-xs leading-5 text-cyan-50">
                                <div>{task.keyword}</div>
                                {buildQueueDiagnosisHint(task) && (
                                  <div className="text-cyan-100/70">{buildQueueDiagnosisHint(task)}</div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {queueDiagnosis.queuedCandidates?.length > 0 && (
                        <div className="rounded-2xl border border-amber-300/16 bg-amber-300/8 px-3 py-3">
                          <div className="text-[11px] uppercase tracking-[0.16em] text-amber-100/80">仍在 queued</div>
                          <div className="mt-2 space-y-2">
                            {queueDiagnosis.queuedCandidates.map(task => (
                              <div key={task.id || task.keyword} className="text-xs leading-5 text-amber-50">
                                <div>{task.keyword}</div>
                                {buildQueueDiagnosisHint(task) && (
                                  <div className="text-amber-100/70">{buildQueueDiagnosisHint(task)}</div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {queueDiagnosis.failedCandidates?.length > 0 && (
                        <div className="rounded-2xl border border-red-400/16 bg-red-400/8 px-3 py-3">
                          <div className="text-[11px] uppercase tracking-[0.16em] text-red-100/80">觸發後最近 failed</div>
                          <div className="mt-2 space-y-2">
                            {queueDiagnosis.failedCandidates.map(task => (
                              <div key={task.id || task.keyword} className="text-xs leading-5 text-red-50">
                                <div>{task.keyword}</div>
                                {buildQueueDiagnosisHint(task) && (
                                  <div className="text-red-100/70">{buildQueueDiagnosisHint(task)}</div>
                                )}
                                {task.failure_at && (
                                  <div className="text-red-100/60">{formatDateTime(task.failure_at)}</div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {queueDiagnosis.persistent?.candidates?.length > 0 && (
                      <div className="mt-3 rounded-2xl border border-orange-400/16 bg-orange-400/8 px-3 py-3">
                        <div className="text-[11px] uppercase tracking-[0.16em] text-orange-100/80">跨多次 run 仍出現</div>
                        <div className="mt-2 text-xs leading-6 text-orange-50">
                          {queueDiagnosis.persistent.summary}
                        </div>
                        <div className="mt-2 space-y-2">
                          {queueDiagnosis.persistent.candidates.map(task => (
                            <div key={`${task.id || task.keyword}-persistent`} className="text-xs leading-5 text-orange-50">
                              <div>{task.keyword}</div>
                              <div className="text-orange-100/70">
                                最近 {task.seenInRuns} 次 Worker snapshot 都還在 {formatQueueBucket(task.currentBucket)}
                                {task.matchedBuckets?.length > 0 && ` · 曾出現在 ${task.matchedBuckets.map(formatQueueBucket).join(' / ')}`}
                              </div>
                              {task.rootCausePatternLabel && (
                                <div className="text-orange-100/70">根因模式：{task.rootCausePatternLabel}</div>
                              )}
                              {task.stuckTypeLabel && (
                                <div className="text-orange-100/70">類型：{task.stuckTypeLabel}</div>
                              )}
                              {task.topErrorSignature?.label && (
                                <div className="text-orange-100/65">
                                  重複錯誤：{task.topErrorSignature.label}
                                  {task.topErrorSignature.count > 1 && `（${task.topErrorSignature.count} 次）`}
                                  {task.topErrorSignature.inferred && '（由 Worker 補推）'}
                                </div>
                              )}
                              {task.topErrorSignature?.confidenceLabel && (
                                <div className="text-orange-100/65">
                                  判讀信心：{task.topErrorSignature.confidenceLabel}
                                </div>
                              )}
                              {task.topErrorSignature?.evidenceScore && (
                                <div className="text-orange-100/60">
                                  證據分數：{task.topErrorSignature.evidenceScore}/5
                                  {task.topErrorSignature.consistencyLabel && ` · ${task.topErrorSignature.consistencyLabel}`}
                                </div>
                              )}
                              {task.topErrorSignature?.evidenceSummary && (
                                <div className="text-orange-100/60">
                                  證據：{task.topErrorSignature.evidenceSummary}
                                </div>
                              )}
                              {task.patternRunbookFocusLabel && (
                                <div className="text-orange-100/65">
                                  排查焦點：{task.patternRunbookFocusLabel}
                                </div>
                              )}
                              {task.patternRunbookFocusDetail && (
                                <div className="text-orange-100/60">
                                  焦點說明：{task.patternRunbookFocusDetail}
                                </div>
                              )}
                              {task.rootCausePatternDetail ? (
                                <div className="text-orange-100/65">{task.rootCausePatternDetail}</div>
                              ) : task.stuckTypeSummary && (
                                <div className="text-orange-100/65">{task.stuckTypeSummary}</div>
                              )}
                              {task.patternRunbookSteps?.length > 0 && (
                                <div className="text-orange-100/65">
                                  排查建議：{task.patternRunbookSteps.slice(0, 2).join(' ')}
                                </div>
                              )}
                              {task.timelineSummary && (
                                <div className="text-orange-100/65">{task.timelineSummary}</div>
                              )}
                              {task.timeline?.length > 0 && (
                                <div className="text-orange-100/60">
                                  timeline：{task.timeline.map(formatQueueTimelineStep).filter(Boolean).join(' -> ')}
                                </div>
                              )}
                              {buildQueueDiagnosisHint(task) && (
                                <div className="text-orange-100/65">{buildQueueDiagnosisHint(task)}</div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {workerRun.detail && (
                  <div
                    className="rounded-2xl border px-4 py-3 text-sm"
                    style={{
                      borderColor: workerRun.status === 'error' ? 'rgba(255,77,77,0.22)' : 'rgba(57,255,20,0.16)',
                      background: workerRun.status === 'error' ? 'rgba(255,77,77,0.08)' : 'rgba(57,255,20,0.08)',
                      color: workerRun.status === 'error' ? '#ffd6d6' : '#d9ffe0',
                    }}
                  >
                    {workerRun.detail}
                  </div>
                )}

                {workerRun.errors?.length > 0 && (
                  <div className="rounded-2xl border border-red-500/14 bg-red-500/8 px-4 py-3">
                    <div className="text-xs uppercase tracking-[0.16em] text-red-200/80">Error Summary</div>
                    <div className="mt-2 space-y-1.5 text-xs leading-6 text-red-100/90">
                      {workerRun.errors.slice(0, 3).map(errorLine => (
                        <div key={errorLine}>- {errorLine}</div>
                      ))}
                    </div>
                  </div>
                )}

                {workerSummary && workerSummary.totalRuns > 1 && (
                  <div className="rounded-2xl border border-white/8 bg-black/10 px-4 py-3">
                    <div className="flex flex-wrap gap-3 text-xs text-gray-400">
                      <div>最近記錄：{workerSummary.totalRuns} 次</div>
                      <div>成功：{workerSummary.successCount}</div>
                      <div>失敗：{workerSummary.failureCount}</div>
                      {workerSummary.consecutiveFailures > 0 && (
                        <div className="text-amber-200">連續失敗：{workerSummary.consecutiveFailures} 次</div>
                      )}
                      {workerSummary.lastSuccessAt && (
                        <div>最近成功：{formatDateTime(workerSummary.lastSuccessAt)}</div>
                      )}
                    </div>
                  </div>
                )}

                {workerFailureSignatures.length > 0 && (
                  <div className="rounded-2xl border border-red-500/14 bg-red-500/8 px-4 py-3">
                    <div className="text-xs uppercase tracking-[0.16em] text-red-200/80">Worker Failure Signatures</div>
                    <div className="mt-2 space-y-2.5">
                      {workerFailureSignatures.slice(0, 3).map(signature => (
                        <div key={signature.key} className="text-xs leading-6 text-red-100/90">
                          <div>{signature.label}</div>
                          <div className="text-red-100/70">
                            出現 {signature.count} 次
                            {signature.consecutiveCount > 1 && ` · 連續 ${signature.consecutiveCount} 次`}
                            {signature.upstreamStatuses?.length > 0 && ` · HTTP ${signature.upstreamStatuses.join(' / ')}`}
                            {signature.latestAt && ` · 最近 ${formatDateTime(signature.latestAt)}`}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {workerHistory.length > 1 && (
                  <div className="rounded-2xl border border-white/8 bg-black/10 px-4 py-3">
                    <div className="text-xs uppercase tracking-[0.16em] text-gray-500">Recent Worker Runs</div>
                    <div className="mt-3 space-y-2.5">
                      {workerHistory.slice(0, 5).map((run, index) => {
                        const isError = run.status === 'error'
                        const runColor = isError ? '#ff4d4d' : '#39ff14'
                        return (
                          <div
                            key={`${run.recordedAt || run.triggeredAt || 'worker-run'}-${index}`}
                            className="rounded-2xl border px-3 py-3"
                            style={{ borderColor: `${runColor}20`, background: `${runColor}08` }}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex flex-wrap items-center gap-2 text-xs text-gray-300">
                                <span
                                  className="rounded-full border px-2 py-1"
                                  style={{ borderColor: `${runColor}30`, color: runColor }}
                                >
                                  {isError ? '失敗' : '成功'}
                                </span>
                                <span>{formatDateTime(run.triggeredAt) || '時間未知'}</span>
                                {run.meta?.upstreamStatus && <span>HTTP {run.meta.upstreamStatus}</span>}
                              </div>
                              <div className="text-xs text-gray-400">
                                處理 {run.processed || 0} · 成功 {run.succeeded || 0} · 失敗 {run.failed || 0}
                              </div>
                            </div>
                            {run.queueImpact?.before && run.queueImpact?.after && (
                              <div className="mt-2 text-[11px] text-gray-400">
                                佇列 {run.queueImpact.before.queued}{' -> '}{run.queueImpact.after.queued}
                                {' · '}
                                產文中 {run.queueImpact.before.processing}{' -> '}{run.queueImpact.after.processing}
                              </div>
                            )}
                            {run.detail && (
                              <div className="mt-2 text-xs leading-6 text-gray-300">
                                {run.detail}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="glass-card rounded-[30px] p-5 md:p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="rounded-xl p-2.5" style={{ background: `${ACCENT}16`, color: ACCENT }}>
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-medium text-white">近期失敗與 retry runbook</div>
              <div className="text-xs text-gray-500">先看 dedicated failure history，再決定要修上游、補憑證，還是回 BWS 後台重排</div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.1fr,0.9fr]">
            <div className="rounded-2xl border border-white/6 bg-white/4 p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-gray-500">Failure History</div>
              {failureSignatures.length > 0 && (
                <div className="mt-4 rounded-2xl border border-red-500/14 bg-red-500/8 px-4 py-3">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-red-200/80">Failure Signatures</div>
                  <div className="mt-2 space-y-2.5">
                    {failureSignatures.slice(0, 3).map(signature => (
                      <div key={signature.key} className="text-xs leading-6 text-red-100/90">
                        <div>{signature.label}</div>
                        <div className="text-red-100/70">
                          最近 {signature.count} 筆
                          {signature.phases?.length > 0 && ` · phase ${signature.phases.join(' / ')}`}
                          {signature.keywords?.length > 0 && ` · 任務 ${signature.keywords.join('、')}`}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {syncIssues.some(segment => segment.label === '失敗歷史') && failureHistory.length === 0 ? (
                <div className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/8 px-4 py-4 text-sm text-amber-100">
                  失敗歷史目前無法同步，請先依下方 runbook 排查 dedicated failure history 這條鏈路。
                  <div className="mt-2 text-xs text-amber-200/80">
                    {syncIssues.find(segment => segment.label === '失敗歷史')?.error}
                  </div>
                </div>
              ) : failureHistory.length === 0 ? (
                <div className="mt-4 text-sm text-gray-500">
                  目前 dedicated failure history 沒有抓到 failed 任務。
                  {stats?.failed > 0 && (
                    <div className="mt-2 text-xs text-amber-200/80">
                      但統計顯示累積仍有 {stats.failed} 筆 failed，代表上游失敗歷史 API 還有更早的資料需要往後追。
                    </div>
                  )}
                </div>
              ) : (
                <div className="mt-4 space-y-3">
                  {failureHistory.map(task => (
                    <div key={task.id} className="rounded-2xl border border-red-500/14 bg-red-500/8 px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm text-red-50">{task.keyword}</div>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-red-200/80">
                            <span>{formatDateTime(task.failure_at) || '時間未知'}</span>
                            {task.failure_phase && <><span>·</span><span>{task.failure_phase}</span></>}
                            {task.retry_count > 0 && <><span>·</span><span>已重試 {task.retry_count} 次</span></>}
                          </div>
                        </div>
                        <span className="rounded-full border border-red-400/20 px-2 py-1 text-[11px] text-red-200">
                          failed
                        </span>
                      </div>
                      <div className="mt-2 text-xs leading-6 text-red-100/90">
                        {task.error_message || '上游沒有回傳明確錯誤訊息。'}
                      </div>
                    </div>
                  ))}
                  {hasMoreFailureHistory && (
                    <div className="rounded-2xl border border-amber-500/16 bg-amber-500/8 px-4 py-3 text-xs text-amber-100">
                      目前只顯示最近一段 failed 任務，統計顯示還有更早的失敗歷史未展開。
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-white/6 bg-white/4 p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-gray-500">Runbook</div>
              {runbook.length === 0 ? (
                <div className="mt-4 text-sm text-gray-500">目前沒有需要立即處理的同步或 retry 提示。</div>
              ) : (
                <div className="mt-4 space-y-3">
                  {runbook.map(item => (
                    <div key={item.key} className="rounded-2xl border border-white/8 bg-black/10 px-4 py-3">
                      <div className="text-sm text-white">{item.title}</div>
                      <div className="mt-1 text-xs leading-6 text-gray-400">{item.detail}</div>
                      <div className="mt-3 space-y-1.5 text-xs text-gray-300">
                        {item.steps?.map(step => (
                          <div key={step}>- {step}</div>
                        ))}
                      </div>
                      {item.references?.length > 0 && (
                        <div className="mt-3 text-[11px] text-gray-500">
                          參考：{item.references.join(' · ')}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {retryHint && (
                <div className="mt-4 rounded-2xl border border-amber-500/16 bg-amber-500/8 px-4 py-3 text-xs text-amber-100">
                  <div className="font-medium">目前 retry 入口</div>
                  <div className="mt-1 leading-6 text-amber-100/85">{retryHint.reason}</div>
                  {retryHint.href && (
                    <Link
                      href={retryHint.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-amber-300/20 px-3 py-1.5 text-[11px] text-amber-100 transition hover:text-white"
                    >
                      前往 BWS 後台 <ExternalLink className="h-3 w-3" />
                    </Link>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 產文表單 */}
        <div className="glass-card rounded-[30px] p-5 md:p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="rounded-xl p-2.5" style={{ background: `${ACCENT}16`, color: ACCENT }}>
              <Brain className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-medium text-white">新增產文任務</div>
              <div className="text-xs text-gray-500">每行一個主題，批次建立任務</div>
            </div>
          </div>

          {error && (
            <div className="mb-4 flex items-center gap-2 rounded-2xl border border-red-500/20 bg-red-500/8 px-4 py-3 text-sm text-red-400">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}
          {success && (
            <div className="mb-4 flex items-center gap-2 rounded-2xl border border-green-500/20 bg-green-500/8 px-4 py-3 text-sm text-green-400">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              {success}
            </div>
          )}

          <div className="space-y-4">
            <textarea
              value={titles}
              onChange={e => setTitles(e.target.value)}
              placeholder="台北自然光攝影棚推薦：2026 年場地完整指南&#10;商品攝影棚怎麼挑？新手選棚的 5 個關鍵指標&#10;（每行一個主題）"
              rows={4}
              className="w-full resize-none rounded-2xl border border-white/8 bg-white/4 px-4 py-3 text-sm text-gray-200 placeholder-gray-600 outline-none focus:border-orange-500/30 focus:ring-0 transition"
            />

            <div className="flex flex-wrap gap-3">
              {/* 字數 */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">字數：</span>
                {[800, 1500, 3000].map(w => (
                  <button
                    key={w}
                    onClick={() => setWordCount(w)}
                    className="rounded-full border px-3 py-1 text-xs transition hover:-translate-y-0.5"
                    style={{
                      borderColor: wordCount === w ? `${ACCENT}60` : 'rgba(255,255,255,0.08)',
                      background: wordCount === w ? `${ACCENT}15` : 'transparent',
                      color: wordCount === w ? ACCENT : '#9ca3af',
                    }}
                  >
                    {w.toLocaleString()}
                  </button>
                ))}
              </div>

              {/* 引擎 */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">引擎：</span>
                {Object.entries(ENGINE_NAMES).map(([k, v]) => (
                  <button
                    key={k}
                    onClick={() => setEngine(k)}
                    className="rounded-full border px-3 py-1 text-xs transition hover:-translate-y-0.5"
                    style={{
                      borderColor: engine === k ? '#00f5ff60' : 'rgba(255,255,255,0.08)',
                      background: engine === k ? '#00f5ff15' : 'transparent',
                      color: engine === k ? '#00f5ff' : '#9ca3af',
                    }}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-3 pt-1">
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-medium text-white transition hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50"
                style={{ background: `${ACCENT}`, boxShadow: `0 4px 20px ${ACCENT}40` }}
              >
                {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                {generating ? '建立中...' : '建立任務'}
              </button>

              <button
                onClick={handleTriggerWorker}
                disabled={workerRunning}
                className="flex items-center gap-2 rounded-xl border border-cyan-500/20 bg-cyan-500/8 px-4 py-2.5 text-sm text-cyan-300 transition hover:-translate-y-0.5 disabled:opacity-50"
              >
                {workerRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                {workerRunning ? 'Worker 執行中...' : '觸發 Worker'}
              </button>

              <button
                onClick={refreshAll}
                className="flex items-center gap-2 rounded-xl border border-white/8 bg-white/4 px-4 py-2.5 text-sm text-gray-400 transition hover:-translate-y-0.5"
              >
                <RefreshCw className="h-4 w-4" />
                重整
              </button>
            </div>
          </div>
        </div>

        {/* 任務列表 */}
        <div className="glass-card rounded-[30px] p-5 md:p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="rounded-xl p-2.5" style={{ background: `${ACCENT}16`, color: ACCENT }}>
              <BarChart3 className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-medium text-white">近期任務</div>
              <div className="text-xs text-gray-500">自動每 15 秒更新</div>
            </div>
            <Link
              href="https://www.bw-space.com/admin/autopen"
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto flex items-center gap-1.5 rounded-full border border-white/8 px-3 py-1.5 text-xs text-gray-400 transition hover:text-white"
            >
              完整後台 <ExternalLink className="h-3 w-3" />
            </Link>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-gray-500" />
            </div>
          ) : tasks.length === 0 && syncIssues.some(segment => segment.label === '任務列表') ? (
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/8 px-4 py-4 text-sm text-amber-100">
              任務列表目前無法同步，暫時不能把空畫面當成「沒有任務」。
              <div className="mt-2 text-xs text-amber-200/80">
                {syncIssues.find(segment => segment.label === '任務列表')?.error}
              </div>
            </div>
          ) : tasks.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-600">尚無任務，輸入主題開始產文</div>
          ) : (
            <div className="space-y-2">
              {tasks.map(task => {
                const sc = STATUS_CONFIG[task.status] || STATUS_CONFIG.queued
                const StatusIcon = sc.icon
                const engineName = ENGINE_NAMES[task.engine] || task.engine || 'geo-dual'
                return (
                  <div
                    key={task.id}
                    className="flex items-center gap-3 rounded-2xl border border-white/5 bg-white/3 px-4 py-3 transition hover:bg-white/5"
                  >
                    <StatusIcon
                      className={`h-4 w-4 shrink-0 ${task.status === 'processing' ? 'animate-spin' : ''}`}
                      style={{ color: sc.color }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-gray-200">{task.keyword}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-gray-600">
                        <span style={{ color: sc.color }}>{sc.label}</span>
                        <span>·</span>
                        <span>{engineName}</span>
                        {task.word_count && <><span>·</span><span>{task.word_count.toLocaleString()} 字</span></>}
                        {task.status === 'processing' && task.processing_phase && <><span>·</span><span>{task.processing_phase}</span></>}
                        {task.status === 'failed' && task.retry_count > 0 && <><span>·</span><span>已重試 {task.retry_count} 次</span></>}
                      </div>
                      {task.status === 'failed' && (
                        <div className="mt-2 text-xs leading-6 text-red-300">
                          失敗原因：{task.error_message || '上游沒有回傳明確原因'}
                          {task.failure_phase && <span className="text-red-200/70"> · phase：{task.failure_phase}</span>}
                          {task.failure_at && <span className="text-red-200/70"> · {formatDateTime(task.failure_at)}</span>}
                        </div>
                      )}
                      {task.status === 'processing' && task.processing_phase && (
                        <div className="mt-2 text-xs text-cyan-200/75">
                          目前環節：{task.processing_phase}
                        </div>
                      )}
                    </div>
                    {task.article_slug && (
                      <Link
                        href={`https://www.bw-space.com/articles/${task.article_slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 rounded-full border border-white/8 px-2.5 py-1 text-xs text-gray-400 transition hover:text-white"
                      >
                        查看 <ExternalLink className="inline h-3 w-3" />
                      </Link>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

      </div>
    </main>
  )
}
