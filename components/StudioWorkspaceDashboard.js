'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowRight,
  Building2,
  CheckCheck,
  ClipboardList,
  Copy,
  ExternalLink,
  FileStack,
  FolderOpen,
  Lightbulb,
  LoaderCircle,
  MessageSquareText,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Target,
  WandSparkles,
} from 'lucide-react'

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

function SectionCard({ title, tone, icon: Icon, children, actions = null, description = '' }) {
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

function MetricPill({ label, value, tone, hint = '' }) {
  return (
    <div className="rounded-2xl border px-4 py-3" style={{ borderColor: `${tone}44`, background: `${tone}10` }}>
      <div className="text-xs uppercase tracking-[0.16em] text-gray-500">{label}</div>
      <div className="mt-2 text-2xl font-display text-white">{value}</div>
      {hint ? <div className="mt-2 text-xs leading-5 text-gray-500">{hint}</div> : null}
    </div>
  )
}

function Field({ label, hint, children }) {
  return (
    <label className="block space-y-2">
      <div>
        <div className="text-xs uppercase tracking-[0.18em] text-gray-500">{label}</div>
        {hint ? <div className="mt-1 text-[11px] leading-5 text-gray-500">{hint}</div> : null}
      </div>
      {children}
    </label>
  )
}

function TextInput(props) {
  return (
    <input
      {...props}
      className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-white outline-none placeholder:text-gray-600"
    />
  )
}

function TextAreaInput(props) {
  return (
    <textarea
      {...props}
      className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-white outline-none placeholder:text-gray-600"
    />
  )
}

function ActionButton({ children, tone = '#00f5ff', disabled, onClick, busy = false, variant = 'solid' }) {
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

function formatList(items) {
  if (!Array.isArray(items) || items.length === 0) return []
  return items.filter(Boolean)
}

function buildHeaders(token) {
  if (!token) return { 'Content-Type': 'application/json' }
  return {
    'Content-Type': 'application/json',
    'x-office-token': token,
  }
}

function textListValue(items) {
  if (!Array.isArray(items) || items.length === 0) return ''
  return items.join(', ')
}

function compactPath(value) {
  if (!value) return '—'
  const segments = String(value).split('/')
  return segments.slice(-2).join('/')
}

function safeArray(value) {
  return Array.isArray(value) ? value : []
}

function formStateFromBusiness(business) {
  if (!business) {
    return {
      name: '',
      category: '商家短影音',
      brand_tone: '可信、清楚、好理解',
      target_audience: '一般消費者',
      key_offers: '',
      priority_goals: '',
      frequent_questions: '',
      avoid_topics: '',
      notes: '',
    }
  }
  return {
    name: business.name || '',
    category: business.category || '商家短影音',
    brand_tone: business.brand_tone || '可信、清楚、好理解',
    target_audience: business.target_audience || '一般消費者',
    key_offers: textListValue(business.key_offers),
    priority_goals: textListValue(business.priority_goals),
    frequent_questions: textListValue(business.frequent_questions),
    avoid_topics: textListValue(business.avoid_topics),
    notes: business.notes || '',
  }
}

function BusinessCard({ business, active, onSelect }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(business.business_id)}
      className="w-full rounded-2xl border p-4 text-left transition hover:-translate-y-0.5"
      style={{
        borderColor: active ? '#00f5ff66' : 'rgba(148,163,184,0.18)',
        background: active ? 'rgba(0,245,255,0.1)' : 'rgba(0,0,0,0.18)',
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-white">{business.name}</div>
          <div className="mt-1 text-xs text-gray-500">{business.category}</div>
        </div>
        <ArrowRight className="h-4 w-4 text-gray-500" />
      </div>
      <div className="mt-3 text-xs leading-6 text-gray-400">受眾：{business.target_audience || '—'}</div>
      <div className="mt-2 flex flex-wrap gap-2">
        {safeArray(business.key_offers).slice(0, 2).map((item) => (
          <ToneTag key={item} tone="#39ff14">
            {item}
          </ToneTag>
        ))}
      </div>
    </button>
  )
}

function DetailList({ label, items, empty = '—', tone = '#00f5ff' }) {
  const normalized = safeArray(items)
  return (
    <div className="space-y-2">
      <div className="text-xs uppercase tracking-[0.16em] text-gray-500">{label}</div>
      {normalized.length === 0 ? (
        <div className="text-sm text-gray-500">{empty}</div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {normalized.map((item) => (
            <ToneTag key={`${label}-${item}`} tone={tone}>
              {item}
            </ToneTag>
          ))}
        </div>
      )}
    </div>
  )
}

function WorkspaceArtifact({ label, value, onCopy, tone = '#00f5ff' }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
      <div className="min-w-0">
        <div className="text-xs uppercase tracking-[0.16em] text-gray-500">{label}</div>
        <div className="mt-1 truncate text-sm text-white">{compactPath(value)}</div>
        <div className="mt-1 truncate text-[11px] text-gray-500">{value || '—'}</div>
      </div>
      <ActionButton tone={tone} variant="ghost" onClick={() => onCopy(value)} disabled={!value}>
        <Copy className="h-4 w-4" />
        複製
      </ActionButton>
    </div>
  )
}

export default function StudioWorkspaceDashboard() {
  const [businesses, setBusinesses] = useState([])
  const [selectedBusinessId, setSelectedBusinessId] = useState('')
  const [contentItems, setContentItems] = useState([])
  const [scriptVersions, setScriptVersions] = useState([])
  const [selectedContentItemId, setSelectedContentItemId] = useState('')
  const [recommendations, setRecommendations] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyAction, setBusyAction] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [authToken, setAuthToken] = useState('')
  const [contentSearch, setContentSearch] = useState('')
  const [contentStatusFilter, setContentStatusFilter] = useState('all')
  const [workspaceResult, setWorkspaceResult] = useState(null)
  const [businessForm, setBusinessForm] = useState({
    name: '',
    category: '商家短影音',
    brand_tone: '可信、清楚、好理解',
    target_audience: '一般消費者',
    key_offers: '',
    priority_goals: '',
    frequent_questions: '',
    avoid_topics: '',
    notes: '',
  })
  const [workspaceForm, setWorkspaceForm] = useState({
    topic: '',
    angle: '',
    niche: '',
    audience: '',
    variant: 'A',
    mode: 'native_sora_master',
  })

  const selectedBusiness = useMemo(
    () => businesses.find((item) => item.business_id === selectedBusinessId) || null,
    [businesses, selectedBusinessId]
  )

  const selectedContentItem = useMemo(
    () => contentItems.find((item) => item.content_item_id === selectedContentItemId) || null,
    [contentItems, selectedContentItemId]
  )

  const latestVersion = useMemo(() => scriptVersions[0] || null, [scriptVersions])

  const contentStats = useMemo(() => {
    const counts = contentItems.reduce(
      (accumulator, item) => {
        accumulator.total += 1
        accumulator[item.status] = (accumulator[item.status] || 0) + 1
        return accumulator
      },
      { total: 0 }
    )
    return counts
  }, [contentItems])

  const filteredContentItems = useMemo(() => {
    const keyword = contentSearch.trim().toLowerCase()
    return contentItems.filter((item) => {
      if (contentStatusFilter !== 'all' && item.status !== contentStatusFilter) return false
      if (!keyword) return true
      const haystack = [
        item.title,
        item.topic,
        item.angle,
        item.template_id,
        item.product_tag,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(keyword)
    })
  }, [contentItems, contentSearch, contentStatusFilter])

  const loadVersions = useCallback(async (contentItemId) => {
    if (!contentItemId) {
      setScriptVersions([])
      setSelectedContentItemId('')
      return
    }
    const response = await fetch(
      `/api/studio/versions?contentItemId=${encodeURIComponent(contentItemId)}&latestOnly=1&summary=1`,
      { cache: 'no-store' }
    )
    const data = await readJsonResponse(response)
    if (!response.ok || data.error) throw new Error(data.error || '無法載入腳本版本')
    setSelectedContentItemId(contentItemId)
    setScriptVersions(Array.isArray(data.items) ? data.items : [])
  }, [])

  const loadBusinesses = useCallback(async () => {
    const response = await fetch('/api/studio/businesses', { cache: 'no-store' })
    const data = await readJsonResponse(response)
    if (!response.ok || data.error) throw new Error(data.error || '無法載入商家資料')
    const items = Array.isArray(data.items) ? data.items : []
    setBusinesses(items)
    if (!selectedBusinessId && items[0]?.business_id) {
      setSelectedBusinessId(items[0].business_id)
    }
    return items
  }, [selectedBusinessId])

  const loadBusinessPanels = useCallback(
    async (businessId, preferredContentItemId = '') => {
      if (!businessId) {
        setContentItems([])
        setRecommendations([])
        setScriptVersions([])
        setSelectedContentItemId('')
        return
      }

      const [contentRes, recommendationRes] = await Promise.all([
        fetch(`/api/studio/content?businessId=${encodeURIComponent(businessId)}&limit=20`, { cache: 'no-store' }),
        fetch(`/api/studio/recommendations?businessId=${encodeURIComponent(businessId)}&count=6`, { cache: 'no-store' }),
      ])
      const [contentData, recommendationData] = await Promise.all([
        readJsonResponse(contentRes),
        readJsonResponse(recommendationRes),
      ])
      if (!contentRes.ok || contentData.error) throw new Error(contentData.error || '無法載入內容庫')
      if (!recommendationRes.ok || recommendationData.error) throw new Error(recommendationData.error || '無法載入題材建議')

      const items = Array.isArray(contentData.items) ? contentData.items : []
      setContentItems(items)
      setRecommendations(Array.isArray(recommendationData.items) ? recommendationData.items : [])

      const fallbackContentItemId =
        preferredContentItemId
        || (items.some((item) => item.content_item_id === selectedContentItemId) ? selectedContentItemId : '')
        || items[0]?.content_item_id
        || ''

      if (fallbackContentItemId) {
        await loadVersions(fallbackContentItemId)
      } else {
        setScriptVersions([])
        setSelectedContentItemId('')
      }
    },
    [loadVersions, selectedContentItemId]
  )

  const refreshAll = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const items = await loadBusinesses()
      const businessId = selectedBusinessId || items[0]?.business_id || ''
      if (businessId) {
        await loadBusinessPanels(businessId)
      }
    } catch (fetchError) {
      setError(fetchError.message)
    } finally {
      setLoading(false)
    }
  }, [loadBusinesses, loadBusinessPanels, selectedBusinessId])

  useEffect(() => {
    refreshAll()
  }, [refreshAll])

  useEffect(() => {
    if (selectedBusiness) {
      setBusinessForm(formStateFromBusiness(selectedBusiness))
      setWorkspaceForm((current) => ({
        ...current,
        audience: selectedBusiness.target_audience || '',
        niche: selectedBusiness.category || '',
      }))
    }
  }, [selectedBusiness])

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

  const handleBusinessSave = useCallback(async () => {
    setBusyAction('save-business')
    setError('')
    try {
      const response = await fetch('/api/studio/businesses', {
        method: 'POST',
        headers: buildHeaders(authToken),
        body: JSON.stringify(businessForm),
      })
      const data = await readJsonResponse(response)
      if (response.status === 401) throw new Error('需要辦公室授權 token 才能寫入商家資料。')
      if (!response.ok || data.error) throw new Error(data.error || '儲存商家失敗')
      const items = await loadBusinesses()
      const businessId = data.business?.business_id || items[0]?.business_id || ''
      if (businessId) {
        setSelectedBusinessId(businessId)
        await loadBusinessPanels(businessId)
      }
      setNotice('商家資料已更新。')
      window.setTimeout(() => setNotice(''), 1800)
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setBusyAction('')
    }
  }, [authToken, businessForm, loadBusinesses, loadBusinessPanels])

  const handleGenerateWorkspace = useCallback(async () => {
    if (!selectedBusinessId) {
      setError('請先選一個商家。')
      return
    }
    setBusyAction('generate-workspace')
    setError('')
    try {
      const response = await fetch('/api/studio/workspace', {
        method: 'POST',
        headers: buildHeaders(authToken),
        body: JSON.stringify({
          business_id: selectedBusinessId,
          ...workspaceForm,
        }),
      })
      const data = await readJsonResponse(response)
      if (response.status === 401) throw new Error('需要辦公室授權 token 才能建立工作包。')
      if (!response.ok || data.error) throw new Error(data.error || '建立工作包失敗')
      setWorkspaceResult(data)
      await loadBusinessPanels(selectedBusinessId, data.content_item_id)
      setNotice('工作包已建立，可以往 Sora 手動操作。')
      window.setTimeout(() => setNotice(''), 2000)
    } catch (workspaceError) {
      setError(workspaceError.message)
    } finally {
      setBusyAction('')
    }
  }, [authToken, loadBusinessPanels, selectedBusinessId, workspaceForm])

  const selectedBusinessOffers = formatList(selectedBusiness?.key_offers)
  const selectedBusinessGoals = formatList(selectedBusiness?.priority_goals)
  const selectedBusinessQuestions = formatList(selectedBusiness?.frequent_questions)
  const selectedBusinessAvoid = formatList(selectedBusiness?.avoid_topics)

  return (
    <main className="min-h-screen px-4 py-6 lg:px-6 lg:py-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <motion.section initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} className="glass-card overflow-hidden rounded-[32px] p-5 md:p-7">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(0,245,255,0.13),transparent_30%),radial-gradient(circle_at_bottom_left,rgba(157,78,221,0.14),transparent_28%)]" />
          <div className="relative flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/25 bg-cyan-500/8 px-4 py-2 text-xs uppercase tracking-[0.22em] text-cyan-300">
                <WandSparkles className="h-3.5 w-3.5" />
                Studio 模式
              </div>
              <h1 className="mt-4 font-display text-3xl leading-tight text-white md:text-5xl">
                商家內容中台
                <span className="mt-2 block text-cyan-300">先策劃，再半自動進 Sora。</span>
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-gray-300 md:text-base">
                這裡是內容來源的上游：先整理商家、盤點已做內容、挑下一支，再把 scene pack 丟進手動生成流程。
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <ToneTag tone="#00f5ff">同一產品線</ToneTag>
                <ToneTag tone="#39ff14">Studio / Factory 共用資料</ToneTag>
                <ToneTag tone="#ffb703">Sora 先半自動</ToneTag>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:min-w-[420px] xl:grid-cols-4">
              <MetricPill label="商家數" value={businesses.length} tone="#00f5ff" />
              <MetricPill label="內容總數" value={contentStats.total || 0} tone="#39ff14" />
              <MetricPill label="可進 Sora" value={contentStats.storyboard_ready || 0} tone="#9d4edd" />
              <MetricPill label="待複查" value={contentStats.needs_review || 0} tone="#ffb703" />
            </div>
          </div>

          <div className="relative mt-5 flex flex-wrap items-center gap-3">
            <TextInput
              type="password"
              value={authToken}
              onChange={(event) => setAuthToken(event.target.value)}
              placeholder="若 OFFICE_ADMIN_TOKEN 有啟用，可在這裡填入 token"
            />
            <ActionButton onClick={refreshAll} busy={loading} tone="#9d4edd">
              <RefreshCw className="h-4 w-4" />
              重新整理
            </ActionButton>
            {notice ? (
              <div className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                {notice}
              </div>
            ) : null}
          </div>
          {error ? <div className="relative mt-4 rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div> : null}
        </motion.section>

        <section className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
          <div className="space-y-6">
            <SectionCard
              title="商家目錄"
              tone="#00f5ff"
              icon={Building2}
              description="先選商家，再看推薦、內容庫和工作包。"
              actions={<div className="text-xs text-gray-500">{loading ? '讀取中…' : `${businesses.length} 個商家`}</div>}
            >
              <div className="space-y-3">
                {businesses.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-sm text-gray-500">
                    還沒有商家資料，先建立一個。
                  </div>
                ) : (
                  businesses.map((business) => (
                    <BusinessCard
                      key={business.business_id}
                      business={business}
                      active={business.business_id === selectedBusinessId}
                      onSelect={(businessId) => {
                        setSelectedBusinessId(businessId)
                        loadBusinessPanels(businessId).catch((fetchError) => setError(fetchError.message))
                      }}
                    />
                  ))
                )}
              </div>
            </SectionCard>

            <SectionCard
              title="商家設定"
              tone="#9d4edd"
              icon={FolderOpen}
              description="品牌語氣、主力服務與避免題材都先在這裡定好。"
            >
              <div className="grid gap-4">
                <Field label="商家名稱">
                  <TextInput value={businessForm.name} onChange={(event) => setBusinessForm((current) => ({ ...current, name: event.target.value }))} placeholder="例如：B.W. Studio" />
                </Field>
                <Field label="商家類型">
                  <TextInput value={businessForm.category} onChange={(event) => setBusinessForm((current) => ({ ...current, category: event.target.value }))} />
                </Field>
                <Field label="品牌語氣">
                  <TextInput value={businessForm.brand_tone} onChange={(event) => setBusinessForm((current) => ({ ...current, brand_tone: event.target.value }))} />
                </Field>
                <Field label="目標受眾">
                  <TextInput value={businessForm.target_audience} onChange={(event) => setBusinessForm((current) => ({ ...current, target_audience: event.target.value }))} />
                </Field>
                <Field label="主力產品 / 服務" hint="用逗號分隔">
                  <TextInput value={businessForm.key_offers} onChange={(event) => setBusinessForm((current) => ({ ...current, key_offers: event.target.value }))} placeholder="短影音企劃, 拍攝製作" />
                </Field>
                <Field label="優先目標" hint="用逗號或換行分隔">
                  <TextAreaInput rows={3} value={businessForm.priority_goals} onChange={(event) => setBusinessForm((current) => ({ ...current, priority_goals: event.target.value }))} />
                </Field>
                <Field label="常見問題" hint="用逗號或換行分隔">
                  <TextAreaInput rows={3} value={businessForm.frequent_questions} onChange={(event) => setBusinessForm((current) => ({ ...current, frequent_questions: event.target.value }))} />
                </Field>
                <Field label="避免題材" hint="例如：政治、療效保證">
                  <TextInput value={businessForm.avoid_topics} onChange={(event) => setBusinessForm((current) => ({ ...current, avoid_topics: event.target.value }))} />
                </Field>
                <Field label="備註">
                  <TextAreaInput rows={3} value={businessForm.notes} onChange={(event) => setBusinessForm((current) => ({ ...current, notes: event.target.value }))} />
                </Field>
                <ActionButton onClick={handleBusinessSave} busy={busyAction === 'save-business'}>
                  儲存商家資料
                </ActionButton>
              </div>
            </SectionCard>
          </div>

          <div className="space-y-6">
            <SectionCard
              title="商家摘要"
              tone="#00f5ff"
              icon={Target}
              description="先看這間商家現在的內容定位，避免每次都從零開始。"
              actions={selectedBusiness ? <StatusBadge status="planned" /> : null}
            >
              {selectedBusiness ? (
                <div className="space-y-6">
                  <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                    <div className="rounded-[24px] border border-white/10 bg-black/20 p-5">
                      <div className="text-xs uppercase tracking-[0.16em] text-cyan-300">目前商家</div>
                      <div className="mt-3 text-2xl font-display text-white">{selectedBusiness.name}</div>
                      <div className="mt-2 text-sm leading-7 text-gray-400">{selectedBusiness.category}</div>
                      <div className="mt-4 rounded-2xl border border-cyan-500/15 bg-cyan-500/6 p-4 text-sm leading-7 text-gray-300">
                        {selectedBusiness.brand_tone}
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                      <MetricPill label="內容總數" value={contentStats.total || 0} tone="#39ff14" />
                      <MetricPill label="最近推薦" value={recommendations.length} tone="#ffb703" />
                    </div>
                  </div>

                  <div className="grid gap-5 md:grid-cols-2">
                    <DetailList label="主力服務" items={selectedBusinessOffers} tone="#39ff14" empty="還沒設定主力服務" />
                    <DetailList label="優先目標" items={selectedBusinessGoals} tone="#ffb703" empty="還沒設定優先目標" />
                    <DetailList label="常見問題" items={selectedBusinessQuestions} tone="#9d4edd" empty="還沒設定常見問題" />
                    <DetailList label="避免題材" items={selectedBusinessAvoid} tone="#ff6b6b" empty="目前沒有禁區" />
                  </div>

                  {selectedBusiness.notes ? (
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm leading-7 text-gray-300">
                      {selectedBusiness.notes}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-sm text-gray-500">
                  先選一個商家，右側會開始聚焦這間商家的內容脈絡。
                </div>
              )}
            </SectionCard>

            <div className="grid gap-6 2xl:grid-cols-[1fr_1.2fr]">
              <SectionCard
                title="下一支建議"
                tone="#ffb703"
                icon={Lightbulb}
                description="先用系統建議暖身，再決定要不要自己改題目。"
              >
                {recommendations.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-sm text-gray-500">
                    先選商家，系統才會開始推薦下一支題材。
                  </div>
                ) : (
                  <div className="space-y-3">
                    {recommendations.map((item) => (
                      <div key={item.recommendation_id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <div className="text-sm font-semibold text-white">{item.suggested_topic}</div>
                            <div className="mt-2 text-xs text-cyan-300">{item.suggested_angle}</div>
                          </div>
                          <div className="text-xs text-gray-500">分數 {item.priority_score}</div>
                        </div>
                        <div className="mt-3 text-sm leading-6 text-gray-400">{item.reason}</div>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <ActionButton
                            tone="#ffb703"
                            variant="ghost"
                            onClick={() => setWorkspaceForm((current) => ({
                              ...current,
                              topic: item.suggested_topic || '',
                              angle: item.suggested_angle || '',
                            }))}
                          >
                            <Sparkles className="h-4 w-4" />
                            套用到工作包
                          </ActionButton>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>

              <SectionCard
                title="內容資料庫"
                tone="#39ff14"
                icon={FileStack}
                description="看這間商家拍過什麼、哪些稿可以重做、哪些卡在待複查。"
                actions={
                  <div className="flex items-center gap-2">
                    <StatusBadge status="storyboard_ready" />
                    <div className="text-xs text-gray-500">{filteredContentItems.length}/{contentItems.length}</div>
                  </div>
                }
              >
                <div className="grid gap-3 md:grid-cols-[1fr_180px]">
                  <TextInput
                    value={contentSearch}
                    onChange={(event) => setContentSearch(event.target.value)}
                    placeholder="搜尋標題、主題、角度、模板…"
                  />
                  <select
                    value={contentStatusFilter}
                    onChange={(event) => setContentStatusFilter(event.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-white outline-none"
                  >
                    <option value="all">全部狀態</option>
                    <option value="idea">想法</option>
                    <option value="needs_review">待複查</option>
                    <option value="storyboard_ready">可進 Sora</option>
                    <option value="published">已上架</option>
                  </select>
                </div>

                {filteredContentItems.length === 0 ? (
                  <div className="mt-4 rounded-2xl border border-dashed border-white/10 px-4 py-6 text-sm text-gray-500">
                    目前沒有符合條件的內容紀錄。
                  </div>
                ) : (
                  <div className="mt-4 space-y-3">
                    {filteredContentItems.map((item) => (
                      <button
                        type="button"
                        key={item.content_item_id}
                        onClick={() => loadVersions(item.content_item_id).catch((fetchError) => setError(fetchError.message))}
                        className="w-full rounded-2xl border p-4 text-left transition hover:-translate-y-0.5"
                        style={{
                          borderColor: item.content_item_id === selectedContentItemId ? '#39ff1466' : 'rgba(255,255,255,0.08)',
                          background: item.content_item_id === selectedContentItemId ? 'rgba(57,255,20,0.09)' : 'rgba(0,0,0,0.18)',
                        }}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-white">{item.title}</div>
                            <div className="mt-1 line-clamp-2 text-xs leading-6 text-gray-500">{item.topic}</div>
                          </div>
                          <StatusBadge status={item.status} />
                        </div>
                        <div className="mt-4 grid gap-3 text-xs leading-6 text-gray-400 md:grid-cols-2">
                          <div>
                            角度：{item.angle || '—'}
                            <br />
                            模板：{item.template_id || '—'}
                          </div>
                          <div>
                            建立：{formatTime(item.created_at)}
                            <br />
                            產品標籤：{item.product_tag || '—'}
                          </div>
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <ActionButton
                            tone="#39ff14"
                            variant="ghost"
                            onClick={(event) => {
                              event.stopPropagation()
                              setWorkspaceForm((current) => ({
                                ...current,
                                topic: item.topic || '',
                                angle: item.angle || '',
                              }))
                            }}
                          >
                            <ClipboardList className="h-4 w-4" />
                            重做這支
                          </ActionButton>
                          <Link
                            href={`/studio/content/${encodeURIComponent(item.content_item_id)}`}
                            onClick={(event) => event.stopPropagation()}
                            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-gray-300 transition hover:-translate-y-0.5 hover:text-white"
                          >
                            <ExternalLink className="h-4 w-4" />
                            查看詳情
                          </Link>
                          {item.metadata?.quality_passed === false ? (
                            <ToneTag tone="#ffb703">
                              失敗場景：{safeArray(item.metadata?.failed_scene_ids).join(', ') || '待確認'}
                            </ToneTag>
                          ) : null}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </SectionCard>
            </div>

            <SectionCard
              title="腳本版本與產物"
              tone="#00f5ff"
              icon={MessageSquareText}
              description="點選內容庫中的一支稿，這裡會顯示最新版本、腳本摘要與工作包路徑。"
            >
              {!selectedContentItem ? (
                <div className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-sm text-gray-500">
                  先從內容資料庫選一支稿，這裡才會展開版本與產物。
                </div>
              ) : (
                <div className="space-y-5">
                  <div className="grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-xs uppercase tracking-[0.16em] text-cyan-300">目前選定內容</div>
                          <div className="mt-2 text-lg font-semibold text-white">{selectedContentItem.title}</div>
                          <div className="mt-2 text-sm leading-7 text-gray-400">{selectedContentItem.hook || selectedContentItem.topic}</div>
                        </div>
                        <StatusBadge status={selectedContentItem.status} />
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                      <div className="text-xs uppercase tracking-[0.16em] text-gray-500">版本數</div>
                      <div className="mt-2 text-2xl font-display text-white">{scriptVersions.length}</div>
                      <div className="mt-3 text-sm leading-6 text-gray-400">
                        最新建立：{formatTime(latestVersion?.created_at)}
                      </div>
                    </div>
                  </div>

                  {latestVersion ? (
                    <div className="space-y-3">
                      <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-xs uppercase tracking-[0.16em] text-gray-500">最新版本</div>
                            <div className="mt-1 text-sm font-semibold text-white">{latestVersion.version_label}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            <ToneTag tone="#00f5ff">{latestVersion.summary?.variant || 'A'}</ToneTag>
                            <Link
                              href={`/studio/content/${encodeURIComponent(selectedContentItem.content_item_id)}`}
                              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-gray-300 transition hover:-translate-y-0.5 hover:text-white"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                              詳情頁
                            </Link>
                          </div>
                        </div>
                        <div className="mt-4 grid gap-4 md:grid-cols-2">
                          <div>
                            <div className="text-xs uppercase tracking-[0.16em] text-gray-500">標題</div>
                            <div className="mt-2 text-sm leading-7 text-white">{latestVersion.summary?.title || '—'}</div>
                          </div>
                          <div>
                            <div className="text-xs uppercase tracking-[0.16em] text-gray-500">Hook</div>
                            <div className="mt-2 text-sm leading-7 text-gray-300">{latestVersion.summary?.hook || '—'}</div>
                          </div>
                        </div>
                      </div>

                      <div className="grid gap-3 md:grid-cols-2">
                        <WorkspaceArtifact label="Guide" value={latestVersion.artifacts?.guide_path} onCopy={copyText} />
                        <WorkspaceArtifact label="Storyboard" value={latestVersion.artifacts?.storyboard_path} onCopy={copyText} />
                        <WorkspaceArtifact label="Manifest" value={latestVersion.artifacts?.manifest_path} onCopy={copyText} />
                        <WorkspaceArtifact label="Scene pack" value={latestVersion.artifacts?.sora_scene_entry_pack_path} onCopy={copyText} />
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-sm text-gray-500">
                      這支內容目前還沒有存下腳本版本。
                    </div>
                  )}
                </div>
              )}
            </SectionCard>

            <SectionCard
              title="建立工作包"
              tone="#9d4edd"
              icon={ClipboardList}
              description="輸入主題與角度後，系統會產出 storyboard、scene pack 和手動操作指南。"
            >
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="主題">
                  <TextInput value={workspaceForm.topic} onChange={(event) => setWorkspaceForm((current) => ({ ...current, topic: event.target.value }))} placeholder="例如：第一次拍短影音，最容易漏掉什麼？" />
                </Field>
                <Field label="角度">
                  <TextInput value={workspaceForm.angle} onChange={(event) => setWorkspaceForm((current) => ({ ...current, angle: event.target.value }))} placeholder="例如：用老闆最容易理解的方式拆解拍攝前準備" />
                </Field>
                <Field label="內容分類">
                  <TextInput value={workspaceForm.niche} onChange={(event) => setWorkspaceForm((current) => ({ ...current, niche: event.target.value }))} />
                </Field>
                <Field label="受眾覆寫">
                  <TextInput value={workspaceForm.audience} onChange={(event) => setWorkspaceForm((current) => ({ ...current, audience: event.target.value }))} />
                </Field>
              </div>

              <div className="mt-4 flex flex-wrap gap-3">
                <ActionButton onClick={handleGenerateWorkspace} busy={busyAction === 'generate-workspace'}>
                  <Sparkles className="h-4 w-4" />
                  產生工作包
                </ActionButton>
                <ToneTag tone="#ffb703">Sora 先半自動</ToneTag>
                <ToneTag tone="#00f5ff">底部 composer 保持留空</ToneTag>
              </div>

              {workspaceResult ? (
                <div className="mt-5 space-y-4">
                  <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/8 p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-emerald-200">
                      <CheckCheck className="h-4 w-4" />
                      最新工作包已建立
                    </div>
                    <div className="mt-3 grid gap-3 text-sm text-gray-300 md:grid-cols-2">
                      <div>主題：{workspaceResult.selected_topic}</div>
                      <div>角度：{workspaceResult.selected_angle}</div>
                      <div>draft：{workspaceResult.draft_slug}</div>
                      <div>content item：{workspaceResult.content_item_id}</div>
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <WorkspaceArtifact label="操作指南" value={workspaceResult.guide_path} onCopy={copyText} tone="#9d4edd" />
                    <WorkspaceArtifact label="Storyboard" value={workspaceResult.storyboard_path} onCopy={copyText} />
                    <WorkspaceArtifact label="Scene pack" value={workspaceResult.scene_entry_pack_path} onCopy={copyText} tone="#39ff14" />
                    <WorkspaceArtifact label="Upload template" value={workspaceResult.upload_manifest_template_path} onCopy={copyText} tone="#ffb703" />
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-white">
                      <ShieldAlert className="h-4 w-4 text-amber-300" />
                      Sora 手動操作提醒
                    </div>
                    <ol className="mt-4 space-y-2 pl-5 text-sm leading-7 text-gray-300 list-decimal">
                      <li>打開 `scene pack`，逐格貼到 Sora Storyboard scene card。</li>
                      <li>每格貼完立刻填對應秒數，不要最後才回頭改。</li>
                      <li>底部整片描述欄保持留空，不要碰左下角 `+`。</li>
                      <li>確認總長正確後再按 `Create`，下載原生影片後回到這套系統接字幕與上傳。</li>
                    </ol>
                  </div>
                </div>
              ) : null}
            </SectionCard>
          </div>
        </section>
      </div>
    </main>
  )
}
