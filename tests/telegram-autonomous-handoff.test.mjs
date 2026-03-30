import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tempRoot = mkdtempSync(join(tmpdir(), 'openclaw-telegram-autonomous-'))
const officeDataDir = join(tempRoot, 'office-data')
mkdirSync(officeDataDir, { recursive: true })

const openclawConfig = {
  channels: {
    telegram: {
      botToken: 'config-telegram-bot-token',
      webhookSecret: 'config-openclaw-secret',
      webhookPath: '/telegram-webhook',
      webhookHost: '127.0.0.1',
      webhookPort: 8787,
    },
  },
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
  bindings: [],
}

writeFileSync(join(tempRoot, 'openclaw.json'), JSON.stringify(openclawConfig, null, 2))

process.env.OPENCLAW_HOME = tempRoot
process.env.OPENCLAW_CONFIG_PATH = join(tempRoot, 'openclaw.json')
process.env.OPENCLAW_OFFICE_DB_PATH = join(officeDataDir, 'office.db')
process.env.TELEGRAM_WEBHOOK_SECRET = 'test-openclaw-secret'
process.env.OPENCLAW_AUTONOMOUS_HANDOFF_DISPATCH_DELAY_MS = '3600000'
process.env.TELEGRAM_BOT_TOKEN = 'test-telegram-bot-token'
process.env.OPENCLAW_OFFICE_CONFIG_JSON = JSON.stringify({
  bossInbox: {
    deliveryEnabled: false,
    discordTarget: '',
  },
})

const {
  db,
  findByTgMessageId,
  getRequests,
  getTaskByRequestId,
} = await import('../lib/db.js')
const { reloadConfig } = await import('../lib/config.js')
const { POST } = await import('../app/api/telegram/webhook/route.js')

reloadConfig()

function resetDb() {
  db.exec(`
    DELETE FROM lobster_rules;
    DELETE FROM attention_state;
    DELETE FROM daily_digests;
    DELETE FROM tasks;
    DELETE FROM events;
    DELETE FROM requests;
  `)
}

function makeWebhookRequest(update) {
  return new Request('http://localhost/api/telegram/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-telegram-bot-api-secret-token': process.env.TELEGRAM_WEBHOOK_SECRET,
    },
    body: JSON.stringify(update),
  })
}

test.beforeEach(() => {
  resetDb()
})

