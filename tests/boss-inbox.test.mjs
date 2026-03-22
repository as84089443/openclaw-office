import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tempRoot = mkdtempSync(join(tmpdir(), 'openclaw-boss-inbox-'))
const cronDir = join(tempRoot, 'cron')
const agentSystemLogsDir = join(tempRoot, 'workspace', 'agent-system', 'logs')
mkdirSync(cronDir, { recursive: true })
mkdirSync(agentSystemLogsDir, { recursive: true })

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
  ],
}

writeFileSync(join(tempRoot, 'openclaw.json'), JSON.stringify(openclawConfig, null, 2))
writeFileSync(join(cronDir, 'jobs.json'), JSON.stringify({ jobs: [] }, null, 2))

process.env.OPENCLAW_HOME = tempRoot
process.env.OPENCLAW_CONFIG_PATH = join(tempRoot, 'openclaw.json')
process.env.OPENCLAW_OFFICE_DB_PATH = join(tempRoot, 'office.db')

const { db, createRequest, createTask, getDailyDigestByDate, upsertAttentionState } = await import('../lib/db.js')
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

test.beforeEach(() => {
  resetDb()
  writeCronJobs([])
  writeAuditEnv()
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
  ])
  const payload = buildBossInboxPayload({ skipDigest: true })
  const rosterCount = getAgentsList().length

  assert.equal(rosterCount, openclawConfig.agents.list.length)
  assert.equal(payload.agentSummaries.length, openclawConfig.agents.list.length)
  assert.ok(payload.agentSummaries.length > 5)
  assert.ok(payload.activeAgentSummaries.some((entry) => entry.id === 'bizdev'))
  assert.ok(payload.inactiveAgentSummaries.some((entry) => entry.id === 'seo'))
  assert.equal(payload.activeAgentSummaries.find((entry) => entry.id === 'bizdev')?.activityState, 'active')
  assert.equal(payload.inactiveAgentSummaries.find((entry) => entry.id === 'seo')?.activityState, 'inactive')
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
        consecutiveErrors: 3,
        lastError: 'Permission denied while syncing invoices',
        lastRunAtMs: Date.now(),
      },
    },
  ])

  const payload = buildBossInboxPayload({ skipDigest: true })
  const item = payload.attentionItems.find((entry) => entry.id === 'cron:nightly-sync')

  assert.ok(item)
  assert.equal(item.attentionType, 'risk')
  assert.equal(item.agentId, 'finance-company')
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
