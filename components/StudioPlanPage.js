'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  ArrowLeft,
  CheckCheck,
  ClipboardList,
  Copy,
  ShieldAlert,
  Sparkles,
} from 'lucide-react'
import { useStudioBusiness, readJsonResponse, buildHeaders } from '../lib/useStudioBusiness'

function Field({ label, hint, children }) {
  return (
    <label className="block space-y-1.5">
      <div>
        <div className="text-xs uppercase tracking-[0.18em] text-gray-500">{label}</div>
        {hint ? <div className="text-[11px] text-gray-600">{hint}</div> : null}
      </div>
      {children}
    </label>
  )
}

function TextInput(props) {
  return (
    <input
      {...props}
      className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none placeholder:text-gray-600"
    />
  )
}

function ToneTag({ children, tone = '#00f5ff' }) {
  return (
    <span
      className="inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] text-white/80"
      style={{ borderColor: `${tone}33`, background: `${tone}12` }}
    >
      {children}
    </span>
  )
}

function ArtifactRow({ label, value, onCopy, tone = '#00f5ff' }) {
  if (!value) return null
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/8 bg-black/20 px-4 py-3">
      <div className="min-w-0">
        <div className="text-xs uppercase tracking-[0.12em] text-gray-500">{label}</div>
        <div className="mt-1 truncate text-xs text-white">{value.split('/').slice(-2).join('/')}</div>
      </div>
      <button
        type="button"
        onClick={() => onCopy(value)}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-gray-300 hover:text-white"
        style={{ borderColor: `${tone}33` }}
      >
        <Copy className="h-3.5 w-3.5" />
        複製
      </button>
    </div>
  )
}

