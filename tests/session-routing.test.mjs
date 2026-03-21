import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildConversationCategories,
  resolveSessionAgent,
} from '../lib/session-routing.js'

test('legacy main discord session resolves to bound fish agent', () => {
  const result = resolveSessionAgent({
    sessionKey: 'agent:main:discord:channel:1482951168081662074',
    agentId: 'main',
    channel: 'discord',
    groupId: '1482951168081662074',
    origin: {
      from: 'discord:channel:1482951168081662074',
      to: 'channel:1482951168081662074',
    },
  })

  assert.equal(result.agentId, 'dev-fish')
  assert.equal(result.storedAgentId, 'main')
  assert.equal(result.source, 'binding')
})

test('conversation categories keep configured fish metadata', () => {
  const categories = buildConversationCategories([{ agentId: 'dev-fish' }])
  const devFish = categories.find((entry) => entry.agentId === 'dev-fish')

  assert.ok(devFish)
  assert.equal(devFish.sessionCount, 1)
  assert.ok(devFish.name)
  assert.ok(devFish.emoji)
})
