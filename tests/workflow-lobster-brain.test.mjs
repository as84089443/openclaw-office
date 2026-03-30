import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tempRoot = mkdtempSync(join(tmpdir(), 'openclaw-workflow-lobster-'))
const officeDataDir = join(tempRoot, 'office-data')
mkdirSync(officeDataDir, { recursive: true })

const openclawConfig = {
  agents: {
    defaults: {
      model: {
        primary: 'openai-codex/gpt-5.4',
      },
    },
    list: [
      { id: 'wickedman', identity: { name: 'WickedMan', emoji: '🦑' } },
      { id: 'bizdev', identity: { name: '鯊魚業務', emoji: '🦈' } },
      { id: 'dev-fish', identity: { name: '開發魚', emoji: '🐠' } },
      { id: 'qa', identity: { name: '品管龜', emoji: '🐢' } },
      { id: 'analyst', identity: { name: '分析魷魚', emoji: '🐟' } },
      { id: 'admin', identity: { name: '八爪魚管', emoji: '🐙' } },
      { id: 'research-fish', identity: { name: '研究魚', emoji: '🔬' } },
      { id: 'gstack-browse', identity: { name: '外腦驗證', emoji: '🦞' } },
    ],
  },
  bindings: [],
}

writeFileSync(join(tempRoot, 'openclaw.json'), JSON.stringify(openclawConfig, null, 2))

process.env.OPENCLAW_HOME = tempRoot
process.env.OPENCLAW_CONFIG_PATH = join(tempRoot, 'openclaw.json')
process.env.OPENCLAW_OFFICE_DB_PATH = join(officeDataDir, 'office.db')
process.env.OPENCLAW_OFFICE_CONFIG_JSON = JSON.stringify({
  bossInbox: {
    deliveryEnabled: false,
    discordTarget: '',
  },
})

const {
  db,
  createRequest,
  createTask,
  getRequestById,
  getTaskById,
  getTaskByRequestId,
  getChildTasks,
} = await import('../lib/db.js')
const { reloadConfig } = await import('../lib/config.js')
const { POST } = await import('../app/api/workflow/route.js')

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

function makeWorkflowRequest(payload) {
  return new Request('http://localhost/api/workflow', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

test.beforeEach(() => {
  resetDb()
})

test('start_flow stops irreversible work at a human gate', async () => {
  const response = await POST(makeWorkflowRequest({
    action: 'start_flow',
    content: '請直接刪除 production database，這是不可逆操作。',
    from: 'Boss',
    agent: 'bizdev',
  }))
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.success, true)

  const task = getTaskById(payload.taskId)
  const request = getRequestById(payload.requestId)

  assert.ok(task)
  assert.ok(request)
  assert.equal(task.status, 'pending')
  assert.equal(task.taskType, 'primary')
  assert.equal(task.riskTier, 'irreversible')
  assert.equal(task.autoContinueAllowed, false)
  assert.equal(task.pendingAction, 'start_work')
  assert.match(task.humanGateReason || '', /不可逆操作/)
})

test('start_flow preserves explicit source for gateway autonomous adoption', async () => {
  const response = await POST(makeWorkflowRequest({
    action: 'start_flow',
    content: '巡檢 copilot.bw-space.com/office/openclaw，異常就自己追根因修到好',
    from: 'Discord',
    agent: 'qa',
    autonomousHandoff: true,
    deferDispatchUntilIdleMs: 60000,
    source: 'discord_gateway_autonomous',
  }))
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.success, true)

  const request = getRequestById(payload.requestId)
  const task = getTaskById(payload.taskId)

  assert.ok(request)
  assert.ok(task)
  assert.equal(request.source, 'discord_gateway_autonomous')
  assert.equal(task.brainMode, 'autonomous_handoff')
  assert.equal(task.pendingAction, 'start_work')
})