export default function StudioPlanPage() {
  const searchParams = useSearchParams()
  const urlBusinessId = searchParams?.get('business_id') || ''

  const {
    businesses,
    selectedBusinessId,
    selectedBusiness,
    loading: bizLoading,
    error: bizError,
    authToken,
    setAuthToken,
    selectBusiness,
  } = useStudioBusiness()

  const [form, setForm] = useState({
    topic: searchParams?.get('topic') || '',
    angle: searchParams?.get('angle') || '',
    niche: '',
    audience: '',
    variant: 'A',
    mode: 'native_sora_master',
  })

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [result, setResult] = useState(null)

  // When business changes, auto-fill audience/niche
  useEffect(() => {
    if (selectedBusiness) {
      setForm((current) => ({
        ...current,
        audience: current.audience || selectedBusiness.target_audience || '',
        niche: current.niche || selectedBusiness.category || '',
      }))
    }
  }, [selectedBusiness])

  useEffect(() => {
    if (urlBusinessId && businesses.length > 0) {
      const match = businesses.find((b) => b.business_id === urlBusinessId)
      if (match) selectBusiness(urlBusinessId)
    }
  }, [urlBusinessId, businesses]) // eslint-disable-line react-hooks/exhaustive-deps

  const copyText = useCallback(async (value) => {
    if (!value) return
    try {
      await navigator.clipboard.writeText(String(value))
      setNotice('已複製到剪貼簿')
      setTimeout(() => setNotice(''), 1600)
    } catch {
      setError('複製失敗，請手動複製')
    }
  }, [])

  const handleGenerate = useCallback(async () => {
    if (!selectedBusinessId) { setError('請先選一個商家'); return }
    if (!form.topic.trim()) { setError('請填寫主題'); return }
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/studio/workspace', {
        method: 'POST',
        headers: buildHeaders(authToken),
        body: JSON.stringify({ business_id: selectedBusinessId, ...form }),
      })
      const data = await readJsonResponse(response)
      if (response.status === 401) throw new Error('需要辦公室授權 token 才能建立工作包')
      if (!response.ok || data.error) throw new Error(data.error || '建立工作包失敗')
      setResult(data)
      setNotice('工作包已建立！')
      setTimeout(() => setNotice(''), 2000)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }, [selectedBusinessId, form, authToken])

  return (
    <main className="min-h-screen px-4 py-6 lg:px-6 lg:py-8">
      <div className="mx-auto max-w-3xl space-y-6">

        {/* Header */}
        <div>
          <Link href="/studio" className="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-300">
            <ArrowLeft className="h-3.5 w-3.5" />
            回內容看板
          </Link>
          <h1 className="text-2xl font-bold text-white">新建工作包</h1>
          <p className="mt-1 text-sm text-gray-500">輸入主題和角度，系統產出 storyboard、scene pack 和操作指南</p>
        </div>

        {error ? (
          <div className="rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>
        ) : null}
        {notice ? (
          <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{notice}</div>
        ) : null}

        {/* Business selector */}
        <div className="glass-card rounded-[24px] p-5" style={{ borderColor: '#00f5ff33' }}>
          <div className="mb-3 text-xs uppercase tracking-[0.18em] text-gray-500">商家</div>
          {bizLoading ? (
            <div className="text-sm text-gray-500">讀取中…</div>
          ) : businesses.length === 0 ? (
            <div className="text-sm text-gray-500">
              還沒有商家—<Link href="/studio/businesses" className="text-cyan-400 underline">先建立一個</Link>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {businesses.map((b) => (
                <button
                  key={b.business_id}
                  type="button"
                  onClick={() => selectBusiness(b.business_id)}
                  className="inline-flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm transition"
                  style={
                    b.business_id === selectedBusinessId
                      ? { borderColor: '#00f5ff55', background: '#00f5ff18', color: '#a5f3fc' }
                      : { borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)', color: '#9ca3af' }
                  }
                >
                  {b.name}
                </button>
              ))}
            </div>
          )}
          {bizError ? <div className="mt-2 text-xs text-red-400">{bizError}</div> : null}
        </div>

        {/* Workspace form */}
        <div className="glass-card rounded-[24px] p-5" style={{ borderColor: '#9d4edd33' }}>
          <div className="mb-4 flex items-center gap-3">
            <div className="rounded-xl p-2" style={{ background: '#9d4edd18', color: '#9d4edd' }}>
              <ClipboardList className="h-4 w-4" />
            </div>
            <div className="text-sm font-medium" style={{ color: '#9d4edd' }}>工作包設定</div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="主題 *">
              <TextInput
                value={form.topic}
                onChange={(e) => setForm((c) => ({ ...c, topic: e.target.value }))}
                placeholder="例如：第一次拍短影音，最容易漏掉什麼？"
              />
            </Field>
            <Field label="角度">
              <TextInput
                value={form.angle}
                onChange={(e) => setForm((c) => ({ ...c, angle: e.target.value }))}
                placeholder="例如：用老闆最容易理解的方式拆解準備"
              />
            </Field>
            <Field label="內容分類">
              <TextInput
                value={form.niche}
                onChange={(e) => setForm((c) => ({ ...c, niche: e.target.value }))}
              />
            </Field>
            <Field label="受眾覆寫" hint="留空則使用商家預設受眾">
              <TextInput
                value={form.audience}
                onChange={(e) => setForm((c) => ({ ...c, audience: e.target.value }))}
              />
            </Field>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleGenerate}
              disabled={busy || !selectedBusinessId}
              className="inline-flex items-center gap-2 rounded-xl border px-5 py-3 text-sm font-semibold transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-40"
              style={{ borderColor: '#9d4edd55', background: '#9d4edd18', color: '#d8b4fe' }}
            >
              <Sparkles className="h-4 w-4" />
              {busy ? '產生中…' : '產生工作包'}
            </button>
            <ToneTag tone="#ffb703">Sora 先半自動</ToneTag>
            <ToneTag tone="#00f5ff">底部 composer 保持留空</ToneTag>
          </div>

          <div className="mt-3">
            <input
              type="password"
              value={authToken}
              onChange={(e) => setAuthToken(e.target.value)}
              placeholder="OFFICE_ADMIN_TOKEN（若已啟用才需填）"
              className="w-full rounded-xl border border-white/8 bg-black/10 px-3 py-2 text-xs text-gray-400 outline-none placeholder:text-gray-600"
            />
          </div>
        </div>

        {/* Result */}
        {result ? (
          <div className="glass-card space-y-4 rounded-[24px] p-5" style={{ borderColor: '#39ff1433' }}>
            <div className="flex items-center gap-2 text-sm font-semibold text-emerald-200">
              <CheckCheck className="h-4 w-4" />
              工作包已建立
            </div>

            <div className="grid gap-3 text-sm text-gray-300 md:grid-cols-2">
              <div><span className="text-gray-500">主題：</span>{result.selected_topic}</div>
              <div><span className="text-gray-500">角度：</span>{result.selected_angle}</div>
              <div><span className="text-gray-500">Draft：</span>{result.draft_slug}</div>
            </div>

            <div className="space-y-2">
              <ArtifactRow label="操作指南" value={result.guide_path} onCopy={copyText} tone="#9d4edd" />
              <ArtifactRow label="Storyboard" value={result.storyboard_path} onCopy={copyText} />
              <ArtifactRow label="Scene pack" value={result.scene_entry_pack_path} onCopy={copyText} tone="#39ff14" />
              <ArtifactRow label="Upload template" value={result.upload_manifest_template_path} onCopy={copyText} tone="#ffb703" />
            </div>

            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/8 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-amber-200">
                <ShieldAlert className="h-4 w-4" />
                Sora 手動操作提醒
              </div>
              <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm leading-6 text-gray-300">
                <li>打開 scene pack，逐格貼到 Sora Storyboard scene card</li>
                <li>每格貼完立刻填對應秒數，不要最後才回頭改</li>
                <li>底部整片描述欄保持留空，不要碰左下角 +</li>
                <li>確認總長正確後再按 Create，下載原生影片後回到系統接字幕與上傳</li>
              </ol>
            </div>

            <div className="flex gap-3">
              <Link
                href="/studio"
                className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-gray-300 hover:text-white"
              >
                ← 回內容看板
              </Link>
              <button
                type="button"
                onClick={() => { setResult(null); setForm({ topic: '', angle: '', niche: '', audience: '', variant: 'A', mode: 'native_sora_master' }) }}
                className="inline-flex items-center gap-2 rounded-xl border border-purple-500/30 bg-purple-500/10 px-4 py-2.5 text-sm text-purple-300 hover:text-white"
              >
                <Sparkles className="h-4 w-4" />
                再建一個
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  )
}
