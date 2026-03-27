'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

const STORAGE_KEY = 'studio_selected_business_id'

function readJsonResponse(response) {
  return response.text().then((text) => {
    if (!text) return {}
    try { return JSON.parse(text) }
    catch { return { error: text.slice(0, 300) || 'Unexpected response' } }
  })
}

function buildHeaders(token) {
  if (!token) return { 'Content-Type': 'application/json' }
  return { 'Content-Type': 'application/json', 'x-office-token': token }
}

export function useStudioBusiness() {
  const [businesses, setBusinesses] = useState([])
  const [selectedBusinessId, setSelectedBusinessId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [authToken, setAuthToken] = useState('')

  const selectedBusiness = useMemo(
    () => businesses.find((b) => b.business_id === selectedBusinessId) || null,
    [businesses, selectedBusinessId]
  )

  const selectBusiness = useCallback((id) => {
    setSelectedBusinessId(id)
    try { localStorage.setItem(STORAGE_KEY, id) } catch {}
  }, [])

  const loadBusinesses = useCallback(async () => {
    const response = await fetch('/api/studio/businesses', { cache: 'no-store' })
    const data = await readJsonResponse(response)
    if (!response.ok || data.error) throw new Error(data.error || '無法載入商家資料')
    const items = Array.isArray(data.items) ? data.items : []
    setBusinesses(items)
    return items
  }, [])

  const syncBusinessesToLocal = useCallback(async (items) => {
    const csItems = items.filter((b) => b.source === 'contentstudio')
    if (csItems.length === 0) return

    for (const b of csItems) {
      fetch('/api/studio/businesses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          _internal_sync: true,
          business_id: b.business_id,
          name: b.name,
          category: b.category || '商家短影音',
          brand_tone: b.brand_tone || '專業可信',
          target_audience: b.target_audience || '一般消費者',
          key_offers: b.key_offers || [],
          priority_goals: b.priority_goals || [],
          frequent_questions: b.frequent_questions || [],
          avoid_topics: b.avoid_topics || [],
          notes: b.notes || '',
        }),
      }).catch(() => {})
    }
  }, [])

  // Initial load
  useEffect(() => {
    let saved = ''
    try { saved = localStorage.getItem(STORAGE_KEY) || '' } catch {}
    setLoading(true)
    loadBusinesses()
      .then((items) => {
        const first = items[0]?.business_id || ''
        const initial = (saved && items.some((b) => b.business_id === saved)) ? saved : first
        setSelectedBusinessId(initial)
        if (saved && initial !== saved) {
          try { localStorage.setItem(STORAGE_KEY, initial) } catch {}
        } else if (initial && !saved) {
          try { localStorage.setItem(STORAGE_KEY, initial) } catch {}
        }
        syncBusinessesToLocal(items)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [loadBusinesses, syncBusinessesToLocal])

  const saveBusiness = useCallback(async (form) => {
    const response = await fetch('/api/studio/businesses', {
      method: 'POST',
      headers: buildHeaders(authToken),
      body: JSON.stringify(form),
    })
    const data = await readJsonResponse(response)
    if (response.status === 401) throw new Error('需要辦公室授權 token 才能寫入商家資料。')
    if (!response.ok || data.error) throw new Error(data.error || '儲存商家失敗')
    const items = await loadBusinesses()
    const id = data.business?.business_id || items[0]?.business_id || ''
    if (id) selectBusiness(id)
    return data
  }, [authToken, loadBusinesses, selectBusiness])

  return {
    businesses,
    selectedBusinessId,
    selectedBusiness,
    loading,
    error,
    setError,
    authToken,
    setAuthToken,
    selectBusiness,
    loadBusinesses,
    saveBusiness,
  }
}

export { readJsonResponse, buildHeaders }
