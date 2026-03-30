import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tempRoot = mkdtempSync(join(tmpdir(), 'openclaw-gateway-autonomous-'))
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
      { id: 'qa', identity: { name: '品管龜', emoji: '🐢' } },
      { id: 'analyst', identity: { name: '分析魷魚', emoji: '🦑' } },
      { id: 'dev-fish', identity: { name: '開發魚', emoji: '🐠' } },
      { id: 'research-fish', identity: { name: '研究魚', emoji: '🔬' } },
    ],
  },
  bindings: [
    {
      agentId: 'research-fish',
      match: { channel: 'discord', peer: { kind: 'channel', id: '1487803123790643341' } },
    },
  ],
  channels: {
    discord: {
      guilds: {
        'guild-1': {
          channels: {
            '1487803123790643341': {
              allow: true,
              requireMention: false,
            },
          },
        },
      },
    },
  },
}, null, 2))

process.env.OPENCLAW_HOME = tempRoot
process.env.OPENCLAW_CONFIG_PATH = join(tempRoot, 'openclaw.json')
process.env.OPENCLAW_OFFICE_DB_PATH = join(officeDataDir, 'office.db')
process.env.OPENCLAW_OFFICE_CONFIG_JSON = JSON.stringify({
  channelPolicies: {
    discord: {
      guilds: {
        'guild-1': {
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

import {
  extractDiscordAutonomousAckDelivery,
  isDiscordGatewaySession,
  maybeAdoptDiscordAutonomousHandoff,
  shouldKickGatewayAutonomousTask,
  shouldCompleteGatewayDelegatedTask,
} from '../lib/gateway-autonomous-handoff.js'

test('discord gateway messages default to autonomous handoff', async () => {
  const calls = []
  const result = await maybeAdoptDiscordAutonomousHandoff({
    sessionKey: 'agent:main:discord:channel:1482951168081662074',
    text: '巡檢 copilot.bw-space.com，異常就自己追根因修到好',
    data: {
      authorName: 'Brian',
      channelId: '1482951168081662074',
      messageId: '1484000000000000001',
    },
    agents: {
      qa: { name: '品管龜', emoji: '🐢' },
    },
    startWorkflow: async (payload) => {
      calls.push(payload)
      return {
        success: true,
        requestId: 'req_discord_auto',
        taskId: 'task_discord_auto',
        agent: payload.agent,
      }
    },
  })

  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], {
    content: '巡檢 copilot.bw-space.com，異常就自己追根因修到好',
    from: 'Brian',
    agent: 'qa',
    routingReason: '自治交辦依任務型態優先派給 品管龜。',
  })
  assert.equal(result.requestId, 'req_discord_auto')
  assert.equal(result.taskId, 'task_discord_auto')
  assert.equal(result.agent, 'qa')
  assert.match(result.ackText, /已交辦/)
  assert.match(result.ackText, /formal workflow/)
  assert.deepEqual(result.ackDelivery, {
    target: '1482951168081662074',
    replyToMessageId: '1484000000000000001',
  })
})

test('discord /研究 shortcut formalizes into research orchestration payload', async () => {
  const calls = []
  const result = await maybeAdoptDiscordAutonomousHandoff({
    sessionKey: 'agent:main:discord:channel:1482951168081662074',
    text: '/研究 魚群',
    data: {
      authorName: 'Brian',
      channelId: '1482951168081662074',
      messageId: '1484000000000000002',
    },
    agents: {
      'research-fish': { name: '研究魚', emoji: '🔬' },
    },
    startWorkflow: async (payload) => {
      calls.push(payload)
      return {
        success: true,
        requestId: 'req_discord_research',
        taskId: 'task_discord_research',
        agent: payload.agent,
      }
    },
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].content, '魚群')
  assert.equal(calls[0].agent, 'research-fish')
  assert.equal(calls[0].riskTier, 'medium')
  assert.equal(calls[0].attentionType, 'decision')
  assert.equal(calls[0].scope, 'fleet')
  assert.equal(calls[0].researchLoop, 'reactive')
  assert.equal(calls[0].operatorMode, 'strict')
  assert.equal(calls[0].autonomyPolicy, 'no_prompt_until_human_gate')
  assert.equal(calls[0].outputContract, 'research_operator_v1')
  assert.equal(calls[0].brainState.objective, '魚群')
  assert.match(calls[0].brainState.focus, /魚群|workflow|handoff/i)
  assert.match(calls[0].brainState.evidence.join('\n'), /office\/openclaw/)
  assert.deepEqual(calls[0].suggestedSubagents, ['admin', 'analyst', 'qa'])
  assert.deepEqual(calls[0].delegationPlan.suggestedSubagents, ['admin', 'analyst', 'qa'])
  assert.deepEqual(calls[0].downstreamMatrix, {
    implementation: ['dev-fish'],
    validation: ['qa'],
    rootCause: ['analyst'],
    governance: ['admin'],
    verifier: ['gstack-browse'],
  })
  assert.match(result.ackText, /已交辦/)
})

test('discord /research_app shortcut formalizes into application research with an Autopen verifier target', async () => {
  const calls = []
  const result = await maybeAdoptDiscordAutonomousHandoff({
    sessionKey: 'agent:main:discord:channel:1482951168081662074',
    text: '/research_app Autopen',
    data: {
      authorName: 'Brian',
      channelId: '1482951168081662074',
      messageId: '1484000000000000003',
    },
    agents: {
      'research-fish': { name: '研究魚', emoji: '🔬' },
    },
    startWorkflow: async (payload) => {
      calls.push(payload)
      return {
        success: true,
        requestId: 'req_discord_research_app',
        taskId: 'task_discord_research_app',
        agent: payload.agent,
      }
    },
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].content, 'Autopen')
  assert.equal(calls[0].agent, 'research-fish')
  assert.equal(calls[0].riskTier, 'medium')
  assert.equal(calls[0].attentionType, 'opportunity')
  assert.match(calls[0].brainState.focus, /應用程式|頁面流程/u)
  assert.match(calls[0].brainState.evidence.join('\n'), /www\.bw-space\.com\/admin\/autopen/)
  assert.deepEqual(calls[0].suggestedSubagents, ['dev-fish', 'qa', 'analyst'])
  assert.match(result.ackText, /已交辦/)
})

test('discord gateway autonomous handoff ignores non-discord traffic and respects explicit chat opt-out', async () => {
  const startWorkflow = async () => {
    throw new Error('should not be called')
  }

  const nonDiscord = await maybeAdoptDiscordAutonomousHandoff({
    sessionKey: 'agent:main:telegram:direct:1681034686',
    text: '幫我完成：測試',
    data: {},
    agents: {},
    startWorkflow,
  })

  const optedOut = await maybeAdoptDiscordAutonomousHandoff({
    sessionKey: 'agent:main:discord:channel:1482951168081662074',
    text: '先聊：幫我看看現在有沒有壞掉',
    data: {},
    agents: {},
    startWorkflow,
  })

  assert.equal(isDiscordGatewaySession('agent:main:discord:channel:1482951168081662074'), true)
  assert.equal(isDiscordGatewaySession('agent:main:telegram:direct:1681034686'), false)
  assert.equal(nonDiscord, null)
  assert.equal(optedOut, null)
})

test('research-fish strict operator channel only accepts 先聊: as the chat escape hatch', async () => {
  const calls = []
  const startWorkflow = async (payload) => {
    calls.push(payload)
    return {
      success: true,
      requestId: 'req_research_strict',
      taskId: 'task_research_strict',
      agent: payload.agent,
    }
  }

  const escaped = await maybeAdoptDiscordAutonomousHandoff({
    sessionKey: 'agent:main:discord:channel:1487803123790643341',
    text: '先聊：研究一下這題值不值得做',
    data: {
      guildId: 'guild-1',
      channelId: '1487803123790643341',
      messageId: '1484000000000000091',
    },
    agents: {
      'research-fish': { name: '研究魚', emoji: '🔬' },
    },
    startWorkflow,
  })

  const strictAdopted = await maybeAdoptDiscordAutonomousHandoff({
    sessionKey: 'agent:main:discord:channel:1487803123790643341',
    text: '先討論一下 OpenClaw workflow 卡點',
    data: {
      guildId: 'guild-1',
      channelId: '1487803123790643341',
      messageId: '1484000000000000092',
      authorName: 'Brian',
    },
    agents: {
      'research-fish': { name: '研究魚', emoji: '🔬' },
    },
    startWorkflow,
  })

  assert.equal(escaped, null)
  assert.equal(calls.length, 1)
  assert.equal(strictAdopted?.agent, 'research-fish')
  assert.equal(calls[0].content, '先討論一下 OpenClaw workflow 卡點')
  assert.equal(calls[0].operatorMode, 'strict')
  assert.equal(calls[0].autonomyPolicy, 'no_prompt_until_human_gate')
  assert.match(strictAdopted?.ackText || '', /已交辦/)
})

test('shouldKickGatewayAutonomousTask only returns true for pending formal autonomous dispatches', () => {
  assert.equal(shouldKickGatewayAutonomousTask({
    brainMode: 'autonomous_handoff',
    pendingAction: 'start_work',
    status: 'in_progress',
  }), true)

  assert.equal(shouldKickGatewayAutonomousTask({
    brainMode: 'autonomous_handoff',
    pendingAction: 'continue_after_reply',
    status: 'in_progress',
  }), false)

  assert.equal(shouldKickGatewayAutonomousTask({
    brainMode: 'execution',
    pendingAction: 'start_work',
    status: 'in_progress',
  }), false)

  assert.equal(shouldKickGatewayAutonomousTask({
    brainMode: 'autonomous_handoff',
    pendingAction: 'start_work',
    status: 'in_progress',
    dispatchRunId: 'run_123',
  }), false)
})

test('shouldCompleteGatewayDelegatedTask returns true for active delegated autonomous tasks', () => {
  // Positive: dispatched delegated task still in progress
  assert.equal(shouldCompleteGatewayDelegatedTask({
    brainMode: 'autonomous_handoff',
    assignedAgent: 'research-fish',
    dispatchRunId: 'run_abc',
    status: 'in_progress',
  }), true)

  // Also with dispatchSessionKey instead of runId
  assert.equal(shouldCompleteGatewayDelegatedTask({
    brainMode: 'autonomous_handoff',
    assignedAgent: 'dev-fish',
    dispatchSessionKey: 'session_xyz',
    status: 'pending',
  }), true)

  // False: wickedman's own task
  assert.equal(shouldCompleteGatewayDelegatedTask({
    brainMode: 'autonomous_handoff',
    assignedAgent: 'wickedman',
    dispatchRunId: 'run_abc',
    status: 'in_progress',
  }), false)

  // False: already completed
  assert.equal(shouldCompleteGatewayDelegatedTask({
    brainMode: 'autonomous_handoff',
    assignedAgent: 'research-fish',
    dispatchRunId: 'run_abc',
    status: 'completed',
  }), false)

  // False: not autonomous_handoff brain mode
  assert.equal(shouldCompleteGatewayDelegatedTask({
    brainMode: 'execution',
    assignedAgent: 'research-fish',
    dispatchRunId: 'run_abc',
    status: 'in_progress',
  }), false)

  // False: no dispatch info (never dispatched)
  assert.equal(shouldCompleteGatewayDelegatedTask({
    brainMode: 'autonomous_handoff',
    assignedAgent: 'research-fish',
    status: 'in_progress',
  }), false)

  // False: null/undefined
  assert.equal(shouldCompleteGatewayDelegatedTask(null), false)
  assert.equal(shouldCompleteGatewayDelegatedTask(undefined), false)
})

test('extractDiscordAutonomousAckDelivery falls back to session target when payload is sparse', () => {
  assert.deepEqual(
    extractDiscordAutonomousAckDelivery({
      sessionKey: 'agent:main:discord:channel:1482951168081662074',
      data: { authorName: 'Brian' },
    }),
    {
      target: '1482951168081662074',
      replyToMessageId: null,
    },
  )
})
