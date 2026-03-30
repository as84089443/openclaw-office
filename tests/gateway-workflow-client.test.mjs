import test from 'node:test'
import assert from 'node:assert/strict'

const originalOfficeBaseUrl = process.env.OPENCLAW_OFFICE_INTERNAL_BASE_URL
const originalOfficeToken = process.env.OPENCLAW_OFFICE_TOKEN
const originalOfficeAdminToken = process.env.OFFICE_ADMIN_TOKEN
const originalXOfficeToken = process.env.X_OFFICE_TOKEN
const originalDispatchDelay = process.env.OPENCLAW_AUTONOMOUS_HANDOFF_DISPATCH_DELAY_MS

const {
  startGatewayAutonomousWorkflow,
  kickPendingGatewayWorkflowRequest,
  completeGatewayDelegatedTask,
} = await import('../lib/gateway-workflow-client.js')

test.afterEach(() => {
  if (originalOfficeBaseUrl === undefined) delete process.env.OPENCLAW_OFFICE_INTERNAL_BASE_URL
  else process.env.OPENCLAW_OFFICE_INTERNAL_BASE_URL = originalOfficeBaseUrl

  if (originalOfficeToken === undefined) delete process.env.OPENCLAW_OFFICE_TOKEN
  else process.env.OPENCLAW_OFFICE_TOKEN = originalOfficeToken

  if (originalOfficeAdminToken === undefined) delete process.env.OFFICE_ADMIN_TOKEN
  else process.env.OFFICE_ADMIN_TOKEN = originalOfficeAdminToken

  if (originalXOfficeToken === undefined) delete process.env.X_OFFICE_TOKEN
  else process.env.X_OFFICE_TOKEN = originalXOfficeToken

  if (originalDispatchDelay === undefined) delete process.env.OPENCLAW_AUTONOMOUS_HANDOFF_DISPATCH_DELAY_MS
  else process.env.OPENCLAW_AUTONOMOUS_HANDOFF_DISPATCH_DELAY_MS = originalDispatchDelay
})

test('startGatewayAutonomousWorkflow posts start_flow to internal Office API', async () => {
  process.env.OPENCLAW_OFFICE_INTERNAL_BASE_URL = 'http://127.0.0.1:4201/'
  process.env.OPENCLAW_OFFICE_TOKEN = 'office-token'
  process.env.OPENCLAW_AUTONOMOUS_HANDOFF_DISPATCH_DELAY_MS = '4321'

  const calls = []
  const result = await startGatewayAutonomousWorkflow({
    content: '讓研究魚升級成 control-plane agent',
    from: 'Brian',
    agent: 'research-fish',
    messageId: '1487863341815955688',
    routingReason: '研究快捷指令優先派給研究魚。',
    researchLoop: 'reactive',
    operatorMode: 'strict',
    autonomyPolicy: 'no_prompt_until_human_gate',
    outputContract: 'research_operator_v1',
  }, {
    fetchImpl: async (url, init) => {
      calls.push({ url, init })
      return {
        ok: true,
        async json() {
          return { requestId: 'req_123', taskId: 'task_123', agent: 'research-fish' }
        },
      }
    },
  })

  assert.deepEqual(result, { requestId: 'req_123', taskId: 'task_123', agent: 'research-fish' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'http://127.0.0.1:4201/api/workflow')
  assert.equal(calls[0].init.method, 'POST')
  assert.equal(calls[0].init.headers['content-type'], 'application/json')
  assert.equal(calls[0].init.headers['x-office-token'], 'office-token')

  const payload = JSON.parse(calls[0].init.body)
  assert.equal(payload.action, 'start_flow')
  assert.equal(payload.content, '讓研究魚升級成 control-plane agent')
  assert.equal(payload.messageId, '1487863341815955688')
  assert.equal(payload.deferDispatchUntilIdleMs, 4321)
  assert.equal(payload.operatorMode, 'strict')
  assert.equal(payload.autonomyPolicy, 'no_prompt_until_human_gate')
  assert.equal(payload.outputContract, 'research_operator_v1')
})

test('kickPendingGatewayWorkflowRequest posts kick_pending_action to internal Office API', async () => {
  process.env.OFFICE_ADMIN_TOKEN = 'admin-token'

  const calls = []
  const result = await kickPendingGatewayWorkflowRequest('req_456', {
    officeBaseUrl: 'http://127.0.0.1:9999',
    fetchImpl: async (url, init) => {
      calls.push({ url, init })
      return {
        ok: true,
        async json() {
          return { ok: true }
        },
      }
    },
  })

  assert.deepEqual(result, { ok: true })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'http://127.0.0.1:9999/api/workflow')
  assert.equal(calls[0].init.headers['x-office-token'], 'admin-token')
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    action: 'kick_pending_action',
    requestId: 'req_456',
  })
})

test('completeGatewayDelegatedTask posts delegate_complete to internal Office API', async () => {
  process.env.OPENCLAW_OFFICE_TOKEN = 'office-token'

  const calls = []
  const result = await completeGatewayDelegatedTask('task_789', {
    result: 'Agent session completed',
    success: true,
    summary: 'research-fish session completed normally',
  }, {
    officeBaseUrl: 'http://127.0.0.1:9999',
    fetchImpl: async (url, init) => {
      calls.push({ url, init })
      return {
        ok: true,
        async json() {
          return { success: true, taskId: 'task_789' }
        },
      }
    },
  })

  assert.deepEqual(result, { success: true, taskId: 'task_789' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'http://127.0.0.1:9999/api/workflow')
  assert.equal(calls[0].init.headers['x-office-token'], 'office-token')

  const payload = JSON.parse(calls[0].init.body)
  assert.equal(payload.action, 'delegate_complete')
  assert.equal(payload.taskId, 'task_789')
  assert.equal(payload.success, true)
  assert.equal(payload.result, 'Agent session completed')
  assert.equal(payload.summary, 'research-fish session completed normally')
})

test('completeGatewayDelegatedTask returns null for missing taskId', async () => {
  const result = await completeGatewayDelegatedTask(null)
  assert.equal(result, null)
})
