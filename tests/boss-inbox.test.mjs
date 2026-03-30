import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tempRoot = mkdtempSync(join(tmpdir(), 'openclaw-boss-inbox-'))
const cronDir = join(tempRoot, 'cron')
const agentSystemLogsDir = join(tempRoot, 'workspace', 'agent-system', 'logs')
const maintenanceReportsDir = join(tempRoot, 'artifacts', 'maintenance', 'reports')
const officeDataDir = join(tempRoot, 'office-data')
const officeMirrorReportsDir = join(officeDataDir, 'maintenance-reports')
mkdirSync(cronDir, { recursive: true })
mkdirSync(agentSystemLogsDir, { recursive: true })
mkdirSync(maintenanceReportsDir, { recursive: true })
mkdirSync(officeMirrorReportsDir, { recursive: true })

const openclawConfig = {
  agents: {
    defaults: {
      model: {
        primary: 'openai-codex/gpt-5.4',
      },
    },
    list: [
      { id: 'main' },
      { id: 'bizdev', identity: { name: '鯊魚業務', emoji: '🦈' } },
      { id: 'seo', identity: { name: '藍鯨SEO', emoji: '🐋' } },
      { id: 'research-fish', identity: { name: '研究魚', emoji: '🐟' } },
      { id: 'admin', identity: { name: '八爪魚管', emoji: '🐙' } },
      { id: 'finance-company', identity: { name: '河童帳務', emoji: '🐡' } },
      { id: 'booking', identity: { name: '水母排程', emoji: '🪼' } },
      { id: 'crm', identity: { name: '珊瑚CRM', emoji: '🪸' } },
      { id: 'production', identity: { name: '劍魚後製', emoji: '⚔️' } },
    ],
  },
  bindings: [
    {
      agentId: 'main',
      match: { channel: 'discord', peer: { kind: 'channel', id: 'main-room' } },
    },
    {
      agentId: 'bizdev',
      match: { channel: 'discord', peer: { kind: 'channel', id: 'sales-room' } },
    },
    {
      agentId: 'finance-company',
      match: { channel: 'discord', peer: { kind: 'channel', id: 'finance-room' } },
    },
    {
      agentId: 'research-fish',
      match: { channel: 'discord', peer: { kind: 'channel', id: 'research-room' } },
    },
  ],
}

writeFileSync(join(tempRoot, 'openclaw.json'), JSON.stringify(openclawConfig, null, 2))
writeFileSync(join(cronDir, 'jobs.json'), JSON.stringify({ jobs: [] }, null, 2))

process.env.OPENCLAW_HOME = tempRoot
process.env.OPENCLAW_CONFIG_PATH = join(tempRoot, 'openclaw.json')
process.env.OPENCLAW_OFFICE_DB_PATH = join(officeDataDir, 'office.db')

const {
  db,
  createRequest,
  createTask,
  ensurePrimaryTask,
  getDailyDigestByDate,
  getPrimaryTasksByRequest,
  getTaskByRequestId,
  repairPrimaryTaskIntegrity,
  updateTask,
  upsertAttentionState,
  upsertLobsterRule,
} = await import('../lib/db.js')
const { buildBossInboxPayload, ensureDailyDigest, runAttentionAction } = await import('../lib/boss-inbox.js')
const { getAgentsList, reloadConfig } = await import('../lib/config.js')

reloadConfig()

function resetDb() {
  db.exec(`
    DELETE FROM daily_digests;
    DELETE FROM attention_state;
    DELETE FROM tasks;
    DELETE FROM events;
    DELETE FROM requests;
  `)
}

function writeCronJobs(jobs) {
  writeFileSync(join(cronDir, 'jobs.json'), JSON.stringify({ jobs }, null, 2))
}

function writeAuditEnv(values = {}) {
  const defaults = {
    AUTOMATION_PLACEHOLDER: 0,
    AUTOMATION_GATED: 0,
    AUTOMATION_CORE_READY: 8,
    AUTOMATION_CORE_TOTAL: 8,
  }
  const merged = { ...defaults, ...values }
  const body = Object.entries(merged)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
  const now = new Date()
  const today = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-')

  writeFileSync(
    join(agentSystemLogsDir, `automation-integrity-${today}.env`),
    `${body}\n`,
  )
}

function writeMaintenanceReports({ hygiene = null, cleanup = null, route = null, reportDir = null } = {}) {
  const reportDirs = Array.isArray(reportDir)
    ? reportDir
    : [reportDir || maintenanceReportsDir, officeMirrorReportsDir]
  const defaultHygiene = {
    generatedAt: new Date().toISOString(),
    root: tempRoot,
    status: 'clean',
    issues: {
      unexpectedRootFiles: [],
      uncoveredTopLevelDirectories: [],
      missingReadmes: [],
    },
    reportPath: join(reportDirs[0], 'latest-root-hygiene.json'),
  }
  const defaultCleanup = {
    generatedAt: new Date().toISOString(),
    root: tempRoot,
    summary: {
      candidateCount: 0,
      candidateBytes: 0,
      candidateSizeHuman: '0B',
      byZone: {},
    },
    candidates: [],
    reportPath: join(reportDirs[0], 'latest-root-maintenance.json'),
  }
  const defaultRoute = {
    generatedAt: new Date().toISOString(),
    hostname: 'copilot.bw-space.com',
    tunnel: 'openclaw',
    status: 'ok',
    configPath: join(tempRoot, '.cloudflared', 'config.yml'),
    configUpdated: 0,
    launchdStatus: 'unchanged',
    dockerPublicStatus: 'ok',
    strayCloudflaredCount: 0,
    localHealth: 'ok',
    publicHealth: 'ok',
    publicBossInbox: 'ok',
    reportPath: join(reportDirs[0], 'latest-copilot-route.json'),
  }

  for (const currentDir of reportDirs) {
    mkdirSync(currentDir, { recursive: true })
    writeFileSync(
      join(currentDir, 'latest-root-hygiene.json'),
      JSON.stringify(hygiene || defaultHygiene, null, 2),
    )
    writeFileSync(
      join(currentDir, 'latest-root-maintenance.json'),
      JSON.stringify(cleanup || defaultCleanup, null, 2),
    )
    writeFileSync(
      join(currentDir, 'latest-copilot-route.json'),
      JSON.stringify(route || defaultRoute, null, 2),
    )
  }
}

test.beforeEach(() => {
  resetDb()
  writeCronJobs([])
  writeAuditEnv()
  writeMaintenanceReports()
})

