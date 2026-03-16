import { NextResponse } from 'next/server'
import {
  createOpsSessionCookieValue,
  getOpsSessionCookieName,
  getRequestErrorStatus,
  validateOpsToken,
} from '../../../../../lib/fnb/route-auth.js'

function buildCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 12,
  }
}

export async function GET(request) {
  try {
    const cookieValue = request.cookies.get(getOpsSessionCookieName())?.value || ''
    const expected = createOpsSessionCookieValue(process.env.FNB_INTERNAL_API_TOKEN || '')
    return Response.json({
      ok: true,
      authenticated: Boolean(cookieValue && expected && cookieValue === expected),
    })
  } catch (error) {
    return Response.json({
      ok: false,
      error: String(error.message || error),
    }, { status: getRequestErrorStatus(error) })
  }
}

export async function POST(request) {
  try {
    let body = {}
    try {
      body = await request.json()
    } catch {}

    const token = body.token || request.headers.get('x-fnb-admin-token') || request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || ''
    if (!validateOpsToken(token)) {
      return Response.json({ ok: false, error: 'Invalid admin token' }, { status: 401 })
    }

    const response = NextResponse.json({ ok: true, authenticated: true })
    response.cookies.set(getOpsSessionCookieName(), createOpsSessionCookieValue(token), buildCookieOptions())
    return response
  } catch (error) {
    return Response.json({
      ok: false,
      error: String(error.message || error),
    }, { status: getRequestErrorStatus(error) })
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true, authenticated: false })
  response.cookies.set(getOpsSessionCookieName(), '', {
    ...buildCookieOptions(),
    maxAge: 0,
  })
  return response
}
