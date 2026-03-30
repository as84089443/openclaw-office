const DEFAULT_UPSTREAM_URL = process.env.CHATGPT_CODEX_BRIDGE_UPSTREAM || 'http://127.0.0.1:4318/mcp'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function proxyToBridge(request) {
  const headers = new Headers(request.headers)
  headers.delete('host')

  const init = {
    method: request.method,
    headers,
    cache: 'no-store',
    redirect: 'manual',
  }

  if (!['GET', 'HEAD'].includes(request.method)) {
    init.body = request.body
    init.duplex = 'half'
  }

  try {
    const upstream = await fetch(DEFAULT_UPSTREAM_URL, init)
    const responseHeaders = new Headers(upstream.headers)
    responseHeaders.set('Cache-Control', 'no-store')
    responseHeaders.set('X-OpenClaw-MCP-Proxy', 'chatgpt-codex')
    responseHeaders.delete('content-length')

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    })
  } catch (error) {
    return Response.json({
      ok: false,
      error: 'chatgpt_codex_bridge_unavailable',
      detail: error?.message || 'upstream bridge request failed',
      upstream: DEFAULT_UPSTREAM_URL,
    }, { status: 502 })
  }
}

export async function GET(request) {
  return proxyToBridge(request)
}

export async function POST(request) {
  return proxyToBridge(request)
}

export async function PUT(request) {
  return proxyToBridge(request)
}

export async function PATCH(request) {
  return proxyToBridge(request)
}

export async function DELETE(request) {
  return proxyToBridge(request)
}

export async function HEAD(request) {
  return proxyToBridge(request)
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Allow': 'GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS',
      'Cache-Control': 'no-store',
      'X-OpenClaw-MCP-Proxy': 'chatgpt-codex',
    },
  })
}