test('boss inbox roster uses canonical openclaw.json agents instead of legacy office list', () => {
  writeCronJobs([
    {
      id: 'bizdev-daily',
      enabled: true,
      agentId: 'bizdev',
      name: 'bizdev-search-daily',
      payload: { kind: 'agentTurn', message: 'run bizdev' },
      delivery: { channel: 'discord' },
    },
    {
      id: 'research-nightly',
      enabled: true,
      agentId: 'research-fish',
      name: 'research-fish-autoresearch-nightly',
      payload: { kind: 'agentTurn', message: 'run research-fish' },
      delivery: { channel: 'discord' },
    },
  ])
  const payload = buildBossInboxPayload({ skipDigest: true })
  const rosterCount = getAgentsList().length
  const researchFish = payload.agentSummaries.find((entry) => entry.id === 'research-fish')

  assert.equal(rosterCount, openclawConfig.agents.list.length)
  assert.equal(payload.agentSummaries.length, openclawConfig.agents.list.length)
  assert.ok(payload.agentSummaries.length > 5)
  assert.ok(payload.activeAgentSummaries.some((entry) => entry.id === 'bizdev'))
  assert.ok(payload.activeAgentSummaries.some((entry) => entry.id === 'research-fish'))
  assert.ok(payload.inactiveAgentSummaries.some((entry) => entry.id === 'seo'))
  assert.equal(payload.activeAgentSummaries.find((entry) => entry.id === 'bizdev')?.activityState, 'active')
  assert.equal(payload.inactiveAgentSummaries.find((entry) => entry.id === 'seo')?.activityState, 'inactive')
  assert.deepEqual(researchFish?.bindings, ['discord channel:research-room'])
  assert.deepEqual(researchFish?.channels, ['discord'])
})

test('cron failures are surfaced as blocked or risk attention items', () => {
  writeCronJobs([
    {
      id: 'nightly-sync',
      name: 'Nightly Sync',
      description: 'Sync accounting exports',
      enabled: true,
      agentId: 'finance-company',
      state: {
        lastStatus: 'error',
        consecutiveErrors: 1,
        lastError: 'Permission denied while syncing invoices',
        lastRunAtMs: Date.now(),
      },
    },
  ])

  const payload = buildBossInboxPayload({ skipDigest: true })
  const item = payload.attentionItems.find((entry) => entry.id === 'cron:nightly-sync')

  assert.ok(item)
  assert.ok(['blocked', 'risk'].includes(item.attentionType))
  assert.equal(item.agentId, 'finance-company')
})

test('delivered status sync noise does not surface as a cron attention item', () => {
  writeCronJobs([
    {
      id: 'nightly-sync',
      name: 'Nightly Sync',
      description: 'Sync accounting exports',
      enabled: true,
      agentId: 'finance-company',
      state: {
        lastStatus: 'error',
        consecutiveErrors: 3,
        lastDelivered: true,
        lastDeliveryStatus: 'delivered',
        lastError: '⚠️ 📝 Edit: `in ~/.openclaw/agent/status.json (142 chars)` failed',
        lastRunAtMs: Date.now(),
      },
    },
  ])

  const payload = buildBossInboxPayload({ skipDigest: true })
  const item = payload.attentionItems.find((entry) => entry.id === 'cron:nightly-sync')

  assert.equal(item, undefined)
})

test('request lookup stays pinned to the primary task when child tasks exist', () => {
  const req = createRequest({
    id: 'req_graph_primary',
    content: '請處理這題主任務',
    from: 'Boss',
    state: 'received',
    createdAt: Date.now(),
  })

  const primaryTask = createTask({
    requestId: req.id,
    title: '主任務',
    detail: '主任務內容',
    assignedAgent: 'bizdev',
    taskType: 'primary',
    sourceAgent: 'wickedman',
    status: 'in_progress',
    createdAt: Date.now(),
  })

  createTask({
    requestId: req.id,
    parentTaskId: primaryTask.id,
    rootTaskId: primaryTask.id,
    title: 'sidecar reviewer',
    detail: '補一輪平行驗證',
    assignedAgent: 'production',
    taskType: 'sidecar_review',
    sourceAgent: 'bizdev',
    mergePolicy: 'advisory',
    graphDepth: 1,
    status: 'in_progress',
    createdAt: Date.now() + 1,
  })

  const resolved = getTaskByRequestId(req.id)
  assert.ok(resolved)
  assert.equal(resolved.id, primaryTask.id)
  assert.equal(resolved.taskType, 'primary')
})

test('ensurePrimaryTask reuses the canonical primary task instead of creating duplicates', () => {
  const req = createRequest({
    id: 'req_primary_reuse',
    content: '請持續收斂這題',
    from: 'Boss',
    state: 'received',
    createdAt: Date.now(),
  })

  const first = ensurePrimaryTask(req.id, {
    title: '第一次主任務',
    detail: '第一次建立',
    assignedAgent: 'bizdev',
    status: 'pending',
    createdAt: Date.now(),
  })

  const second = ensurePrimaryTask(req.id, {
    title: '更新後主任務',
    detail: '第二次呼叫應該覆用同一個 primary',
    assignedAgent: 'admin',
    status: 'assigned',
    lastUpdate: Date.now() + 10,
  })

  const primaryTasks = getPrimaryTasksByRequest(req.id)

  assert.ok(first)
  assert.ok(second)
  assert.equal(second.id, first.id)
  assert.equal(primaryTasks.length, 1)
  assert.equal(primaryTasks[0]?.assignedAgent, 'admin')
  assert.equal(primaryTasks[0]?.title, '更新後主任務')
})

