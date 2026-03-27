'use client'

import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, Building2, FolderOpen, Plus } from 'lucide-react'
import Link from 'next/link'
import { useStudioBusiness } from '../lib/useStudioBusiness'

const CONTENTSTUDIO_BRAND_URL = 'https://contentstudio.bw-space.com/brand'

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

function TextAreaInput(props) {
  return (
    <textarea
      {...props}
      className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none placeholder:text-gray-600"
    />
  )
}

function safeArray(val) {
  return Array.isArray(val) ? val : []
}

function textListValue(items) {
  if (!Array.isArray(items) || items.length === 0) return ''
  return items.join(', ')
}

function formFromBusiness(b) {
  if (!b) return {
    name: '', category: '商家短影音',
    brand_tone: '可信、清楚、好理解', target_audience: '一般消費者',
    key_offers: '', priority_goals: '', frequent_questions: '',
    avoid_topics: '', notes: '',
  }
  return {
    name: b.name || '',
    category: b.category || '商家短影音',
    brand_tone: b.brand_tone || '可信、清楚、好理解',
    target_audience: b.target_audience || '一般消費者',
    key_offers: textListValue(b.key_offers),
    priority_goals: textListValue(b.priority_goals),
    frequent_questions: textListValue(b.frequent_questions),
    avoid_topics: textListValue(b.avoid_topics),
    notes: b.notes || '',
  }
}

