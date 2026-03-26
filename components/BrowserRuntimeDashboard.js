'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Clipboard, ExternalLink, PlugZap, RefreshCw, Terminal, XCircle } from 'lucide-react'

function StatusPill({ ready }) {
  return (
    <div
      className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs uppercase tracking-[0.22em]"
      style={{
        borderColor: ready ? '#39ff1444' : '#ffb70344',
        color: ready ? '#86efac' : '#fcd34d',
        background: ready ? '#39ff1412' : '#ffb70312',
      }}
    >
      {ready ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
      {ready ? '可直接使用' : '需要留意'}
    </div>
  )
}

function MetricCard({ label, value, hint, accent }) {
  return (
    <div className="glass-card rounded-[24px] p-5" style={{ borderColor: `${accent}44` }}>
      <div className="text-xs uppercase tracking-[0.22em]" style={{ color: accent }}>
        {label}
      </div>
      <div className="mt-3 text-3xl font-bold text-white">{value}</div>
      <div className="mt-2 text-sm leading-6 text-gray-400">{hint}</div>
    </div>
  )
}

function CopyButton({ value }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch (error) {
      console.error('Failed to copy command:', error)
    }
  }, [value])

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-gray-200 transition hover:border-cyan-400/40 hover:text-white"
    >
      <Clipboard className="h-3.5 w-3.5" />
      {copied ? '已複製' : '複製'}
    </button>
  )
}

function SectionLabel({ icon: Icon, children, tone = '#00f5ff' }) {
  return (
    <div className="flex items-center gap-2 text-sm uppercase tracking-[0.18em]" style={{ color: tone }}>
      <Icon className="h-4 w-4" />
      <span>{children}</span>
    </div>
  )
}

function RuntimeItem({ label, value, detail, tone = '#00f5ff' }) {
  return (
    <div className="rounded-[22px] border border-white/8 bg-black/20 p-4">
      <div className="text-[11px] uppercase tracking-[0.18em] text-gray-500">{label}</div>
      <div className="mt-2 text-base font-semibold" style={{ color: tone }}>{value}</div>
      {detail ? <div className="mt-2 text-sm leading-6 text-gray-400">{detail}</div> : null}
    </div>
  )
}