test('start_flow persists explicit research delegation seed into the primary task memory', async () => {
  const response = await POST(makeWorkflowRequest({
    action: 'start_flow',
    content: '魚群',
    from: 'Telegram',
    agent: 'research-fish',
    autonomousHandoff: true,
    source: 'telegram_autonomous_handoff',
    riskTier: 'medium',
    attentionType: 'decision',
    brainState: {
      objective: '魚群',
      scope: 'fleet',
      researchLoop: 'reactive',
      operatorMode: 'strict',
      autonomyPolicy: 'no_prompt_until_human_gate',
      outputContract: 'research_operator_v1',
      focus: '盤點魚群 routing、handoff、workflow、看板與治理問題。',
      summary: '研究魚會先巡整個魚群與流程治理，再把需要的工作派出去。',
      evidence: ['verification target: https://copilot.bw-space.com/office/openclaw'],
    },
    scope: 'fleet',
    researchLoop: 'reactive',
    operatorMode: 'strict',
    autonomyPolicy: 'no_prompt_until_human_gate',
    outputContract: 'research_operator_v1',
    suggestedSubagents: ['admin', 'analyst', 'qa'],
    downstreamMatrix: {
      implementation: ['dev-fish'],
      validation: ['qa'],
      rootCause: ['analyst'],
      governance: ['admin'],
      verifier: ['gstack-browse'],
    },
    delegationPlan: {
      allowSubagents: true,
      reviewerMode: 'research-operator',
      suggestedSubagents: ['admin', 'analyst', 'qa'],
      currentStatus: 'queued',
      scope: 'fleet',
      researchLoop: 'reactive',
      operatorMode: 'strict',
      autonomyPolicy: 'no_prompt_until_human_gate',
      outputContract: 'research_operator_v1',
      downstreamMatrix: {
        implementation: ['dev-fish'],
        validation: ['qa'],
        rootCause: ['analyst'],
        governance: ['admin'],
        verifier: ['gstack-browse'],
      },
    },
  }))
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.success, true)

  const task = getTaskById(payload.taskId)
  assert.ok(task)
  assert.equal(task.assignedAgent, 'research-fish')
  assert.equal(task.riskTier, 'medium')
  assert.equal(task.attentionType, 'decision')
  assert.equal(task.brainMode, 'autonomous_handoff')
  assert.equal(task.brainState.objective, '魚群')
  assert.equal(task.scope, 'fleet')
  assert.equal(task.researchLoop, 'reactive')
  assert.equal(task.operatorMode, 'strict')
  assert.equal(task.autonomyPolicy, 'no_prompt_until_human_gate')
  assert.equal(task.outputContract, 'research_operator_v1')
  assert.equal(task.brainState.scope, 'fleet')
  assert.equal(task.brainState.researchLoop, 'reactive')
  assert.equal(task.brainState.operatorMode, 'strict')
  assert.equal(task.brainState.autonomyPolicy, 'no_prompt_until_human_gate')
  assert.equal(task.brainState.outputContract, 'research_operator_v1')
  assert.match(task.brainState.focus || '', /魚群|workflow|handoff/i)
  assert.match((task.brainState.evidence || []).join('\n'), /office\/openclaw/)
  assert.deepEqual(task.delegationPlan.suggestedSubagents, ['admin', 'analyst', 'qa'])
  assert.equal(task.delegationPlan.reviewerMode, 'research-operator')
  assert.equal(task.delegationPlan.scope, 'fleet')
  assert.equal(task.delegationPlan.researchLoop, 'reactive')
  assert.equal(task.delegationPlan.operatorMode, 'strict')
  assert.equal(task.delegationPlan.autonomyPolicy, 'no_prompt_until_human_gate')
  assert.equal(task.delegationPlan.outputContract, 'research_operator_v1')
  assert.deepEqual(task.downstreamMatrix, {
    implementation: ['dev-fish'],
    validation: ['qa'],
    rootCause: ['analyst'],
    governance: ['admin'],
    verifier: ['gstack-browse'],
  })
  assert.deepEqual(task.delegationPlan.downstreamMatrix, {
    implementation: ['dev-fish'],
    validation: ['qa'],
    rootCause: ['analyst'],
    governance: ['admin'],
    verifier: ['gstack-browse'],
  })
})

