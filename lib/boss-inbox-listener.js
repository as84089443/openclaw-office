import { ensureDailyDigest, maybeDeliverDailyDigest, maybeSendImmediateAttention } from './boss-inbox.js'

const REQUEST_TIMERS = globalThis.__openclawBossInboxTimers || new Map()
globalThis.__openclawBossInboxTimers = REQUEST_TIMERS

export function registerBossInboxListeners(eventBus, EVENTS) {
  if (globalThis.__openclawBossInboxRegistered) return
  globalThis.__openclawBossInboxRegistered = true

  const scheduleRequestCheck = (requestId) => {
    if (!requestId) return
    const existing = REQUEST_TIMERS.get(requestId)
    if (existing) clearTimeout(existing)

    const timer = setTimeout(async () => {
      REQUEST_TIMERS.delete(requestId)
      try {
        await maybeSendImmediateAttention(requestId)
        const digest = ensureDailyDigest()
        await maybeDeliverDailyDigest(digest)
      } catch (error) {
        console.error('[boss-inbox] listener failed:', error.message)
      }
    }, 500)

    REQUEST_TIMERS.set(requestId, timer)
  }

  eventBus.on(EVENTS.REQUEST_UPDATE, (request) => {
    scheduleRequestCheck(request?.id)
  })
}
