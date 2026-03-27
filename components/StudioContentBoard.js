'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowRight,
  ClipboardList,
  ExternalLink,
  FileStack,
  Lightbulb,
  MessageSquareText,
  Plus,
  RefreshCw,
  Settings,
  Sparkles,
} from 'lucide-react'
import { useStudioBusiness, readJsonResponse } from '../lib/useStudioBusiness'

function StatusBadge({ status }) {
  const map = {
    published: { label: '已上架', tone: '#39ff14' },
    storyboard_ready: { label: '可進 Sora', tone: '#00f5ff' },
    needs_review: { label: '待複查', tone: '#ffb703' },
    generated: { label: '已生成', tone: '#00f5ff' },
    draft: { label: '草稿', tone: '#9d4edd' },
    idea: { label: '想法', tone: '#9d4edd' },
    planned: { label: '已策劃', tone: '#00f5ff' },
    analyzed: { label: '已分析', tone: '#39ff14' },
  }
  const cur = map[status] || { label: status || '未分類', tone: '#94a3b8' }
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-[0.12em]"
      style={{ borderColor: `${cur.tone}55`, background: `${cur.tone}18`, color: cur.tone }}
    >
      {cur.label}
    </span>
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

function formatTime(value) {
  if (!value) return '—'
  return new Date(value).toLocaleString('zh-TW', { hour12: false })
}

function BusinessPill({ business, active, onSelect }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(business.business_id)}
      className="inline-flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm transition"
      style={
        active
          ? { borderColor: '#00f5ff55', background: '#00f5ff18', color: '#a5f3fc' }
          : { borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)', color: '#9ca3af' }
      }
    >
      {business.name}
    </button>
  )
}

