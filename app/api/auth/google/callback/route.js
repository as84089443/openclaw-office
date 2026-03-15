import { NextResponse } from 'next/server'
import { completeGoogleAuth } from '../../../../../lib/fnb-service.js'

function decodeState(state) {
  return JSON.parse(Buffer.from(state, 'base64url').toString('utf8'))
}

export async function GET(request) {
  const url = new URL(request.url)
  const state = url.searchParams.get('state')
  const code = url.searchParams.get('code')
  const cookieState = request.cookies.get('fnb_oauth_google')?.value

  if (!state || !code || state !== cookieState) {
    return Response.json({
      ok: false,
      error: 'Invalid Google OAuth state',
    }, { status: 400 })
  }

  try {
    const payload = decodeState(state)
    await completeGoogleAuth({
      locationId: payload.locationId,
      code,
      redirectUri: `${url.origin}/api/auth/google/callback`,
      googleLocationName: payload.googleLocationName || null,
    })

    const redirectUrl = new URL(payload.redirectTo || '/ops', url.origin)
    redirectUrl.searchParams.set('google', 'connected')
    const response = NextResponse.redirect(redirectUrl)
    response.cookies.delete('fnb_oauth_google')
    return response
  } catch (error) {
    return Response.json({
      ok: false,
      error: error.message,
    }, { status: 500 })
  }
}
