import { NextResponse } from 'next/server'
import {
  createOfficeSessionCookieValue,
  getOfficeAuthState,
  getOfficeSessionCookieName,
  isOfficeAuthConfigured,
  validateOfficeToken,
} from '../../../../lib/office-route-auth.js'

function buildCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 12,
  }
}

function getSubmittedToken(request, body = {}) {
  return (
    body?.token
    || request.headers.get('x-office-token')
    || request.headers.get('x-office')
    || request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    || ''
  )
}

export async function GET(request) {
  return NextResponse.json(getOfficeAuthState(request))
}

export async function POST(request) {
  if (!isOfficeAuthConfigured()) {
    return NextResponse.json({
      success: true,
      configured: false,
      authenticated: true,
      authSource: 'disabled',
    })
  }

  const body = await request.json().catch(() => ({}))
  const token = getSubmittedToken(request, body)

  if (!token) {
    return NextResponse.json({ error: 'token is required' }, { status: 400 })
  }

  if (!validateOfficeToken(token)) {
    return NextResponse.json({ error: 'Invalid office token' }, { status: 401 })
  }

  const response = NextResponse.json({
    success: true,
    configured: true,
    authenticated: true,
    authSource: 'cookie',
  })
  response.cookies.set(
    getOfficeSessionCookieName(),
    createOfficeSessionCookieValue(token),
    buildCookieOptions(),
  )
  return response
}

export async function DELETE() {
  const response = NextResponse.json({
    success: true,
    configured: isOfficeAuthConfigured(),
    authenticated: false,
    authSource: null,
  })
  response.cookies.set(getOfficeSessionCookieName(), '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  })
  return response
}
