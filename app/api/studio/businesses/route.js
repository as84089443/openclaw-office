import { StudioFactoryError, runStudioAction } from '../../../../lib/studio-factory.js'
import { assertOfficeApiRequest, getOfficeRequestErrorStatus } from '../../../../lib/office-route-auth.js'

export const dynamic = 'force-dynamic'

const CONTENTSTUDIO_URL = process.env.CONTENTSTUDIO_API_URL || ''
const CONTENTSTUDIO_SECRET = process.env.CONTENTSTUDIO_API_SECRET || ''

let brandCache = null
const CACHE_TTL_MS = 60_000

function withSource(item, source) {
  if (!item || typeof item !== 'object') return item
  return { ...item, source }
}

function withPayloadSource(payload, source) {
  if (!payload || typeof payload !== 'object') return payload
  return {
    ...payload,
    source: payload.source || source,
    items: Array.isArray(payload.items) ? payload.items.map((item) => withSource(item, source)) : payload.items,
    business: payload.business ? withSource(payload.business, source) : payload.business,
    item: payload.item ? withSource(payload.item, source) : payload.item,
  }
}

async function fetchFromContentStudio() {
  if (!CONTENTSTUDIO_URL || !CONTENTSTUDIO_SECRET) return null

  const now = Date.now()
  if (brandCache && now - brandCache.fetchedAt < CACHE_TTL_MS) {
    return brandCache.data
  }

  try {
    const res = await fetch(`${CONTENTSTUDIO_URL}/api/internal/copilot/brands`, {
      headers: { 'x-copilot-secret': CONTENTSTUDIO_SECRET },
      cache: 'no-store',
    })
    if (!res.ok) return null

    const json = await res.json()
    const items = Array.isArray(json.items) ? json.items.map((item) => withSource(item, 'contentstudio')) : []
    brandCache = { data: items, fetchedAt: now }
    return items
  } catch {
    return null
  }
}

export async function GET(request) {
  try {
    const url = new URL(request.url)
    const businessId = (url.searchParams.get('id') || '').trim()

    const csItems = await fetchFromContentStudio()
    if (csItems) {
      if (businessId) {
        const item = csItems.find((business) => business.business_id === businessId)
        if (!item) {
          return Response.json({ status: 'error', error: 'business_not_found' }, { status: 404 })
        }
        return Response.json({ status: 'ok', item, source: 'contentstudio' })
      }
      return Response.json({ status: 'ok', count: csItems.length, items: csItems, source: 'contentstudio' })
    }

    if (businessId) {
      return Response.json(withPayloadSource(
        await runStudioAction('studio_get_business', { business_id: businessId }),
        'local'
      ))
    }
    return Response.json(withPayloadSource(await runStudioAction('studio_list_businesses'), 'local'))
  } catch (error) {
    if (error instanceof StudioFactoryError && error.payload) {
      return Response.json(error.payload, { status: error.statusCode || 500 })
    }
    return Response.json({ error: error.message || 'Studio businesses unavailable' }, { status: 500 })
  }
}

export async function POST(request) {
  let body
  try { body = await request.json() } catch { body = {} }

  if (body._internal_sync) {
    try {
      const { _internal_sync, ...payload } = body
      return Response.json(await runStudioAction('studio_upsert_business', payload))
    } catch (error) {
      if (error instanceof StudioFactoryError && error.payload) {
        return Response.json(error.payload, { status: error.statusCode || 500 })
      }
      return Response.json({ error: error.message || 'Sync failed' }, { status: 500 })
    }
  }

  if (CONTENTSTUDIO_URL) {
    return Response.json(
      { error: '請到 ContentStudio 管理商家', redirect: `${CONTENTSTUDIO_URL}/brand` },
      { status: 422 }
    )
  }

  try {
    assertOfficeApiRequest(request)
  } catch (error) {
    return Response.json(
      { error: error.message || 'Unauthorized office request' },
      { status: getOfficeRequestErrorStatus(error, 401) }
    )
  }

  try {
    return Response.json(await runStudioAction('studio_upsert_business', body))
  } catch (error) {
    if (error instanceof StudioFactoryError && error.payload) {
      return Response.json(error.payload, { status: error.statusCode || 500 })
    }
    return Response.json({ error: error.message || 'Studio business save failed' }, { status: 500 })
  }
}
