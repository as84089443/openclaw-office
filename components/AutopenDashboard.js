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
  Trash2,
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

export default function AutopenDashboard() {
  const [tasks, setTasks] = useState([])
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [titles, setTitles] = useState('')
  const [wordCount, setWordCount] = useState(3000)
  const [engine, setEngine] = useState('gpt-proxy')
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  // 全部走 server-side proxy，不需要 API key 在前端

  const fetchTasks = useCallback(async () => {
    try {
      const r = await fetch('/api/autopen/stats')
      if (!r.ok) return
      const d = await r.json()
      setStats(d)
    } catch {}
  }, [])

  const fetchRecentTasks = useCallback(async () => {
    try {
      const r = await fetch('/api/autopen/tasks?limit=20')
      if (!r.ok) return
      const d = await r.json()
      setTasks(d.tasks || d || [])
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchTasks()
    fetchRecentTasks()
    const interval = setInterval(() => {
      fetchTasks()
      fetchRecentTasks()
    }, 15000)
    return () => clearInterval(interval)
  }, [fetchTasks, fetchRecentTasks])

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
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || '建立失敗')
      setSuccess(`✅ 已建立 ${d.tasks?.length || 0} 筆任務，Worker 即將開始產文`)
      setTitles('')
      await fetchRecentTasks()
      await fetchTasks()
    } catch (e) {
      setError(e.message)
    }
    setGenerating(false)
  }

  const handleTriggerWorker = async () => {
    setSuccess('⏳ 觸發 Worker 中（可能需 1-5 分鐘）...')
    try {
      const r = await fetch('/api/autopen/worker', { method: 'POST' })
      const d = await r.json()
      if (d.ok) {
        setSuccess(`✅ Worker 完成：處理 ${d.processed || 0} 筆，成功 ${d.succeeded || 0}`)
        await fetchRecentTasks()
        await fetchTasks()
      } else setError(d.error || 'Worker 觸發失敗')
    } catch (e) {
      setError(e.message)
    }
  }

  const processingCount = tasks.filter(t => t.status === 'processing').length
  const queuedCount = tasks.filter(t => t.status === 'queued').length

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
                  { label: '今日完成', value: stats.today_completed || 0, color: '#39ff14' },
                  { label: '佇列中', value: queuedCount, color: '#ffb703' },
                  { label: '產文中', value: processingCount, color: '#00f5ff' },
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
                className="flex items-center gap-2 rounded-xl border border-cyan-500/20 bg-cyan-500/8 px-4 py-2.5 text-sm text-cyan-300 transition hover:-translate-y-0.5"
              >
                <Zap className="h-4 w-4" />
                觸發 Worker
              </button>

              <button
                onClick={() => { fetchTasks(); fetchRecentTasks() }}
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
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-gray-600">
                        <span style={{ color: sc.color }}>{sc.label}</span>
                        <span>·</span>
                        <span>{engineName}</span>
                        {task.word_count && <><span>·</span><span>{task.word_count.toLocaleString()} 字</span></>}
                      </div>
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
