'use client'

import { useEffect } from 'react'

const RECOVERY_KEY = 'openclaw-chunk-recovery-at'
const RECOVERY_COOLDOWN_MS = 15_000

function normalizeErrorText(source) {
  if (!source) return ''
  if (typeof source === 'string') return source
  if (source instanceof Error) return `${source.name}: ${source.message}\n${source.stack || ''}`
  try {
    return JSON.stringify(source)
  } catch {
    return String(source)
  }
}

function isChunkLoadFailure(source) {
  const text = normalizeErrorText(source)
  return /ChunkLoadError/i.test(text)
    || /Loading chunk [0-9]+ failed/i.test(text)
    || /Failed to fetch dynamically imported module/i.test(text)
    || /_next\/static\/chunks\/app\/.+page-.+\.js/i.test(text)
}

function canRecoverNow() {
  if (typeof window === 'undefined') return false
  try {
    const lastAttempt = Number(window.sessionStorage.getItem(RECOVERY_KEY) || '0')
    return !lastAttempt || Date.now() - lastAttempt > RECOVERY_COOLDOWN_MS
  } catch {
    return true
  }
}

function markRecoveryAttempt() {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(RECOVERY_KEY, String(Date.now()))
  } catch {}
}

function recoverChunkLoad() {
  if (typeof window === 'undefined' || !canRecoverNow()) return
  markRecoveryAttempt()
  const url = new URL(window.location.href)
  url.searchParams.set('_r', String(Date.now()))
  window.location.replace(url.toString())
}

export default function ChunkRecoveryBridge() {
  useEffect(() => {
    const handleError = (event) => {
      if (!isChunkLoadFailure(event?.error || event?.message)) return
      recoverChunkLoad()
    }

    const handleRejection = (event) => {
      if (!isChunkLoadFailure(event?.reason)) return
      event.preventDefault?.()
      recoverChunkLoad()
    }

    window.addEventListener('error', handleError)
    window.addEventListener('unhandledrejection', handleRejection)

    return () => {
      window.removeEventListener('error', handleError)
      window.removeEventListener('unhandledrejection', handleRejection)
    }
  }, [])

  return null
}