test('telegram messages default to autonomous handoff and create a formal workflow primary task', async () => {
  const originalFetch = globalThis.fetch
  const telegramCalls = []
  globalThis.fetch = async (url, options = {}) => {
    telegramCalls.push({
      url: String(url),
      options,
      body: options?.body ? JSON.parse(options.body) : null,
    })
    return new Response(JSON.stringify({ ok: true, result: { message_id: 999 } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  try {
    const response = await POST(makeWebhookRequest({
      update_id: 1,
      message: {
        message_id: 4242,
        chat: {
          id: 1681034686,
          type: 'private',
        },
        from: {
          id: 1681034686,
          is_bot: false,
          first_name: 'Brian',
        },
        text: '巡檢 copilot.bw-space.com，異常就自己追根因修到好',
      },
    }))

    assert.equal(response.status, 200)

    const request = findByTgMessageId(4242)
    assert.ok(request)
    assert.equal(request.assignedTo, 'qa')
    assert.equal(request.state, 'received')
    assert.equal(request.content, '巡檢 copilot.bw-space.com，異常就自己追根因修到好')

    const task = getTaskByRequestId(request.id)
    assert.ok(task)
    assert.equal(task.taskType, 'primary')
    assert.equal(task.assignedAgent, 'qa')
    assert.equal(task.status, 'pending')
    assert.equal(task.brainMode, 'autonomous_handoff')
    assert.equal(task.pendingAction, 'start_work')
    assert.equal(task.continuationRequired, true)

    assert.equal(telegramCalls.length, 1)
    assert.match(telegramCalls[0].url, /api\.telegram\.org\/bottest-telegram-bot-token\/sendMessage$/)
    assert.equal(telegramCalls[0].body.chat_id, 1681034686)
    assert.equal(telegramCalls[0].body.reply_to_message_id, 4242)
    assert.equal(telegramCalls[0].body.disable_notification, true)
    assert.match(telegramCalls[0].body.text, /已交辦/)
    assert.match(telegramCalls[0].body.text, /主代理保持待命/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('telegram explicit chat opt-out messages are forwarded to the local gateway webhook while dashboard dedupe stays local', async () => {
  const originalFetch = globalThis.fetch
  const fetchCalls = []
  globalThis.fetch = async (url, options = {}) => {
    fetchCalls.push({
      url: String(url),
      options,
      body: options?.body ? JSON.parse(options.body) : null,
    })
    return new Response('OK', { status: 200 })
  }

  const update = {
    update_id: 2,
    message: {
      message_id: 5151,
      chat: {
        id: 1681034686,
        type: 'private',
      },
      from: {
        id: 1681034686,
        is_bot: false,
        first_name: 'Brian',
      },
      text: '先聊：幫我看看 copilot.bw-space.com 現在有沒有怪怪的',
    },
  }

  try {
    const firstResponse = await POST(makeWebhookRequest(update))
    const secondResponse = await POST(makeWebhookRequest(update))

    assert.equal(firstResponse.status, 200)
    assert.equal(secondResponse.status, 200)

    const stored = findByTgMessageId(5151)
    assert.ok(stored)
    assert.equal(getRequests(10).length, 1)

    assert.equal(fetchCalls.length, 2)
    assert.equal(fetchCalls[0].url, 'http://127.0.0.1:8787/telegram-webhook')
    assert.equal(fetchCalls[1].url, 'http://127.0.0.1:8787/telegram-webhook')
    assert.equal(fetchCalls[0].options.headers['x-telegram-bot-api-secret-token'], process.env.TELEGRAM_WEBHOOK_SECRET)
    assert.equal(fetchCalls[1].options.headers['x-telegram-bot-api-secret-token'], process.env.TELEGRAM_WEBHOOK_SECRET)
    assert.equal(fetchCalls[0].body.message.message_id, 5151)
    assert.equal(fetchCalls[1].body.message.message_id, 5151)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('telegram /research shortcut creates a seeded research workflow instead of forwarding as a raw command', async () => {
  const originalFetch = globalThis.fetch
  const telegramCalls = []
  globalThis.fetch = async (url, options = {}) => {
    telegramCalls.push({
      url: String(url),
      options,
      body: options?.body ? JSON.parse(options.body) : null,
    })
    return new Response(JSON.stringify({ ok: true, result: { message_id: 1001 } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  try {
    const response = await POST(makeWebhookRequest({
      update_id: 3,
      message: {
        message_id: 6262,
        chat: {
          id: 1681034686,
          type: 'private',
        },
        from: {
          id: 1681034686,
          is_bot: false,
          first_name: 'Brian',
        },
        text: '/research 魚群',
      },
    }))

    assert.equal(response.status, 200)

    const request = findByTgMessageId(6262)
    assert.ok(request)
    assert.equal(request.assignedTo, 'research-fish')

    const task = getTaskByRequestId(request.id)
    assert.ok(task)
    assert.equal(task.assignedAgent, 'research-fish')
    assert.equal(task.status, 'pending')
    assert.equal(task.brainMode, 'autonomous_handoff')
    assert.equal(task.riskTier, 'medium')
    assert.match(task.brainState.focus || '', /魚群|workflow|handoff/i)
    assert.deepEqual(task.delegationPlan.suggestedSubagents, ['analyst', 'dev-fish', 'qa'])
    assert.match((task.brainState.evidence || []).join('\n'), /office\/openclaw/)

    assert.equal(telegramCalls.length, 1)
    assert.match(telegramCalls[0].body.text, /已交辦/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('telegram /research_app shortcut seeds an application research task with the Autopen verifier target', async () => {
  const originalFetch = globalThis.fetch
  const telegramCalls = []
  globalThis.fetch = async (url, options = {}) => {
    telegramCalls.push({
      url: String(url),
      options,
      body: options?.body ? JSON.parse(options.body) : null,
    })
    return new Response(JSON.stringify({ ok: true, result: { message_id: 1002 } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  try {
    const response = await POST(makeWebhookRequest({
      update_id: 4,
      message: {
        message_id: 7373,
        chat: {
          id: 1681034686,
          type: 'private',
        },
        from: {
          id: 1681034686,
          is_bot: false,
          first_name: 'Brian',
        },
        text: '/research_app Autopen',
      },
    }))

    assert.equal(response.status, 200)

    const request = findByTgMessageId(7373)
    assert.ok(request)
    assert.equal(request.assignedTo, 'research-fish')

    const task = getTaskByRequestId(request.id)
    assert.ok(task)
    assert.equal(task.assignedAgent, 'research-fish')
    assert.equal(task.riskTier, 'medium')
    assert.equal(task.attentionType, 'opportunity')
    assert.match(task.brainState.focus || '', /應用程式|頁面流程/u)
    assert.match((task.brainState.evidence || []).join('\n'), /www\.bw-space\.com\/admin\/autopen/)
    assert.deepEqual(task.delegationPlan.suggestedSubagents, ['dev-fish', 'qa', 'analyst'])

    assert.equal(telegramCalls.length, 1)
    assert.match(telegramCalls[0].body.text, /已交辦/)
  } finally {
    globalThis.fetch = originalFetch
  }
})