test('repairPrimaryTaskIntegrity collapses duplicate primaries into one canonical primary', () => {
  const requestId = 'req_duplicate_primary_repair'
  createRequest({
    id: requestId,
    content: '這題之前長出了兩個 primary',
    from: 'Boss',
    state: 'in_progress',
    createdAt: Date.now(),
  })

  db.exec('DROP INDEX IF EXISTS idx_tasks_primary_request_unique')
  db.exec(`
    INSERT INTO tasks (id, request_id, task_type, title, detail, assigned_agent, status, created_at, last_update)
    VALUES
      ('task_dup_old', '${requestId}', 'primary', '舊主任務', '舊主任務內容', 'bizdev', 'in_progress', 1000, 2000),
      ('task_dup_new', '${requestId}', 'primary', '新主任務', '新主任務內容', 'admin', 'in_progress', 1001, 3000),
      ('task_dup_child', '${requestId}', 'sidecar_review', 'child', 'child detail', 'production', 'in_progress', 1002, 3001)
  `)
  db.exec(`
    UPDATE tasks
    SET parent_task_id = 'task_dup_old', root_task_id = 'task_dup_old', graph_depth = 1
    WHERE id = 'task_dup_child'
  `)

  const repaired = repairPrimaryTaskIntegrity(5000)
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_primary_request_unique
    ON tasks(request_id)
    WHERE request_id IS NOT NULL
      AND COALESCE(task_type, 'primary') = 'primary'
  `)

  const primaryTasks = getPrimaryTasksByRequest(requestId)
  const canonical = getTaskByRequestId(requestId)
  const superseded = db.prepare(`
    SELECT task_type, resolution_source, parent_task_id, root_task_id, status
    FROM tasks WHERE id = 'task_dup_old'
  `).get()
  const child = db.prepare(`
    SELECT parent_task_id, root_task_id
    FROM tasks WHERE id = 'task_dup_child'
  `).get()

  assert.equal(repaired.duplicateRequestCount, 1)
  assert.equal(primaryTasks.length, 1)
  assert.equal(canonical?.id, 'task_dup_new')
  assert.equal(superseded?.task_type, 'superseded_primary')
  assert.equal(superseded?.resolution_source, 'superseded')
  assert.equal(superseded?.parent_task_id, 'task_dup_new')
  assert.equal(child?.parent_task_id, 'task_dup_new')
  assert.equal(child?.root_task_id, 'task_dup_new')
})

test('updateTask can explicitly clear nullable orchestration fields', () => {
  const task = createTask({
    title: '清空欄位測試',
    detail: '測試 pendingAction / result / resolutionSource',
    assignedAgent: 'bizdev',
    taskType: 'primary',
    status: 'in_progress',
    pendingAction: 'continue_after_reply',
    result: 'stale result',
    resolutionSource: 'self',
    createdAt: Date.now(),
  })

  const updated = updateTask(task.id, {
    pendingAction: null,
    result: null,
    resolutionSource: null,
  })

  assert.equal(updated?.pendingAction, null)
  assert.equal(updated?.result, null)
  assert.equal(updated?.resolutionSource, null)
})

test('lobster brain payload shows task graph child tasks under the primary track', () => {
  const req = createRequest({
    id: 'req_graph_payload',
    content: '請直接接手並叫 reviewer',
    from: 'Boss',
    state: 'received',
    createdAt: Date.now(),
  })

  const primaryTask = createTask({
    requestId: req.id,
    title: '主任務 / 龍蝦追蹤',
    detail: '主任務內容',
    assignedAgent: 'bizdev',
    taskType: 'primary',
    sourceAgent: 'wickedman',
    status: 'in_progress',
    rootCause: '主線還缺一個可驗證根因',
    brainMode: 'execution',
    brainState: {
      summary: '主任務還在收斂',
      focus: '先把根因補齊',
      blockers: ['等待 reviewer 回報'],
    },
    createdAt: Date.now(),
    lastUpdate: Date.now(),
  })

  createTask({
    requestId: req.id,
    parentTaskId: primaryTask.id,
    rootTaskId: primaryTask.id,
    title: 'QA reviewer',
    detail: '平行驗證 UI 與流程',
    assignedAgent: 'production',
    taskType: 'sidecar_review',
    sourceAgent: 'bizdev',
    mergePolicy: 'blocking_review',
    graphDepth: 1,
    status: 'in_progress',
    brainState: {
      summary: '正在驗證風險切面',
      openLoops: ['等待補最後一個 repro'],
    },
    createdAt: Date.now() + 1,
    lastUpdate: Date.now() + 1,
  })

  createTask({
    requestId: req.id,
    parentTaskId: primaryTask.id,
    rootTaskId: primaryTask.id,
    title: '記憶蒸餾',
    detail: '整理 recurring 修法',
    assignedAgent: 'crm',
    taskType: 'memory_distill',
    sourceAgent: 'bizdev',
    mergePolicy: 'advisory',
    graphDepth: 1,
    status: 'pending',
    createdAt: Date.now() + 2,
    lastUpdate: Date.now() + 2,
  })

  const payload = buildBossInboxPayload({ skipDigest: true })
  const track = payload.lobsterBrain?.trackedTasks?.find((entry) => entry.id === primaryTask.id)

  assert.ok(track)
  assert.equal(payload.lobsterBrain?.activeTaskCount, 1)
  assert.equal(payload.lobsterBrain?.activeChildTaskCount, 2)
  assert.equal(payload.lobsterBrain?.taskGraphNodeCount, 3)
  assert.equal(track.childTaskCount, 2)
  assert.equal(track.activeChildTaskCount, 2)
  assert.equal(track.childTasks?.length, 2)
  assert.deepEqual(track.childTasks.map((entry) => entry.taskType), ['memory_distill', 'sidecar_review'])
})

test('lobster brain payload includes consensus, governance, and reusable rules', () => {
  const req = createRequest({
    id: 'req_lobster_governance',
    content: '請追根因並叫 verifier',
    from: 'Boss',
    state: 'received',
    createdAt: Date.now(),
  })

  const primaryTask = createTask({
    requestId: req.id,
    title: '高風險主任務',
    detail: '需要 verifier 與 reviewer 共識',
    assignedAgent: 'admin',
    taskType: 'primary',
    sourceAgent: 'wickedman',
    status: 'in_progress',
    riskTier: 'high',
    retryBudget: 2,
    retryCount: 1,
    escalationLevel: 2,
    humanGateReason: '需要老闆確認是否放行',
    consensus: {
      status: 'blocked',
      summary: 'reviewer 發現 blocking issue',
      blockingCount: 1,
      warningCount: 0,
      resultCount: 2,
      recommendedAction: 'fix_console_errors',
    },
    reusableMemory: {
      episodic: {
        rootCause: 'console error',
      },
      candidateRule: {
        id: 'rule_console',
        category: 'guardrail',
        status: 'canary',
        title: '避免 console error 再次出現',
        summary: '先跑 gstack verifier 再放行',
        triggerKey: 'console-error',
        confidence: 0.82,
      },
    },
    createdAt: Date.now(),
    lastUpdate: Date.now(),
  })

  createTask({
    requestId: req.id,
    parentTaskId: primaryTask.id,
    rootTaskId: primaryTask.id,
    title: 'gstack verifier',
    detail: '補 browser 驗證',
    assignedAgent: 'gstack-browse',
    taskType: 'verifier',
    sourceAgent: 'gstack',
    mergePolicy: 'blocking_review',
    graphDepth: 1,
    status: 'completed',
    consensus: {
      status: 'blocked',
      summary: 'console error still exists',
      blockingCount: 1,
      warningCount: 0,
    },
    riskTier: 'medium',
    retryBudget: 1,
    retryCount: 1,
    escalationLevel: 1,
    createdAt: Date.now() + 1,
    lastUpdate: Date.now() + 1,
  })

  upsertLobsterRule({
    category: 'guardrail',
    ruleType: 'guardrail',
    title: '避免 console error 再次出現',
    summary: '先跑 gstack verifier 再放行',
    triggerKey: 'console-error',
    confidence: 0.82,
    status: 'canary',
    successCount: 1,
    failureCount: 0,
    sourceTaskId: primaryTask.id,
    sourceRootTaskId: primaryTask.id,
    evidence: ['console error'],
    rule: { recommendedAction: 'fix_console_errors' },
  })

  const payload = buildBossInboxPayload({ skipDigest: true })
  const track = payload.lobsterBrain?.trackedTasks?.find((entry) => entry.id === primaryTask.id)

  assert.ok(track)
  assert.equal(track.riskTier, 'high')
  assert.equal(track.retryBudget, 2)
  assert.equal(track.retryCount, 1)
  assert.equal(track.escalationLevel, 2)
  assert.equal(track.humanGateReason, '需要老闆確認是否放行')
  assert.equal(track.consensus?.status, 'blocked')
  assert.equal(track.consensus?.recommendedAction, 'fix_console_errors')
  assert.equal(track.reusableRule?.status, 'canary')
  assert.equal(payload.lobsterBrain?.humanGateCount, 1)
  assert.equal(payload.lobsterBrain?.blockedConsensusCount, 1)
  assert.ok(Array.isArray(payload.reusableRules))
  assert.ok(payload.reusableRules.some((entry) => entry.triggerKey === 'console-error'))
})

test('lobster brain payload exposes research-fish operator phases and next auto steps', () => {
  const baseNow = Date.now()
  const tracks = [
    {
      requestId: 'req_research_running',
      taskId: 'task_research_running',
      title: '研究中',
      status: 'in_progress',
      lastUpdate: baseNow,
      brainState: {
        operatorMode: 'strict',
        outputContract: 'research_operator_v1',
        openLoops: ['等待第一輪研究收斂'],
      },
      delegationPlan: {
        currentStatus: 'running',
      },
    },
    {
      requestId: 'req_research_delegating',
      taskId: 'task_research_delegating',
      title: '派工中',
      status: 'in_progress',
      lastUpdate: baseNow + 10,
      brainState: {
        operatorMode: 'strict',
        outputContract: 'research_operator_v1',
        openLoops: ['等待 downstream child tasks 回報', '等待驗證結果'],
      },
      delegationPlan: {
        currentStatus: 'delegating',
        delegatedAgents: ['dev-fish', 'qa'],
        nextAutoStep: '等待 downstream child tasks 回流後自動續跑',
      },
    },
    {
      requestId: 'req_research_verifying',
      taskId: 'task_research_verifying',
      title: '驗證中',
      status: 'in_progress',
      lastUpdate: baseNow + 20,
      brainState: {
        operatorMode: 'strict',
        outputContract: 'research_operator_v1',
        openLoops: ['等待 verifier 回報'],
      },
      delegationPlan: {
        currentStatus: 'verifying',
        nextAutoStep: '等待 verifier 回流後自動續跑',
      },
    },
    {
      requestId: 'req_research_gate',
      taskId: 'task_research_gate',
      title: '等老闆拍板',
      status: 'in_progress',
      lastUpdate: baseNow + 30,
      humanGateReason: '需要老闆決定是否正式對外發布',
      brainState: {
        operatorMode: 'strict',
        outputContract: 'research_operator_v1',
        openLoops: ['等待人類 gate'],
      },
      delegationPlan: {
        currentStatus: 'waiting_human_gate',
      },
    },
  ]

  for (const entry of tracks) {
    createRequest({
      id: entry.requestId,
      content: entry.title,
      from: 'Boss',
      state: 'in_progress',
      createdAt: baseNow,
    })

    createTask({
      id: entry.taskId,
      requestId: entry.requestId,
      title: entry.title,
      detail: `${entry.title} detail`,
      assignedAgent: 'research-fish',
      taskType: 'primary',
      sourceAgent: 'main',
      status: entry.status,
      operatorMode: 'strict',
      outputContract: 'research_operator_v1',
      brainMode: 'execution',
      brainState: entry.brainState,
      delegationPlan: entry.delegationPlan,
      humanGateReason: entry.humanGateReason || null,
      createdAt: baseNow,
      lastUpdate: entry.lastUpdate,
    })
  }

  createTask({
    id: 'task_research_delegating_child',
    requestId: 'req_research_delegating',
    parentTaskId: 'task_research_delegating',
    rootTaskId: 'task_research_delegating',
    title: '跟進派工',
    detail: 'dev-fish downstream',
    assignedAgent: 'dev-fish',
    taskType: 'worker_subtask',
    sourceAgent: 'research-fish',
    status: 'in_progress',
    createdAt: baseNow + 11,
    lastUpdate: baseNow + 11,
  })

  createTask({
    id: 'task_research_verifying_child',
    requestId: 'req_research_verifying',
    parentTaskId: 'task_research_verifying',
    rootTaskId: 'task_research_verifying',
    title: '外腦驗證',
    detail: 'gstack verifier',
    assignedAgent: 'gstack-browse',
    taskType: 'verifier',
    sourceAgent: 'gstack',
    status: 'in_progress',
    createdAt: baseNow + 21,
    lastUpdate: baseNow + 21,
  })

  const payload = buildBossInboxPayload({ skipDigest: true })
  const runningTrack = payload.lobsterBrain?.trackedTasks?.find((entry) => entry.id === 'task_research_running')
  const delegatingTrack = payload.lobsterBrain?.trackedTasks?.find((entry) => entry.id === 'task_research_delegating')
  const verifyingTrack = payload.lobsterBrain?.trackedTasks?.find((entry) => entry.id === 'task_research_verifying')
  const gateTrack = payload.lobsterBrain?.trackedTasks?.find((entry) => entry.id === 'task_research_gate')

  assert.equal(runningTrack?.researchOperatorPhase, 'running_research')
  assert.equal(delegatingTrack?.researchOperatorPhase, 'delegating')
  assert.equal(verifyingTrack?.researchOperatorPhase, 'verifying')
  assert.equal(gateTrack?.researchOperatorPhase, 'waiting_human_gate')
  assert.deepEqual(delegatingTrack?.delegatedAgents, ['dev-fish', 'qa'])
  assert.equal(delegatingTrack?.nextAutoStep, '等待 downstream child tasks 回流後自動續跑')
  assert.equal(delegatingTrack?.openLoopCount, 2)
})

test('lobster brain payload separates direct user requests from manual api and background tasks', () => {
  const baseNow = Date.now()
  const fixtures = [
    {
      requestId: 'req_direct_discord',
      taskId: 'task_direct_discord',
      source: 'discord_gateway_autonomous',
      from: 'Discord',
      title: 'Discord 直接交辦',
      expectedGroup: 'direct_ingress',
      expectedLabel: 'Discord 直接交辦',
    },
    {
      requestId: 'req_direct_tg',
      taskId: 'task_direct_tg',
      source: 'telegram_webhook',
      from: 'Brian',
      title: 'Telegram 直接交辦',
      expectedGroup: 'direct_ingress',
      expectedLabel: 'Telegram 直接交辦',
    },
    {
      requestId: 'req_manual_api',
      taskId: 'task_manual_api',
      source: 'api',
      from: 'Boss',
      title: '手動建立的 API 題目',
      expectedGroup: 'manual_request',
      expectedLabel: '手動 / API 交辦',
    },
    {
      requestId: 'req_internal_api',
      taskId: 'task_internal_api',
      source: 'api',
      from: 'Office QA',
      title: 'dispatch smoke test for workflow session binding',
      expectedGroup: 'background',
      expectedLabel: '系統內部驗證',
    },
    {
      requestId: 'req_boss_inbox',
      taskId: 'task_boss_inbox',
      source: 'boss-inbox',
      from: 'Boss Inbox',
      title: '由 Boss Inbox attention 產出的跟進任務',
      expectedGroup: 'background',
      expectedLabel: 'Boss Inbox 跟進題',
    },
  ]

  for (const [index, fixture] of fixtures.entries()) {
    createRequest({
      id: fixture.requestId,
      content: fixture.title,
      from: fixture.from,
      state: 'in_progress',
      source: fixture.source,
      createdAt: baseNow + index,
    })

    createTask({
      id: fixture.taskId,
      requestId: fixture.requestId,
      title: fixture.title,
      detail: `${fixture.title} detail`,
      assignedAgent: 'research-fish',
      taskType: 'primary',
      sourceAgent: 'wickedman',
      status: 'in_progress',
      brainMode: 'execution',
      createdAt: baseNow + index,
      lastUpdate: baseNow + index,
    })
  }

  const payload = buildBossInboxPayload({ skipDigest: true })
  const lobsterBrain = payload.lobsterBrain || {}

  assert.equal(lobsterBrain.directIngressTaskCount, 2)
  assert.equal(lobsterBrain.manualRequestTaskCount, 1)
  assert.equal(lobsterBrain.backgroundTaskCount, 2)
  assert.deepEqual(
    (lobsterBrain.directIngressTracks || []).map((entry) => entry.id).sort(),
    ['task_direct_discord', 'task_direct_tg'],
  )
  assert.deepEqual(
    (lobsterBrain.manualRequestTracks || []).map((entry) => entry.id),
    ['task_manual_api'],
  )
  assert.deepEqual(
    (lobsterBrain.backgroundTracks || []).map((entry) => entry.id).sort(),
    ['task_boss_inbox', 'task_internal_api'],
  )

  for (const fixture of fixtures) {
    const track = (lobsterBrain.trackedTasks || []).find((entry) => entry.id === fixture.taskId)
    assert.ok(track)
    assert.equal(track.originGroup, fixture.expectedGroup)
    assert.equal(track.originLabel, fixture.expectedLabel)
  }
})

test('boss inbox request cards use canonical primary freshness and show human gate as blocked', () => {
  const req = createRequest({
    id: 'req_canonical_request_item',
    content: '這題應該顯示 canonical primary 的狀態',
    from: 'Boss',
    state: 'in_progress',
    createdAt: Date.now(),
  })

  const primaryTask = ensurePrimaryTask(req.id, {
    title: '主任務 / 等老闆拍板',
    detail: '主任務 detail',
    assignedAgent: 'admin',
    status: 'in_progress',
    riskTier: 'high',
    humanGateReason: '已達 retry budget，先停在老闆面前。',
    consensus: {
      status: 'blocked',
      summary: 'reviewer 發現 blocking issue',
      blockingCount: 1,
      warningCount: 0,
    },
    brainState: {
      blockers: ['等待人工確認'],
    },
    createdAt: Date.now(),
    lastUpdate: Date.now() + 5000,
  })

  createTask({
    requestId: req.id,
    parentTaskId: primaryTask.id,
    rootTaskId: primaryTask.id,
    title: '更新較新的 child reviewer',
    detail: 'child detail',
    assignedAgent: 'production',
    taskType: 'sidecar_review',
    sourceAgent: 'admin',
    mergePolicy: 'blocking_review',
    graphDepth: 1,
    status: 'completed',
    createdAt: Date.now() + 6000,
    lastUpdate: Date.now() + 6000,
    completedAt: Date.now() + 6000,
  })

  const payload = buildBossInboxPayload({ skipDigest: true })
  const item = payload.attentionItems.find((entry) => entry.id === req.id)

  assert.ok(item)
  assert.equal(item.linkedTaskId, primaryTask.id)
  assert.equal(item.attentionType, 'blocked')
  assert.equal(item.workflowPhase, 'waiting_human_gate')
  assert.equal(item.humanGateReason, '已達 retry budget，先停在老闆面前。')
  assert.ok(Number(item.updatedAt || 0) >= Number(primaryTask.lastUpdate || 0))
})

test('waiting reviewer stays digest_only instead of surfacing as blocked attention', () => {
  const req = createRequest({
    id: 'req_waiting_reviewer_digest',
    content: '這題正在等 reviewer，不應該直接炸 blocked',
    from: 'Boss',
    state: 'in_progress',
    createdAt: Date.now(),
  })

  const primaryTask = ensurePrimaryTask(req.id, {
    title: '主任務 / 等 reviewer',
    detail: '先等 reviewer 回來再說',
    assignedAgent: 'admin',
    status: 'in_progress',
    riskTier: 'high',
    retryCount: 2,
    retryBudget: 2,
    pendingAction: 'continue_after_reply',
    humanGateReason: '已達 retry budget，先停下來讓老闆決定。',
    consensus: {
      status: 'pending_review',
      summary: '目前還沒有 reviewer / verifier 結果。',
      blockingCount: 0,
      warningCount: 0,
    },
    brainState: {
      blockers: [],
      openLoops: ['等待 reviewer / verifier 結果'],
    },
    createdAt: Date.now(),
    lastUpdate: Date.now() + 5000,
  })

  createTask({
    requestId: req.id,
    parentTaskId: primaryTask.id,
    rootTaskId: primaryTask.id,
    title: '進行中的 reviewer',
    detail: 'reviewer 正在背景檢查',
    assignedAgent: 'production',
    taskType: 'sidecar_review',
    sourceAgent: 'admin',
    mergePolicy: 'blocking_review',
    graphDepth: 1,
    status: 'in_progress',
    createdAt: Date.now() + 6000,
    lastUpdate: Date.now() + 6000,
  })

  const payload = buildBossInboxPayload({ skipDigest: true })
  const item = payload.attentionItems.find((entry) => entry.id === req.id)

  assert.ok(item)
  assert.equal(item.workflowPhase, 'waiting_reviewer')
  assert.equal(item.attentionType, 'digest_only')
  assert.equal(item.unresolved, true)
})

test('root maintenance reports surface a single maintenance attention card when issues exist', () => {
  writeMaintenanceReports({
    hygiene: {
      generatedAt: new Date().toISOString(),
      root: tempRoot,
      status: 'issues',
      issues: {
        unexpectedRootFiles: ['loose-note.md'],
        uncoveredTopLevelDirectories: ['mystery-dir'],
        missingReadmes: ['tmp'],
      },
      reportPath: join(maintenanceReportsDir, 'latest-root-hygiene.json'),
    },
    cleanup: {
      generatedAt: new Date().toISOString(),
      root: tempRoot,
      summary: {
        candidateCount: 3,
        candidateBytes: 4096,
        candidateSizeHuman: '4.0KB',
        byZone: {
          tmp: { count: 3, sizeBytes: 4096, sizeHuman: '4.0KB' },
        },
      },
      candidates: [],
      reportPath: join(maintenanceReportsDir, 'latest-root-maintenance.json'),
    },
  })

  const payload = buildBossInboxPayload({ skipDigest: true })
  const item = payload.attentionItems.find((entry) => entry.id === 'maintenance:root-workspace')

  assert.ok(item)
  assert.equal(item.source, 'maintenance')
  assert.equal(item.agentId, 'admin')
  assert.equal(item.attentionType, 'risk')
  assert.equal(item.hygieneIssueCount, 3)
  assert.equal(item.cleanupCandidateCount, 3)
  assert.equal(payload.governanceSummary?.rootMaintenanceStatus, 'issues')
  assert.equal(payload.governanceSummary?.rootHygieneIssueCount, 3)
  assert.equal(payload.governanceSummary?.rootCleanupCandidateCount, 3)
  assert.equal(payload.governanceSummary?.copilotRouteStatus, 'ok')
  assert.ok(payload.rootMaintenance?.reportPaths?.hygiene)
  assert.ok(payload.rootMaintenance?.reportPaths?.route)
})

test('clean root maintenance reports do not create maintenance attention cards', () => {
  writeMaintenanceReports()

  const payload = buildBossInboxPayload({ skipDigest: true })
  const item = payload.attentionItems.find((entry) => entry.id === 'maintenance:root-workspace')

  assert.equal(item, undefined)
  assert.equal(payload.governanceSummary?.rootMaintenanceStatus, 'clean')
  assert.equal(payload.governanceSummary?.rootCleanupCandidateCount, 0)
  assert.equal(payload.governanceSummary?.copilotRouteStatus, 'ok')
})

test('maintenance attention state auto-resolves once reports return clean', () => {
  writeMaintenanceReports({
    hygiene: {
      generatedAt: new Date().toISOString(),
      root: tempRoot,
      status: 'issues',
      issues: {
        unexpectedRootFiles: ['loose-note.md'],
        uncoveredTopLevelDirectories: [],
        missingReadmes: [],
      },
      reportPath: join(maintenanceReportsDir, 'latest-root-hygiene.json'),
    },
  })
  let payload = buildBossInboxPayload({ skipDigest: true })
  assert.ok(payload.attentionItems.find((entry) => entry.id === 'maintenance:root-workspace'))

  writeMaintenanceReports()
  payload = buildBossInboxPayload({ skipDigest: true })

  assert.equal(payload.governanceSummary?.rootMaintenanceStatus, 'clean')
  assert.equal(payload.attentionItems.find((entry) => entry.id === 'maintenance:root-workspace'), undefined)
})

test('stale root maintenance reports are surfaced as a maintenance risk card', () => {
  const staleAt = new Date(Date.now() - (48 * 60 * 60 * 1000)).toISOString()
  writeMaintenanceReports({
    hygiene: {
      generatedAt: staleAt,
      root: tempRoot,
      status: 'clean',
      issues: {
        unexpectedRootFiles: [],
        uncoveredTopLevelDirectories: [],
        missingReadmes: [],
      },
      reportPath: join(maintenanceReportsDir, 'latest-root-hygiene.json'),
    },
    cleanup: {
      generatedAt: staleAt,
      root: tempRoot,
      summary: {
        candidateCount: 0,
        candidateBytes: 0,
        candidateSizeHuman: '0B',
        byZone: {},
      },
      candidates: [],
      reportPath: join(maintenanceReportsDir, 'latest-root-maintenance.json'),
    },
  })

  const payload = buildBossInboxPayload({ skipDigest: true })
  const item = payload.attentionItems.find((entry) => entry.id === 'maintenance:root-workspace')

  assert.ok(item)
  assert.equal(item.attentionType, 'risk')
  assert.equal(item.escalationReason, 'maintenance-stale')
  assert.equal(payload.governanceSummary?.rootMaintenanceStatus, 'stale')
})

test('copilot route degradation is folded into the maintenance attention card', () => {
  writeMaintenanceReports({
    route: {
      generatedAt: new Date().toISOString(),
      hostname: 'copilot.bw-space.com',
      tunnel: 'openclaw',
      status: 'degraded',
      configPath: join(tempRoot, '.cloudflared', 'config.yml'),
      configUpdated: 0,
      launchdStatus: 'unchanged',
      dockerPublicStatus: 'ok',
      strayCloudflaredCount: 1,
      localHealth: 'ok',
      publicHealth: 'ok',
      publicBossInbox: 'failed',
      reportPath: join(maintenanceReportsDir, 'latest-copilot-route.json'),
    },
  })

  const payload = buildBossInboxPayload({ skipDigest: true })
  const item = payload.attentionItems.find((entry) => entry.id === 'maintenance:root-workspace')

  assert.ok(item)
  assert.equal(item.attentionType, 'risk')
  assert.equal(item.escalationReason, 'copilot-route')
  assert.equal(item.copilotRouteStatus, 'degraded')
  assert.equal(item.copilotRouteDegraded, true)
  assert.ok(item.categories.includes('copilot-route'))
  assert.equal(payload.governanceSummary?.copilotRouteStatus, 'degraded')
  assert.equal(payload.governanceSummary?.copilotRouteDegraded, true)
})

test('maintenance reports fall back to office data mirror when root artifacts are unavailable', () => {
  writeMaintenanceReports({
    cleanup: {
      generatedAt: new Date().toISOString(),
      root: tempRoot,
      summary: {
        candidateCount: 2,
        candidateBytes: 2048,
        candidateSizeHuman: '2.0KB',
        byZone: {
          tmp: { count: 2, sizeBytes: 2048, sizeHuman: '2.0KB' },
        },
      },
      candidates: [],
      reportPath: join(officeMirrorReportsDir, 'latest-root-maintenance.json'),
    },
    reportDir: [officeMirrorReportsDir],
  })

  const payload = buildBossInboxPayload({ skipDigest: true })
  const item = payload.attentionItems.find((entry) => entry.id === 'maintenance:root-workspace')

  assert.ok(item)
  assert.equal(item.cleanupCandidateCount, 2)
  assert.ok(String(payload.rootMaintenance?.reportPaths?.cleanup || '').includes('office-data/maintenance-reports'))
})

test('daily digest is generated as a boss brief and stored with structured sections', () => {
  const request = createRequest({
    id: 'req_digest',
    content: '請今天拍板是否要對重要客戶送出升級方案。',
    from: 'Boss',
    state: 'assigned',
    assignedTo: 'bizdev',
    attentionType: 'decision',
    needsDecision: true,
    priority: 88,
    estimatedValue: 120000,
    createdAt: Date.now(),
  })

  createTask({
    id: 'task_digest',
    requestId: request.id,
    title: '重要客戶升級方案',
    detail: request.content,
    assignedAgent: 'bizdev',
    status: 'assigned',
    attentionType: 'opportunity',
    priority: 72,
    estimatedValue: 120000,
    createdAt: Date.now(),
  })

  const digest = ensureDailyDigest({ force: true })
  const stored = getDailyDigestByDate(digest.date)

  assert.ok(digest.content.includes('老闆晚間摘要'))
  assert.ok(digest.content.includes('你需要做的事'))
  assert.ok(stored)
  assert.equal(stored.date, digest.date)
  assert.equal(stored.content, digest.content)
  assert.equal(stored.summary.unresolvedCounts.decision, 1)
  assert.equal(stored.headline, stored.summary.headline)
  assert.equal(stored.sections[0].id, 'decision')
  assert.equal(stored.sections[0].items[0].agentId, 'bizdev')
  assert.equal(stored.deliveryChannel, 'discord')
})

test('quiet day digest stays short and excludes legacy KPI rows', () => {
  const digest = ensureDailyDigest({ force: true })

  assert.equal(digest.quietDay, true)
  assert.ok(digest.content.includes('今天無待拍板與阻塞'))
  assert.ok(!digest.content.includes('行程'))
  assert.ok(!digest.content.includes('真實腳本'))
  assert.deepEqual(digest.sections, [])
  assert.ok(['pending', 'not-configured', 'delivered'].includes(digest.deliveryStatus))
  assert.equal(digest.summary.deliveryStatus, digest.deliveryStatus)
})

test('technical anomalies only appear when audit or cron failures are present', () => {
  writeAuditEnv({
    AUTOMATION_PLACEHOLDER: 2,
    AUTOMATION_GATED: 1,
    AUTOMATION_CORE_READY: 6,
    AUTOMATION_CORE_TOTAL: 8,
  })
  writeCronJobs([
    {
      id: 'daily-admin-preview',
      enabled: true,
      agentId: 'admin',
      state: {
        lastStatus: 'error',
        consecutiveErrors: 1,
        lastError: 'Preview generation timed out',
      },
    },
  ])

  const digest = ensureDailyDigest({ force: true })
  const anomalyLabels = digest.anomalies.map((entry) => entry.label)

  assert.equal(digest.quietDay, false)
  assert.ok(anomalyLabels.includes('假技能'))
  assert.ok(anomalyLabels.includes('待配置'))
  assert.ok(anomalyLabels.includes('核心管線'))
  assert.ok(anomalyLabels.includes('Cron 失敗'))
  assert.ok(digest.content.includes('系統異常附錄'))
})

test('attention snooze and owner assignment update governance summary', () => {
  const request = createRequest({
    id: 'req_snooze',
    content: '請先處理 blocked issue',
    from: 'Boss',
    state: 'assigned',
    assignedTo: 'bizdev',
    attentionType: 'blocked',
    priority: 90,
    createdAt: Date.now(),
  })

  createTask({
    id: 'task_snooze',
    requestId: request.id,
    title: 'Blocked issue',
    detail: request.content,
    assignedAgent: 'bizdev',
    status: 'assigned',
    attentionType: 'blocked',
    priority: 90,
    createdAt: Date.now(),
  })

  runAttentionAction('req_snooze', { action: 'set_owner', owner: 'admin', reviewer: 'test-suite' })
  runAttentionAction('req_snooze', { action: 'snooze', snoozeHours: 24, reviewer: 'test-suite' })

  const payload = buildBossInboxPayload({ skipDigest: true })
  const item = payload.attentionItems.find((entry) => entry.id === 'req_snooze')
  assert.equal(item?.assignedOwner, 'admin')
  assert.equal(item?.unresolved, false)
  assert.ok((payload.governanceSummary?.snoozedCount || 0) >= 1)
})

test('attentionActionHints learns from historical action outcomes and exposes expectedSuccess', () => {
  const now = Date.now()
  upsertAttentionState({
    id: 'hint_seed_success',
    source: 'evolution',
    agentId: 'bizdev',
    attentionType: 'blocked',
    status: 'open',
    signalCount: 2,
    signalScoreMax: 90,
    categories: ['delivery-flow'],
    actionHistory: [{ action: 'create_task', at: now - 3000 }],
    didImproveScore: 0.7,
    lastFeedbackAt: now - 2000,
    firstSeenAt: now - 5000,
    lastSeenAt: now - 2000,
    updatedAt: now - 1000,
  })
  upsertAttentionState({
    id: 'hint_seed_fail',
    source: 'evolution',
    agentId: 'seo',
    attentionType: 'blocked',
    status: 'open',
    signalCount: 2,
    signalScoreMax: 88,
    categories: ['delivery-flow'],
    actionHistory: [{ action: 'acknowledge', at: now - 3000 }],
    didImproveScore: -0.6,
    rollbackNeeded: true,
    lastFeedbackAt: now - 2000,
    firstSeenAt: now - 5000,
    lastSeenAt: now - 2000,
    updatedAt: now - 1000,
  })
  upsertAttentionState({
    id: 'hint_target',
    source: 'evolution',
    agentId: 'bizdev',
    attentionType: 'blocked',
    status: 'open',
    signalCount: 1,
    signalScoreMax: 86,
    categories: ['delivery-flow'],
    firstSeenAt: now - 1000,
    lastSeenAt: now - 500,
    updatedAt: now,
  })

  const payload = buildBossInboxPayload({ skipDigest: true })
  const targetHint = payload.attentionActionHints?.hint_target
  assert.ok(targetHint)
  assert.equal(targetHint.suggestedAction, 'create_task')
  assert.ok(Number.isFinite(targetHint.expectedSuccess))
  assert.ok(targetHint.expectedSuccess > 0.5)
  assert.ok(Object.prototype.hasOwnProperty.call(payload.governanceSummary || {}, 'canaryOpenCount'))
  assert.ok(Object.prototype.hasOwnProperty.call(payload.governanceSummary || {}, 'autoApplySuccessRate7d'))
  assert.ok(Object.prototype.hasOwnProperty.call(payload.governanceSummary || {}, 'autonomyLevel'))
  assert.ok(Object.prototype.hasOwnProperty.call(payload.governanceSummary || {}, 'autoApproveReadyCount'))
  assert.ok(Object.prototype.hasOwnProperty.call(payload.governanceSummary || {}, 'openCriticalAttentionCount'))
  assert.ok(Object.prototype.hasOwnProperty.call(payload || {}, 'autonomyUpgradeAdvice'))
  assert.ok(['hold', 'upgrade', 'downgrade'].includes(payload.autonomyUpgradeAdvice?.direction))
})

test('attentionActionHints maps to valid front-end actions and respects state', () => {
  const now = Date.now()
  const openNoTaskId = 'req_hint_open_notask'
  createRequest({
    id: openNoTaskId,
    content: 'blocked: 找不到權限，請先處理同步中斷',
    from: 'Boss',
    state: 'assigned',
    assignedTo: 'bizdev',
    attentionType: 'blocked',
    needsDecision: false,
    priority: 90,
  })

  const openWithTaskId = 'req_hint_open_with_task'
  createRequest({
    id: openWithTaskId,
    content: 'risk: 付款流程等待核對中',
    from: 'Boss',
    state: 'assigned',
    assignedTo: 'finance-company',
    attentionType: 'risk',
    needsDecision: false,
    priority: 85,
  })
  createTask({
    id: 'task_hint_with_task',
    requestId: openWithTaskId,
    title: '付款核對',
    detail: '確認付款資料',
    assignedAgent: 'admin',
    status: 'completed',
    attentionType: 'risk',
    priority: 85,
    createdAt: now - (2 * 24 * 60 * 60 * 1000),
    completedAt: now - (18 * 60 * 60 * 1000),
  })

  const resolvedByActionId = 'req_hint_resolved'
  createRequest({
    id: resolvedByActionId,
    content: 'decision: 該用哪個文案方向',
    from: 'Boss',
    state: 'assigned',
    assignedTo: 'seo',
    attentionType: 'decision',
    needsDecision: true,
    priority: 70,
  })
  upsertAttentionState({
    id: resolvedByActionId,
    source: 'evolution',
    agentId: 'seo',
    attentionType: 'decision',
    status: 'resolved',
    signalCount: 1,
    signalScoreMax: 78,
    categories: ['copy'],
    updatedAt: now - 1000,
  })

  const payload = buildBossInboxPayload({ skipDigest: true })
  const openNoTaskHint = payload.attentionActionHints?.[openNoTaskId]
  const openWithTaskHint = payload.attentionActionHints?.[openWithTaskId]
  const resolvedHint = payload.attentionActionHints?.[resolvedByActionId]

  assert.ok(openNoTaskHint)
  assert.equal(openNoTaskHint.suggestedAction, 'create_task')
  assert.ok(Number.isFinite(openNoTaskHint.expectedSuccess))
  assert.equal(openNoTaskHint.shouldBlock, true)
  assert.ok(openWithTaskHint)
  assert.ok(['acknowledge', 'resolve'].includes(openWithTaskHint.suggestedAction))
  assert.equal(openWithTaskHint.shouldBlock, true)
  assert.ok(resolvedHint)
  assert.equal(resolvedHint.suggestedAction, 'reopen')
  assert.equal(resolvedHint.shouldBlock, false)
})

test('attentionActionHints includes action score ladder for deterministic default action', () => {
  const now = Date.now()
  const targetId = 'req_hint_scores'
  createRequest({
    id: targetId,
    content: 'decision: 明天要不要開啟A/B測試',
    from: 'Boss',
    state: 'assigned',
    assignedTo: 'admin',
    attentionType: 'decision',
    needsDecision: true,
    priority: 72,
    createdAt: now,
  })

  const payload = buildBossInboxPayload({ skipDigest: true })
  const hint = payload.attentionActionHints?.[targetId]

  assert.ok(Array.isArray(hint?.actionScores), 'expected actionScores array')
  assert.ok(hint.actionScores.length >= 2)
  assert.equal(hint.actionScores[0]?.action, 'create_task')
  assert.ok(
    hint.actionScores.every((entry, index, list) => index === 0 || Number(entry?.score || 0) <= Number(list[index - 1]?.score || 0)),
    'action scores should be ordered descending'
  )
  assert.ok(Number.isFinite(hint.expectedSuccess))
})
