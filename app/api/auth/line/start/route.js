import { NextResponse } from 'next/server'
import {
  createLineAuthUrl,
  getDefaultLocationId,
  getLineOAuthCookieName,
  getPublicBaseUrl,
} from '../../../../../lib/fnb-service.js'

function resolveInput(request, body = null) {
  const url = new URL(request.url)
  return {
    locationId: body?.locationId || url.searchParams.get('locationId'),
    redirectTo: body?.redirectTo || url.searchParams.get('redirectTo') || '/merchant',
    origin: url.origin,
  }
}

function normalizeRedirectTo(value) {
  const candidate = String(value || '').trim()
  if (!candidate.startsWith('/') || candidate.startsWith('//')) return '/merchant'
  return candidate
}

function buildOnboardingUrl(origin, redirectTo) {
  const url = new URL(normalizeRedirectTo(redirectTo), getPublicBaseUrl(origin))
  url.searchParams.set('line', 'needs-onboarding')
  url.searchParams.set('reason', 'missing-location')
  return url
}

export async function GET(request) {
  try {
    const input = resolveInput(request)
    const resolvedLocationId = input.locationId || await getDefaultLocationId()
    if (!resolvedLocationId) {
      return NextResponse.redirect(buildOnboardingUrl(input.origin, input.redirectTo))
    }
    const auth = await createLineAuthUrl({
      ...input,
      locationId: resolvedLocationId,
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
    const resolvedLocationId = input.locationId || await getDefaultLocationId()
    if (!resolvedLocationId) {
      return Response.json({
        ok: false,
        needsOnboarding: true,
        reason: 'missing-location',
        onboardingUrl: '/ops',
        error: 'No merchant location is available. Complete onboarding first.',
      }, { status: 409 })
    }
    const auth = await createLineAuthUrl({
      ...input,
      locationId: resolvedLocationId,
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
