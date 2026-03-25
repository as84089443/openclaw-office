'use client'

import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle,
  BriefcaseBusiness,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'

function getStoppedServiceCount(status) {
  return status?.summary?.stoppedServiceCount ?? status?.stoppedServices?.length ?? 0
}

function getStoppedServiceTargetCount(status) {
  return status?.summary?.stoppedServiceTargetCount ?? 10
}

function getCoreServiceCount(status) {
  return status?.summary?.coreServiceCount ?? status?.coreServices?.length ?? 4
}

export default function WorkModeToggle() {
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [dialogMode, setDialogMode] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let isMounted = true

    async function loadStatus() {
      setLoading(true)
      setError('')

      try {
        const response = await fetch('/api/office/work-mode', {
          method: 'GET',
          cache: 'no-store',
        })

        const payload = await response.json().catch(() => ({}))
        if (!response.ok || payload?.ok === false) {
          throw new Error(payload?.detail || payload?.error || '目前無法讀取工作模式狀態')
        }

        if (isMounted) {
          setStatus(payload)
        }
      } catch (fetchError) {
        if (isMounted) {
          setError(fetchError.message || '目前無法讀取工作模式狀態')
        }
      } finally {
        if (isMounted) {
          setLoading(false)
        }
      }
    }

    loadStatus()
    return () => {
      isMounted = false
    }
  }, [])

  const isWorkMode = status?.mode === 'work'
  const stoppedServiceCount = getStoppedServiceCount(status)
  const stoppedServiceTargetCount = getStoppedServiceTargetCount(status)
  const coreServiceCount = getCoreServiceCount(status)
  const toggleDisabled = loading || submitting

  async function submitMode(mode) {
    setSubmitting(true)
    setError('')

    try {
      const response = await fetch('/api/office/work-mode', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ mode }),
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.detail || payload?.error || '切換工作模式失敗')
      }

      setStatus(payload)
      setDialogMode(null)
    } catch (submitError) {
      setError(submitError.message || '切換工作模式失敗')
    } finally {
      setSubmitting(false)
    }
  }

  const accentClasses = isWorkMode
    ? {
      badge: 'border-amber-400/35 bg-amber-500/12 text-amber-200',
      glow: 'from-amber-500/22 via-orange-500/12 to-transparent',
      dot: 'bg-amber-400 shadow-[0_0_20px_rgba(251,191,36,0.55)]',
      switch: 'bg-amber-500/30',
      switchThumb: 'bg-amber-300',
      title: '工作模式 · 僅核心服務',
      description: '已暫停非核心服務與排程，讓外出工作時更安靜、輕量。',
      icon: BriefcaseBusiness,
    }
    : {
      badge: 'border-emerald-400/35 bg-emerald-500/12 text-emerald-200',
      glow: 'from-emerald-500/22 via-cyan-500/10 to-transparent',
      dot: 'bg-emerald-400 shadow-[0_0_20px_rgba(52,211,153,0.55)]',
      switch: 'bg-emerald-500/25',
      switchThumb: 'bg-emerald-200',
      title: '全部服務運行中',
      description: '目前維持完整辦公環境，背景工作、排程與輔助服務都會照常執行。',
      icon: ShieldCheck,
    }

  const AccentIcon = accentClasses.icon
  const nextMode = isWorkMode ? 'normal' : 'work'
  const statusLine = isWorkMode
    ? `保留 ${coreServiceCount} 項核心服務，已停用 ${stoppedServiceCount} / ${stoppedServiceTargetCount} 項背景服務`
    : `保留 ${coreServiceCount} 項核心服務，工作模式可停用 ${stoppedServiceTargetCount} 項背景服務`

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-[28px] border border-white/10 bg-[#05070d]/95 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.35)]"
      >
        <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${accentClasses.glow}`} />

        <div className="relative space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-3">
              <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] tracking-[0.18em] ${accentClasses.badge}`}>
                <Sparkles className="h-3.5 w-3.5" />
                WORK MODE
              </div>
              <div className="flex items-center gap-3">
                <div className={`flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/5 ${isWorkMode ? 'text-amber-300' : 'text-emerald-300'}`}>
                  <AccentIcon className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${accentClasses.dot}`} />
                    <p className="font-display text-lg text-white">{accentClasses.title}</p>
                  </div>
                  <p className="mt-1 max-w-md text-sm leading-6 text-gray-300">
                    {accentClasses.description}
                  </p>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setDialogMode(nextMode)}
              disabled={toggleDisabled}
              className={`relative inline-flex h-14 w-[118px] items-center rounded-full border border-white/10 px-2 transition ${accentClasses.switch} ${toggleDisabled ? 'cursor-not-allowed opacity-70' : 'hover:scale-[1.02]'}`}
              aria-label={isWorkMode ? '切換回一般模式' : '切換到工作模式'}
            >
              <motion.span
                animate={{ x: isWorkMode ? 58 : 0 }}
                transition={{ type: 'spring', stiffness: 320, damping: 24 }}
                className={`flex h-10 w-10 items-center justify-center rounded-full shadow-lg ${accentClasses.switchThumb}`}
              >
                {submitting ? (
                  <LoaderCircle className="h-5 w-5 animate-spin text-slate-900" />
                ) : (
                  <span className="h-2.5 w-2.5 rounded-full bg-slate-900" />
                )}
              </motion.span>
              <span className={`absolute left-4 text-[11px] font-medium tracking-[0.18em] ${isWorkMode ? 'text-white/35' : 'text-white/80'}`}>
                一般
              </span>
              <span className={`absolute right-4 text-[11px] font-medium tracking-[0.18em] ${isWorkMode ? 'text-white/90' : 'text-white/35'}`}>
                工作
              </span>
            </button>
          </div>

          <div className="rounded-3xl border border-white/8 bg-black/25 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs tracking-[0.16em] text-gray-500">即時狀態</p>
                <p className="mt-1 text-sm text-gray-200">
                  {statusLine}
                </p>
              </div>
              <div className="text-right text-xs text-gray-400">
                <p>{isWorkMode ? '所有 crontab 排程已暫停' : '排程與背景服務皆可正常恢復'}</p>
                {status?.since ? <p className="mt-1 text-[11px] text-gray-500">狀態自 {new Date(status.since).toLocaleString('zh-TW')}</p> : null}
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2 text-xs text-gray-300">
              {(status?.coreRunningServices || status?.coreServices || []).slice(0, 4).map((label) => (
                <span
                  key={label}
                  className="rounded-full border border-cyan-400/20 bg-cyan-500/10 px-2.5 py-1 text-cyan-100"
                >
                  {label}
                </span>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <LoaderCircle className="h-4 w-4 animate-spin" />
              正在讀取工作模式狀態...
            </div>
          ) : null}

          {error ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-gray-200 transition hover:bg-white/10"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                重新整理
              </button>
            </div>
          ) : null}
        </div>
      </motion.div>

      <AnimatePresence>
        {dialogMode ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          >
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.96 }}
              className="w-full max-w-lg rounded-[28px] border border-white/10 bg-[#060911] p-6 shadow-[0_30px_90px_rgba(0,0,0,0.45)]"
            >
              <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/25 bg-amber-500/10 px-3 py-1 text-xs tracking-[0.16em] text-amber-100">
                <AlertTriangle className="h-3.5 w-3.5" />
                切換確認
              </div>

              <h3 className="mt-4 font-display text-2xl text-white">
                {dialogMode === 'work' ? '切換到工作模式？' : '恢復一般模式？'}
              </h3>

              <p className="mt-3 text-sm leading-7 text-gray-300">
                {dialogMode === 'work'
                  ? `切換後將停用 ${stoppedServiceTargetCount} 個背景服務與所有 crontab 排程，只保留 ${coreServiceCount} 個核心服務。`
                  : '恢復一般模式後，已停用的 LaunchAgents 與 crontab 排程會重新啟用，背景自動化也會回到原本節奏。'}
              </p>

              <div className="mt-6 flex flex-wrap justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setDialogMode(null)}
                  disabled={submitting}
                  className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-gray-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  先不要
                </button>
                <button
                  type="button"
                  onClick={() => submitMode(dialogMode)}
                  disabled={submitting}
                  className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${dialogMode === 'work' ? 'bg-amber-400 text-slate-900 hover:bg-amber-300' : 'bg-emerald-400 text-slate-900 hover:bg-emerald-300'}`}
                >
                  {submitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
                  {dialogMode === 'work' ? '確認進入工作模式' : '確認恢復一般模式'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  )
}
