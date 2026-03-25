'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Activity,
  Circle,
  Cpu,
  HardDrive,
  MemoryStick,
  Server,
  Wifi,
  WifiOff,
  Zap,
} from 'lucide-react'

const REFRESH_INTERVAL_MS = 5000
const GAUGE_RADIUS = 28
const GAUGE_STROKE = 6
const GAUGE_SIZE = 72
const GAUGE_CIRCUMFERENCE = 2 * Math.PI * GAUGE_RADIUS
const CYBER_TONES = {
  cyan: {
    solid: 'var(--cyber-cyan)',
    border: 'rgba(0, 245, 255, 0.2)',
    glow: 'rgba(0, 245, 255, 0.16)',
  },
  green: {
    solid: 'var(--cyber-green)',
    border: 'rgba(57, 255, 20, 0.2)',
    glow: 'rgba(57, 255, 20, 0.16)',
  },
  yellow: {
    solid: 'var(--cyber-yellow)',
    border: 'rgba(255, 215, 0, 0.2)',
    glow: 'rgba(255, 215, 0, 0.16)',
  },
  red: {
    solid: 'var(--cyber-red)',
    border: 'rgba(255, 0, 64, 0.2)',
    glow: 'rgba(255, 0, 64, 0.16)',
  },
}

function formatBytes(value) {
  if (!Number.isFinite(value) || value <= 0) return '0 B'

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let amount = value
  let unitIndex = 0

  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024
    unitIndex += 1
  }

  return `${amount >= 10 ? amount.toFixed(1) : amount.toFixed(2)} ${units[unitIndex]}`
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return '—'
  return `${Math.round(value)}%`
}

function formatUptime(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0h 0m'

  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return `${hours}h ${minutes}m`
}

function getGaugeColor(percent) {
  if (!Number.isFinite(percent)) return CYBER_TONES.cyan
  if (percent > 80) return CYBER_TONES.red
  if (percent >= 60) return CYBER_TONES.yellow
  return CYBER_TONES.green
}

function GaugeCard({ icon: Icon, label, percent, valueText, tone }) {
  const safePercent = Number.isFinite(percent) ? Math.max(0, Math.min(percent, 100)) : 0
  const dashOffset = GAUGE_CIRCUMFERENCE * (1 - safePercent / 100)

  return (
    <div
      className="rounded-[28px] border px-4 py-5 text-center"
      style={{
        borderColor: tone.border,
        background: 'linear-gradient(180deg, rgba(255,255,255,0.03), rgba(0,0,0,0.18))',
        boxShadow: `inset 0 0 0 1px ${tone.glow}, 0 0 24px ${tone.glow}`,
      }}
    >
      <div className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.22em]" style={{ color: tone.solid }}>
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>

      <div className="mt-4 flex items-center justify-center">
        <div className="relative" style={{ height: GAUGE_SIZE, width: GAUGE_SIZE }}>
          <svg className="-rotate-90" height={GAUGE_SIZE} width={GAUGE_SIZE} viewBox={`0 0 ${GAUGE_SIZE} ${GAUGE_SIZE}`}>
            <circle
              cx={GAUGE_SIZE / 2}
              cy={GAUGE_SIZE / 2}
              fill="none"
              r={GAUGE_RADIUS}
              stroke="rgba(255,255,255,0.1)"
              strokeWidth={GAUGE_STROKE}
            />
            <circle
              cx={GAUGE_SIZE / 2}
              cy={GAUGE_SIZE / 2}
              fill="none"
              r={GAUGE_RADIUS}
              stroke={tone.solid}
              strokeDasharray={GAUGE_CIRCUMFERENCE}
              strokeDashoffset={dashOffset}
              strokeLinecap="round"
              strokeWidth={GAUGE_STROKE}
              style={{
                filter: `drop-shadow(0 0 6px ${tone.solid})`,
                transition: 'stroke-dashoffset 480ms ease, stroke 240ms ease',
              }}
            />
          </svg>

          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="font-display text-lg text-white">{formatPercent(percent)}</div>
          </div>
        </div>
      </div>

      <div className="mt-3 text-sm text-gray-200">{valueText}</div>
    </div>
  )
}

