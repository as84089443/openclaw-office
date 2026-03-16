// Health check endpoint
import { getConfig, validateConfig } from '../../../lib/config.js'
import { getStatus } from '../../../lib/openclaw-ws.js'
import { getServiceStatus } from '../../../lib/fnb-service.js'

export async function GET() {
  const config = getConfig()
  const validation = validateConfig(config)
  const wsStatus = getStatus()
  const fnb = await getServiceStatus()
  const mode = process.env.FNB_APP_ENV
    || (process.env.DATABASE_URL ? (process.env.NODE_ENV === 'production' ? 'production' : 'staging') : 'demo')

  return Response.json({
    status: 'healthy',
    service: 'OpenClaw Office',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    deployment: {
      mode,
      gatewayDisabled: process.env.OPENCLAW_OFFICE_DISABLE_GATEWAY === '1',
      databaseUrlConfigured: Boolean(process.env.DATABASE_URL),
      publicBaseUrl: process.env.FNB_PUBLIC_BASE_URL || null,
      internalApiTokenConfigured: Boolean(process.env.FNB_INTERNAL_API_TOKEN),
      lineLoginChannelConfigured: Boolean(process.env.LINE_LOGIN_CHANNEL_ID || process.env.FNB_LINE_LOGIN_CHANNEL_ID),
      lineLoginSecretConfigured: Boolean(process.env.LINE_LOGIN_CHANNEL_SECRET || process.env.FNB_LINE_LOGIN_CHANNEL_SECRET),
      lineMessagingConfigured: Boolean(process.env.LINE_CHANNEL_ACCESS_TOKEN || process.env.FNB_LINE_CHANNEL_ACCESS_TOKEN),
      liffIdConfigured: Boolean(process.env.NEXT_PUBLIC_LINE_LIFF_ID || process.env.NEXT_PUBLIC_FNB_LINE_LIFF_ID),
      merchantCopilotWorkerIntervalSeconds: Number(process.env.FNB_MERCHANT_COPILOT_WORKER_INTERVAL_SECONDS || 0) || null,
    },
    gateway: {
      connected: wsStatus.connected,
      url: config.gateway?.url || 'not configured',
    },
    agents: {
      count: Object.keys(config.agents || {}).length,
      ids: Object.keys(config.agents || {}),
    },
    config: {
      valid: validation.valid,
      errors: validation.errors,
    },
    fnb,
    readiness: {
      demoMode: fnb.demoMode,
      environment: fnb.environment,
      provider: fnb.provider,
      line: {
        messaging: fnb.lineConfigured,
        login: fnb.lineLoginConfigured,
        liff: fnb.liffConfigured,
        richMenuImage: fnb.richMenuImageConfigured,
      },
      google: {
        oauth: fnb.googleConfigured,
      },
      merchantCopilot: {
        internalRoutesProtected: Boolean(process.env.FNB_INTERNAL_API_TOKEN),
      },
    },
  })
}