export default function BrowserRuntimeDashboard({ initialSnapshot }) {
  const [officeAccess, setOfficeAccess] = useState({ configured: false, authenticated: true, authSource: 'disabled' })
  const [tokenDraft, setTokenDraft] = useState('')
  const [accessBusy, setAccessBusy] = useState(false)
  const [snapshot, setSnapshot] = useState(initialSnapshot)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(!initialSnapshot)

  const refreshOfficeAccess = useCallback(async () => {
    try {
      const response = await fetch('/api/office/session', { cache: 'no-store' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data?.error || '無法讀取目前的辦公室權限')
      }
      setOfficeAccess({
        configured: Boolean(data.configured),
        authenticated: Boolean(data.authenticated),
        authSource: data.authSource || null,
      })
      return data
    } catch (loadError) {
      setOfficeAccess({ configured: false, authenticated: true, authSource: 'disabled' })
      setError(loadError.message || '無法讀取目前的辦公室權限')
      return null
    }
  }, [])

  const fetchSnapshot = useCallback(async () => {
    try {
      setError('')
      const response = await fetch('/api/browser-stack', { cache: 'no-store' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        if (response.status === 401) {
          await refreshOfficeAccess()
          setSnapshot(null)
          setError('請先完成辦公室驗證，才能查看這頁工具。')
          return
        }
        throw new Error(data?.error || '目前暫時讀不到瀏覽器工具資訊')
      }
      setSnapshot(data)
      setLoading(false)
    } catch (loadError) {
      console.error('Failed to load browser stack:', loadError)
      setError(loadError.message || '目前暫時讀不到瀏覽器工具資訊')
      setLoading(false)
    }
  }, [refreshOfficeAccess])

  useEffect(() => {
    let interval = null
    let cancelled = false

    async function bootstrap() {
      const access = await refreshOfficeAccess()
      if (cancelled) return
      if (!access?.configured || access?.authenticated) {
        await fetchSnapshot()
        if (cancelled) return
        interval = window.setInterval(fetchSnapshot, 15000)
      } else {
        setSnapshot(null)
        setLoading(false)
      }
    }

    bootstrap()
    return () => {
      cancelled = true
      if (interval) window.clearInterval(interval)
    }
  }, [fetchSnapshot, refreshOfficeAccess])

  const submitOfficeAccess = useCallback(async (event) => {
    event.preventDefault()
    setAccessBusy(true)
    setError('')
    try {
      const response = await fetch('/api/office/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: tokenDraft.trim() }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data?.error || '驗證失敗，請再試一次')
      }
      setOfficeAccess({
        configured: Boolean(data.configured),
        authenticated: Boolean(data.authenticated),
        authSource: data.authSource || 'cookie',
      })
      setTokenDraft('')
      setLoading(true)
      await fetchSnapshot()
    } catch (submitError) {
      setError(submitError.message || '驗證失敗，請再試一次')
    } finally {
      setAccessBusy(false)
    }
  }, [fetchSnapshot, tokenDraft])

  const clearOfficeAccess = useCallback(async () => {
    setAccessBusy(true)
    setError('')
    try {
      const response = await fetch('/api/office/session', { method: 'DELETE' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data?.error || '無法清除這次驗證')
      }
      setOfficeAccess({
        configured: Boolean(data.configured),
        authenticated: Boolean(data.authenticated),
        authSource: data.authSource || null,
      })
      setSnapshot(null)
    } catch (clearError) {
      setError(clearError.message || '無法清除這次驗證')
    } finally {
      setAccessBusy(false)
    }
  }, [])

  const metrics = useMemo(() => ([
    {
      label: '連線外掛',
      value: snapshot?.opencliStatus?.extensionConnected ? '已連上' : '未連上',
      hint: '現在瀏覽器這端有沒有順利接上。',
      accent: snapshot?.opencliStatus?.extensionConnected ? '#39ff14' : '#ff6b35',
    },
    {
      label: '可附著頁面',
      value: snapshot?.cdpTargetCount ?? 0,
      hint: '目前可以接上檢查的頁面數量。',
      accent: '#00f5ff',
    },
    {
      label: '可互動分頁',
      value: snapshot?.pageTargetCount ?? 0,
      hint: '目前可以直接操作的頁面分頁數量。',
      accent: '#9d4edd',
    },
    {
      label: '待處理訊息',
      value: snapshot?.opencliStatus?.pending ?? 0,
      hint: '還沒處理完的瀏覽器橋接訊息數量。',
      accent: '#ffb703',
    },
  ]), [snapshot])

  const runtimeSummary = useMemo(() => ([
    {
      label: '橋接狀態',
      value: snapshot?.opencliStatus?.extensionConnected ? '擴充功能已連上' : '等待擴充功能',
      detail: snapshot?.opencliStatus?.extensionConnected
        ? '可以直接對現有瀏覽器分頁做附著與互動。'
        : '先確認 Chrome 擴充功能與橋接程序都已啟動。',
      tone: snapshot?.opencliStatus?.extensionConnected ? '#39ff14' : '#ffb703',
    },
    {
      label: '可附著頁面',
      value: `${snapshot?.cdpTargetCount ?? 0} 個`,
      detail: '代表目前有多少分頁能被接手檢查或操作。',
      tone: '#00f5ff',
    },
    {
      label: '橋接佇列',
      value: `${snapshot?.opencliStatus?.pending ?? 0} 筆`,
      detail: '數字偏高時，通常代表有命令還沒消化完。',
      tone: '#8b5cf6',
    },
  ]), [snapshot])

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-4 py-6 md:py-8">
      <div className="space-y-8">
        <section className="glass-card rounded-[34px] p-5 md:p-7">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_320px]">
            <div className="max-w-4xl">
              <div className="mb-4 inline-flex rounded-full border border-cyan-500/25 bg-cyan-500/8 px-4 py-2 text-xs uppercase tracking-[0.22em] text-cyan-300">
                瀏覽器工具
              </div>
              <h1 className="font-display text-4xl leading-tight text-white md:text-5xl">
                先確認連線，
                <span className="block text-cyan-300">再複製指令。</span>
              </h1>
              <p className="mt-5 max-w-3xl text-sm leading-7 text-gray-400 md:text-base">
                這頁只留兩件事：橋接狀態現在能不能用，以及常用命令在哪裡。先判斷，再動手。
              </p>
            </div>

            <div className="rounded-[28px] border border-white/10 bg-black/20 p-5">
              <div className="flex items-center justify-between gap-3">
                <StatusPill ready={Boolean(snapshot?.ready)} />
                <button
                  type="button"
                  onClick={fetchSnapshot}
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-gray-200 transition hover:border-cyan-400/40 hover:text-white"
                >
                  <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                  重新整理
                </button>
              </div>

              <div className="mt-5 space-y-3">
                {runtimeSummary.map((item) => (
                  <RuntimeItem key={item.label} {...item} />
                ))}
              </div>

              <div className="mt-5 text-xs text-gray-500">
                最近更新: {snapshot?.updatedAt ? new Date(snapshot.updatedAt).toLocaleString('zh-TW') : '讀取中'}
              </div>
            </div>
          </div>

          {error ? (
            <div className="mt-6 rounded-2xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-100">
              目前暫時讀不到瀏覽器工具資訊：{error}
            </div>
          ) : null}
        </section>

        {officeAccess.configured && (
          <section className="glass-card rounded-[28px] p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="text-xs uppercase tracking-[0.18em] text-cyan-300">工具存取</div>
                <div className="mt-2 text-sm leading-7 text-gray-400">
                  {officeAccess.authenticated
                    ? '這個瀏覽器已驗證過，可以直接看工具狀態。'
                    : '這頁有保護機制。先驗證一次，再看橋接與命令。'}
                </div>
                <div className="mt-2 text-[11px] text-gray-500">
                  驗證欄位: <code>x-office-token</code>
                  {officeAccess.authSource ? ` / 目前: ${officeAccess.authSource}` : ''}
                </div>
              </div>
              {officeAccess.authenticated ? (
                <button
                  type="button"
                  disabled={accessBusy}
                  onClick={clearOfficeAccess}
                  className="rounded-lg border border-white/15 px-3 py-2 text-xs uppercase tracking-[0.18em] text-gray-200 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {accessBusy ? '清除中...' : '清除權限'}
                </button>
              ) : (
                <form className="flex w-full max-w-xl flex-col gap-3 lg:w-auto lg:flex-row" onSubmit={submitOfficeAccess}>
                  <input
                    type="password"
                    value={tokenDraft}
                    onChange={(event) => setTokenDraft(event.target.value)}
                    placeholder="貼上 Office 驗證碼"
                    className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-400/40 lg:min-w-[320px]"
                  />
                  <button
                    type="submit"
                    disabled={accessBusy || !tokenDraft.trim()}
                    className="rounded-lg border border-cyan-400/40 bg-cyan-500/10 px-3 py-2 text-xs uppercase tracking-[0.18em] text-cyan-200 transition hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {accessBusy ? '驗證中...' : '確認'}
                  </button>
                </form>
              )}
            </div>
          </section>
        )}

        {officeAccess.configured && !officeAccess.authenticated && !snapshot ? (
          <section className="glass-card rounded-[28px] p-6 text-sm leading-7 text-gray-300">
            先完成驗證，這裡才會顯示瀏覽器連線狀態與常用指令。
          </section>
        ) : null}

        {(!officeAccess.configured || officeAccess.authenticated || snapshot) && (
          <>
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {metrics.map((metric) => (
                <MetricCard key={metric.label} {...metric} />
              ))}
            </section>

            <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
              <div className="rounded-[28px] border border-white/10 bg-black/20 p-6">
                <SectionLabel icon={Terminal}>常用指令</SectionLabel>
                <div className="mt-2 text-sm leading-7 text-gray-400">
                  常用動作集中在這裡，照情境複製就好。
                </div>

                <div className="mt-5 grid gap-4">
                  {snapshot?.commandPresets?.map((preset) => (
                    <div
                      key={preset.id}
                      className="rounded-[24px] border p-4"
                      style={{ borderColor: `${preset.tone}44`, background: `${preset.tone}10` }}
                    >
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="space-y-2">
                          <div className="text-xs uppercase tracking-[0.22em]" style={{ color: preset.tone }}>
                            {preset.label}
                          </div>
                          <div className="text-sm leading-7 text-gray-300">{preset.description}</div>
                          <code className="block overflow-x-auto rounded-2xl border border-black/20 bg-black/30 px-3 py-3 text-xs text-cyan-100">
                            {preset.command}
                          </code>
                        </div>
                        <CopyButton value={preset.command} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-[28px] border border-white/10 bg-black/20 p-6">
                  <SectionLabel icon={PlugZap} tone="#39ff14">工具腳本</SectionLabel>
                  <div className="mt-2 text-sm leading-7 text-gray-400">
                    確認本機工具還在不在，不用再猜路徑。
                  </div>
                  <div className="mt-5 space-y-3">
                    {snapshot?.scripts?.map((script) => (
                      <div key={script.id} className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-semibold text-white">{script.id}</div>
                          <div className={`text-xs ${script.exists ? 'text-green-300' : 'text-red-300'}`}>
                            {script.exists ? '可用' : '缺少'}
                          </div>
                        </div>
                        <div className="mt-2 break-all text-xs text-gray-500">{script.path}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-[28px] border border-white/10 bg-black/20 p-6">
                  <SectionLabel icon={ExternalLink} tone="#c084fc">已連上的頁面</SectionLabel>
                  <div className="mt-2 text-sm leading-7 text-gray-400">
                    這些是現在能直接接手檢查的分頁。
                  </div>
                  <div className="mt-5 space-y-3">
                    {(snapshot?.cdpTargets || []).map((target) => (
                      <div key={target.id} className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-semibold text-white">{target.title || '未命名頁面'}</div>
                          <div className="text-xs uppercase tracking-[0.18em] text-gray-400">{target.type}</div>
                        </div>
                        <div className="mt-2 break-all text-xs text-gray-500">{target.url}</div>
                      </div>
                    ))}
                    {!snapshot?.cdpTargets?.length ? (
                      <div className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-sm text-gray-500">
                        目前還沒有偵測到可連線的頁面。先跑 `browser doctor`，或重新打開那個 Chrome 視窗。
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  )
}