test('research-fish completion auto-creates downstream child tasks instead of stopping at a recommendation', async () => {
  const startResponse = await POST(makeWorkflowRequest({
    action: 'start_flow',
    content: '研究 OpenClaw workflow 卡點',
    from: 'Boss',
    agent: 'research-fish',
    autonomousHandoff: true,
    source: 'discord_gateway_autonomous',
    scope: 'application',
    researchLoop: 'reactive',
    operatorMode: 'strict',
    autonomyPolicy: 'no_prompt_until_human_gate',
    outputContract: 'research_operator_v1',
    brainState: {
      objective: '研究 OpenClaw workflow 卡點',
      scope: 'application',
      researchLoop: 'reactive',
      operatorMode: 'strict',
      autonomyPolicy: 'no_prompt_until_human_gate',
      outputContract: 'research_operator_v1',
      focus: '盤點 workflow 摩擦並直接往可落地修補推進',
    },
    delegationPlan: {
      currentStatus: 'queued',
      reviewerMode: 'research-operator',
      suggestedSubagents: ['dev-fish', 'qa', 'analyst'],
      downstreamMatrix: {
        implementation: ['dev-fish'],
        validation: ['qa'],
        rootCause: ['analyst'],
        governance: ['admin'],
        verifier: ['gstack-browse'],
      },
    },
  }))
  const startPayload = await startResponse.json()
  assert.equal(startResponse.status, 200)

  const response = await POST(makeWorkflowRequest({
    action: 'agent_complete',
    taskId: startPayload.taskId,
    agent: 'research-fish',
    success: true,
    result: '第一輪研究完成',
    summary: '主線已收斂到 workflow 與驗證缺口，需要直接分派實作與驗證。',
    nextStep: '請交給 dev-fish 修 workflow，並讓 qa 與 gstack 驗證。',
  }))
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.success, true)

  const task = getTaskById(startPayload.taskId)
  const childTasks = getChildTasks(startPayload.taskId, 20)
  const workerChildren = childTasks.filter((entry) => entry.taskType === 'worker_subtask')

  assert.ok(task)
  assert.ok(workerChildren.length >= 2)
  assert.ok(workerChildren.some((entry) => entry.assignedAgent === 'dev-fish'))
  assert.ok(workerChildren.some((entry) => entry.assignedAgent === 'qa'))
  assert.ok((task.delegationPlan?.delegatedAgents || []).includes('dev-fish'))
  assert.ok((task.delegationPlan?.delegatedAgents || []).includes('qa'))
})

test('research-fish consultant stop signals are forced back into control-plane continuation', async () => {
  const startResponse = await POST(makeWorkflowRequest({
    action: 'start_flow',
    content: '研究 research-fish 升級成 control-plane agent',
    from: 'Boss',
    agent: 'research-fish',
    autonomousHandoff: true,
    source: 'discord_gateway_autonomous',
    scope: 'fleet',
    researchLoop: 'reactive',
    operatorMode: 'strict',
    autonomyPolicy: 'no_prompt_until_human_gate',
    outputContract: 'research_operator_v1',
    brainState: {
      objective: '研究 research-fish control-plane 升級',
      scope: 'fleet',
      researchLoop: 'reactive',
      operatorMode: 'strict',
      autonomyPolicy: 'no_prompt_until_human_gate',
      outputContract: 'research_operator_v1',
      focus: '把研究輸出升級成可交辦、可驗證、可治理的 artifact',
    },
  }))
  const startPayload = await startResponse.json()
  assert.equal(startResponse.status, 200)

  const response = await POST(makeWorkflowRequest({
    action: 'agent_complete',
    taskId: startPayload.taskId,
    agent: 'research-fish',
    success: true,
    result: '如果你要，我下一則就直接開始做研究魚能力缺口地圖 v1。',
    summary: '先收斂出北極星，但還沒壓成正式 artifact。',
  }))
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.success, true)

  const task = getTaskById(startPayload.taskId)
  assert.ok(task)
  assert.equal(task.status, 'in_progress')
  assert.equal(task.continuationRequired, true)
  assert.ok(['awaiting-continuation', 'delegating'].includes(task.delegationPlan?.currentStatus))
  assert.match(task.nextStep || '', /downstream child tasks|自動續跑|續跑/)
})

