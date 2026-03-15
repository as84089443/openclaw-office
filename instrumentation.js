/**
 * Next.js Instrumentation
 * Runs on server startup — connects to OpenClaw Gateway
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    console.log('[instrumentation] Initializing OpenClaw Office server...')

    if (process.env.OPENCLAW_OFFICE_DISABLE_GATEWAY === '1') {
      console.log('[instrumentation] Gateway disabled for this session, skipping WebSocket connection.')
      return
    }
    
    try {
      const { connect } = await import('./lib/openclaw-ws.js')
      
      setTimeout(() => {
        console.log('[instrumentation] Connecting to OpenClaw WebSocket...')
        connect()
      }, 2000)
      
    } catch (err) {
      console.error('[instrumentation] Failed to initialize WebSocket:', err.message)
    }
  }
}
