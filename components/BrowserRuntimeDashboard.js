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
      {ready ? 'Stack Ready' : 'Needs Attention'}
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
      {copied ? 'Copied' : 'Copy'}
    </button>
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
        throw new Error(data?.error || 'Failed to read Office access state')
      }
      setOfficeAccess({
        configured: Boolean(data.configured),
        authenticated: Boolean(data.authenticated),
        authSource: data.authSource || null,
      })
      return data
    } catch (loadError) {
      setOfficeAccess({ configured: false, authenticated: true, authSource: 'disabled' })
      setError(loadError.message || 'Failed to read Office access state')
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
          setError('Office token required before reading Browser Runtime.')
          return
        }
        throw new Error(data?.error || 'Browser stack API unavailable')
      }
      setSnapshot(data)
      setLoading(false)
    } catch (loadError) {
      console.error('Failed to load browser stack:', loadError)
      setError(loadError.message || 'Browser stack API unavailable')
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
        throw new Error(data?.error || 'Failed to authorize Office access')
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
      setError(submitError.message || 'Failed to authorize Office access')
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
        throw new Error(data?.error || 'Failed to clear Office access')
      }
      setOfficeAccess({
        configured: Boolean(data.configured),
        authenticated: Boolean(data.authenticated),
        authSource: data.authSource || null,
      })
      setSnapshot(null)
    } catch (clearError) {
      setError(clearError.message || 'Failed to clear Office access')
    } finally {
      setAccessBusy(false)
    }
  }, [])

  const metrics = useMemo(() => ([
    {
      label: 'Extension',
      value: snapshot?.opencliStatus?.extensionConnected ? 'Connected' : 'Offline',
      hint: 'opencli daemon 和 Chrome bridge 是否已經握手。',
      accent: snapshot?.opencliStatus?.extensionConnected ? '#39ff14' : '#ff6b35',
    },
    {
      label: 'CDP Targets',
      value: snapshot?.cdpTargetCount ?? 0,
      hint: '目前可附著的 Chrome DevTools targets 總數。',
      accent: '#00f5ff',
    },
    {
      label: 'Page Tabs',
      value: snapshot?.pageTargetCount ?? 0,
      hint: '目前可直接互動的 page 類型 targets。',
      accent: '#9d4edd',
    },
    {
      label: 'Pending',
      value: snapshot?.opencliStatus?.pending ?? 0,
      hint: 'opencli bridge 尚未處理完的 pending 訊息數。',
      accent: '#ffb703',
    },
  ]), [snapshot])

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-4 py-10">
      <div className="space-y-8">
        <section className="glass-card rounded-[32px] p-8 md:p-10">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-4xl">
              <div className="mb-4 inline-flex rounded-full border border-cyan-500/30 bg-cyan-500/8 px-4 py-2 text-xs uppercase tracking-[0.22em] text-cyan-300">
                Browser Runtime
              </div>
              <h1 className="font-display text-4xl leading-tight text-white md:text-5xl">
                真實 Chrome、MCP、browser CLI
                <span className="block text-cyan-300">統一看板。</span>
              </h1>
              <p className="mt-5 max-w-3xl text-sm leading-8 text-gray-300 md:text-base">
                這頁不是文件替代品，而是日常操作入口。先看 stack 是否健康，再複製正確命令，不用回頭翻 skill 或猜哪條 wrapper 才是最新真相。
              </p>
            </div>
            <div className="space-y-3">
              <StatusPill ready={Boolean(snapshot?.ready)} />
              <button
                type="button"
                onClick={fetchSnapshot}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-gray-200 transition hover:border-cyan-400/40 hover:text-white"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
          </div>
          {error ? (
            <div className="mt-6 rounded-2xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-100">
              Browser stack 目前不可用：{error}
            </div>
          ) : null}
          <div className="mt-6 text-xs text-gray-500">
            Last updated: {snapshot?.updatedAt ? new Date(snapshot.updatedAt).toLocaleString('zh-TW') : 'loading'}
          </div>
        </section>

        {officeAccess.configured && (
          <section className="glass-card rounded-[28px] p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="text-xs uppercase tracking-[0.18em] text-cyan-300">Browser Access</div>
                <div className="mt-2 text-sm leading-7 text-gray-300">
                  {officeAccess.authenticated
                    ? '這個瀏覽器已取得 Browser Runtime 存取權限。'
                    : 'Browser Runtime 現在也走 x-office 保護，先驗證一次再看 Chrome / MCP 真實狀態。'}
                </div>
                <div className="mt-2 text-[11px] text-gray-500">
                  header: <code>x-office-token</code>
                  {officeAccess.authSource ? ` / current: ${officeAccess.authSource}` : ''}
                </div>
              </div>
              {officeAccess.authenticated ? (
                <button
                  type="button"
                  disabled={accessBusy}
                  onClick={clearOfficeAccess}
                  className="rounded-lg border border-white/15 px-3 py-2 text-xs uppercase tracking-[0.18em] text-gray-200 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {accessBusy ? 'Signing Out...' : 'Clear Access'}
                </button>
              ) : (
                <form className="flex w-full max-w-xl flex-col gap-3 lg:w-auto lg:flex-row" onSubmit={submitOfficeAccess}>
                  <input
                    type="password"
                    value={tokenDraft}
                    onChange={(event) => setTokenDraft(event.target.value)}
                    placeholder="Paste OFFICE_ADMIN_TOKEN"
                    className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-400/40 lg:min-w-[320px]"
                  />
                  <button
                    type="submit"
                    disabled={accessBusy || !tokenDraft.trim()}
                    className="rounded-lg border border-cyan-400/40 bg-cyan-500/10 px-3 py-2 text-xs uppercase tracking-[0.18em] text-cyan-200 transition hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {accessBusy ? 'Authorizing...' : 'Authorize'}
                  </button>
                </form>
              )}
            </div>
          </section>
        )}

        {officeAccess.configured && !officeAccess.authenticated && !snapshot ? (
          <section className="glass-card rounded-[28px] p-6 text-sm leading-7 text-gray-300">
            先完成 Office access 驗證，這裡才會顯示真實 Chrome、CDP targets 與 browser CLI 狀態。
          </section>
        ) : null}

        {(!officeAccess.configured || officeAccess.authenticated || snapshot) && (
          <>
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {metrics.map((metric) => (
                <MetricCard key={metric.label} {...metric} />
              ))}
            </section>

            <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
              <div className="glass-card rounded-[28px] p-6">
                <div className="flex items-center gap-2 text-sm uppercase tracking-[0.18em] text-cyan-300">
                  <Terminal className="h-4 w-4" />
                  Command Presets
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
                <div className="glass-card rounded-[28px] p-6">
                  <div className="flex items-center gap-2 text-sm uppercase tracking-[0.18em] text-green-300">
                    <PlugZap className="h-4 w-4" />
                    Runtime Scripts
                  </div>
                  <div className="mt-5 space-y-3">
                    {snapshot?.scripts?.map((script) => (
                      <div key={script.id} className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-semibold text-white">{script.id}</div>
                          <div className={`text-xs ${script.exists ? 'text-green-300' : 'text-red-300'}`}>
                            {script.exists ? 'present' : 'missing'}
                          </div>
                        </div>
                        <div className="mt-2 break-all text-xs text-gray-500">{script.path}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="glass-card rounded-[28px] p-6">
                  <div className="flex items-center gap-2 text-sm uppercase tracking-[0.18em] text-purple-300">
                    <ExternalLink className="h-4 w-4" />
                    Connected Targets
                  </div>
                  <div className="mt-5 space-y-3">
                    {(snapshot?.cdpTargets || []).map((target) => (
                      <div key={target.id} className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-semibold text-white">{target.title || 'Untitled target'}</div>
                          <div className="text-xs uppercase tracking-[0.18em] text-gray-400">{target.type}</div>
                        </div>
                        <div className="mt-2 break-all text-xs text-gray-500">{target.url}</div>
                      </div>
                    ))}
                    {!snapshot?.cdpTargets?.length ? (
                      <div className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-sm text-gray-500">
                        目前沒有偵測到 CDP targets。先跑 `browser doctor` 或重新打開 bridge Chrome。
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
