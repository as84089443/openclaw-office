// Health check endpoint

export async function GET() {
  try {
    return Response.json({
      status: 'healthy',
      service: 'OpenClaw Office',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      check: 'ok',
    })
  } catch (error) {
    console.error('[health] failed:', error)
    return Response.json({
      status: 'error',
      service: 'OpenClaw Office',
      timestamp: new Date().toISOString(),
      error: {
        message: error?.message || 'health endpoint failed',
      },
    }, { status: 500 })
  }
}