function LoadingState() {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <div
          key={`loading-ring-${index}`}
          className="flex min-h-[184px] items-center justify-center rounded-[28px] border border-cyan-400/15 bg-black/10"
        >
          <div className="h-20 w-20 animate-spin rounded-full border-[6px] border-cyan-400/15 border-t-cyan-300 shadow-[0_0_24px_rgba(0,245,255,0.15)]" />
        </div>
      ))}
    </div>
  )
}

function ErrorState({ error, onRetry, busy }) {
  return (
    <div className="rounded-[28px] border border-red-500/30 bg-red-500/10 px-5 py-6">
      <div className="text-sm leading-7 text-red-200">{error}</div>
      <button
        type="button"
        onClick={onRetry}
        disabled={busy}
        className="mt-4 inline-flex items-center gap-2 rounded-full border border-red-400/30 bg-red-500/10 px-4 py-2 text-sm text-red-100 transition hover:border-red-300/60 hover:bg-red-500/15 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Activity className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
        {busy ? '重新連線中…' : '重新整理'}
      </button>
    </div>
  )
}

function ServiceColumn({ title, services }) {
  return (
    <div className="rounded-[28px] border border-white/10 bg-black/15 p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-cyan-300">
        <Server className="h-3.5 w-3.5" />
        {title}
      </div>

      <div className="mt-4 space-y-2">
        {services.map((service, index) => {
          const isOnline = Boolean(service.running)
          const hasOpenPort = Boolean(service.port && service.portOpen)
          const rowColor = isOnline ? 'var(--cyber-green)' : 'var(--cyber-red)'

          return (
            <motion.div
              key={service.label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.24, delay: index * 0.04 }}
              className={`flex items-center justify-between gap-3 rounded-2xl border border-white/5 px-3 py-3 ${isOnline ? '' : 'opacity-50'}`}
              style={{ background: 'rgba(255,255,255,0.02)' }}
              title={service.label}
            >
              <div className="flex min-w-0 items-center gap-3">
                <Circle
                  className="h-3.5 w-3.5 shrink-0"
                  style={{
                    color: rowColor,
                    fill: rowColor,
                    filter: `drop-shadow(0 0 6px ${rowColor})`,
                  }}
                />
                <div className="truncate text-sm text-white">{service.name}</div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {service.port ? (
                  hasOpenPort ? (
                    <>
                      <Wifi className="h-3.5 w-3.5 text-cyan-300" />
                      <span className="rounded-full border border-cyan-400/25 bg-cyan-400/10 px-2.5 py-1 text-[11px] font-medium text-cyan-200">
                        :{service.port}
                      </span>
                    </>
                  ) : (
                    <WifiOff className="h-3.5 w-3.5 text-gray-500" />
                  )
                ) : (
                  <Server className="h-3.5 w-3.5 text-gray-500" />
                )}
              </div>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}

export default function SystemMonitor() {
  const [stats, setStats] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const fetchStats = useCallback(async () => {
    try {
      setRefreshing(true)
      setError('')

      const response = await fetch('/api/office/system-stats', { cache: 'no-store' })
      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('請先完成辦公室驗證，才能查看系統監控。')
        }
        throw new Error(data?.error || '目前暫時讀不到系統效能資料。')
      }

      setStats(data)
      setLoading(false)
    } catch (loadError) {
      console.error('Failed to load system stats:', loadError)
      setError(loadError.message || '目前暫時讀不到系統效能資料。')
      setLoading(false)
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    let intervalId = null
    let cancelled = false

    async function bootstrap() {
      await fetchStats()
      if (cancelled) return
      intervalId = window.setInterval(fetchStats, REFRESH_INTERVAL_MS)
    }

    bootstrap()

    return () => {
      cancelled = true
      if (intervalId) window.clearInterval(intervalId)
    }
  }, [fetchStats])

  const coreServices = useMemo(
    () => stats?.services?.filter((service) => service.core) ?? [],
    [stats],
  )
  const backgroundServices = useMemo(
    () => stats?.services?.filter((service) => !service.core) ?? [],
    [stats],
  )

  const memoryPercent = stats?.memory?.percentActive ?? stats?.memory?.percentUsed ?? null
  const cpuPercent = stats?.cpu?.percent ?? null
  const diskPercent = stats?.disk?.percentUsed ?? null

  const cpuTone = getGaugeColor(cpuPercent)
  const memoryTone = getGaugeColor(memoryPercent)
  const diskTone = getGaugeColor(diskPercent)
  const loadAverageText = Number.isFinite(stats?.cpu?.loadAvg?.one)
    ? stats.cpu.loadAvg.one.toFixed(2)
    : '0.00'

  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: 'easeOut' }}
      className="space-y-5"
    >
      {loading ? (
        <LoadingState />
      ) : error && !stats ? (
        <ErrorState error={error} onRetry={fetchStats} busy={refreshing} />
      ) : (
        <>
          <section
            className="rounded-[28px] border p-5 md:p-6"
            style={{
              borderColor: 'rgba(0, 245, 255, 0.16)',
              background: 'linear-gradient(180deg, rgba(0, 245, 255, 0.05), rgba(0, 0, 0, 0.16))',
            }}
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-cyan-300">
                <Activity className="h-4 w-4" />
                效能概覽
              </div>
              <div className="flex flex-col items-start gap-2 sm:items-end">
                <div className="text-[11px] text-gray-500">每 5 秒更新</div>
                <button
                  type="button"
                  onClick={fetchStats}
                  disabled={refreshing}
                  className="inline-flex items-center gap-2 self-start rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-gray-200 transition hover:border-cyan-400/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Activity className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                  {refreshing ? '更新中…' : '立即更新'}
                </button>
              </div>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-3">
              <GaugeCard
                icon={Cpu}
                label="CPU"
                percent={cpuPercent}
                valueText={`共 ${stats?.cpu?.count ?? '—'} 核心`}
                tone={cpuTone}
              />
              <GaugeCard
                icon={MemoryStick}
                label="記憶體"
                percent={memoryPercent}
                valueText={`${formatBytes(stats?.memory?.active ?? stats?.memory?.used)} / ${formatBytes(stats?.memory?.total)}`}
                tone={memoryTone}
              />
              <GaugeCard
                icon={HardDrive}
                label="磁碟 /"
                percent={diskPercent}
                valueText={`${formatBytes(stats?.disk?.used)} / ${formatBytes(stats?.disk?.total)}`}
                tone={diskTone}
              />
            </div>

            <div className="mt-5 grid gap-3 text-xs text-gray-400 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/5 bg-black/15 px-4 py-3">
                負載 1m: <span className="font-medium text-cyan-200">{loadAverageText}</span>
              </div>
              <div className="rounded-2xl border border-white/5 bg-black/15 px-4 py-3">
                運行 <span className="font-medium text-cyan-200">{formatUptime(stats?.uptimeSec)}</span>
              </div>
            </div>
          </section>

          <section className="rounded-[28px] border border-white/10 bg-black/10 p-5 md:p-6">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-cyan-300">
              <Server className="h-4 w-4" />
              服務狀態
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <ServiceColumn title="核心服務" services={coreServices} />
              <ServiceColumn title="背景服務" services={backgroundServices} />
            </div>
          </section>

          {Array.isArray(stats?.extraPorts) && stats.extraPorts.length > 0 ? (
            <section className="rounded-[28px] border border-white/10 bg-black/10 p-5 md:p-6">
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-cyan-300">
                <Zap className="h-4 w-4" />
                其他監聽 PORT
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {stats.extraPorts.map((entry) => (
                  <div
                    key={`${entry.port}-${entry.pid || 'na'}`}
                    className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1.5 text-xs text-cyan-100"
                  >
                    <span className="font-medium">:{entry.port}</span>
                    <span className="text-cyan-50/80">{entry.process || '未知程序'}</span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {error ? (
            <div className="rounded-2xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-xs text-red-200">
              {error}
            </div>
          ) : null}
        </>
      )}
    </motion.div>
  )
}
