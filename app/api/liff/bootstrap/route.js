import {
  decodeMerchantSession,
  getDefaultLocationId,
  getMerchantHome,
  getMerchantSessionCookieName,
  getServiceStatus,
} from '../../../../lib/fnb-service.js'

export async function GET(request) {
  try {
    const url = new URL(request.url)
    const locationId = url.searchParams.get('locationId') || null
    const tab = url.searchParams.get('tab') || 'approvals'
    const status = await getServiceStatus()
    const cookieName = getMerchantSessionCookieName()
    const sessionToken = request.cookies.get(cookieName)?.value || null
    const merchantSession = decodeMerchantSession(sessionToken)
      || (process.env.FNB_DEMO_MODE === '1' ? { lineUserId: 'line:merchant-azhu', defaultLocationId: locationId } : null)
    const lineUserId = merchantSession?.lineUserId || null

    if (!lineUserId) {
      const defaultLocationId = await getDefaultLocationId()
      if (!status.lineLoginConfigured && process.env.FNB_DEMO_MODE !== '1') {
        return Response.json({
          ok: false,
          merchantLineConfigured: false,
          error: '商家專用 LINE 入口尚未設定。請改填 LINE_LOGIN_* 與 NEXT_PUBLIC_LINE_LIFF_ID。',
        }, { status: 503 })
      }
      if (!defaultLocationId) {
        return Response.json({
          ok: false,
          needsOnboarding: true,
          onboardingUrl: '/ops',
          error: '尚未建立店家據點，請先完成 onboarding 再綁定 LINE。',
        }, { status: 409 })
      }
      return Response.json({
        ok: false,
        needsBinding: true,
        bindUrl: `/api/auth/line/start?locationId=${encodeURIComponent(defaultLocationId)}&redirectTo=${encodeURIComponent('/merchant')}`,
      }, { status: 401 })
    }

    const home = await getMerchantHome(lineUserId, locationId || merchantSession?.defaultLocationId || null)
    return Response.json({
      ok: true,
      tab,
      liff: {
        liffId: process.env.NEXT_PUBLIC_LINE_LIFF_ID || process.env.NEXT_PUBLIC_FNB_LINE_LIFF_ID || null,
        enabled: Boolean(process.env.NEXT_PUBLIC_LINE_LIFF_ID || process.env.NEXT_PUBLIC_FNB_LINE_LIFF_ID),
      },
      home,
    })
  } catch (error) {
    if (String(error.message || '').includes('does not have access')) {
      return Response.json({
        ok: false,
        error: error.message,
      }, { status: 403 })
    }
    if (String(error.message || '').includes('LINE operator is not bound')) {
      const defaultLocationId = await getDefaultLocationId()
      if (!defaultLocationId) {
        return Response.json({
          ok: false,
          needsOnboarding: true,
          onboardingUrl: '/ops',
          error: '尚未建立店家據點，請先完成 onboarding 再綁定 LINE。',
        }, { status: 409 })
      }
      return Response.json({
        ok: false,
        needsBinding: true,
        bindUrl: `/api/auth/line/start?locationId=${encodeURIComponent(defaultLocationId)}&redirectTo=${encodeURIComponent('/merchant')}`,
      }, { status: 401 })
    }
    return Response.json({
      ok: false,
      error: error.message,
    }, { status: 500 })
  }
}
