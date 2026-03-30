import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tempRoot = mkdtempSync(join(tmpdir(), 'openclaw-discord-operator-ingress-'))
const officeDataDir = join(tempRoot, 'office-data')
mkdirSync(officeDataDir, { recursive: true })

writeFileSync(join(tempRoot, 'openclaw.json'), JSON.stringify({
  agents: {
    defaults: {
      model: {
        primary: 'openai-codex/gpt-5.4',
      },
    },
    list: [
      { id: 'main', identity: { name: 'WickedMan', emoji: '🦑' } },
      { id: 'research-fish', identity: { name: '研究魚', emoji: '🔬' } },
    ],
  },
  bindings: [
    {
      agentId: 'research-fish',
      match: { channel: 'discord', peer: { kind: 'channel', id: '1487803123790643341' } },
    },
  ],
}, null, 2))

process.env.OPENCLAW_HOME = tempRoot
process.env.OPENCLAW_CONFIG_PATH = join(tempRoot, 'openclaw.json')
process.env.OPENCLAW_OFFICE_DB_PATH = join(officeDataDir, 'office.db')
process.env.OPENCLAW_OFFICE_CONFIG_JSON = JSON.stringify({
  channelPolicies: {
    discord: {
      guilds: {
        '974685838157971466': {
          channels: {
            '1487803123790643341': {
              mode: 'autonomous_operator',
              chatEscapePrefix: '先聊:',
              defaultDelivery: 'workflow_only',
            },
          },
        },
      },
    },
  },
})

const { reloadConfig } = await import('../lib/config.js')
const { maybeHandleDiscordOperatorIngress } = await import('../lib/gateway-discord-operator-ingress.js')

test.beforeEach(() => {
  reloadConfig()
})

test('strict operator channel hands plain text to workflow and sends ack', async () => {
  const startCalls = []
  const ackCalls = []

  const result = await maybeHandleDiscordOperatorIngress({
    text: '讓研究魚升級成 control-plane agent',
    guildId: '974685838157971466',
    channelId: '1487803123790643341',
    messageId: '1489000000000000001',
    senderName: 'Brian',
    token: 'discord-token',
  }, {
    maybeAdoptDiscordAutonomousHandoff: async ({ startWorkflow }) => {
      startCalls.push(await startWorkflow({
        content: '讓研究魚升級成 control-plane agent',
        from: 'Brian',
        agent: 'research-fish',
        routingReason: '研究快捷指令優先派給 研究魚。',
        researchLoop: 'reactive',
      }))
      return {
        requestId: 'req_operator_ingress',
        taskId: 'task_operator_ingress',
        ackText: '已交辦\n- 接手：🔬 研究魚',
      }
    },
    startGatewayAutonomousWorkflow: async (payload) => payload,
    sendDiscordOperatorAck: async (payload) => {
      ackCalls.push(payload)
      return true
    },
  })

  assert.equal(result.mode, 'workflow_handoff')
  assert.equal(result.requestId, 'req_operator_ingress')
  assert.equal(startCalls.length, 1)
  assert.equal(startCalls[0].agent, 'research-fish')
  assert.equal(startCalls[0].messageId, '1489000000000000001')
  assert.equal(startCalls[0].source, 'discord_gateway_autonomous')
  assert.equal(startCalls[0].researchLoop, 'reactive')
  assert.equal(startCalls[0].operatorMode, 'strict')
  assert.equal(startCalls[0].autonomyPolicy, 'no_prompt_until_human_gate')
  assert.equal(startCalls[0].outputContract, 'research_operator_v1')
  assert.equal(ackCalls.length, 1)
  assert.equal(ackCalls[0].channelId, '1487803123790643341')
  assert.equal(ackCalls[0].messageId, '1489000000000000001')
  assert.match(ackCalls[0].content, /已交辦/)
})

test('strict operator channel strips 先聊 escape and returns direct chat mode', async () => {
  const result = await maybeHandleDiscordOperatorIngress({
    text: '先聊：這題值不值得做？',
    guildId: '974685838157971466',
    channelId: '1487803123790643341',
    messageId: '1489000000000000002',
    senderName: 'Brian',
    token: 'discord-token',
  })

  assert.deepEqual(result, {
    mode: 'chat_escape',
    text: '這題值不值得做？',
  })
})

test('non-operator channel leaves inbound message on normal chat path', async () => {
  const result = await maybeHandleDiscordOperatorIngress({
    text: '一般訊息',
    guildId: '974685838157971466',
    channelId: '999999999999999999',
    messageId: '1489000000000000003',
    senderName: 'Brian',
    token: 'discord-token',
  })

  assert.deepEqual(result, {
    mode: 'continue_chat',
  })
})
