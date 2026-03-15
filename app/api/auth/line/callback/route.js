import { NextResponse } from 'next/server'
import {
  completeLineAuth,
  decodeLineAuthState,
  getLineOAuthCookieName,
  getMerchantSessionCookieName,
  issueMerchantSession,
} from '../../../../../lib/fnb-service.js'

export async function GET(request) {
  const url = new URL(request.url)
  const state = url.searchParams.get('state')
  const code = url.searchParams.get('code')
  const stateCookieName = getLineOAuthCookieName()
  const sessionCookieName = getMerchantSessionCookieName()
  const cookieStateNonce = request.cookies.get(stateCookieName)?.value
  const statePayload = decodeLineAuthState(state)
  const expectedRedirectUri = `${url.origin}/api/auth/line/callback`

  if (!code || !statePayload || !cookieStateNonce || statePayload.stateNonce !== cookieStateNonce) {
    return Response.json({
      ok: false,
      error: 'Invalid LINE OAuth state',
    }, { status: 400 })
  }
  if (statePayload.redirectUri !== expectedRedirectUri) {
    return Response.json({
      ok: false,
      error: 'LINE OAuth callback redirect URI mismatch',
    }, { status: 400 })
  }

  try {
    const auth = await completeLineAuth({
      locationId: statePayload.locationId,
      code,
      redirectUri: statePayload.redirectUri,
      expectedNonce: statePayload.nonce,
    })

    const redirectUrl = new URL(statePayload.redirectTo || '/merchant', url.origin)
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
    return Response.json({
      ok: false,
      error: error.message,
    }, { status: 500 })
  }
}
