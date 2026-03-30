import { NextResponse } from 'next/server'

const DIALOGUEFLOW_ORIGIN =
  process.env.DIALOGUEFLOW_PUBLIC_URL || 'https://dialogueflow.bw-space.com'

const COPILOT_ORIGIN = process.env.NEXT_PUBLIC_SITE_URL || 'https://copilot.bw-space.com'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': COPILOT_ORIGIN,
  'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS',
  'Access-Control-Allow-Headers': 'RSC,Next-Router-State-Tree,Next-Router-Prefetch,Next-Url,Content-Type',
  'Access-Control-Max-Age': '86400',
}

function createRedirectResponse(request, params) {
  const incoming = new URL(request.url)
  const target = new URL(DIALOGUEFLOW_ORIGIN)
  const path = params?.path?.length ? `/${params.path.join('/')}` : '/'

  target.pathname = path
  target.search = incoming.search

  return NextResponse.redirect(target, 307)
}

// Preflight — 直接在 copilot 側回應，避免跨域 redirect 被瀏覽器攔截
export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

export function GET(request, { params }) {
  return createRedirectResponse(request, params)
}

export function HEAD(request, { params }) {
  return createRedirectResponse(request, params)
}