test('kick_pending_action can immediately enforce the pending autonomous task governor', async () => {
  const request = createRequest({
    id: 'req_kick_pending',
    content: '請直接刪除 production database，這是不可逆操作。',
    from: 'Discord',
    state: 'in_progress',
    createdAt: Date.now(),
    source: 'discord_gateway_autonomous',
  })

  const task = createTask({
    id: 'task_kick_pending',
    requestId: request.id,
    title: '不可逆交辦',
    detail: request.content,
    assignedAgent: 'qa',
    taskType: 'primary',
    sourceAgent: 'wickedman',
    status: 'in_progress',
    brainMode: 'autonomous_handoff',
    riskTier: 'irreversible',
    autoContinueAllowed: false,
    continuationRequired: true,
    pendingAction: 'start_work',
    createdAt: Date.now(),
    lastUpdate: Date.now(),
  })

  const response = await POST(makeWorkflowRequest({
    action: 'kick_pending_action',
    requestId: request.id,
  }))
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.success, true)
  assert.equal(payload.kicked, true)
  assert.equal(payload.status, 'blocked')

  const updatedTask = getTaskById(task.id)
  assert.ok(updatedTask)
  assert.equal(updatedTask.status, 'blocked')
  assert.match(updatedTask.humanGateReason || '', /不可逆操作/)
})

test('sidecar completion flows into parent reviewer consensus', async () => {
  const request = createRequest({
    id: 'req_lobster_consensus',
    content: '請追根究底找出為什麼驗證一直失敗',
    from: 'Boss',
    state: 'received',
    createdAt: Date.now(),
  })

  const parentTask = createTask({
    id: 'task_primary_lobster',
    requestId: request.id,
    title: '主任務',
    detail: '需要 reviewer 幫忙檢查 schema drift',
    assignedAgent: 'bizdev',
    taskType: 'primary',
    sourceAgent: 'wickedman',
    status: 'pending',
    riskTier: 'high',
    mergePolicy: 'consensus_required',
    createdAt: Date.now(),
    lastUpdate: Date.now(),
  })

  createTask({
    id: 'task_child_reviewer',
    requestId: request.id,
    parentTaskId: parentTask.id,
    rootTaskId: parentTask.id,
    taskType: 'sidecar_review',
    sourceAgent: 'wickedman',
    mergePolicy: 'consensus_required',
    assignedAgent: 'qa',
    title: 'child reviewer',
    detail: '請檢查 root cause',
    status: 'in_progress',
    graphDepth: 1,
    createdAt: Date.now(),
    startedAt: Date.now(),
    lastUpdate: Date.now(),
  })

  const response = await POST(makeWorkflowRequest({
    action: 'agent_complete',
    agent: 'qa',
    success: true,
    result: 'Reviewer completed',
    summary: 'QA reviewer 認為 schema drift 是主要根因。',
    rootCause: 'schema drift',
    recommendedAction: 'fix_schema',
    reviewerResults: [{
      findingType: 'root_cause',
      severity: 'warning',
      recommendedAction: 'fix_schema',
      supportsRootCause: true,
      summary: 'schema drift 導致驗證失敗',
      rootCause: 'schema drift',
      confidence: 0.92,
    }],
  }))
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.success, true)
  assert.equal(payload.sidecar, true)

  const updatedParent = getTaskByRequestId(request.id)
  const childTasks = getChildTasks(parentTask.id, 10)
  const childTask = childTasks.find((entry) => entry.id === 'task_child_reviewer')

  assert.ok(updatedParent)
  assert.ok(childTask)
  assert.equal(childTask.status, 'completed')
  assert.equal(updatedParent.reviewerResults.length, 1)
  assert.equal(updatedParent.consensus.status, 'needs_more_review')
  assert.equal(updatedParent.consensus.topRootCause, 'schema drift')
  assert.equal(updatedParent.consensus.recommendedAction, 'fix_schema')
  assert.equal(updatedParent.consensus.humanApprovalRequired, false)
  assert.equal(updatedParent.riskTier, 'high')
  assert.equal(updatedParent.reusableMemory?.episodic?.rootCause, 'schema drift')
})

