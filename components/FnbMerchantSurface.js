'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { motion } from 'framer-motion'
import {
  Bot,
  BellRing,
  CheckCircle2,
  ChevronRight,
  Clock3,
  ExternalLink,
  Link2,
  MessageCircleMore,
  NotebookPen,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Store,
  Users,
} from 'lucide-react'

const LIFF_ID = process.env.NEXT_PUBLIC_LINE_LIFF_ID || process.env.NEXT_PUBLIC_FNB_LINE_LIFF_ID || ''

const tabs = [
  { id: 'approvals', label: '待審核', icon: BellRing, tone: '#00f5ff' },
  { id: 'customers', label: '顧客資訊', icon: Users, tone: '#39ff14' },
  { id: 'settings', label: '店家設定', icon: Settings2, tone: '#ffb703' },
  { id: 'digest', label: '本週摘要', icon: Sparkles, tone: '#ff6b35' },
]

let liffScriptPromise = null

function loadLiffSdk() {
  if (typeof window === 'undefined') return Promise.resolve(null)
  if (window.liff) return Promise.resolve(window.liff)
  if (liffScriptPromise) return liffScriptPromise

  liffScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://static.line-scdn.net/liff/edge/2/sdk.js'
    script.async = true
    script.onload = () => resolve(window.liff || null)
    script.onerror = () => reject(new Error('無法載入 LIFF SDK'))
    document.head.appendChild(script)
  })

  return liffScriptPromise
}

function formatDate(value) {
  if (!value) return '未排程'
  return new Intl.DateTimeFormat('zh-TW', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatTaskStatus(status) {
  switch (status) {
    case 'delegated':
      return '已交給 OpenClaw'
    case 'in_progress':
      return '生成中'
    case 'completed':
      return '已完成'
    case 'ops-review':
      return '營運覆核'
    case 'failed':
      return '生成失敗'
    case 'awaiting-rewrite':
      return '等待你補充'
    case 'queued':
      return '已排入佇列'
    default:
      return status || '待處理'
  }
}

function MerchantButton({ children, onClick, tone = '#00f5ff', disabled, subtle = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-2xl border px-4 py-3 text-sm font-semibold transition hover:translate-y-[-1px] disabled:cursor-not-allowed disabled:opacity-50"
      style={{
        borderColor: `${tone}55`,
        background: subtle ? 'rgba(0,0,0,0.15)' : `${tone}14`,
        color: tone,
      }}
    >
      {children}
    </button>
  )
}

async function readJsonResponse(response) {
  const text = await response.text()
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return {
      ok: false,
      error: text.slice(0, 200) || 'Unexpected non-JSON response',
    }
  }
}

function TabButton({ tab, active, onClick, badge = null }) {
  const Icon = tab.icon
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-[22px] border px-4 py-3 text-left transition"
      style={{
        borderColor: active ? `${tab.tone}80` : 'rgba(148, 163, 184, 0.2)',
        background: active ? `${tab.tone}18` : 'rgba(10, 10, 15, 0.52)',
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: active ? tab.tone : '#f3f4f6' }}>
            <Icon className="h-4 w-4" />
            <span>{tab.label}</span>
          </div>
        </div>
        {badge ? (
          <span className="rounded-full bg-black/30 px-2 py-1 text-xs text-white">{badge}</span>
        ) : null}
      </div>
    </button>
  )
}

function MetricCard({ label, value, hint, tone, icon: Icon }) {
  return (
    <div className="glass-card rounded-3xl p-4">
      <div className="flex items-center gap-2 text-sm" style={{ color: tone }}>
        <Icon className="h-4 w-4" />
        <span>{label}</span>
      </div>
      <div className="mt-3 text-2xl font-bold text-white">{value}</div>
      <div className="mt-2 text-xs leading-6 text-gray-400">{hint}</div>
    </div>
  )
}

function StatusPill({ tone, children }) {
  return (
    <span
      className="inline-flex items-center rounded-full border px-2 py-1 text-[11px] font-semibold"
      style={{
        color: tone,
        borderColor: `${tone}44`,
        background: `${tone}10`,
      }}
    >
      {children}
    </span>
  )
}