export default function StudioContentBoard() {
  const {
    businesses,
    selectedBusinessId,
    selectedBusiness,
    loading: bizLoading,
    error: bizError,
    setError,
    selectBusiness,
  } = useStudioBusiness()

  const [contentItems, setContentItems] = useState([])
  const [recommendations, setRecommendations] = useState([])
  const [scriptVersions, setScriptVersions] = useState([])
  const [selectedContentItemId, setSelectedContentItemId] = useState('')
  const [contentSearch, setContentSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [panelLoading, setPanelLoading] = useState(false)
  const [error, setLocalError] = useState('')
  const [contentStats, setContentStats] = useState({ total: 0 })

  const handleError = useCallback((msg) => {
    setLocalError(msg)
    setError(msg)
  }, [setError])

  const selectedContentItem = useMemo(
    () => contentItems.find((i) => i.content_item_id === selectedContentItemId) || null,
    [contentItems, selectedContentItemId]
  )

  const latestVersion = useMemo(() => scriptVersions[0] || null, [scriptVersions])

  const buildPlanHref = useCallback((topic = '', angle = '') => (
    `/studio/plan?topic=${encodeURIComponent(topic || '')}&angle=${encodeURIComponent(angle || '')}&business_id=${selectedBusinessId || ''}`
  ), [selectedBusinessId])

  const filteredItems = useMemo(() => {
    const kw = contentSearch.trim().toLowerCase()
    return contentItems.filter((item) => {
      if (statusFilter !== 'all' && item.status !== statusFilter) return false
      if (!kw) return true
      return [item.title, item.topic, item.angle, item.template_id, item.product_tag]
        .filter(Boolean).join(' ').toLowerCase().includes(kw)
    })
  }, [contentItems, contentSearch, statusFilter])

  const loadVersions = useCallback(async (id) => {
    if (!id) { setScriptVersions([]); setSelectedContentItemId(''); return }
    const res = await fetch(
      `/api/studio/versions?contentItemId=${encodeURIComponent(id)}&latestOnly=1&summary=1`,
      { cache: 'no-store' }
    )
    const data = await readJsonResponse(res)
    if (!res.ok || data.error) throw new Error(data.error || '無法載入腳本版本')
    setSelectedContentItemId(id)
    setScriptVersions(Array.isArray(data.items) ? data.items : [])
  }, [])

  const loadPanels = useCallback(async (businessId) => {
    if (!businessId) {
      setContentItems([]); setRecommendations([]); setScriptVersions([])
      setSelectedContentItemId(''); return
    }
    setPanelLoading(true)
    try {
      const [contentRes, recRes] = await Promise.all([
        fetch(`/api/studio/content?businessId=${encodeURIComponent(businessId)}&limit=50`, { cache: 'no-store' }),
        fetch(`/api/studio/recommendations?businessId=${encodeURIComponent(businessId)}&count=6`, { cache: 'no-store' }),
      ])
      const [contentData, recData] = await Promise.all([
        readJsonResponse(contentRes),
        readJsonResponse(recRes),
      ])
      if (!contentRes.ok || contentData.error) throw new Error(contentData.error || '無法載入內容庫')
      if (!recRes.ok || recData.error) throw new Error(recData.error || '無法載入建議')

      const items = Array.isArray(contentData.items) ? contentData.items : []
      setContentItems(items)
      setRecommendations(Array.isArray(recData.items) ? recData.items : [])

      const stats = items.reduce((acc, item) => {
        acc.total += 1
        acc[item.status] = (acc[item.status] || 0) + 1
        return acc
      }, { total: 0 })
      setContentStats(stats)

      const fallback = items.some((i) => i.content_item_id === selectedContentItemId)
        ? selectedContentItemId
        : items[0]?.content_item_id || ''
      if (fallback) await loadVersions(fallback)
      else { setScriptVersions([]); setSelectedContentItemId('') }
    } catch (err) {
      handleError(err.message)
    } finally {
      setPanelLoading(false)
    }
  }, [loadVersions, selectedContentItemId, handleError])

  useEffect(() => {
    if (selectedBusinessId) loadPanels(selectedBusinessId)
  }, [selectedBusinessId]) // eslint-disable-line

  const loading = bizLoading || panelLoading
  const err = error || bizError

  return (
    <main className="min-h-screen px-4 py-6 lg:px-6 lg:py-8">
      <div className="mx-auto max-w-7xl space-y-6">

        {/* Header row */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">內容看板</h1>
            <p className="mt-1 text-sm text-gray-500">
              選商家 → 看推薦 → 挑下一支 → 進工作包
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href={buildPlanHref()}
              className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/40 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-300 transition hover:-translate-y-0.5"
            >
              <Plus className="h-4 w-4" />
              新建工作包
            </Link>
            <Link
              href="/studio/businesses"
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-gray-400 transition hover:text-white"
            >
              <Settings className="h-4 w-4" />
              商家管理
            </Link>
            <button
              type="button"
              onClick={() => loadPanels(selectedBusinessId)}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-gray-400 transition hover:text-white disabled:opacity-40"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {err ? (
          <div className="rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">{err}</div>
        ) : null}

        {/* Business selector */}
        <div className="glass-card rounded-[24px] p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-xs uppercase tracking-[0.18em] text-gray-500">選商家</div>
            <div className="text-xs text-gray-600">{businesses.length} 個商家</div>
          </div>
          {businesses.length === 0 ? (
            <div className="flex items-center gap-3 text-sm text-gray-500">
              還沒有商家—
              <Link href="/studio/businesses" className="text-cyan-400 underline">建立第一個</Link>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {businesses.map((b) => (
                <BusinessPill
                  key={b.business_id}
                  business={b}
                  active={b.business_id === selectedBusinessId}
                  onSelect={(id) => {
                    selectBusiness(id)
                    loadPanels(id)
                  }}
                />
              ))}
            </div>
          )}
          {selectedBusiness ? (
            <div className="mt-3 flex flex-wrap gap-3 border-t border-white/5 pt-3 text-xs text-gray-500">
              <span>類型：{selectedBusiness.category}</span>
              <span>受眾：{selectedBusiness.target_audience}</span>
              <span>語氣：{selectedBusiness.brand_tone}</span>
              <Link href="/studio/businesses" className="ml-auto text-gray-600 hover:text-gray-400">
                編輯設定 →
              </Link>
            </div>
          ) : null}
        </div>

        {/* Stats */}
        {selectedBusiness ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: '內容總數', value: contentStats.total || 0, tone: '#39ff14' },
              { label: '可進 Sora', value: contentStats.storyboard_ready || 0, tone: '#00f5ff' },
              { label: '待複查', value: contentStats.needs_review || 0, tone: '#ffb703' },
              { label: '已上架', value: contentStats.published || 0, tone: '#9d4edd' },
            ].map((m) => (
              <div
                key={m.label}
                className="rounded-2xl border px-4 py-3"
                style={{ borderColor: `${m.tone}33`, background: `${m.tone}08` }}
              >
                <div className="text-xs uppercase tracking-[0.16em] text-gray-500">{m.label}</div>
                <div className="mt-2 text-2xl font-bold" style={{ color: m.tone }}>{m.value}</div>
              </div>
            ))}
          </div>
        ) : null}

        <div className="grid gap-6 xl:grid-cols-[1fr_400px]">
          {/* Left: content library */}
          <div className="space-y-4">
            {/* Recommendations */}
            {recommendations.length > 0 ? (
              <div className="glass-card rounded-[24px] p-5" style={{ borderColor: '#ffb70333' }}>
                <div className="mb-4 flex items-center gap-3">
                  <div className="rounded-xl p-2" style={{ background: '#ffb70318', color: '#ffb703' }}>
                    <Lightbulb className="h-4 w-4" />
                  </div>
                  <div className="text-sm font-medium" style={{ color: '#ffb703' }}>系統建議下一支</div>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {recommendations.slice(0, 4).map((item) => (
                    <div
                      key={item.recommendation_id}
                      className="rounded-2xl border border-white/8 bg-black/20 p-3"
                    >
                      <div className="text-sm font-semibold text-white">{item.suggested_topic}</div>
                      <div className="mt-1 text-xs text-cyan-400">{item.suggested_angle}</div>
                      <div className="mt-2 text-xs leading-5 text-gray-500">{item.reason}</div>
                      <Link
                        href={buildPlanHref(item.suggested_topic, item.suggested_angle)}
                        className="mt-3 inline-flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300"
                      >
                        <Sparkles className="h-3 w-3" />
                        用這個建立工作包
                      </Link>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {/* Content library */}
            <div className="glass-card rounded-[24px] p-5" style={{ borderColor: '#39ff1433' }}>
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="rounded-xl p-2" style={{ background: '#39ff1418', color: '#39ff14' }}>
                    <FileStack className="h-4 w-4" />
                  </div>
                  <div className="text-sm font-medium" style={{ color: '#39ff14' }}>內容資料庫</div>
                </div>
                <div className="text-xs text-gray-500">{filteredItems.length} / {contentItems.length} 筆</div>
              </div>

              <div className="grid gap-3 md:grid-cols-[1fr_160px]">
                <input
                  value={contentSearch}
                  onChange={(e) => setContentSearch(e.target.value)}
                  placeholder="搜尋標題、主題、角度…"
                  className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none placeholder:text-gray-600"
                />
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none"
                >
                  <option value="all">全部狀態</option>
                  <option value="idea">想法</option>
                  <option value="needs_review">待複查</option>
                  <option value="storyboard_ready">可進 Sora</option>
                  <option value="published">已上架</option>
                </select>
              </div>

              {panelLoading ? (
                <div className="mt-4 rounded-2xl border border-dashed border-white/10 px-4 py-6 text-center text-sm text-gray-500">
                  載入中…
                </div>
              ) : filteredItems.length === 0 ? (
                <div className="mt-4 rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center">
                  <div className="text-sm text-gray-500">
                    {contentItems.length === 0
                      ? '這個商家還沒有內容，先去建立工作包。'
                      : '沒有符合條件的內容。'}
                  </div>
                  {contentItems.length === 0 ? (
                    <Link
                      href={buildPlanHref()}
                      className="mt-3 inline-flex items-center gap-2 text-sm text-cyan-400 hover:text-cyan-300"
                    >
                      <Plus className="h-4 w-4" />
                      新建工作包
                    </Link>
                  ) : null}
                </div>
              ) : (
                <div className="mt-4 space-y-2">
                  {filteredItems.map((item) => {
                    const selected = item.content_item_id === selectedContentItemId
                    return (
                      <button
                        type="button"
                        key={item.content_item_id}
                        onClick={() => loadVersions(item.content_item_id).catch((e) => handleError(e.message))}
                        className="w-full rounded-2xl border p-4 text-left transition hover:-translate-y-0.5"
                        style={{
                          borderColor: selected ? '#39ff1466' : 'rgba(255,255,255,0.07)',
                          background: selected ? 'rgba(57,255,20,0.08)' : 'rgba(0,0,0,0.15)',
                        }}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-white">{item.title}</div>
                            <div className="mt-0.5 line-clamp-1 text-xs text-gray-500">{item.topic}</div>
                          </div>
                          <StatusBadge status={item.status} />
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                          <span>角度：{item.angle || '—'}</span>
                          <span>·</span>
                          <span>{formatTime(item.created_at)}</span>
                          <Link
                            href={`/studio/content/${encodeURIComponent(item.content_item_id)}`}
                            onClick={(e) => e.stopPropagation()}
                            className="ml-auto inline-flex items-center gap-1 text-gray-400 hover:text-white"
                          >
                            <ExternalLink className="h-3 w-3" />
                            詳情
                          </Link>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Right: script version panel */}
          <div className="glass-card rounded-[24px] p-5" style={{ borderColor: '#00f5ff33' }}>
            <div className="mb-4 flex items-center gap-3">
              <div className="rounded-xl p-2" style={{ background: '#00f5ff18', color: '#00f5ff' }}>
                <MessageSquareText className="h-4 w-4" />
              </div>
              <div className="text-sm font-medium" style={{ color: '#00f5ff' }}>腳本版本</div>
            </div>

            {!selectedContentItem ? (
              <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-white/10 px-4 py-12 text-center">
                <ClipboardList className="h-8 w-8 text-gray-600" />
                <div className="text-sm text-gray-500">從左側點選一支內容<br />這裡會展開腳本詳情</div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs uppercase tracking-[0.12em] text-gray-500">選定內容</div>
                      <div className="mt-2 text-base font-semibold text-white">{selectedContentItem.title}</div>
                      <div className="mt-1 text-xs leading-5 text-gray-400">
                        {selectedContentItem.hook || selectedContentItem.topic}
                      </div>
                    </div>
                    <StatusBadge status={selectedContentItem.status} />
                  </div>
                  <div className="mt-3 flex items-center gap-3">
                    <Link
                      href={`/studio/content/${encodeURIComponent(selectedContentItem.content_item_id)}`}
                      className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-white"
                    >
                      <ExternalLink className="h-3 w-3" />
                      完整詳情頁
                    </Link>
                    <Link
                      href={buildPlanHref(selectedContentItem.topic, selectedContentItem.angle)}
                      className="ml-auto inline-flex items-center gap-1.5 text-xs text-cyan-400 hover:text-cyan-300"
                    >
                      <Sparkles className="h-3 w-3" />
                      重做這支
                    </Link>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-white/8 bg-black/20 p-3 text-center">
                    <div className="text-xs text-gray-500">版本數</div>
                    <div className="mt-1 text-2xl font-bold text-white">{scriptVersions.length}</div>
                  </div>
                  <div className="rounded-2xl border border-white/8 bg-black/20 p-3">
                    <div className="text-xs text-gray-500">最新建立</div>
                    <div className="mt-1 text-xs text-white">{formatTime(latestVersion?.created_at)}</div>
                  </div>
                </div>

                {latestVersion ? (
                  <div className="space-y-3">
                    <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
                      <div className="text-xs uppercase tracking-[0.12em] text-gray-500">最新版本</div>
                      <div className="mt-2 text-sm font-semibold text-white">{latestVersion.version_label}</div>
                      {latestVersion.summary?.title ? (
                        <div className="mt-2 text-xs text-gray-300">{latestVersion.summary.title}</div>
                      ) : null}
                      {latestVersion.summary?.hook ? (
                        <div className="mt-1 text-xs text-gray-500">{latestVersion.summary.hook}</div>
                      ) : null}
                    </div>

                    {[
                      { label: 'Guide', key: 'guide_path' },
                      { label: 'Storyboard', key: 'storyboard_path' },
                      { label: 'Scene pack', key: 'sora_scene_entry_pack_path' },
                    ].map(({ label, key }) =>
                      latestVersion.artifacts?.[key] ? (
                        <div
                          key={key}
                          className="rounded-2xl border border-white/8 bg-black/20 px-4 py-3"
                        >
                          <div className="text-xs uppercase tracking-[0.12em] text-gray-500">{label}</div>
                          <div className="mt-1 truncate text-xs text-gray-300">
                            {latestVersion.artifacts[key].split('/').slice(-2).join('/')}
                          </div>
                        </div>
                      ) : null
                    )}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-center text-sm text-gray-500">
                    這支內容還沒有腳本版本
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
