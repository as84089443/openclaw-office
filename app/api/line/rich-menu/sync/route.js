import { readFile } from 'fs/promises'
import { isAbsolute, join } from 'path'
import { getLineMessagingAdapter } from '../../../../../lib/fnb/channels.js'

function assertAuthorized(request) {
  if (process.env.FNB_DEMO_MODE === '1') return
  const token = process.env.FNB_INTERNAL_API_TOKEN
  if (!token) throw new Error('FNB_INTERNAL_API_TOKEN is required for rich menu sync outside demo mode')
  const received = request.headers.get('x-fnb-admin-token')
  if (received !== token) throw new Error('Unauthorized rich menu sync request')
}

function buildTargetUrl(tab) {
  const liffId = process.env.NEXT_PUBLIC_LINE_LIFF_ID || process.env.NEXT_PUBLIC_FNB_LINE_LIFF_ID
  if (liffId) {
    return `https://liff.line.me/${liffId}?tab=${encodeURIComponent(tab)}`
  }
  if (process.env.FNB_DEMO_MODE === '1') {
    const baseUrl = process.env.FNB_PUBLIC_BASE_URL || 'http://localhost:4200'
    return `${baseUrl}/merchant?tab=${encodeURIComponent(tab)}`
  }
  throw new Error('NEXT_PUBLIC_LINE_LIFF_ID is required for rich menu sync outside demo mode')
}

export async function POST(request) {
  try {
    assertAuthorized(request)
    const adapter = getLineMessagingAdapter()
    const manifestPath = join(process.cwd(), 'lib', 'fnb', 'merchant-rich-menu.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    const imageBase64Path = process.env.FNB_LINE_RICH_MENU_IMAGE_BASE64_PATH || null
    let imageBase64 = process.env.LINE_RICH_MENU_IMAGE_BASE64 || process.env.FNB_LINE_RICH_MENU_IMAGE_BASE64 || null

    if (!imageBase64 && imageBase64Path) {
      const resolvedImagePath = isAbsolute(imageBase64Path)
        ? imageBase64Path
        : join(process.cwd(), imageBase64Path)
      imageBase64 = (await readFile(resolvedImagePath, 'utf8')).trim()
    }

    const result = await adapter.syncRichMenu({
      name: manifest.name,
      chatBarText: manifest.chatBarText,
      size: manifest.size,
      areas: manifest.areas.map((area) => ({
        bounds: area.bounds,
        action: {
          type: 'uri',
          uri: buildTargetUrl(area.tab),
        },
      })),
      imageBase64,
    })

    return Response.json({
      ok: result.ok,
      result,
      manifest: {
        ...manifest,
        areas: manifest.areas.map((area) => ({
          ...area,
          target: buildTargetUrl(area.tab),
        })),
      },
      assetSource: process.env.LINE_RICH_MENU_IMAGE_BASE64
        ? 'env.LINE_RICH_MENU_IMAGE_BASE64'
        : process.env.FNB_LINE_RICH_MENU_IMAGE_BASE64
          ? 'env.FNB_LINE_RICH_MENU_IMAGE_BASE64'
        : imageBase64Path
          ? `file:${imageBase64Path}`
          : 'missing',
    }, { status: result.ok ? 200 : 400 })
  } catch (error) {
    return Response.json({
      ok: false,
      error: error.message,
    }, { status: 500 })
  }
}
