'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, CheckCheck, ClipboardList, Copy, ExternalLink, FileStack, LoaderCircle, Sparkles } from 'lucide-react'

function readJsonResponse(response) {
  return response.text().then((text) => {
    if (!text) return {}
    try {
      return JSON.parse(text)
    } catch {
      return { error: text.slice(0, 300) || 'Unexpected response' }
    }
  })
}

function ActionButton({ children, tone = '#00f5ff', onClick, disabled = false, busy = false, variant = 'solid' }) {
  const background = variant === 'ghost' ? 'rgba(255,255,255,0.03)' : `${tone}18`
  const color = variant === 'ghost' ? '#d1d5db' : tone
  const borderColor = variant === 'ghost' ? 'rgba(255,255,255,0.08)' : `${tone}55`

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className="inline-flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-40"
      style={{ borderColor, background, color }}
    >
      {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
      {children}
    </button>
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

function StatusBadge({ status }) {
  const map = {
    published: { label: '已上架', tone: '#39ff14' },
    storyboard_ready: { label: '可進 Sora', tone: '#00f5ff' },
    needs_review: { label: '待人工複查', tone: '#ffb703' },
    generated: { label: '已生成', tone: '#00f5ff' },
    draft: { label: '草稿', tone: '#9d4edd' },
    idea: { label: '想法', tone: '#9d4edd' },
    planned: { label: '已策劃', tone: '#00f5ff' },
    analyzed: { label: '已分析', tone: '#39ff14' },
  }
  const current = map[status] || { label: status || '未分類', tone: '#94a3b8' }
  return (
    <span
      className="inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-[0.12em]"
      style={{ borderColor: `${current.tone}55`, background: `${current.tone}18`, color: current.tone }}
    >
      {current.label}
    </span>
  )
}

function compactPath(value) {
  if (!value) return '—'
  const segments = String(value).split('/')
  return segments.slice(-2).join('/')
}

function formatTime(value) {
  if (!value) return '—'
  return new Date(value).toLocaleString('zh-TW', { hour12: false })
}

function safeArray(value) {
  return Array.isArray(value) ? value : []
}

function SectionCard({ title, tone, icon: Icon, description = '', children, actions = null }) {
  return (
    <div className="glass-card rounded-[28px] p-6" style={{ borderColor: `${tone}44` }}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl p-3" style={{ background: `${tone}18`, color: tone }}>
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm uppercase tracking-[0.18em]" style={{ color: tone }}>
              {title}
            </div>
            {description ? <div className="mt-1 text-xs leading-5 text-gray-500">{description}</div> : null}
          </div>
        </div>
        {actions}
      </div>
      <div className="mt-5">{children}</div>
    </div>
  )
}

function ArtifactRow({ label, value, onCopy }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
      <div className="min-w-0">
        <div className="text-xs uppercase tracking-[0.16em] text-gray-500">{label}</div>
        <div className="mt-1 truncate text-sm text-white">{compactPath(value)}</div>
        <div className="mt-1 truncate text-[11px] text-gray-500">{value || '—'}</div>
      </div>
      <ActionButton tone="#00f5ff" variant="ghost" onClick={() => onCopy(value)} disabled={!value}>
        <Copy className="h-4 w-4" />
        複製
      </ActionButton>
    </div>
  )
}

export default function StudioContentDetail({ contentItemId }) {
  const [item, setItem] = useState(null)
  const [versions, setVersions] = useState([])
  const [selectedVersionId, setSelectedVersionId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const selectedVersion = useMemo(
    () => versions.find((entry) => entry.version_id === selectedVersionId) || versions[0] || null,
    [selectedVersionId, versions]
  )

  const loadData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [itemRes, versionsRes] = await Promise.all([
        fetch(`/api/studio/content?contentItemId=${encodeURIComponent(contentItemId)}`, { cache: 'no-store' }),
        fetch(`/api/studio/versions?contentItemId=${encodeURIComponent(contentItemId)}`, { cache: 'no-store' }),
      ])
      const [itemData, versionsData] = await Promise.all([readJsonResponse(itemRes), readJsonResponse(versionsRes)])
      if (!itemRes.ok || itemData.error) throw new Error(itemData.error || '無法載入內容資料')
      if (!versionsRes.ok || versionsData.error) throw new Error(versionsData.error || '無法載入版本資料')
      const nextItem = itemData.item || null
      const nextVersions = safeArray(versionsData.items)
      setItem(nextItem)
      setVersions(nextVersions)
      setSelectedVersionId((current) => current || nextVersions[0]?.version_id || '')
    } catch (fetchError) {
      setError(fetchError.message)
    } finally {
      setLoading(false)
    }
  }, [contentItemId])

  useEffect(() => {
    loadData()
  }, [loadData])

  const copyText = useCallback(async (value) => {
    if (!value) return
    try {
      await navigator.clipboard.writeText(String(value))
      setNotice('已複製到剪貼簿。')
      window.setTimeout(() => setNotice(''), 1800)
    } catch {
      setError('複製失敗，請手動複製。')
    }
  }, [])

  if (loading) {
    return (
      <main className="min-h-screen px-4 py-6 lg:px-6 lg:py-8">
        <div className="mx-auto max-w-7xl">
          <div className="glass-card rounded-[32px] p-8 text-sm text-gray-400">正在載入內容詳情…</div>
        </div>
      </main>
    )
  }

  if (error || !item) {
    return (
      <main className="min-h-screen px-4 py-6 lg:px-6 lg:py-8">
        <div className="mx-auto max-w-7xl space-y-4">
          <Link href="/studio" className="inline-flex items-center gap-2 text-sm text-cyan-300 transition hover:text-cyan-200">
            <ArrowLeft className="h-4 w-4" />
            回內容策劃中台
          </Link>
          <div className="glass-card rounded-[32px] border border-red-500/30 p-8 text-sm text-red-200">
            {error || '找不到這支內容。'}
          </div>
        </div>
      </main>
    )
  }

  const latestScript = selectedVersion?.script_json || {}
  const latestStoryboard = selectedVersion?.storyboard_json || {}
  const latestArtifacts = selectedVersion?.artifacts || {}
  const sceneCount = safeArray(latestStoryboard.scenes || latestStoryboard.scene_list).length

  return (
    <main className="min-h-screen px-4 py-6 lg:px-6 lg:py-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="glass-card overflow-hidden rounded-[32px] p-5 md:p-7">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(0,245,255,0.13),transparent_30%),radial-gradient(circle_at_bottom_left,rgba(157,78,221,0.14),transparent_28%)]" />
          <div className="relative flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl">
              <Link href="/studio" className="inline-flex items-center gap-2 text-sm text-cyan-300 transition hover:text-cyan-200">
                <ArrowLeft className="h-4 w-4" />
                回內容策劃中台
              </Link>
              <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-cyan-500/25 bg-cyan-500/8 px-4 py-2 text-xs uppercase tracking-[0.22em] text-cyan-300">
                <FileStack className="h-3.5 w-3.5" />
                內容詳情頁
              </div>
              <h1 className="mt-4 font-display text-3xl leading-tight text-white md:text-5xl">
                {item.title}
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-gray-300 md:text-base">
                {item.hook || item.topic}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <StatusBadge status={item.status} />
                {item.template_id ? <ToneTag tone="#9d4edd">{item.template_id}</ToneTag> : null}
                {item.product_tag ? <ToneTag tone="#39ff14">{item.product_tag}</ToneTag> : null}
                {item.audience_tag ? <ToneTag tone="#ffb703">{item.audience_tag}</ToneTag> : null}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                <div className="text-xs uppercase tracking-[0.16em] text-gray-500">版本數</div>
                <div className="mt-2 text-2xl font-display text-white">{versions.length}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                <div className="text-xs uppercase tracking-[0.16em] text-gray-500">建立時間</div>
                <div className="mt-2 text-sm text-white">{formatTime(item.created_at)}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                <div className="text-xs uppercase tracking-[0.16em] text-gray-500">最近更新</div>
                <div className="mt-2 text-sm text-white">{formatTime(item.updated_at)}</div>
              </div>
            </div>
          </div>

          {notice ? (
            <div className="relative mt-5 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
              {notice}
            </div>
          ) : null}
        </section>

        <section className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
          <div className="space-y-6">
            <SectionCard
              title="版本列表"
              tone="#00f5ff"
              icon={ClipboardList}
              description="切換不同腳本版本，比對 hook、scene 與工作包。"
              actions={
                <ActionButton tone="#9d4edd" variant="ghost" onClick={loadData}>
                  <Sparkles className="h-4 w-4" />
                  重新整理
                </ActionButton>
              }
            >
              <div className="space-y-3">
                {versions.map((version) => {
                  const active = version.version_id === selectedVersion?.version_id
                  return (
                    <button
                      key={version.version_id}
                      type="button"
                      onClick={() => setSelectedVersionId(version.version_id)}
                      className="w-full rounded-2xl border p-4 text-left transition hover:-translate-y-0.5"
                      style={{
                        borderColor: active ? '#00f5ff66' : 'rgba(255,255,255,0.08)',
                        background: active ? 'rgba(0,245,255,0.10)' : 'rgba(0,0,0,0.18)',
                      }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-white">{version.version_label}</div>
                          <div className="mt-1 text-xs text-gray-500">{formatTime(version.created_at)}</div>
                        </div>
                        <ToneTag tone={version.storyboard_json?.quality_result?.passed === false ? '#ffb703' : '#39ff14'}>
                          {version.script_json?.variant || version.summary?.variant || 'A'}
                        </ToneTag>
                      </div>
                      <div className="mt-3 text-xs leading-6 text-gray-400">
                        {(version.script_json?.hook || version.summary?.hook || '—').slice(0, 120)}
                      </div>
                    </button>
                  )
                })}
              </div>
            </SectionCard>

            <SectionCard
              title="工作包操作"
              tone="#ffb703"
              icon={CheckCheck}
              description="這頁先聚焦人工製作與半自動 Sora 的操作脈絡。"
            >
              <ol className="space-y-2 pl-5 text-sm leading-7 text-gray-300 list-decimal">
                <li>先確認標題、hook、scene 數是否符合這支內容的目的。</li>
                <li>複製 `scene pack`，逐格貼進 Sora Storyboard。</li>
                <li>每格貼完立刻填秒數，底部 composer 保持留空。</li>
                <li>下載原生影片後，再回主系統做字幕與上傳。</li>
              </ol>
            </SectionCard>
          </div>

          <div className="space-y-6">
            <SectionCard
              title="腳本摘要"
              tone="#39ff14"
              icon={MessageSquareText}
              description="看目前版本的標題、hook、旁白骨幹與 storyboard 概況。"
            >
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="text-xs uppercase tracking-[0.16em] text-gray-500">標題</div>
                  <div className="mt-2 text-sm leading-7 text-white">{latestScript.title || '—'}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="text-xs uppercase tracking-[0.16em] text-gray-500">Hook</div>
                  <div className="mt-2 text-sm leading-7 text-white">{latestScript.hook || '—'}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="text-xs uppercase tracking-[0.16em] text-gray-500">Payoff</div>
                  <div className="mt-2 text-sm leading-7 text-white">{latestScript.payoff || '—'}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="text-xs uppercase tracking-[0.16em] text-gray-500">Storyboard</div>
                  <div className="mt-2 text-sm leading-7 text-white">
                    {latestStoryboard.template_id || '未指定模板'} / {sceneCount || 0} 個 scene
                  </div>
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="text-xs uppercase tracking-[0.16em] text-gray-500">旁白骨幹</div>
                <div className="mt-2 text-sm leading-7 text-gray-300 whitespace-pre-wrap">
                  {latestScript.narration_text || '—'}
                </div>
              </div>
            </SectionCard>

            <SectionCard
              title="Storyboard 與工作包"
              tone="#00f5ff"
              icon={FileStack}
              description="保留完整路徑，讓你可以直接回到草稿與手動操作檔。"
              actions={
                <Link
                  href="/studio"
                  className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-gray-300 transition hover:-translate-y-0.5 hover:text-white"
                >
                  <ExternalLink className="h-4 w-4" />
                  回工作台
                </Link>
              }
            >
              <div className="grid gap-3 md:grid-cols-2">
                <ArtifactRow label="Guide" value={latestArtifacts.guide_path} onCopy={copyText} />
                <ArtifactRow label="Storyboard" value={latestArtifacts.storyboard_path} onCopy={copyText} />
                <ArtifactRow label="Manifest" value={latestArtifacts.manifest_path} onCopy={copyText} />
                <ArtifactRow label="Scene pack" value={latestArtifacts.sora_scene_entry_pack_path} onCopy={copyText} />
                <ArtifactRow label="Sora master plan" value={latestArtifacts.sora_master_plan_path} onCopy={copyText} />
                <ArtifactRow label="Upload template" value={latestArtifacts.upload_manifest_template_path} onCopy={copyText} />
              </div>
            </SectionCard>
          </div>
        </section>
      </div>
    </main>
  )
}