export default function FnbMerchantSurface() {
  const searchParams = useSearchParams()
  const tabFromUrl = searchParams.get('tab') || 'approvals'
  const locationFromUrl = searchParams.get('locationId') || ''
  const highlightedDraftId = searchParams.get('draftId') || ''

  const [home, setHome] = useState(null)
  const [activeTab, setActiveTab] = useState(tabFromUrl)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [bindUrl, setBindUrl] = useState('')
  const [onboardingUrl, setOnboardingUrl] = useState('')
  const [liffState, setLiffState] = useState({ ready: false, profile: null, requiresLogin: false })
  const [customerQuery, setCustomerQuery] = useState('')
  const [selectedCustomerId, setSelectedCustomerId] = useState('')
  const [noteDraft, setNoteDraft] = useState('')
  const [tagDraft, setTagDraft] = useState('')
  const [chatDraft, setChatDraft] = useState('')

  const updateUrl = useCallback((nextTab, nextLocationId) => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    url.searchParams.set('tab', nextTab)
    if (nextLocationId) url.searchParams.set('locationId', nextLocationId)
    else url.searchParams.delete('locationId')
    url.searchParams.delete('lineUserId')
    window.history.replaceState({}, '', url)
  }, [])

  const resolveLineIdentity = useCallback(async () => {
    if (!LIFF_ID) return { profile: null }

    try {
      const liff = await loadLiffSdk()
      if (!liff) return { profile: null }
      await liff.init({ liffId: LIFF_ID })
      if (!liff.isLoggedIn()) {
        setLiffState((state) => ({ ...state, requiresLogin: true }))
        return { profile: null }
      }
      const profile = await liff.getProfile()
      setLiffState({ ready: true, profile, requiresLogin: false })
      return { profile }
    } catch (resolveError) {
      setError(resolveError.message)
      return { profile: null }
    }
  }, [])

  const fetchHome = useCallback(async ({ nextTab = tabFromUrl, nextLocationId = locationFromUrl || null } = {}) => {
    setBusy('bootstrap')
    try {
      await resolveLineIdentity()
      const params = new URLSearchParams({ tab: nextTab })
      if (nextLocationId) params.set('locationId', nextLocationId)

      const response = await fetch(`/api/liff/bootstrap?${params.toString()}`)
      const data = await readJsonResponse(response)
      if (!response.ok || !data.ok) {
        if (data.merchantLineConfigured === false) {
          setBindUrl('')
          setOnboardingUrl('')
          setHome(null)
          setError(data.error || '商家專用 LINE 入口尚未設定')
          return
        }
        if (data.needsOnboarding) {
          setBindUrl('')
          setOnboardingUrl(data.onboardingUrl || '/ops')
          setHome(null)
          setError(data.error || '尚未建立店家據點，請先完成 onboarding。')
          return
        }
        if (data.needsBinding) {
          setBindUrl(data.bindUrl)
          setOnboardingUrl('')
          setHome(null)
          setError('')
          return
        }
        throw new Error(data.error || '載入商家工作台失敗')
      }

      setHome(data.home)
      setActiveTab(nextTab)
      setBindUrl('')
      setOnboardingUrl('')
      setError('')
      updateUrl(nextTab, data.home?.activeMembership?.location?.id || nextLocationId)
    } catch (fetchError) {
      setError(fetchError.message)
    } finally {
      setBusy('')
    }
  }, [locationFromUrl, resolveLineIdentity, tabFromUrl, updateUrl])

  useEffect(() => {
    setActiveTab(tabFromUrl)
    fetchHome({ nextTab: tabFromUrl, nextLocationId: locationFromUrl || null })
  }, [fetchHome, locationFromUrl, tabFromUrl])

  useEffect(() => {
    const customer = home?.customers?.find((item) => item.id === selectedCustomerId) || home?.customers?.[0] || null
    if (customer) {
      setSelectedCustomerId(customer.id)
      setTagDraft(customer.tags.map((tag) => tag.tag).join(', '))
      setNoteDraft('')
    }
  }, [home, selectedCustomerId])

  const selectedCustomer = useMemo(
    () => home?.customers?.find((customer) => customer.id === selectedCustomerId) || home?.customers?.[0] || null,
    [home, selectedCustomerId]
  )

  const filteredCustomers = useMemo(() => {
    const query = customerQuery.trim().toLowerCase()
    const customers = home?.customers || []
    if (!query) return customers
    return customers.filter((customer) => {
      const matchesName = customer.displayName.toLowerCase().includes(query)
      const matchesTag = customer.tags.some((tag) => tag.tag.toLowerCase().includes(query))
      return matchesName || matchesTag
    })
  }, [customerQuery, home?.customers])

  const approvalCards = useMemo(() => {
    const items = home?.approvals || []
    if (!highlightedDraftId) return items
    return [...items].sort((left, right) => {
      if (left.draftId === highlightedDraftId) return -1
      if (right.draftId === highlightedDraftId) return 1
      return 0
    })
  }, [highlightedDraftId, home?.approvals])

  const submitApproval = useCallback(async (approvalId, action) => {
    if (!home) return
    setBusy(`${action}:${approvalId}`)
    try {
      const response = await fetch(`/api/fnb/merchant/approvals/${approvalId}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          locationId: home.activeMembership.location.id,
        }),
      })
      const data = await readJsonResponse(response)
      if (!response.ok || !data.ok) throw new Error(data.error || '審核操作失敗')
      setHome(data.home)
      setError('')
    } catch (actionError) {
      setError(actionError.message)
    } finally {
      setBusy('')
    }
  }, [home])

  const saveNote = useCallback(async () => {
    if (!selectedCustomer || !noteDraft.trim() || !home) return
    setBusy(`note:${selectedCustomer.id}`)
    try {
      const response = await fetch(`/api/fnb/merchant/customers/${selectedCustomer.id}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId: home.activeMembership.location.id,
          note: noteDraft,
        }),
      })
      const data = await readJsonResponse(response)
      if (!response.ok || !data.ok) throw new Error(data.error || '新增顧客備註失敗')
      setHome((current) => ({
        ...current,
        customers: current.customers.map((customer) => customer.id === data.customer.id ? data.customer : customer),
      }))
      setNoteDraft('')
      setError('')
    } catch (actionError) {
      setError(actionError.message)
    } finally {
      setBusy('')
    }
  }, [home, noteDraft, selectedCustomer])

  const saveTags = useCallback(async () => {
    if (!selectedCustomer || !home) return
    setBusy(`tags:${selectedCustomer.id}`)
    try {
      const response = await fetch(`/api/fnb/merchant/customers/${selectedCustomer.id}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId: home.activeMembership.location.id,
          tags: tagDraft,
        }),
      })
      const data = await readJsonResponse(response)
      if (!response.ok || !data.ok) throw new Error(data.error || '更新顧客標籤失敗')
      setHome((current) => ({
        ...current,
        customers: current.customers.map((customer) => customer.id === data.customer.id ? data.customer : customer),
      }))
      setError('')
    } catch (actionError) {
      setError(actionError.message)
    } finally {
      setBusy('')
    }
  }, [home, selectedCustomer, tagDraft])

  const submitCopilotMessage = useCallback(async (preset = '') => {
    if (!home) return
    const message = String(preset || chatDraft).trim()
    if (!message) return
    setBusy('merchant-copilot')
    try {
      const response = await fetch('/api/fnb/merchant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId: home.activeMembership.location.id,
          message,
        }),
      })
      const data = await readJsonResponse(response)
      if (!response.ok || !data.ok) throw new Error(data.error || '送出 Copilot 需求失敗')
      setHome(data.home)
      setChatDraft('')
      setError('')
      if (activeTab !== 'approvals') {
        setActiveTab('approvals')
        updateUrl('approvals', home.activeMembership.location.id)
      }
    } catch (actionError) {
      setError(actionError.message)
    } finally {
      setBusy('')
    }
  }, [activeTab, chatDraft, home, updateUrl])

  const handleTabChange = useCallback((tabId) => {
    setActiveTab(tabId)
    if (!home) {
      updateUrl(tabId, locationFromUrl)
      return
    }
    updateUrl(tabId, home.activeMembership.location.id)
  }, [home, locationFromUrl, updateUrl])

  const switchLocation = useCallback((nextLocationId) => {
    if (!nextLocationId) return
    fetchHome({ nextTab: activeTab, nextLocationId })
  }, [activeTab, fetchHome])

  if (!home && bindUrl) {
    return (
      <main className="mx-auto max-w-md px-4 py-8">
        <div className="glass-card rounded-[28px] p-6">
          <div className="flex items-center gap-2 text-sm text-cyan-300">
            <Link2 className="h-4 w-4" />
            <span>官方 LINE 單一入口</span>
          </div>
          <h1 className="mt-3 font-display text-3xl text-white">先完成商家綁定</h1>
          <p className="mt-3 text-sm leading-7 text-gray-300">
            這個入口只給商家操作人員使用。第一次進入需要用 LINE Login 把你的帳號綁到店家與角色。
          </p>
          <div className="mt-6">
            <a
              href={bindUrl}
              className="inline-flex items-center gap-2 rounded-2xl border border-cyan-500/40 bg-cyan-500/10 px-4 py-3 text-sm font-semibold text-cyan-200"
            >
              <span>用 LINE 綁定商家身份</span>
              <ExternalLink className="h-4 w-4" />
            </a>
          </div>
        </div>
      </main>
    )
  }

  if (!home && onboardingUrl) {
    return (
      <main className="mx-auto max-w-md px-4 py-8">
        <div className="glass-card rounded-[28px] p-6">
          <div className="flex items-center gap-2 text-sm text-amber-300">
            <Store className="h-4 w-4" />
            <span>先完成店家 onboarding</span>
          </div>
          <h1 className="mt-3 font-display text-3xl text-white">還沒有可綁定的店家據點</h1>
          <p className="mt-3 text-sm leading-7 text-gray-300">
            請先建立商家與分店資料，再回到 LINE 入口完成身份綁定。
          </p>
          <div className="mt-6">
            <a
              href={onboardingUrl}
              className="inline-flex items-center gap-2 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm font-semibold text-amber-200"
            >
              <span>前往 onboarding</span>
              <ExternalLink className="h-4 w-4" />
            </a>
          </div>
        </div>
      </main>
    )
  }

  if (!home) {
    return (
      <main className="mx-auto max-w-md px-4 py-8">
        <div className="glass-card rounded-[28px] p-6">
          <div className="text-sm text-gray-300">{error || '載入商家工作台…'}</div>
          {error ? (
            <div className="mt-4 text-xs leading-6 text-gray-500">
              這個商家入口已與原本的 SuperFish 分開。下一步請填入獨立的 `LINE_*` 與 `NEXT_PUBLIC_LINE_LIFF_ID`。
            </div>
          ) : null}
        </div>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-md px-4 py-6">
      <div className="space-y-5">
        <motion.section
          className="glass-card rounded-[28px] p-5"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-sm text-cyan-300">
                <Store className="h-4 w-4" />
                <span>Merchant Copilot / LINE OA</span>
              </div>
              <h1 className="mt-3 font-display text-3xl text-white">{home.location.name}</h1>
              <p className="mt-3 text-sm leading-7 text-gray-300">
                待審核、顧客摘要、店家設定與週摘要都集中在這裡。需要你點頭的事才推播，其餘由系統先處理。
              </p>
            </div>

            <div className="rounded-2xl border border-green-500/30 bg-green-500/10 px-3 py-2 text-right">
              <div className="text-[11px] uppercase tracking-[0.18em] text-green-300">本週負擔</div>
              <div className="mt-1 text-2xl font-bold text-white">{home.metrics.merchantApprovalsPending}</div>
              <div className="mt-1 text-[11px] text-gray-400">
                目標 {home.metrics.merchantTimeBudgetMinutes} 分鐘內
              </div>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <StatusPill tone="#39ff14">{home.operator.displayName}</StatusPill>
            <StatusPill tone="#00f5ff">{home.activeMembership.role}</StatusPill>
            <StatusPill tone={LIFF_ID ? '#ffb703' : '#94a3b8'}>
              {LIFF_ID ? 'LIFF 已配置' : 'Demo / Web fallback'}
            </StatusPill>
            {liffState.profile?.displayName ? (
              <StatusPill tone="#ff6b35">{liffState.profile.displayName}</StatusPill>
            ) : null}
          </div>

          {home.memberships.length > 1 ? (
            <div className="mt-5 flex flex-wrap gap-2">
              {home.memberships.map((membership) => (
                <MerchantButton
                  key={membership.location.id}
                  tone={membership.location.id === home.activeMembership.location.id ? '#00f5ff' : '#94a3b8'}
                  subtle={membership.location.id !== home.activeMembership.location.id}
                  disabled={busy === 'bootstrap'}
                  onClick={() => switchLocation(membership.location.id)}
                >
                  {membership.location.name}
                </MerchantButton>
              ))}
            </div>
          ) : null}

          {error ? (
            <div className="mt-5 rounded-2xl border border-red-500/30 bg-red-950/30 px-4 py-3 text-sm text-red-200">
              {error}
            </div>
          ) : null}

          {liffState.requiresLogin ? (
            <div className="mt-5 rounded-2xl border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-100">
              目前是在 LIFF 環境但尚未登入 LINE。完成登入後，頁面會自動帶出你的商家身份。
            </div>
          ) : null}
        </motion.section>

        <motion.section
          className="grid grid-cols-2 gap-3"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
        >
          {tabs.map((tab) => (
            <TabButton
              key={tab.id}
              tab={tab}
              active={activeTab === tab.id}
              badge={tab.id === 'approvals' ? home.approvals.length : null}
              onClick={() => handleTabChange(tab.id)}
            />
          ))}
        </motion.section>

        <motion.section
          className="grid grid-cols-2 gap-3"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <MetricCard
            label="自動完成"
            value={home.metrics.autoPublishedThisWeek}
            hint="這些事情系統已先處理，不需要你人工進後台。"
            tone="#39ff14"
            icon={CheckCircle2}
          />
          <MetricCard
            label="顧客摘要"
            value={home.customers.length}
            hint="這是 v1 的輕量 CRM，只保留標籤、備註與最近互動。"
            tone="#ffb703"
            icon={Users}
          />
        </motion.section>

        <motion.section
          className="glass-card rounded-[28px] p-5"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.11 }}
        >
          <div className="flex items-center gap-2 text-cyan-300">
            <Bot className="h-4 w-4" />
            <span className="text-sm uppercase tracking-[0.18em]">自然語言 Copilot</span>
          </div>

          <div className="mt-4 rounded-3xl border border-cyan-500/20 bg-cyan-500/6 p-4">
            <div className="text-sm leading-7 text-gray-200">
              直接跟我說你想要的文案方向。我會先整理成草稿，完成後再推回來讓你同意、再改或跳過。
            </div>
            <textarea
              value={chatDraft}
              onChange={(event) => setChatDraft(event.target.value)}
              rows={3}
              className="mt-4 w-full rounded-2xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-white outline-none placeholder:text-gray-600"
              placeholder="例如：幫我寫這週平日下午茶促銷文案，口吻像熟客推薦，不要太硬銷。"
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <MerchantButton tone="#00f5ff" disabled={Boolean(busy) || !chatDraft.trim()} onClick={() => submitCopilotMessage()}>
                送出需求
              </MerchantButton>
              <MerchantButton
                tone="#39ff14"
                subtle
                disabled={Boolean(busy)}
                onClick={() => submitCopilotMessage('幫我寫這週平日下午茶促銷文案，口吻像熟客推薦。')}
              >
                下午茶促銷
              </MerchantButton>
              <MerchantButton
                tone="#ffb703"
                subtle
                disabled={Boolean(busy)}
                onClick={() => submitCopilotMessage('把剛剛那篇縮短到適合 LINE 推播。')}
              >
                縮短成推播
              </MerchantButton>
            </div>
          </div>

          {home.merchantCopilot?.activeThreadMessages?.length ? (
            <div className="mt-4 space-y-3">
              {home.merchantCopilot.activeThreadMessages.slice(-4).map((message) => (
                <div
                  key={message.id}
                  className="rounded-2xl border px-4 py-3 text-sm leading-7"
                  style={{
                    borderColor: message.role === 'merchant' ? 'rgba(0,245,255,0.24)' : 'rgba(57,255,20,0.2)',
                    background: message.role === 'merchant' ? 'rgba(0,245,255,0.08)' : 'rgba(57,255,20,0.08)',
                  }}
                >
                  <div className="mb-1 text-[11px] uppercase tracking-[0.18em] text-gray-500">
                    {message.role === 'merchant' ? '你' : 'Copilot'}
                  </div>
                  <div className="text-gray-100">{message.body}</div>
                </div>
              ))}
            </div>
          ) : null}

          <div className="mt-4 space-y-3">
            {(home.merchantCopilot?.tasks || []).length === 0 ? (
              <div className="rounded-2xl border border-dashed border-gray-700 px-4 py-6 text-sm text-gray-500">
                還沒有新的自然語言任務。你可以直接用上面的輸入框告訴我想要的文案。
              </div>
            ) : (
              (home.merchantCopilot?.tasks || []).map((task) => (
                <div key={task.id} className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-white">{task.title || 'Merchant Copilot 任務'}</div>
                    <StatusPill tone={task.status === 'completed' ? '#39ff14' : task.status === 'ops-review' || task.status === 'failed' ? '#fb7185' : '#00f5ff'}>
                      {formatTaskStatus(task.status)}
                    </StatusPill>
                  </div>
                  <div className="mt-2 text-sm leading-7 text-gray-300">{task.instructionText}</div>
                  {task.outputDraft?.title ? (
                    <div className="mt-3 rounded-2xl border border-green-500/20 bg-green-500/8 px-3 py-3 text-sm text-gray-100">
                      <div className="font-semibold text-white">{task.outputDraft.title}</div>
                      <div className="mt-2 whitespace-pre-line leading-7 text-gray-300">{task.outputDraft.body}</div>
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </motion.section>

        {activeTab === 'approvals' ? (
          <motion.section
            className="glass-card rounded-[28px] p-5"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.12 }}
          >
            <div className="flex items-center gap-2 text-cyan-300">
              <BellRing className="h-4 w-4" />
              <span className="text-sm uppercase tracking-[0.18em]">待審核</span>
            </div>

            <div className="mt-4 space-y-4">
              {approvalCards.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-gray-700 px-4 py-8 text-sm text-gray-500">
                  目前沒有需要你決定的項目。這代表系統有把工作量壓在目標範圍內。
                </div>
              ) : null}

              {approvalCards.map((approval) => (
                <div
                  key={approval.id}
                  className="rounded-3xl border border-cyan-500/20 bg-cyan-500/6 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-base font-semibold text-white">{approval.title}</div>
                      <div className="mt-2 text-xs text-gray-500">
                        預計 {formatDate(approval.scheduledFor)} 發送
                      </div>
                    </div>
                    <StatusPill tone={approval.riskScore >= 0.5 ? '#fb7185' : '#39ff14'}>
                      風險 {Math.round((approval.riskScore || 0) * 100)}%
                    </StatusPill>
                  </div>

                  <div className="mt-3 whitespace-pre-line text-sm leading-7 text-gray-300">
                    {approval.merchantMessage}
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <MerchantButton
                      tone="#39ff14"
                      disabled={Boolean(busy)}
                      onClick={() => submitApproval(approval.id, 'approve')}
                    >
                      同意排程
                    </MerchantButton>
                    {approval.payload?.origin === 'merchant-copilot' ? (
                      <MerchantButton
                        tone="#ffb703"
                        disabled={Boolean(busy)}
                        onClick={() => submitApproval(approval.id, 'rewrite')}
                      >
                        再改一版
                      </MerchantButton>
                    ) : (
                      <MerchantButton
                        tone="#ffb703"
                        disabled={Boolean(busy)}
                        onClick={() => submitApproval(approval.id, 'reschedule')}
                      >
                        延到明天
                      </MerchantButton>
                    )}
                    <MerchantButton
                      tone="#fb7185"
                      disabled={Boolean(busy)}
                      onClick={() => submitApproval(approval.id, 'skip')}
                    >
                      先跳過
                    </MerchantButton>
                  </div>
                </div>
              ))}
            </div>
          </motion.section>
        ) : null}

        {activeTab === 'customers' ? (
          <motion.section
            className="space-y-4"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.12 }}
          >
            <div className="glass-card rounded-[28px] p-5">
              <div className="flex items-center gap-2 text-green-300">
                <Users className="h-4 w-4" />
                <span className="text-sm uppercase tracking-[0.18em]">顧客資訊</span>
              </div>

              <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
                <div className="flex items-center gap-2 text-gray-400">
                  <Search className="h-4 w-4" />
                  <input
                    value={customerQuery}
                    onChange={(event) => setCustomerQuery(event.target.value)}
                    placeholder="搜尋顧客名稱或標籤"
                    className="w-full bg-transparent text-sm text-white outline-none placeholder:text-gray-600"
                  />
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {filteredCustomers.map((customer) => (
                  <button
                    key={customer.id}
                    type="button"
                    onClick={() => setSelectedCustomerId(customer.id)}
                    className="w-full rounded-3xl border px-4 py-4 text-left transition"
                    style={{
                      borderColor: customer.id === selectedCustomer?.id ? 'rgba(57, 255, 20, 0.35)' : 'rgba(148, 163, 184, 0.16)',
                      background: customer.id === selectedCustomer?.id ? 'rgba(57, 255, 20, 0.08)' : 'rgba(10, 10, 15, 0.42)',
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-base font-semibold text-white">{customer.displayName}</div>
                        <div className="mt-1 text-xs text-gray-500">
                          最近互動：{customer.activity.lastEventType || '尚無紀錄'} / {formatDate(customer.lastInteractionAt)}
                        </div>
                      </div>
                      <ChevronRight className="mt-1 h-4 w-4 text-gray-500" />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {customer.tags.map((tag) => (
                        <StatusPill key={tag.id} tone="#39ff14">{tag.tag}</StatusPill>
                      ))}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {selectedCustomer ? (
              <div className="glass-card rounded-[28px] p-5">
                <div className="flex items-center gap-2 text-yellow-300">
                  <NotebookPen className="h-4 w-4" />
                  <span className="text-sm uppercase tracking-[0.18em]">顧客卡片</span>
                </div>

                <div className="mt-4">
                  <div className="text-xl font-semibold text-white">{selectedCustomer.displayName}</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <StatusPill tone="#00f5ff">{selectedCustomer.loyaltyStage}</StatusPill>
                    <StatusPill tone="#ffb703">領券 {selectedCustomer.activity.couponClaims}</StatusPill>
                    <StatusPill tone="#39ff14">訊息 {selectedCustomer.activity.messageCount}</StatusPill>
                    <StatusPill tone="#ff6b35">來店訊號 {selectedCustomer.activity.visitSignals}</StatusPill>
                  </div>
                </div>

                <div className="mt-5">
                  <div className="text-xs uppercase tracking-[0.18em] text-gray-500">標籤</div>
                  <textarea
                    value={tagDraft}
                    onChange={(event) => setTagDraft(event.target.value)}
                    rows={2}
                    className="mt-2 w-full rounded-2xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-white outline-none placeholder:text-gray-600"
                    placeholder="例如：熟客, 愛麻醬麵, 外帶"
                  />
                  <div className="mt-3">
                    <MerchantButton tone="#39ff14" disabled={Boolean(busy)} onClick={saveTags}>
                      更新標籤
                    </MerchantButton>
                  </div>
                </div>

                <div className="mt-6">
                  <div className="text-xs uppercase tracking-[0.18em] text-gray-500">備註</div>
                  <div className="mt-3 space-y-3">
                    {selectedCustomer.notes.map((note) => (
                      <div key={note.id} className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3 text-sm leading-7 text-gray-200">
                        <div>{note.body}</div>
                        <div className="mt-2 text-[11px] text-gray-500">{formatDate(note.createdAt)}</div>
                      </div>
                    ))}
                  </div>
                  <textarea
                    value={noteDraft}
                    onChange={(event) => setNoteDraft(event.target.value)}
                    rows={3}
                    className="mt-3 w-full rounded-2xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-white outline-none placeholder:text-gray-600"
                    placeholder="補一個只要店家自己知道的備註，例如偏好、回訪頻率或注意事項"
                  />
                  <div className="mt-3">
                    <MerchantButton tone="#ffb703" disabled={Boolean(busy) || !noteDraft.trim()} onClick={saveNote}>
                      新增備註
                    </MerchantButton>
                  </div>
                </div>
              </div>
            ) : null}
          </motion.section>
        ) : null}

        {activeTab === 'settings' ? (
          <motion.section
            className="space-y-4"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.12 }}
          >
            <div className="glass-card rounded-[28px] p-5">
              <div className="flex items-center gap-2 text-yellow-300">
                <Settings2 className="h-4 w-4" />
                <span className="text-sm uppercase tracking-[0.18em]">店家設定</span>
              </div>

              <div className="mt-4 space-y-3">
                {home.settings.onboardingChecklist.map((item) => (
                  <div key={item.id} className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                    <span className="text-sm text-white">{item.label}</span>
                    <StatusPill tone={item.done ? '#39ff14' : '#ffb703'}>
                      {item.done ? '已完成' : '待補'}
                    </StatusPill>
                  </div>
                ))}
              </div>
            </div>

            <div className="glass-card rounded-[28px] p-5">
              <div className="text-xs uppercase tracking-[0.18em] text-gray-500">品牌語氣</div>
              <div className="mt-3 text-sm leading-7 text-gray-200">{home.settings.brandPack.voice}</div>
              <div className="mt-4 flex flex-wrap gap-2">
                {home.settings.brandPack.guardrails.map((guardrail) => (
                  <StatusPill key={guardrail} tone="#fb7185">{guardrail}</StatusPill>
                ))}
              </div>

              <div className="mt-5 rounded-2xl border border-cyan-500/20 bg-cyan-500/8 p-4 text-sm leading-7 text-gray-200">
                目前 merchant 端只保留低負擔設定摘要。較完整的素材與規則調整，仍由 ops 端處理，避免店家被迫管理太多欄位。
              </div>
            </div>

            <div className="glass-card rounded-[28px] p-5">
              <div className="text-xs uppercase tracking-[0.18em] text-gray-500">渠道健康度</div>
              <div className="mt-4 space-y-3">
                {home.settings.channels.map((channel) => (
                  <div key={channel.channel} className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm text-white">{channel.channel}</div>
                      <StatusPill tone={channel.status === 'connected' ? '#39ff14' : '#ffb703'}>
                        {channel.status}
                      </StatusPill>
                    </div>
                    {channel.lastError ? (
                      <div className="mt-2 text-xs text-red-300">{channel.lastError}</div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          </motion.section>
        ) : null}

        {activeTab === 'digest' ? (
          <motion.section
            className="space-y-4"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.12 }}
          >
            <div className="glass-card rounded-[28px] p-5">
              <div className="flex items-center gap-2 text-orange-300">
                <Sparkles className="h-4 w-4" />
                <span className="text-sm uppercase tracking-[0.18em]">本週摘要</span>
              </div>

              <div className="mt-4 text-xl font-semibold text-white">{home.latestDigest?.headline}</div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <MetricCard
                  label="領券"
                  value={home.latestDigest?.summary?.couponClaims || 0}
                  hint="先看有沒有人願意接你的優惠。"
                  tone="#39ff14"
                  icon={CheckCircle2}
                />
                <MetricCard
                  label="導航"
                  value={home.latestDigest?.summary?.navigations || 0}
                  hint="Google 商家更新是否把人帶到門口。"
                  tone="#00f5ff"
                  icon={Clock3}
                />
                <MetricCard
                  label="友加"
                  value={home.latestDigest?.summary?.friendAdds || 0}
                  hint="新加入官方 LINE 的顧客數。"
                  tone="#ffb703"
                  icon={MessageCircleMore}
                />
                <MetricCard
                  label="摘要閱讀率"
                  value={`${home.kpis.digestReadRate}%`}
                  hint="這代表系統推送的摘要有沒有被打開。"
                  tone="#ff6b35"
                  icon={ShieldCheck}
                />
              </div>
            </div>

            <div className="glass-card rounded-[28px] p-5">
              <div className="text-xs uppercase tracking-[0.18em] text-gray-500">下週建議</div>
              <div className="mt-3 rounded-2xl border border-green-500/20 bg-green-500/8 p-4 text-sm leading-7 text-gray-200">
                {home.latestDigest?.recommendedNextAction}
              </div>
            </div>
          </motion.section>
        ) : null}

        {home.alerts.length > 0 ? (
          <motion.section
            className="glass-card rounded-[28px] p-5"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
          >
            <div className="flex items-center gap-2 text-pink-300">
              <ShieldCheck className="h-4 w-4" />
              <span className="text-sm uppercase tracking-[0.18em]">提醒</span>
            </div>
            <div className="mt-4 space-y-3">
              {home.alerts.map((alert) => (
                <div key={alert.id} className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-gray-200">
                  {alert.message}
                </div>
              ))}
            </div>
          </motion.section>
        ) : null}
      </div>
    </main>
  )
}
