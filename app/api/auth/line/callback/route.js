import { NextResponse } from 'next/server'
import {
  completeLineAuth,
  decodeLineAuthState,
  getPublicBaseUrl,
  getLineOAuthCookieName,
  isAllowedLineAuthCallbackUri,
  getMerchantSessionCookieName,
  issueMerchantSession,
} from '../../../../../lib/fnb-service.js'

function buildOnboardingRedirect(statePayload, requestOrigin) {
  const redirectUrl = new URL(statePayload?.redirectTo || '/merchant', getPublicBaseUrl(requestOrigin))
  redirectUrl.searchParams.set('line', 'needs-onboarding')
  redirectUrl.searchParams.set('reason', 'missing-location')
  return redirectUrl
}

export async function GET(request) {
  const url = new URL(request.url)
  const state = url.searchParams.get('state')
  const code = url.searchParams.get('code')
  const stateCookieName = getLineOAuthCookieName()
  const sessionCookieName = getMerchantSessionCookieName()
  const cookieStateNonce = request.cookies.get(stateCookieName)?.value
  const statePayload = decodeLineAuthState(state)

  if (!code || !statePayload || !cookieStateNonce || statePayload.stateNonce !== cookieStateNonce) {
    return Response.json({
      ok: false,
      error: 'Invalid LINE OAuth state',
    }, { status: 400 })
  }
  if (!isAllowedLineAuthCallbackUri(statePayload.redirectUri, url.origin)) {
    return Response.json({
      ok: false,
      error: 'LINE OAuth callback redirect URI mismatch',
    }, { status: 400 })
  }
  if (!statePayload.locationId) {
    const response = NextResponse.redirect(buildOnboardingRedirect(statePayload, url.origin))
    response.cookies.delete(stateCookieName)
    return response
  }

  try {
    const auth = await completeLineAuth({
      locationId: statePayload.locationId,
      code,
      redirectUri: statePayload.redirectUri,
      expectedNonce: statePayload.nonce,
    })

    const redirectUrl = new URL(statePayload.redirectTo || '/merchant', getPublicBaseUrl(url.origin))
    redirectUrl.searchParams.set('line', 'connected')
    const response = NextResponse.redirect(redirectUrl)
    response.cookies.delete(stateCookieName)
    response.cookies.set(sessionCookieName, issueMerchantSession({
      lineUserId: auth.profile.userId,
      operatorId: auth.operatorId,
      defaultLocationId: auth.locationId,
    }), {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 24 * 30,
    })
    return response
  } catch (error) {
    if (String(error.message || '').includes('No merchant location is available')) {
      const response = NextResponse.redirect(buildOnboardingRedirect(statePayload, url.origin))
      response.cookies.delete(stateCookieName)
      return response
    }
    return Response.json({
      ok: false,
      error: error.message,
    }, { status: 500 })
  }
}
