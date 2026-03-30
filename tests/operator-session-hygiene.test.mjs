import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tempRoot = mkdtempSync(join(tmpdir(), 'openclaw-operator-hygiene-'))
const officeDataDir = join(tempRoot, 'office-data')
const sessionDir = join(tempRoot, 'agents', 'research-fish', 'sessions')
mkdirSync(officeDataDir, { recursive: true })
mkdirSync(sessionDir, { recursive: true })

writeFileSync(join(tempRoot, 'openclaw.json'), JSON.stringify({
  agents: {
    defaults: {
      model: {
        primary: 'openai-codex/gpt-5.4',
      },
    },
    list: [
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

writeFileSync(join(sessionDir, 'sessions.json'), JSON.stringify({
  'agent:research-fish:discord:channel:1487803123790643341': {
    sessionId: 'legacy-session',
    sessionFile: join(sessionDir, 'legacy-session.jsonl'),
    updatedAt: Date.now(),
  },
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
const {
  ensureStrictOperatorSessionHygiene,
  resetStrictOperatorSessionHygieneCache,
} = await import('../lib/operator-session-hygiene.js')

test.beforeEach(() => {
  reloadConfig()
  resetStrictOperatorSessionHygieneCache()
})

test('strict operator session hygiene rotates the stale discord channel session once', () => {
  const result = ensureStrictOperatorSessionHygiene()
  const updatedStore = JSON.parse(readFileSync(join(sessionDir, 'sessions.json'), 'utf8'))
  const markerPath = join(tempRoot, 'runtime', 'strict-operator-session-hygiene.json')

  assert.equal(result.skipped, false)
  assert.equal(result.rotated.length, 1)
  assert.equal(updatedStore['agent:research-fish:discord:channel:1487803123790643341'], undefined)
  assert.equal(existsSync(markerPath), true)
})

test('strict operator session hygiene is idempotent after the marker is written', () => {
  ensureStrictOperatorSessionHygiene()
  resetStrictOperatorSessionHygieneCache()

  const second = ensureStrictOperatorSessionHygiene()
  assert.equal(second.skipped, true)
  assert.equal(second.reason, 'already-applied')
})
