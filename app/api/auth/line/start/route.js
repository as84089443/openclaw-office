import { NextResponse } from 'next/server'
import {
  createLineAuthUrl,
  getDefaultLocationId,
  getLineOAuthCookieName,
} from '../../../../../lib/fnb-service.js'

function resolveInput(request, body = null) {
  const url = new URL(request.url)
  return {
    locationId: body?.locationId || url.searchParams.get('locationId'),
    redirectTo: body?.redirectTo || url.searchParams.get('redirectTo') || '/merchant',
    origin: url.origin,
  }
}

export async function GET(request) {
  try {
    const input = resolveInput(request)
    const auth = await createLineAuthUrl({
      ...input,
      locationId: input.locationId || await getDefaultLocationId(),
    })
    const response = NextResponse.redirect(auth.url)
    response.cookies.set(getLineOAuthCookieName(), auth.stateNonce, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 600,
    })
    return response
  } catch (error) {
    return Response.json({
      ok: false,
      error: error.message,
    }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    const body = await request.json()
    const input = resolveInput(request, body)
    const auth = await createLineAuthUrl({
      ...input,
      locationId: input.locationId || await getDefaultLocationId(),
    })
    return Response.json({
      ok: true,
      ...auth,
    })
  } catch (error) {
    return Response.json({
      ok: false,
      error: error.message,
    }, { status: 500 })
  }
}
