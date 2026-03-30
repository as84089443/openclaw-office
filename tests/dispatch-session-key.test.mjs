import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildWorkflowSidecarSessionKey,
  buildWorkflowTaskSessionKey,
  isExternalConversationSessionKey,
  resolveWorkflowDispatchSessionKey,
} from '../lib/dispatch-session-key.js'

test('formal workflow tasks use task-scoped workflow sessions', () => {
  const primary = buildWorkflowTaskSessionKey({
    id: 'task_primary_1',
    assignedAgent: 'research-fish',
    taskType: 'primary',
  })
  const child = buildWorkflowTaskSessionKey({
    id: 'task_child_1',
    assignedAgent: 'qa',
    taskType: 'worker_subtask',
  })

  assert.equal(primary, 'agent:research-fish:workflow:task:task_primary_1')
  assert.equal(child, 'agent:qa:workflow:child:task_child_1')
})

test('legacy channel-bound dispatch session keys are replaced with workflow sessions', () => {
  const sessionKey = resolveWorkflowDispatchSessionKey({
    id: 'task_primary_2',
    assignedAgent: 'research-fish',
    taskType: 'primary',
    dispatchSessionKey: 'agent:research-fish:discord:channel:1487803123790643341',
  })

  assert.equal(isExternalConversationSessionKey('agent:research-fish:discord:channel:1487803123790643341'), true)
  assert.equal(sessionKey, 'agent:research-fish:workflow:task:task_primary_2')
})

test('sidecar workflow sessions stay isolated from the parent discord channel', () => {
  const sessionKey = buildWorkflowSidecarSessionKey({ id: 'task_parent_1' }, 'analyst')
  assert.equal(sessionKey, 'agent:analyst:workflow:sidecar:task_parent_1')
})
