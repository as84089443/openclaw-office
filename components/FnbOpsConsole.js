'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Bot,
  CalendarRange,
  CheckCircle2,
  CircleDashed,
  Clock3,
  ExternalLink,
  Link2,
  MessagesSquare,
  NotebookPen,
  QrCode,
  RefreshCw,
  Send,
  ShieldAlert,
  Sparkles,
  Store,
  TriangleAlert,
} from 'lucide-react'

function MetricCard({ icon: Icon, label, value, tone, hint }) {
  return (
    <motion.div
      className="glass-card rounded-xl p-4"
      whileHover={{ scale: 1.01 }}
      style={{ borderColor: `${tone}55` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-gray-500">{label}</div>
          <div className="mt-2 text-2xl font-display font-bold" style={{ color: tone }}>
            {value}
          </div>
          {hint ? <div className="mt-2 text-xs text-gray-400">{hint}</div> : null}
        </div>
        <div className="rounded-xl p-2" style={{ backgroundColor: `${tone}18`, color: tone }}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </motion.div>
  )
}

function PipelineColumn({ title, tone, icon: Icon, items, emptyText }) {
  return (
    <div className="glass-card rounded-xl p-4" style={{ borderColor: `${tone}44` }}>
      <div className="mb-4 flex items-center gap-2">
        <Icon className="h-4 w-4" style={{ color: tone }} />
        <h3 className="font-display text-sm uppercase tracking-[0.18em]" style={{ color: tone }}>
          {title}
        </h3>
      </div>

      <div className="space-y-3">
        {items.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-700 px-3 py-5 text-sm text-gray-500">
            {emptyText}
          </div>
        ) : (
          items.map((item) => (
            <div key={item.id} className="rounded-lg border border-white/5 bg-black/20 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-white">{item.title}</div>
                <div className="text-[10px] uppercase tracking-[0.18em] text-gray-500">{item.channel}</div>
              </div>
              <div className="mt-2 text-xs text-gray-400">{item.body}</div>
              <div className="mt-3 flex items-center gap-3 text-[11px] text-gray-500">
                <span>risk {Math.round((item.riskScore || 0) * 100)}%</span>
                <span>{item.draftType}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function ActionButton({ children, onClick, disabled, tone = '#00f5ff' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg border px-3 py-2 text-xs font-semibold transition hover:translate-y-[-1px] disabled:cursor-not-allowed disabled:opacity-40"
      style={{
        borderColor: `${tone}55`,
        background: `${tone}18`,
        color: tone,
      }}
    >
      {children}
    </button>
  )
}

function ActionLink({ children, href, tone = '#00f5ff' }) {
  return (
    <a
      href={href}
      className="inline-flex rounded-lg border px-3 py-2 text-xs font-semibold transition hover:translate-y-[-1px]"
      style={{
        borderColor: `${tone}55`,
        background: `${tone}18`,
        color: tone,
      }}
    >
      {children}
    </a>
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
      className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-3 text-sm text-white outline-none placeholder:text-gray-600"
    />
  )
}

function TextAreaInput(props) {
  return (
    <textarea
      {...props}
      className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-3 text-sm text-white outline-none placeholder:text-gray-600"
    />
  )
}

function createInitialOnboardingForm() {
  return {
    tenantName: '',
    locationName: '',
    restaurantType: '',
    address: '',
    ownerName: '',
    primaryGoal: '',
    voice: '',
    signatureItemsText: '',
    guardrailsText: '避免誇大療效, 避免連發相同促銷',
    menuItemsText: '',
    googleLocationName: '',
    merchantTimeBudgetMinutes: '15',
    weeklyTimeBudgetMinutes: '15',
    notes: '',
  }
}

function parseCsvText(value) {
  return Array.from(new Set(
    String(value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  ))
}

function parseMenuItemsText(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line, index) => {
      const [name, category = '', price = '', signature = ''] = line.split('|').map((part) => part.trim())
      return {
        id: `menu_onboard_${index}_${name || 'item'}`.replace(/\s+/g, '_'),
        name,
        category,
        priceCents: price ? Math.round(Number(price) * 100) : 0,
        isSignature: /^(1|y|yes|true|signature|招牌)$/i.test(signature),
      }
    })
    .filter((item) => item.name)
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

export default function FnbOpsConsole() {
  const [snapshot, setSnapshot] = useState(null)
  const [locations, setLocations] = useState([])
  const [serviceStatus, setServiceStatus] = useState(null)
  const [selectedLocationId, setSelectedLocationId] = useState('')
  const [inviteLinks, setInviteLinks] = useState(null)
  const [onboardingForm, setOnboardingForm] = useState(createInitialOnboardingForm)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyAction, setBusyAction] = useState('')
  const [authRequired, setAuthRequired] = useState(false)
  const [authToken, setAuthToken] = useState('')
  const [authBusy, setAuthBusy] = useState(false)

  const applyOpsResponse = useCallback((data) => {
    setSnapshot(data.snapshot || null)
    setLocations(Array.isArray(data.locations) ? data.locations : [])
    setServiceStatus(data.serviceStatus || null)
    setSelectedLocationId(data.snapshot?.location?.id || data.defaultLocationId || '')
  }, [])

  const handleUnauthorized = useCallback((message = '需要內部 admin token 才能存取 ops。') => {
    setAuthRequired(true)
    setSnapshot(null)
    setLocations([])
    setServiceStatus(null)
    setError(message)
  }, [])

  const fetchSnapshot = useCallback(async (nextLocationId = '') => {
    try {
      const params = new URLSearchParams()
      if (nextLocationId) params.set('locationId', nextLocationId)
      const response = await fetch(`/api/fnb/ops${params.size ? `?${params.toString()}` : ''}`)
      const data = await response.json()
      if (response.status === 401) {
        handleUnauthorized(data.error || '需要內部 admin token 才能存取 ops。')
        return
      }
      if (!response.ok || !data.ok) {
        throw new Error(data.error || 'Failed to load F&B ops snapshot')
      }
      setAuthRequired(false)
      applyOpsResponse(data)
      setError('')
    } catch (fetchError) {
      setError(fetchError.message)
    } finally {
      setLoading(false)
    }
  }, [applyOpsResponse, handleUnauthorized])

  useEffect(() => {
    fetchSnapshot()
  }, [fetchSnapshot])

  const postAction = useCallback(async (action, extra = {}) => {
    setBusyAction(action)
    try {
      const targetLocationId = extra.locationId || selectedLocationId || snapshot?.location?.id || ''
      const response = await fetch('/api/fnb/ops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          ...(action === 'onboard-merchant' ? {} : { locationId: targetLocationId }),
          ...extra,
        }),
      })
      const data = await response.json()
      if (response.status === 401) {
        handleUnauthorized(data.error || '需要內部 admin token 才能執行營運操作。')
        return null
      }
      if (!response.ok || !data.ok) {
        throw new Error(data.error || `Action failed: ${action}`)
      }
      setAuthRequired(false)
      applyOpsResponse(data)
      setInviteLinks(data.result?.links || null)
      if (action === 'onboard-merchant') {
        setOnboardingForm(createInitialOnboardingForm())
      }
      setError('')
      return data
    } catch (actionError) {
      setError(actionError.message)
      return null
    } finally {
      setBusyAction('')
    }
  }, [applyOpsResponse, handleUnauthorized, selectedLocationId, snapshot])

  const submitOpsAuth = useCallback(async () => {
    const trimmed = authToken.trim()
    if (!trimmed) {
      setError('請輸入 FNB_INTERNAL_API_TOKEN。')
      return
    }

    setAuthBusy(true)
    try {
      const response = await fetch('/api/fnb/ops/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: trimmed }),
      })
      const data = await response.json()
      if (!response.ok || !data.ok) {
        throw new Error(data.error || 'Ops auth failed')
      }
      setAuthRequired(false)
      setAuthToken('')
      setError('')
      setLoading(true)
      await fetchSnapshot(selectedLocationId)
    } catch (authError) {
      setError(authError.message)
    } finally {
      setAuthBusy(false)
    }
  }, [authToken, fetchSnapshot, selectedLocationId])

  const logoutOpsAuth = useCallback(async () => {
    setAuthBusy(true)
    try {
      await fetch('/api/fnb/ops/session', { method: 'DELETE' })
    } finally {
      setAuthRequired(true)
      setSnapshot(null)
      setLocations([])
      setServiceStatus(null)
      setBusyAction('')
      setLoading(false)
      setAuthBusy(false)
    }
  }, [])

  const updateOnboardingField = useCallback((key, value) => {
    setOnboardingForm((current) => ({
      ...current,
      [key]: value,
    }))
  }, [])

  const submitOnboarding = useCallback(async () => {
    const payload = {
      tenantName: onboardingForm.tenantName.trim(),
      locationName: onboardingForm.locationName.trim(),
      restaurantType: onboardingForm.restaurantType.trim() || '餐飲',
      address: onboardingForm.address.trim(),
      ownerName: onboardingForm.ownerName.trim() || '店主',
      primaryGoal: onboardingForm.primaryGoal.trim() || '穩定回流與 Google 更新',
      toneSummary: onboardingForm.voice.trim() || '直接、溫暖、不過度推銷',
      voice: onboardingForm.voice.trim() || '直接、溫暖、不過度推銷',
      signatureItems: parseCsvText(onboardingForm.signatureItemsText),
      guardrails: parseCsvText(onboardingForm.guardrailsText),
      menuItems: parseMenuItemsText(onboardingForm.menuItemsText),
      googleLocationName: onboardingForm.googleLocationName.trim() || null,
      merchantTimeBudgetMinutes: Number(onboardingForm.merchantTimeBudgetMinutes || 15),
      weeklyTimeBudgetMinutes: Number(onboardingForm.weeklyTimeBudgetMinutes || 15),
      lowTouchMode: true,
      notes: onboardingForm.notes.trim() || null,
    }

    if (!payload.tenantName || !payload.locationName) {
      setError('請先填入租戶名稱與店點名稱，再建立商家資料。')
      return
    }

    await postAction('onboard-merchant', { payload })
  }, [onboardingForm, postAction])

  const switchLocation = useCallback((locationId) => {
    if (!locationId || locationId === selectedLocationId) return
    setInviteLinks(null)
    fetchSnapshot(locationId)
  }, [fetchSnapshot, selectedLocationId])

  const metrics = snapshot?.metrics
  const activeLocationId = selectedLocationId || snapshot?.location?.id || ''
  const activeLinks = inviteLinks || snapshot?.links || null
  const currentProvider = snapshot?.workspace?.provider || serviceStatus?.provider || 'sqlite'
  const providerTone = currentProvider === 'postgres' ? '#39ff14' : '#ffb703'
  const providerLabel = currentProvider === 'postgres' ? 'Postgres' : 'SQLite'
  const currentEnvironment = snapshot?.workspace?.environment || serviceStatus?.environment || 'staging'
  const workspaceLocations = snapshot?.locations || locations
  const canRunActions = Boolean(activeLocationId)
  const setupStatusItems = [
    {
      key: 'provider',
      label: '資料層',
      value: providerLabel,
      ready: currentProvider === 'postgres',
      tone: providerTone,
    },
    {
      key: 'line',
      label: 'LINE Messaging',
      value: serviceStatus?.lineConfigured ? '已設定' : '未設定',
      ready: Boolean(serviceStatus?.lineConfigured),
      tone: '#00f5ff',
    },
    {
      key: 'line-login',
      label: 'LINE Login / LIFF',
      value: serviceStatus?.lineLoginConfigured && serviceStatus?.liffConfigured ? '已設定' : '未設定',
      ready: Boolean(serviceStatus?.lineLoginConfigured && serviceStatus?.liffConfigured),
      tone: '#39ff14',
    },
    {
      key: 'google',
      label: 'Google Business',
      value: serviceStatus?.googleConfigured ? '已設定' : '待接線',
      ready: Boolean(serviceStatus?.googleConfigured),
      tone: '#ffb703',
    },
  ]

  const merchantTimeUsage = useMemo(() => {
    if (!metrics) return 0
    const budget = metrics.merchantTimeBudgetMinutes || 1
    return Math.min(100, Math.round((metrics.merchantTimeSavedMinutes / budget) * 100))
  }, [metrics])

  if (loading) {
    return (
      <div className="glass-card rounded-xl p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-56 rounded bg-gray-800" />
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {[1, 2, 3, 4].map((item) => (
              <div key={item} className="h-28 rounded-xl bg-gray-900/70" />
            ))}
          </div>
          <div className="grid gap-4 xl:grid-cols-3">
            {[1, 2, 3].map((item) => (
              <div key={item} className="h-64 rounded-xl bg-gray-900/70" />
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (authRequired) {
    return (
      <div className="glass-card rounded-2xl p-6">
        <div className="max-w-xl space-y-5">
          <div>
            <div className="mb-3 flex items-center gap-2 text-sm text-orange-300">
              <ShieldAlert className="h-4 w-4" />
              <span>Internal Ops Access Required</span>
            </div>
            <h2 className="font-display text-3xl text-white">輸入內部 admin token</h2>
            <p className="mt-3 text-sm leading-7 text-gray-300">
              `/ops` 與營運 API 現在只接受 `FNB_INTERNAL_API_TOKEN`。驗證成功後會建立一個 httpOnly session，
              之後同一瀏覽器就不需要重複輸入。
            </p>
          </div>

          <Field label="Admin Token" hint="使用 Render 或 .env.local 裡的 FNB_INTERNAL_API_TOKEN。">
            <TextInput
              type="password"
              value={authToken}
              onChange={(event) => setAuthToken(event.target.value)}
              placeholder="貼上 FNB_INTERNAL_API_TOKEN"
            />
          </Field>

          {error ? (
            <div className="rounded-lg border border-red-500/40 bg-red-950/30 px-4 py-3 text-sm text-red-200">
              {error}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <ActionButton onClick={submitOpsAuth} disabled={authBusy} tone="#00f5ff">
              <ShieldAlert className="mr-1 inline h-4 w-4" />
              驗證並進入 ops
            </ActionButton>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="glass-card rounded-2xl p-6">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="max-w-3xl">
            <div className="mb-3 flex items-center gap-2 text-sm text-orange-300">
              <Store className="h-4 w-4" />
              <span>AI 餐飲 SaaS 低負擔版營運台</span>
            </div>
            <h2 className="font-display text-3xl text-white">
              {snapshot?.location?.name || '建立第一間試點商家'}
              <span className="ml-3 text-base text-gray-500">{snapshot?.location?.restaurantType || 'Pilot onboarding'}</span>
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-gray-300">
              目標是讓店家每週只花 15 分鐘內處理必要決策。系統先自動排出內容、推播與回流動作，
              只有高風險與缺資料的情況才打擾店家。
            </p>
            <div className="mt-4 flex flex-wrap gap-3 text-xs text-gray-400">
              <span className="rounded-full border border-white/10 px-3 py-1">Tenant: {snapshot?.tenant?.name || '尚未建立'}</span>
              <span className="rounded-full border border-white/10 px-3 py-1">Plan: {snapshot?.tenant?.plan || 'growth'}</span>
              <span className="rounded-full border border-white/10 px-3 py-1">主工作面: LINE 對話式 Copilot</span>
              <span className="rounded-full border px-3 py-1" style={{ borderColor: `${providerTone}55`, color: providerTone }}>
                {providerLabel} · {currentEnvironment}
              </span>
              {snapshot?.workspace?.demoMode || serviceStatus?.demoMode ? (
                <span className="rounded-full border border-yellow-500/40 px-3 py-1 text-yellow-300">demo mode</span>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <ActionButton onClick={logoutOpsAuth} disabled={Boolean(busyAction) || authBusy} tone="#fb7185">
              <ShieldAlert className="mr-1 inline h-4 w-4" />
              登出 ops
            </ActionButton>
            <ActionButton onClick={() => postAction('generate-plan')} disabled={Boolean(busyAction) || !canRunActions} tone="#ffb703">
              <CalendarRange className="mr-1 inline h-4 w-4" />
              產新一週計畫
            </ActionButton>
            <ActionButton onClick={() => postAction('run-autopilot')} disabled={Boolean(busyAction) || !canRunActions} tone="#00f5ff">
              <Bot className="mr-1 inline h-4 w-4" />
              執行 Autopilot
            </ActionButton>
            <ActionButton onClick={() => postAction('generate-digest')} disabled={Boolean(busyAction) || !canRunActions} tone="#39ff14">
              <Sparkles className="mr-1 inline h-4 w-4" />
              重算週摘要
            </ActionButton>
            <ActionButton onClick={() => fetchSnapshot(activeLocationId)} disabled={Boolean(busyAction)} tone="#9d4edd">
              <RefreshCw className="mr-1 inline h-4 w-4" />
              重新整理
            </ActionButton>
          </div>
        </div>

        {workspaceLocations.length ? (
          <div className="mt-5 flex flex-wrap gap-2">
            {workspaceLocations.map((location) => {
              const isActive = location.id === activeLocationId
              return (
                <button
                  key={location.id}
                  type="button"
                  onClick={() => switchLocation(location.id)}
                  className="rounded-full border px-3 py-2 text-xs font-semibold transition hover:translate-y-[-1px]"
                  style={{
                    borderColor: isActive ? '#00f5ff66' : 'rgba(255,255,255,0.08)',
                    color: isActive ? '#00f5ff' : '#d1d5db',
                    background: isActive ? 'rgba(0,245,255,0.12)' : 'rgba(255,255,255,0.03)',
                  }}
                >
                  {location.name}
                </button>
              )
            })}
          </div>
        ) : null}

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            icon={Clock3}
            label="店家本週省下時間"
            value={`${metrics?.merchantTimeSavedMinutes || 0} 分鐘`}
            tone="#39ff14"
            hint={`時間預算 ${metrics?.merchantTimeBudgetMinutes || 15} 分鐘內，負擔使用率 ${merchantTimeUsage}%`}
          />
          <MetricCard
            icon={CheckCircle2}
            label="本週自動完成"
            value={`${metrics?.autoPublishedThisWeek || 0} 則`}
            tone="#00f5ff"
            hint={`本週已發佈 ${metrics?.publishedThisWeek || 0} 則內容`}
          />
          <MetricCard
            icon={MessagesSquare}
            label="待店家決策"
            value={`${metrics?.merchantApprovalsPending || 0} 件`}
            tone="#ffb703"
            hint="只把需要拍板的事情丟回 LINE，不強迫店家開後台。"
          />
          <MetricCard
            icon={QrCode}
            label="代理成交訊號"
            value={`${metrics?.couponClaims || 0} 領券 / ${metrics?.navigations || 0} 導航`}
            tone="#fb7185"
            hint={`${metrics?.friendAdds || 0} 友加、${metrics?.calls || 0} 通電話、${metrics?.messages || 0} 則訊息`}
          />
        </div>

        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between text-xs text-gray-500">
            <span>店家時間負擔</span>
            <span>越低越好</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-gray-900">
            <div
              className="h-full rounded-full bg-gradient-to-r from-green-500 via-cyan-400 to-cyan-300"
              style={{ width: `${Math.min(merchantTimeUsage, 100)}%` }}
            />
          </div>
        </div>

        {error ? (
          <div className="mt-4 rounded-lg border border-red-500/40 bg-red-950/30 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.92fr,1.08fr]">
        <div className="glass-card rounded-xl p-5">
          <div className="mb-4 flex items-center gap-2">
            <NotebookPen className="h-4 w-4 text-cyan-300" />
            <div className="text-sm uppercase tracking-[0.18em] text-cyan-300">Real Merchant Onboarding</div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="租戶名稱" hint="通常是品牌或經營主體。">
              <TextInput
                value={onboardingForm.tenantName}
                onChange={(event) => updateOnboardingField('tenantName', event.target.value)}
                placeholder="例：鼎湯餐飲集團"
              />
            </Field>
            <Field label="店點名稱" hint="會成為真正的 location。">
              <TextInput
                value={onboardingForm.locationName}
                onChange={(event) => updateOnboardingField('locationName', event.target.value)}
                placeholder="例：鼎湯麵鋪 民生店"
              />
            </Field>
            <Field label="店型" hint="例：小吃、咖啡、便當、火鍋。">
              <TextInput
                value={onboardingForm.restaurantType}
                onChange={(event) => updateOnboardingField('restaurantType', event.target.value)}
                placeholder="小吃 / 咖啡 / 便當"
              />
            </Field>
            <Field label="店主名稱" hint="會成為預設 owner/operator。">
              <TextInput
                value={onboardingForm.ownerName}
                onChange={(event) => updateOnboardingField('ownerName', event.target.value)}
                placeholder="王老闆"
              />
            </Field>
            <Field label="地址" hint="先填店址，方便後續 Google Business 綁定。">
              <TextInput
                value={onboardingForm.address}
                onChange={(event) => updateOnboardingField('address', event.target.value)}
                placeholder="台北市大同區..."
              />
            </Field>
            <Field label="Google Business Location Name" hint="如果已有 GBP，可先填正式 locationName。">
              <TextInput
                value={onboardingForm.googleLocationName}
                onChange={(event) => updateOnboardingField('googleLocationName', event.target.value)}
                placeholder="locations/1234567890"
              />
            </Field>
            <Field label="主要目標" hint="系統會拿來生成低負擔周計畫。">
              <TextInput
                value={onboardingForm.primaryGoal}
                onChange={(event) => updateOnboardingField('primaryGoal', event.target.value)}
                placeholder="穩定回流與 Google 更新"
              />
            </Field>
            <Field label="品牌語氣" hint="簡短描述即可。">
              <TextInput
                value={onboardingForm.voice}
                onChange={(event) => updateOnboardingField('voice', event.target.value)}
                placeholder="直接、溫暖、不過度推銷"
              />
            </Field>
            <Field label="招牌菜" hint="用逗號分隔。">
              <TextInput
                value={onboardingForm.signatureItemsText}
                onChange={(event) => updateOnboardingField('signatureItemsText', event.target.value)}
                placeholder="牛肉麵, 滷味拼盤"
              />
            </Field>
            <Field label="Guardrails" hint="用逗號分隔。">
              <TextInput
                value={onboardingForm.guardrailsText}
                onChange={(event) => updateOnboardingField('guardrailsText', event.target.value)}
                placeholder="避免誇大療效, 避免連發相同促銷"
              />
            </Field>
            <Field label="店家每次可投入分鐘數" hint="預設 15 分鐘。">
              <TextInput
                type="number"
                min="1"
                value={onboardingForm.merchantTimeBudgetMinutes}
                onChange={(event) => updateOnboardingField('merchantTimeBudgetMinutes', event.target.value)}
              />
            </Field>
            <Field label="每週時間預算" hint="週摘要會用這個判斷負擔是否過重。">
              <TextInput
                type="number"
                min="1"
                value={onboardingForm.weeklyTimeBudgetMinutes}
                onChange={(event) => updateOnboardingField('weeklyTimeBudgetMinutes', event.target.value)}
              />
            </Field>
          </div>

          <div className="mt-4 grid gap-4">
            <Field label="菜單" hint="每行一筆，格式：菜名|分類|價格|是否招牌。">
              <TextAreaInput
                rows={5}
                value={onboardingForm.menuItemsText}
                onChange={(event) => updateOnboardingField('menuItemsText', event.target.value)}
                placeholder={'牛肉麵|主食|220|招牌\n燙青菜|小菜|60|'}
              />
            </Field>
            <Field label="內部備註" hint="只留給 ops 參考。">
              <TextAreaInput
                rows={3}
                value={onboardingForm.notes}
                onChange={(event) => updateOnboardingField('notes', event.target.value)}
                placeholder="例如：目前沒有專職行銷，Google 評論回覆慢。"
              />
            </Field>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <ActionButton onClick={submitOnboarding} disabled={Boolean(busyAction)} tone="#00f5ff">
              <NotebookPen className="mr-1 inline h-4 w-4" />
              建立商家資料
            </ActionButton>
            <ActionButton
              onClick={() => setOnboardingForm(createInitialOnboardingForm())}
              disabled={Boolean(busyAction)}
              tone="#9d4edd"
            >
              清空表單
            </ActionButton>
            <div className="text-xs text-gray-500">
              建立後會自動產生 merchant bind link、ops deep link 與 location。
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="glass-card rounded-xl p-5">
            <div className="mb-4 flex items-center gap-2">
              <Link2 className="h-4 w-4 text-green-300" />
              <div className="text-sm uppercase tracking-[0.18em] text-green-300">Workspace Status</div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {setupStatusItems.map((item) => (
                <div key={item.key} className="rounded-lg border border-white/5 bg-black/20 p-3">
                  <div className="text-xs text-gray-500">{item.label}</div>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-white">{item.value}</div>
                    <div
                      className="rounded-full px-2 py-1 text-[10px] uppercase tracking-[0.18em]"
                      style={{
                        border: `1px solid ${item.ready ? `${item.tone}66` : 'rgba(251,191,36,0.4)'}`,
                        color: item.ready ? item.tone : '#fbbf24',
                      }}
                    >
                      {item.ready ? 'ready' : 'todo'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 rounded-lg border border-white/5 bg-black/20 px-4 py-3 text-sm text-gray-300">
              {currentProvider === 'postgres'
                ? '現在已經是 Postgres-ready 工作模式，適合開始接真實 pilot 商家。'
                : '目前仍在 SQLite 模式，適合本機與單機 tunnel。若要多店長期運行，下一步應切到 Postgres。'}
            </div>
          </div>

          <div className="glass-card rounded-xl p-5">
            <div className="mb-4 flex items-center gap-2">
              <ExternalLink className="h-4 w-4 text-cyan-300" />
              <div className="text-sm uppercase tracking-[0.18em] text-cyan-300">Merchant Entry Links</div>
            </div>
            {activeLinks ? (
              <div className="space-y-3">
                <div className="rounded-lg border border-white/5 bg-black/20 p-3">
                  <div className="text-xs text-gray-500">Merchant bind URL</div>
                  <div className="mt-2 break-all text-sm text-white">{activeLinks.merchantBindUrl}</div>
                </div>
                <div className="rounded-lg border border-white/5 bg-black/20 p-3">
                  <div className="text-xs text-gray-500">Merchant dashboard</div>
                  <div className="mt-2 break-all text-sm text-white">{activeLinks.merchantDashboardUrl}</div>
                </div>
                <div className="rounded-lg border border-white/5 bg-black/20 p-3">
                  <div className="text-xs text-gray-500">Ops dashboard</div>
                  <div className="mt-2 break-all text-sm text-white">{activeLinks.opsDashboardUrl}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <ActionLink href={activeLinks.merchantBindUrl} tone="#00f5ff">開啟綁定入口</ActionLink>
                  <ActionLink href={activeLinks.merchantDashboardUrl} tone="#39ff14">開啟商家面</ActionLink>
                  <ActionLink href={activeLinks.opsDashboardUrl} tone="#ffb703">開啟 ops</ActionLink>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-gray-700 px-4 py-8 text-sm text-gray-500">
                建立第一個商家或切換 location 後，這裡會顯示對應的 bind link 與 dashboard deep links。
              </div>
            )}
          </div>
        </div>
      </div>

      {!snapshot ? (
        <div className="glass-card rounded-xl border border-dashed border-cyan-500/20 px-6 py-10 text-center">
          <div className="mx-auto max-w-2xl">
            <div className="text-lg font-semibold text-white">目前還沒有商家 location</div>
            <div className="mt-3 text-sm leading-7 text-gray-400">
              先用上方 onboarding 建立第一家試點店。建立後，ops 會切到該 location，並產生商家綁定入口與後續的 Autopilot 流程。
            </div>
          </div>
        </div>
      ) : null}

      {snapshot ? (
        <>

      <div className="grid gap-4 xl:grid-cols-[0.9fr,1.1fr]">
        <div className="glass-card rounded-xl p-5">
          <div className="mb-4 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-300" />
            <div className="text-sm uppercase tracking-[0.18em] text-green-300">Pilot KPIs</div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg bg-black/20 p-3">
              <div className="text-xs text-gray-500">Autopilot 成功率</div>
              <div className="mt-1 text-xl font-bold text-white">{snapshot?.kpis?.autopilotSuccessRate || 0}%</div>
            </div>
            <div className="rounded-lg bg-black/20 p-3">
              <div className="text-xs text-gray-500">摘要閱讀率</div>
              <div className="mt-1 text-xl font-bold text-white">{snapshot?.kpis?.digestReadRate || 0}%</div>
            </div>
            <div className="rounded-lg bg-black/20 p-3">
              <div className="text-xs text-gray-500">代理成效事件</div>
              <div className="mt-1 text-xl font-bold text-white">{snapshot?.kpis?.attributedEventsCount || 0}</div>
            </div>
            <div className="rounded-lg bg-black/20 p-3">
              <div className="text-xs text-gray-500">渠道健康度</div>
              <div className="mt-1 text-xl font-bold text-white">{snapshot?.kpis?.channelHealthScore || 0}%</div>
            </div>
          </div>
        </div>

        <div className="glass-card rounded-xl p-5">
          <div className="mb-4 flex items-center gap-2">
            <TriangleAlert className="h-4 w-4 text-orange-300" />
            <div className="text-sm uppercase tracking-[0.18em] text-orange-300">Onboarding & Alerts</div>
          </div>
          <div className="grid gap-4 lg:grid-cols-[0.95fr,1.05fr]">
            <div className="space-y-3">
              {snapshot?.onboardingChecklist?.map((item) => (
                <div key={item.id} className="flex items-center justify-between rounded-lg border border-white/5 bg-black/20 px-3 py-3">
                  <div className="text-sm text-white">{item.label}</div>
                  <div className={`text-xs font-semibold ${item.done ? 'text-green-300' : 'text-yellow-300'}`}>
                    {item.done ? 'done' : 'todo'}
                  </div>
                </div>
              ))}
              <div className="flex flex-wrap gap-2 pt-1">
                <ActionLink href={`/api/auth/line/start?locationId=${activeLocationId}&redirectTo=/ops`} tone="#00f5ff">
                  連接 LINE
                </ActionLink>
                <ActionLink href={`/api/auth/google/start?locationId=${activeLocationId}&redirectTo=/ops`} tone="#39ff14">
                  連接 Google
                </ActionLink>
              </div>
            </div>
            <div className="space-y-3">
              {snapshot?.alerts?.length ? snapshot.alerts.map((alert) => (
                <div key={alert.id} className="rounded-lg border border-orange-500/20 bg-orange-500/5 p-3">
                  <div className="text-sm font-semibold text-white">{alert.message}</div>
                  <div className="mt-2 text-[11px] uppercase tracking-[0.18em] text-orange-300">
                    {alert.severity} · {alert.code}
                  </div>
                </div>
              )) : (
                <div className="rounded-lg border border-dashed border-gray-700 px-4 py-8 text-sm text-gray-500">
                  目前沒有需要處理的風險告警。
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.4fr,1fr]">
        <div className="glass-card rounded-xl p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm uppercase tracking-[0.18em] text-cyan-400">Merchant Copilot Inbox</div>
              <div className="mt-1 text-sm text-gray-400">店家主要只會在 LINE 看到這些卡片與摘要。</div>
            </div>
            <div className="rounded-full border border-cyan-500/30 px-3 py-1 text-xs text-cyan-300">
              {snapshot?.pendingApprovals?.length || 0} pending
            </div>
          </div>

          <div className="space-y-4">
            {snapshot?.pendingApprovals?.length ? (
              snapshot.pendingApprovals.map((approval) => (
                <div key={approval.id} className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4">
                  <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <MessagesSquare className="h-4 w-4 text-cyan-300" />
                        <div className="font-semibold text-white">{approval.title}</div>
                      </div>
                      <div className="mt-2 whitespace-pre-line text-sm leading-7 text-gray-300">
                        {approval.merchantMessage}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-3 text-xs text-gray-500">
                        <span>route: {approval.route}</span>
                        <span>risk: {Math.round((approval.riskScore || 0) * 100)}%</span>
                        <span>預計: {formatDate(approval.scheduledFor)}</span>
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-wrap gap-2">
                      <ActionButton
                        onClick={() => postAction('merchant-reply', {
                          messageIntent: 'approve-draft',
                          payload: { draftId: approval.draftId, actorId: 'owner' },
                        })}
                        disabled={Boolean(busyAction)}
                        tone="#39ff14"
                      >
                        同意排程
                      </ActionButton>
                      <ActionButton
                        onClick={() => postAction('merchant-reply', {
                          messageIntent: 'reschedule-draft',
                          payload: { draftId: approval.draftId, actorId: 'owner' },
                        })}
                        disabled={Boolean(busyAction)}
                        tone="#ffb703"
                      >
                        延到明天
                      </ActionButton>
                      <ActionButton
                        onClick={() => postAction('merchant-reply', {
                          messageIntent: 'skip-draft',
                          payload: { draftId: approval.draftId, actorId: 'owner' },
                        })}
                        disabled={Boolean(busyAction)}
                        tone="#fb7185"
                      >
                        先跳過
                      </ActionButton>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-dashed border-gray-700 px-4 py-8 text-sm text-gray-500">
                目前沒有需要店家回覆的卡片，符合「例外才打擾」原則。
              </div>
            )}

            <div className="grid gap-3 md:grid-cols-3">
              <ActionButton
                onClick={() => postAction('merchant-reply', {
                  messageIntent: 'report-stock-issue',
                  payload: { item: '蛤蜊雞湯', note: '今天先停售', actorId: 'owner' },
                })}
                disabled={Boolean(busyAction)}
                tone="#f97316"
              >
                回報停售品項
              </ActionButton>
              <ActionButton
                onClick={() => postAction('merchant-reply', {
                  messageIntent: 'submit-store-update',
                  payload: { type: 'holiday', note: '下週三提早 18:00 打烊', actorId: 'owner' },
                })}
                disabled={Boolean(busyAction)}
                tone="#9d4edd"
              >
                提交營業更新
              </ActionButton>
              <ActionButton
                onClick={() => postAction('merchant-reply', {
                  messageIntent: 'request-summary',
                  payload: { actorId: 'owner' },
                })}
                disabled={Boolean(busyAction)}
                tone="#00f5ff"
              >
                補發本週摘要
              </ActionButton>
            </div>
          </div>
        </div>

        <div className="glass-card rounded-xl p-5">
          <div className="mb-4 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-green-300" />
            <div className="text-sm uppercase tracking-[0.18em] text-green-300">Weekly Digest</div>
          </div>
          {snapshot?.latestDigest ? (
            <div className="space-y-4">
              <div>
                <div className="text-lg font-semibold text-white">{snapshot.latestDigest.headline}</div>
                <div className="mt-2 text-sm leading-7 text-gray-300">
                  期間 {formatDate(snapshot.latestDigest.periodStart)} 到 {formatDate(snapshot.latestDigest.periodEnd)}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-black/20 p-3">
                  <div className="text-xs text-gray-500">領券</div>
                  <div className="mt-1 text-xl font-bold text-white">{snapshot.latestDigest.summary.couponClaims || 0}</div>
                </div>
                <div className="rounded-lg bg-black/20 p-3">
                  <div className="text-xs text-gray-500">友加</div>
                  <div className="mt-1 text-xl font-bold text-white">{snapshot.latestDigest.summary.friendAdds || 0}</div>
                </div>
                <div className="rounded-lg bg-black/20 p-3">
                  <div className="text-xs text-gray-500">導航</div>
                  <div className="mt-1 text-xl font-bold text-white">{snapshot.latestDigest.summary.navigations || 0}</div>
                </div>
                <div className="rounded-lg bg-black/20 p-3">
                  <div className="text-xs text-gray-500">自動發佈</div>
                  <div className="mt-1 text-xl font-bold text-white">{snapshot.latestDigest.summary.autoPublished || 0}</div>
                </div>
              </div>

              <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-4 text-sm leading-7 text-gray-200">
                <div className="mb-2 text-xs uppercase tracking-[0.18em] text-green-300">下週建議</div>
                {snapshot.latestDigest.recommendedNextAction}
              </div>

              <div className="grid gap-2 md:grid-cols-2">
              <ActionButton
                onClick={() => postAction('record-event', {
                  source: 'line',
                    campaignId: snapshot.latestCampaignPlan?.id,
                    eventType: 'coupon-claim',
                    value: 1,
                    offerId: snapshot.offers?.[0]?.id,
                    draftId: snapshot.pipeline?.merchantApprove?.[0]?.id,
                  })}
                  disabled={Boolean(busyAction)}
                  tone="#39ff14"
                >
                  +1 領券
                </ActionButton>
                <ActionButton
                  onClick={() => postAction('record-event', {
                    source: 'google-business-profile',
                    campaignId: snapshot.latestCampaignPlan?.id,
                    eventType: 'navigation',
                    value: 1,
                    draftId: snapshot.pipeline?.published?.find((item) => item.channel === 'google-business-profile')?.id,
                  })}
                  disabled={Boolean(busyAction)}
                  tone="#ffb703"
                >
                  +1 導航
                </ActionButton>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-gray-700 px-3 py-5 text-sm text-gray-500">
              尚未生成週摘要。
            </div>
          )}
        </div>
      </div>

      <div className="glass-card rounded-xl p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <div className="text-sm uppercase tracking-[0.18em] text-cyan-300">Merchant NL Copilot</div>
            <div className="mt-1 text-sm text-gray-400">商家自然語言任務、卡住原因與 OpenClaw handoff 狀態。</div>
          </div>
          <div className="flex items-center gap-2">
            <ActionButton
              onClick={() => postAction('merchant-copilot-complete-next')}
              disabled={Boolean(busyAction)}
              tone="#00f5ff"
            >
              <Bot className="mr-1 inline h-4 w-4" />
              處理下一筆
            </ActionButton>
            <div className="rounded-full border border-cyan-500/30 px-3 py-1 text-xs text-cyan-300">
              {snapshot?.merchantCopilot?.tasks?.length || 0} tasks
            </div>
          </div>
        </div>

        {(snapshot?.merchantCopilot?.tasks || []).length ? (
          <div className="space-y-3">
            {snapshot.merchantCopilot.tasks.map((task) => (
              <div key={task.id} className="rounded-xl border border-white/5 bg-black/20 p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <Bot className="h-4 w-4 text-cyan-300" />
                      <div className="font-semibold text-white">{task.title || 'Merchant Copilot 任務'}</div>
                    </div>
                    <div className="mt-2 text-sm leading-7 text-gray-300">{task.instructionText}</div>
                    <div className="mt-3 flex flex-wrap gap-3 text-xs text-gray-500">
                      <span>type: {task.taskType}</span>
                      <span>status: {task.status}</span>
                      <span>assigned: {task.assignedTo || 'unassigned'}</span>
                      {task.confidence !== null && task.confidence !== undefined ? (
                        <span>confidence: {Math.round(task.confidence * 100)}%</span>
                      ) : null}
                    </div>
                  </div>

                  <div className="shrink-0 rounded-lg border px-3 py-2 text-xs"
                    style={{
                      borderColor: task.status === 'completed' ? 'rgba(57,255,20,0.4)' : task.status === 'ops-review' || task.status === 'failed' ? 'rgba(251,113,133,0.4)' : 'rgba(0,245,255,0.35)',
                      color: task.status === 'completed' ? '#39ff14' : task.status === 'ops-review' || task.status === 'failed' ? '#fb7185' : '#00f5ff',
                    }}
                  >
                    {task.status}
                  </div>
                </div>

                {task.outputDraft ? (
                  <div className="mt-4 rounded-lg border border-green-500/20 bg-green-500/5 p-3">
                    <div className="text-sm font-semibold text-white">{task.outputDraft.title}</div>
                    <div className="mt-2 whitespace-pre-line text-sm leading-7 text-gray-300">{task.outputDraft.body}</div>
                  </div>
                ) : null}

                {task.errorMessage ? (
                  <div className="mt-3 rounded-lg border border-red-500/20 bg-red-950/20 px-3 py-3 text-sm text-red-200">
                    {task.errorMessage}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-gray-700 px-4 py-8 text-sm text-gray-500">
            目前沒有新的 Merchant Copilot 任務。
          </div>
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <PipelineColumn
          title="Auto Send"
          tone="#00f5ff"
          icon={Send}
          items={snapshot?.pipeline?.autoSend || []}
          emptyText="目前沒有待自動發送的草稿。"
        />
        <PipelineColumn
          title="Merchant Approve"
          tone="#ffb703"
          icon={CircleDashed}
          items={snapshot?.pipeline?.merchantApprove || []}
          emptyText="目前沒有卡在店家手上的決策。"
        />
        <PipelineColumn
          title="Ops Review"
          tone="#fb7185"
          icon={ShieldAlert}
          items={snapshot?.pipeline?.opsReview || []}
          emptyText="目前沒有需要人工代操介入的項目。"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr,1fr]">
        <div className="glass-card rounded-xl p-5">
          <div className="mb-4 flex items-center gap-2">
            <TriangleAlert className="h-4 w-4 text-orange-300" />
            <div className="text-sm uppercase tracking-[0.18em] text-orange-300">Channel Health & Rules</div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-3">
              {snapshot?.channels?.map((channel) => (
                <div key={channel.id} className="rounded-lg border border-white/5 bg-black/20 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-white">{channel.channel}</div>
                    <div className={`rounded-full px-2 py-1 text-[10px] uppercase tracking-[0.18em] ${
                      channel.status === 'connected'
                        ? 'border border-green-500/40 text-green-300'
                        : channel.status === 'planned'
                          ? 'border border-yellow-500/40 text-yellow-300'
                          : 'border border-red-500/40 text-red-300'
                    }`}>
                      {channel.status}
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-gray-400">
                    {channel.metadata?.accountName || channel.metadata?.listingName || channel.metadata?.note || 'No details'}
                  </div>
                </div>
              ))}
            </div>

            <div className="space-y-3">
              {snapshot?.autopilotRules?.map((rule) => (
                <div key={rule.id} className="rounded-lg border border-white/5 bg-black/20 p-3">
                  <div className="text-sm font-semibold text-white">{rule.name}</div>
                  <div className="mt-2 text-xs text-gray-500">
                    {rule.actionMode} · tolerance {Math.round(rule.riskTolerance * 100)}%
                  </div>
                  <div className="mt-2 text-xs text-gray-400">
                    {rule.config?.draftTypes?.join(', ') || 'all draft types'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="glass-card rounded-xl p-5">
          <div className="mb-4 flex items-center gap-2">
            <Bot className="h-4 w-4 text-purple-300" />
            <div className="text-sm uppercase tracking-[0.18em] text-purple-300">Ops Audit Trail</div>
          </div>
          <div className="space-y-3">
            {snapshot?.audits?.map((audit) => (
              <div key={audit.id} className="rounded-lg border border-white/5 bg-black/20 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-white">{audit.action}</div>
                  <div className="text-[10px] text-gray-500">{formatDate(audit.createdAt)}</div>
                </div>
                <div className="mt-2 text-xs text-gray-400">
                  {audit.actorType} → {audit.entityType}
                  {audit.entityId ? ` (${audit.entityId.slice(0, 8)})` : ''}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
        </>
      ) : null}
    </div>
  )
}