test('agent_complete can target an explicit gstack child task without串錯其他任務', async () => {
  createRequest({
    id: 'req_parent_a',
    content: '巡檢 A',
    from: 'Boss',
    state: 'received',
    createdAt: Date.now(),
  })

  createRequest({
    id: 'req_parent_b',
    content: '巡檢 B',
    from: 'Boss',
    state: 'received',
    createdAt: Date.now(),
  })

  const parentA = createTask({
    id: 'task_parent_a',
    requestId: 'req_parent_a',
    title: 'A 任務',
    detail: '巡檢 https://copilot.bw-space.com/office/a',
    assignedAgent: 'bizdev',
    taskType: 'primary',
    sourceAgent: 'wickedman',
    status: 'in_progress',
    riskTier: 'medium',
    createdAt: Date.now(),
    lastUpdate: Date.now(),
  })

  const parentB = createTask({
    id: 'task_parent_b',
    requestId: 'req_parent_b',
    title: 'B 任務',
    detail: '巡檢 https://copilot.bw-space.com/office/b',
    assignedAgent: 'analyst',
    taskType: 'primary',
    sourceAgent: 'wickedman',
    status: 'in_progress',
    riskTier: 'medium',
    createdAt: Date.now(),
    lastUpdate: Date.now(),
  })

  createTask({
    id: 'task_child_gstack_a',
    requestId: 'req_parent_a',
    parentTaskId: parentA.id,
    rootTaskId: parentA.id,
    taskType: 'verifier',
    sourceAgent: 'gstack',
    mergePolicy: 'blocking_review',
    assignedAgent: 'gstack-browse',
    title: 'gstack A',
    detail: 'verify A',
    status: 'in_progress',
    graphDepth: 1,
    createdAt: Date.now(),
    startedAt: Date.now(),
    lastUpdate: Date.now(),
  })

  createTask({
    id: 'task_child_gstack_b',
    requestId: 'req_parent_b',
    parentTaskId: parentB.id,
    rootTaskId: parentB.id,
    taskType: 'verifier',
    sourceAgent: 'gstack',
    mergePolicy: 'blocking_review',
    assignedAgent: 'gstack-browse',
    title: 'gstack B',
    detail: 'verify B',
    status: 'in_progress',
    graphDepth: 1,
    createdAt: Date.now(),
    startedAt: Date.now(),
    lastUpdate: Date.now(),
  })

  const response = await POST(makeWorkflowRequest({
    action: 'agent_complete',
    taskId: 'task_child_gstack_b',
    agent: 'gstack-browse',
    success: true,
    result: 'gstack verifier passed on B',
    summary: 'B 頁面已過 gstack verifier。',
    reviewerResults: [{
      findingType: 'verification',
      severity: 'info',
      recommendedAction: 'continue',
      summary: 'B 頁面 console clean',
      confidence: 0.78,
    }],
  }))
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.success, true)
  assert.equal(payload.sidecar, true)
  assert.equal(payload.taskId, 'task_child_gstack_b')
  assert.equal(payload.parentTaskId, 'task_parent_b')

  const childA = getChildTasks(parentA.id, 10).find((entry) => entry.id === 'task_child_gstack_a')
  const childB = getChildTasks(parentB.id, 10).find((entry) => entry.id === 'task_child_gstack_b')
  const updatedParentA = getTaskById(parentA.id)
  const updatedParentB = getTaskById(parentB.id)

  assert.equal(childA?.status, 'in_progress')
  assert.equal(childB?.status, 'completed')
  assert.equal(updatedParentA?.reviewerResults?.length || 0, 0)
  assert.equal(updatedParentB?.reviewerResults?.length || 0, 1)
  assert.equal(updatedParentB?.consensus?.status, 'clear')
})

test('autonomous handoff reroutes away from primary agent so main stays on standby', async () => {
  const response = await POST(makeWorkflowRequest({
    action: 'start_flow',
    content: '巡檢 https://copilot.bw-space.com/office，異常就自己追根因修到好',
    from: 'Boss',
    agent: 'wickedman',
    autonomousHandoff: true,
    deferDispatchUntilIdleMs: 3600000,
  }))
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.success, true)

  const task = getTaskById(payload.taskId)
  assert.ok(task)
  assert.notEqual(task.assignedAgent, 'wickedman')
  assert.ok(['qa', 'analyst', 'bizdev', 'research-fish'].includes(task.assignedAgent))
  assert.equal(task.brainMode, 'autonomous_handoff')
  assert.equal(task.pendingAction, 'start_work')
})
