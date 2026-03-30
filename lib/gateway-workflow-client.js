function getInternalOfficeToken() {
  return (
    process.env.OFFICE_ADMIN_TOKEN
    || process.env.OPENCLAW_OFFICE_TOKEN
    || process.env.X_OFFICE_TOKEN
    || ''
  )
}

function getGatewayAutonomousDispatchDelayMs() {
  const raw = Number(process.env.OPENCLAW_AUTONOMOUS_HANDOFF_DISPATCH_DELAY_MS || 15000)
  if (!Number.isFinite(raw) || raw <= 0) return 15000
  return Math.max(1000, Math.round(raw))
}

function getGatewayWorkflowBaseUrl() {
  return String(process.env.OPENCLAW_OFFICE_INTERNAL_BASE_URL || 'http://127.0.0.1:4201')
    .trim()
    .replace(/\/+$/, '')
}

function buildWorkflowHeaders() {
  const headers = {
    'content-type': 'application/json',
  }
  const officeToken = getInternalOfficeToken()
  if (officeToken) {
    headers['x-office-token'] = officeToken
  }
  return headers
}

async function callWorkflowApi(
  body,
  {
    officeBaseUrl = getGatewayWorkflowBaseUrl(),
    fetchImpl = globalThis.fetch,
  } = {},
) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('global fetch is unavailable for gateway workflow client')
  }

  const response = await fetchImpl(`${officeBaseUrl}/api/workflow`, {
    method: 'POST',
    headers: buildWorkflowHeaders(),
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const payload = await response.text().catch(() => '')
    throw new Error(`workflow ${body.action} failed (${response.status}): ${payload}`)
  }

  return response.json()
}

export async function startGatewayAutonomousWorkflow({
  content,
  from,
  agent,
  messageId,
  routingReason,
  source = 'discord_gateway_autonomous',
  ...workflowSeed
}, options = {}) {
  return callWorkflowApi({
    action: 'start_flow',
    content,
    from,
    agent,
    ...(messageId ? { messageId } : {}),
    autonomousHandoff: true,
    deferDispatchUntilIdleMs: getGatewayAutonomousDispatchDelayMs(),
    routingReason,
    source,
    ...workflowSeed,
  }, options)
}

export async function kickPendingGatewayWorkflowRequest(requestId, options = {}) {
  if (!requestId) return null

  return callWorkflowApi({
    action: 'kick_pending_action',
    requestId,
  }, options)
}

export async function completeGatewayDelegatedTask(taskId, { result, success = true, summary } = {}, options = {}) {
  if (!taskId) return null

  return callWorkflowApi({
    action: 'delegate_complete',
    taskId,
    success,
    ...(result ? { result } : {}),
    ...(summary ? { summary } : {}),
  }, options)
}