export default function StudioBusinessesPage() {
  const {
    businesses,
    selectedBusinessId,
    selectedBusiness,
    loading,
    error: bizError,
    authToken,
    setAuthToken,
    selectBusiness,
    saveBusiness,
  } = useStudioBusiness()

  const [form, setForm] = useState(formFromBusiness(null))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [mode, setMode] = useState('edit') // 'edit' | 'new'
  const isContentStudioSync = businesses.length > 0 && businesses[0]?.source === 'contentstudio'

  useEffect(() => {
    if (selectedBusiness && mode === 'edit') {
      setForm(formFromBusiness(selectedBusiness))
    }
  }, [selectedBusiness, mode])

  useEffect(() => {
    if (isContentStudioSync && mode !== 'edit') {
      setMode('edit')
    }
  }, [isContentStudioSync, mode])

  const handleNew = useCallback(() => {
    setMode('new')
    setForm(formFromBusiness(null))
    setError('')
  }, [])

  const handleSelect = useCallback((id) => {
    selectBusiness(id)
    setMode('edit')
    setError('')
  }, [selectBusiness])

  const handleSave = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      await saveBusiness(form)
      setNotice('商家資料已儲存')
      setTimeout(() => setNotice(''), 2000)
      if (mode === 'new') setMode('edit')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }, [saveBusiness, form, mode])

  const f = (field) => (e) => setForm((c) => ({ ...c, [field]: e.target.value }))

  return (
    <main className="min-h-screen px-4 py-6 lg:px-6 lg:py-8">
      <div className="mx-auto max-w-6xl space-y-6">

        {/* Header */}
        <div>
          <Link href="/studio" className="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-300">
            <ArrowLeft className="h-3.5 w-3.5" />
            回內容看板
          </Link>
          <h1 className="text-2xl font-bold text-white">商家管理</h1>
          <p className="mt-1 text-sm text-gray-500">設定商家資料、品牌語氣、服務範圍</p>
        </div>

        {error ? (
          <div className="rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>
        ) : null}
        {notice ? (
          <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{notice}</div>
        ) : null}
        {bizError ? (
          <div className="rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">{bizError}</div>
        ) : null}
        {isContentStudioSync ? (
          <div className="flex flex-col gap-3 rounded-2xl border border-cyan-400/30 bg-cyan-500/10 px-4 py-4 text-sm text-cyan-100 md:flex-row md:items-center md:justify-between">
            <div>商家資料由 ContentStudio 統一管理。</div>
            <Link
              href={CONTENTSTUDIO_BRAND_URL}
              className="inline-flex items-center text-sm font-medium text-cyan-200 transition hover:text-white"
            >
              前往 ContentStudio 管理品牌 →
            </Link>
          </div>
        ) : null}

        <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
          {/* Business list */}
          <div className="glass-card rounded-[24px] p-5" style={{ borderColor: '#00f5ff33' }}>
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-cyan-400" />
                <div className="text-sm font-medium text-cyan-300">商家清單</div>
              </div>
              <div className="text-xs text-gray-600">{loading ? '…' : `${businesses.length} 個`}</div>
            </div>

            <div className="space-y-2">
              {businesses.map((b) => {
                const active = b.business_id === selectedBusinessId && mode === 'edit'
                return (
                  <button
                    key={b.business_id}
                    type="button"
                    onClick={() => handleSelect(b.business_id)}
                    className="w-full rounded-2xl border p-3 text-left transition hover:-translate-y-0.5"
                    style={{
                      borderColor: active ? '#00f5ff55' : 'rgba(255,255,255,0.07)',
                      background: active ? 'rgba(0,245,255,0.1)' : 'rgba(0,0,0,0.15)',
                    }}
                  >
                    <div className="text-sm font-semibold text-white">{b.name}</div>
                    <div className="mt-0.5 text-xs text-gray-500">{b.category}</div>
                  </button>
                )
              })}

              {businesses.length === 0 && !loading ? (
                <div className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-center text-sm text-gray-500">
                  還沒有商家
                </div>
              ) : null}
            </div>

            {isContentStudioSync ? (
              <Link
                href={CONTENTSTUDIO_BRAND_URL}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-cyan-400/25 py-2.5 text-sm text-cyan-200 transition hover:border-cyan-300/50 hover:text-white"
              >
                <Plus className="h-4 w-4" />
                新增商家
              </Link>
            ) : (
              <button
                type="button"
                onClick={handleNew}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 py-2.5 text-sm text-gray-500 transition hover:border-cyan-500/30 hover:text-cyan-400"
              >
                <Plus className="h-4 w-4" />
                新增商家
              </button>
            )}
          </div>

          {isContentStudioSync ? (
            <div className="glass-card rounded-[24px] p-5" style={{ borderColor: '#9d4edd33' }}>
              <div className="mb-5 flex items-center gap-3">
                <div className="rounded-xl p-2" style={{ background: '#9d4edd18', color: '#9d4edd' }}>
                  <FolderOpen className="h-4 w-4" />
                </div>
                <div className="text-sm font-medium" style={{ color: '#9d4edd' }}>
                  ContentStudio 同步模式
                </div>
              </div>

              <div className="rounded-2xl border border-white/8 bg-black/20 p-4 text-sm text-gray-300">
                <div className="font-medium text-white">這裡目前是唯讀檢視。</div>
                <p className="mt-2 leading-7 text-gray-400">
                  商家資料由 ContentStudio 統一維護，OpenClaw Copilot 會直接讀取最新品牌設定。
                </p>
                <Link
                  href={CONTENTSTUDIO_BRAND_URL}
                  className="mt-4 inline-flex items-center text-sm font-medium text-cyan-300 transition hover:text-white"
                >
                  前往 ContentStudio 管理品牌 →
                </Link>
              </div>

              {/* Business preview */}
              {selectedBusiness ? (
                <div className="mt-6 rounded-2xl border border-white/8 bg-black/20 p-4">
                  <div className="text-xs uppercase tracking-[0.14em] text-gray-500">目前商家摘要</div>
                  <div className="mt-3 grid gap-3 text-xs md:grid-cols-2">
                    {[
                      { label: '主力服務', items: safeArray(selectedBusiness.key_offers), tone: '#39ff14' },
                      { label: '優先目標', items: safeArray(selectedBusiness.priority_goals), tone: '#ffb703' },
                      { label: '常見問題', items: safeArray(selectedBusiness.frequent_questions), tone: '#9d4edd' },
                      { label: '避免題材', items: safeArray(selectedBusiness.avoid_topics), tone: '#ff6b6b' },
                    ].map(({ label, items, tone }) => (
                      <div key={label}>
                        <div className="text-gray-600">{label}</div>
                        {items.length === 0 ? (
                          <div className="mt-1 text-gray-600">—</div>
                        ) : (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {items.map((item) => (
                              <span
                                key={item}
                                className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px]"
                                style={{ borderColor: `${tone}33`, background: `${tone}12`, color: tone }}
                              >
                                {item}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="glass-card rounded-[24px] p-5" style={{ borderColor: '#9d4edd33' }}>
              <div className="mb-5 flex items-center gap-3">
                <div className="rounded-xl p-2" style={{ background: '#9d4edd18', color: '#9d4edd' }}>
                  <FolderOpen className="h-4 w-4" />
                </div>
                <div className="text-sm font-medium" style={{ color: '#9d4edd' }}>
                  {mode === 'new' ? '新增商家' : `編輯：${selectedBusiness?.name || '—'}`}
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <Field label="商家名稱 *">
                  <TextInput value={form.name} onChange={f('name')} placeholder="例如：B.W. Studio" />
                </Field>
                <Field label="商家類型">
                  <TextInput value={form.category} onChange={f('category')} />
                </Field>
                <Field label="品牌語氣">
                  <TextInput value={form.brand_tone} onChange={f('brand_tone')} />
                </Field>
                <Field label="目標受眾">
                  <TextInput value={form.target_audience} onChange={f('target_audience')} />
                </Field>
                <Field label="主力產品 / 服務" hint="用逗號分隔">
                  <TextInput value={form.key_offers} onChange={f('key_offers')} placeholder="短影音企劃, 拍攝製作" />
                </Field>
                <Field label="避免題材" hint="例如：政治、療效保證">
                  <TextInput value={form.avoid_topics} onChange={f('avoid_topics')} />
                </Field>
                <Field label="優先目標" hint="用逗號或換行分隔">
                  <TextAreaInput rows={3} value={form.priority_goals} onChange={f('priority_goals')} />
                </Field>
                <Field label="常見問題" hint="用逗號或換行分隔">
                  <TextAreaInput rows={3} value={form.frequent_questions} onChange={f('frequent_questions')} />
                </Field>
                <div className="md:col-span-2">
                  <Field label="備註">
                    <TextAreaInput rows={3} value={form.notes} onChange={f('notes')} />
                  </Field>
                </div>
              </div>

              <div className="mt-5 space-y-3">
                <input
                  type="password"
                  value={authToken}
                  onChange={(e) => setAuthToken(e.target.value)}
                  placeholder="OFFICE_ADMIN_TOKEN（若已啟用才需填）"
                  className="w-full rounded-xl border border-white/8 bg-black/10 px-3 py-2 text-xs text-gray-400 outline-none placeholder:text-gray-600"
                />
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={busy || !form.name.trim()}
                    className="inline-flex items-center gap-2 rounded-xl border px-5 py-3 text-sm font-semibold transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-40"
                    style={{ borderColor: '#9d4edd55', background: '#9d4edd18', color: '#d8b4fe' }}
                  >
                    {busy ? '儲存中…' : mode === 'new' ? '建立商家' : '儲存設定'}
                  </button>
                  {mode === 'new' ? (
                    <button
                      type="button"
                      onClick={() => { setMode('edit'); setForm(formFromBusiness(selectedBusiness)) }}
                      className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-gray-400 hover:text-white"
                    >
                      取消
                    </button>
                  ) : null}
                </div>
              </div>

              {/* Business preview */}
              {selectedBusiness && mode === 'edit' ? (
                <div className="mt-6 rounded-2xl border border-white/8 bg-black/20 p-4">
                  <div className="text-xs uppercase tracking-[0.14em] text-gray-500">目前商家摘要</div>
                  <div className="mt-3 grid gap-3 text-xs md:grid-cols-2">
                    {[
                      { label: '主力服務', items: safeArray(selectedBusiness.key_offers), tone: '#39ff14' },
                      { label: '優先目標', items: safeArray(selectedBusiness.priority_goals), tone: '#ffb703' },
                      { label: '常見問題', items: safeArray(selectedBusiness.frequent_questions), tone: '#9d4edd' },
                      { label: '避免題材', items: safeArray(selectedBusiness.avoid_topics), tone: '#ff6b6b' },
                    ].map(({ label, items, tone }) => (
                      <div key={label}>
                        <div className="text-gray-600">{label}</div>
                        {items.length === 0 ? (
                          <div className="mt-1 text-gray-600">—</div>
                        ) : (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {items.map((item) => (
                              <span
                                key={item}
                                className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px]"
                                style={{ borderColor: `${tone}33`, background: `${tone}12`, color: tone }}
                              >
                                {item}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
