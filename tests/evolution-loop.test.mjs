import test from 'node:test'
import assert from 'node:assert/strict'
import { appendFileSync, mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tempRoot = mkdtempSync(join(tmpdir(), 'openclaw-evolution-'))
const cronDir = join(tempRoot, 'cron')
const runsDir = join(cronDir, 'runs')
const officeDir = join(tempRoot, 'office')
const adminWorkspace = join(tempRoot, 'workspace-admin')
const seoWorkspace = join(tempRoot, 'workspace-seo')
const bizdevWorkspace = join(tempRoot, 'workspace-bizdev')
const agentSystemDir = join(tempRoot, 'workspace', 'agent-system')
const pendingDir = join(agentSystemDir, 'evolution-pending')

for (const dir of [cronDir, runsDir, officeDir, adminWorkspace, seoWorkspace, bizdevWorkspace, pendingDir]) {
  mkdirSync(dir, { recursive: true })
}

for (const workspace of [adminWorkspace, seoWorkspace, bizdevWorkspace]) {
  mkdirSync(join(workspace, '.learnings'), { recursive: true })
  mkdirSync(join(workspace, 'memory'), { recursive: true })
  writeFileSync(join(workspace, 'HEARTBEAT.md'), 'last_seen: 2026-03-13 08:00\n')
  writeFileSync(join(workspace, 'SYSTEM_PROMPT.md'), '# SYSTEM_PROMPT\n\nBase instruction.\n')
}

const openclawConfig = {
  agents: {
    list: [
      { id: 'admin', workspace: adminWorkspace, identity: { name: '八爪魚管', emoji: '🐙' } },
      { id: 'seo', workspace: seoWorkspace, identity: { name: '藍鯨SEO', emoji: '🐋' } },
      { id: 'bizdev', workspace: bizdevWorkspace, identity: { name: '鯊魚業務', emoji: '🦈' } },
    ],
  },
  bindings: [],
}

writeFileSync(join(tempRoot, 'openclaw.json'), JSON.stringify(openclawConfig, null, 2))
writeFileSync(join(cronDir, 'jobs.json'), JSON.stringify({
  jobs: [
    {
      id: 'seo-daily',
      agentId: 'seo',
      enabled: true,
      name: 'seo-article-daily',
      createdAtMs: Date.now() - 4 * 60 * 60 * 1000,
      updatedAtMs: Date.now() - 30 * 60 * 1000,
      evolutionBaselineAtMs: Date.now() - 3 * 60 * 60 * 1000,
      payload: { kind: 'agentTurn', message: 'run seo' },
      delivery: { channel: 'discord' },
    },
    {
      id: 'bizdev-daily',
      agentId: 'bizdev',
      enabled: true,
      name: 'bizdev-search-daily',
      createdAtMs: Date.now() - 5 * 60 * 60 * 1000,
      updatedAtMs: Date.now() - 25 * 60 * 1000,
      evolutionBaselineAtMs: Date.now() - 3 * 60 * 60 * 1000,
      payload: { kind: 'agentTurn', message: 'run bizdev' },
      delivery: { channel: 'discord' },
    },
  ],
}, null, 2))

writeFileSync(join(runsDir, 'seo-daily.jsonl'), [
  JSON.stringify({
    jobId: 'seo-daily',
    action: 'finished',
    status: 'ok',
    runAtMs: Date.now() - 2 * 60 * 60 * 1000,
    summary: [
      '今日推進',
      '- 今日主題：活動攝影／商業攝影報價與選擇指南',
      '你現在要看',
      '- 先打高意圖報價與怎麼選題群，這批最接近詢價。',
      '卡點 / 風險',
      '- 若 CTA 與來源追蹤沒補上，流量不會變成名單。',
      '下一步',
      '- 先發 3 篇報價 / 怎麼選 / checklist 文章並補 CTA。',
      '今天學到',
      '- 高意圖題群比器材流量詞更接近成交。',
      '下一輪要試',
      '- 測試報價文 + checklist 的內鏈組合是否提高詢價品質。',
    ].join('\n'),
  }),
  JSON.stringify({
    jobId: 'seo-daily',
    action: 'finished',
    status: 'ok',
    runAtMs: Date.now() - 70 * 60 * 1000,
    summary: [
      '今日推進',
      '- 今天確認報價內容應優先支援接單頁。',
      '你現在要看',
      '- 高意圖主題群仍是最值得先打的 SEO 面向。',
      '卡點 / 風險',
      '- 若沒補 CTA 與來源回填，無法驗證轉換。',
      '下一步',
      '- 先補來源別與 CTA 再擴寫第二批。',
      '今天學到',
      '- 商業意圖比泛流量更值得優先投資。',
      '下一輪要試',
      '- 測試報價 / 比較 / checklist 的 cluster 組合。',
    ].join('\n'),
  }),
].join('\n') + '\n')

writeFileSync(join(runsDir, 'bizdev-daily.jsonl'), [
  JSON.stringify({
    jobId: 'bizdev-daily',
    action: 'finished',
    status: 'ok',
    runAtMs: Date.now() - 90 * 60 * 1000,
    summary: [
      '狀態',
      '- 今天沒有可直接發送的 CRM 名單。',
      '缺什麼',
      '- 缺來源別與最近交件紀錄，無法判斷最值得先追誰。',
      '誰要補',
      '- Brian 或 crm 要補回購名單與最近交件結果。',
      '補完後我下一輪會做什麼',
      '- 我會先挑 1 位最值得追的舊客，直接寫出下一封跟進訊息。',
      '今天學到',
      '- 沒有來源別與交件資料時，回購優先序會失真。',
    ].join('\n'),
  }),
  JSON.stringify({
    jobId: 'bizdev-daily',
    action: 'finished',
    status: 'ok',
    runAtMs: Date.now() - 80 * 60 * 1000,
    summary: [
      '狀態',
      '- 今天仍缺可直接跟進的回購名單。',
      '缺什麼',
      '- 缺來源別與最近交件紀錄，無法判斷今天最值得先追誰。',
      '誰要補',
      '- Brian 或 crm 要補回購名單與最近交件結果。',
      '補完後我下一輪會做什麼',
      '- 我會先挑 1 位最值得追的舊客，直接寫出下一封跟進訊息。',
      '今天學到',
      '- 沒有來源別與交件資料時，回購優先序會持續失真。',
    ].join('\n'),
  }),
].join('\n') + '\n')

process.env.OPENCLAW_HOME = tempRoot
process.env.OPENCLAW_CONFIG_PATH = join(tempRoot, 'openclaw.json')
process.env.OPENCLAW_OFFICE_DB_PATH = join(officeDir, 'office.db')
process.chdir(officeDir)

const { applyCandidatePatch, buildEvolutionAttentionItems, buildEvolutionSnapshot, getCandidatePatchById, reviewCandidatePatch, runNightlyEvolutionPromotion, syncEvolutionArtifacts, unapplyCandidatePatch } = await import('../lib/evolution.js')
const { getAttentionStateById, getRequestById, getTaskById } = await import('../lib/db.js')
const { buildBossInboxPayload, recordAttentionTaskFeedback, runAttentionAction } = await import('../lib/boss-inbox.js')
const { reloadConfig } = await import('../lib/config.js')

reloadConfig()

function restoreEnv(key, value) {
  if (value === undefined || value === null) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

test('syncEvolutionArtifacts writes events, learnings, and heartbeat state per active fish', () => {
  const result = syncEvolutionArtifacts({ now: Date.now() })
  assert.equal(result.processedRuns, 4)

  const seoEventsPath = join(seoWorkspace, '.learnings', 'events.jsonl')
  const seoHeartbeatStatePath = join(seoWorkspace, 'memory', 'heartbeat-state.json')
  const seoLearningsPath = join(seoWorkspace, '.learnings', 'LEARNINGS.md')

  assert.ok(existsSync(seoEventsPath))
  assert.ok(existsSync(seoHeartbeatStatePath))
  assert.ok(existsSync(seoLearningsPath))

  const firstEvent = JSON.parse(readFileSync(seoEventsPath, 'utf8').trim().split('\n')[0])
  assert.equal(firstEvent.agentId, 'seo')
  assert.equal(firstEvent.format, 'hard')
  assert.equal(firstEvent.qualityRegression, false)
  assert.ok(firstEvent.commercialSignal.score >= 50)
  assert.equal(firstEvent.commercialSignal.category, 'high-intent-conversion')

  const bizdevEvent = JSON.parse(readFileSync(join(bizdevWorkspace, '.learnings', 'events.jsonl'), 'utf8').trim().split('\n')[0])
  assert.equal(bizdevEvent.format, 'short')
  assert.equal(bizdevEvent.qualityRegression, false)
  assert.ok(bizdevEvent.nextTests[0].includes('最值得追'))
})

test('runNightlyEvolutionPromotion generates candidate patches and promoted knowledge from repeated evidence', () => {
  const result = runNightlyEvolutionPromotion({ now: Date.now() })

  assert.ok(result.candidatePatches.length >= 2)
  assert.ok(result.promotedPatterns.length >= 1)
  assert.ok(existsSync(join(agentSystemDir, 'evolution-reviewed')))
  const seoCandidate = result.candidatePatches.find((entry) => entry.agentId === 'seo')
  assert.equal(seoCandidate?.recurrence, 2)
  assert.equal(new Set(seoCandidate?.evidenceRefs || []).size, 2)
  assert.equal(seoCandidate?.candidateKind, 'recurring')
  assert.ok(Array.isArray(seoCandidate?.prereqChecks))
  assert.ok(typeof seoCandidate?.dryRunSummary === 'string' && seoCandidate.dryRunSummary.length > 0)
  assert.ok(['ready', 'needs_canary', 'blocked_by_missing_guard'].includes(seoCandidate?.evolutionStatus))

  const snapshot = buildEvolutionSnapshot({ now: Date.now() })
  assert.ok(snapshot.growthSignals.some((entry) => entry.agentId === 'seo'))
  assert.ok(snapshot.candidatePatches.some((entry) => entry.agentId === 'seo'))
  assert.equal(snapshot.agentEvolutionStatus.find((entry) => entry.agentId === 'seo')?.activityState, 'active')
  assert.equal(snapshot.agentEvolutionStatus.find((entry) => entry.agentId === 'bizdev')?.activityState, 'active')

  const evolutionAttention = buildEvolutionAttentionItems({ now: Date.now(), snapshot })
  assert.ok(evolutionAttention.some((entry) => entry.agentId === 'seo' && entry.attentionType === 'opportunity'))
  assert.ok(evolutionAttention.some((entry) => entry.agentId === 'bizdev' && entry.attentionType === 'blocked'))

  const knowledgeBase = readFileSync(join(agentSystemDir, 'AI_KNOWLEDGE_BASE.md'), 'utf8')
  assert.ok(knowledgeBase.includes('Promoted Rules'))
  assert.ok(knowledgeBase.includes('來源：workspace-*/.learnings/events.jsonl'))

  const candidateFiles = readFileSync(join(pendingDir, readdirSync(pendingDir).find((name) => name.endsWith('.json'))), 'utf8')
  assert.ok(candidateFiles.includes('"reviewStatus": "pending"'))

  const approved = reviewCandidatePatch({
    id: seoCandidate.id,
    reviewStatus: 'approved',
    reviewer: 'test-suite',
    reviewNote: 'looks good',
  })
  assert.equal(approved?.reviewStatus, 'approved')
  assert.equal(approved?.reviewedBy, 'test-suite')
  assert.ok(approved?.reviewArtifactPath)
  assert.ok(existsSync(approved.reviewArtifactPath))
  assert.equal(approved?.autoApplyEligible, true)

  const applied = applyCandidatePatch({
    id: seoCandidate.id,
    applier: 'test-suite',
  })
  assert.equal(applied?.applyStatus, 'applied')
  assert.equal(applied?.appliedBy, 'test-suite')
  const seoPrompt = readFileSync(join(seoWorkspace, 'SYSTEM_PROMPT.md'), 'utf8')
  assert.ok(seoPrompt.includes(`OPENCLAW_EVOLUTION_APPLY:START ${seoCandidate.id}`))
  assert.ok(seoPrompt.includes('Approved Evolution Patch'))
  const appliedArtifact = readFileSync(approved.reviewArtifactPath, 'utf8')
  assert.ok(appliedArtifact.includes('- applyStatus: applied'))
  assert.ok(appliedArtifact.includes('- appliedBy: test-suite'))

  const rolledBack = unapplyCandidatePatch({
    id: seoCandidate.id,
    applier: 'test-suite',
  })
  assert.equal(rolledBack?.applyStatus, 'rolled_back')
  assert.equal(rolledBack?.unappliedBy, 'test-suite')
  const seoPromptAfterRollback = readFileSync(join(seoWorkspace, 'SYSTEM_PROMPT.md'), 'utf8')
  assert.ok(!seoPromptAfterRollback.includes(`OPENCLAW_EVOLUTION_APPLY:START ${seoCandidate.id}`))
  const rolledBackArtifact = readFileSync(approved.reviewArtifactPath, 'utf8')
  assert.ok(rolledBackArtifact.includes('- applyStatus: rolled_back'))
  assert.ok(rolledBackArtifact.includes('- unappliedBy: test-suite'))

  const rerun = runNightlyEvolutionPromotion({ now: Date.now() + 1000 })
  const persistedSeoCandidate = rerun.candidatePatches.find((entry) => entry.id === seoCandidate.id)
  assert.equal(persistedSeoCandidate?.reviewStatus, 'approved')
  assert.equal(persistedSeoCandidate?.reviewArtifactPath, approved.reviewArtifactPath)
  assert.equal(persistedSeoCandidate?.applyStatus, 'rolled_back')
  assert.equal(persistedSeoCandidate?.unappliedBy, 'test-suite')
})

test('boss inbox keeps one evolution card per agent/type and can convert it into a linked workflow task', () => {
  syncEvolutionArtifacts({ now: Date.now() })

  const initialPayload = buildBossInboxPayload({ skipDigest: true })
  const seoOpportunity = initialPayload.attentionItems.find((entry) => entry.id === 'evolution:opportunity:seo')
  const bizdevBlocked = initialPayload.attentionItems.find((entry) => entry.id === 'evolution:blocked:bizdev')

  assert.ok(seoOpportunity)
  assert.ok(bizdevBlocked)
  assert.equal(seoOpportunity.signalCount, 2)
  assert.equal(seoOpportunity.status, 'open')
  assert.equal(initialPayload.attentionItems.filter((entry) => entry.id === 'evolution:opportunity:seo').length, 1)

  const created = runAttentionAction('evolution:opportunity:seo', {
    action: 'create_task',
    title: 'SEO 高意圖題群任務',
    detail: '先排高意圖文章與 CTA 補齊。',
    targetAgent: 'seo',
    reviewer: 'test-suite',
  })

  assert.ok(created?.linkedRequest?.id)
  assert.ok(created?.linkedTask?.id)
  assert.equal(created.linkedTask?.assignedAgent, 'seo')
  assert.equal(created.attentionItem?.linkedTaskId, created.linkedTask.id)
  assert.equal(created.attentionItem?.linkedTaskStatus, 'assigned')
  assert.equal(getAttentionStateById('evolution:opportunity:seo')?.linkedTaskId, created.linkedTask.id)
  assert.equal(getRequestById(created.linkedRequest.id)?.assignedTo, 'seo')
  assert.equal(getTaskById(created.linkedTask.id)?.status, 'assigned')

  runAttentionAction('evolution:opportunity:seo', {
    action: 'set_owner',
    owner: 'seo',
    reviewer: 'test-suite',
  })
  const ownerUpdatedPayload = buildBossInboxPayload({ skipDigest: true })
  assert.equal(ownerUpdatedPayload.attentionItems.find((entry) => entry.id === 'evolution:opportunity:seo')?.assignedOwner, 'seo')

  runAttentionAction('evolution:opportunity:seo', {
    action: 'snooze',
    snoozeHours: 24,
    reviewer: 'test-suite',
  })
  const snoozedPayload = buildBossInboxPayload({ skipDigest: true })
  assert.equal(snoozedPayload.attentionItems.find((entry) => entry.id === 'evolution:opportunity:seo')?.unresolved, false)

  runAttentionAction('evolution:opportunity:seo', { action: 'reopen', reviewer: 'test-suite' })

  runAttentionAction('evolution:opportunity:seo', { action: 'acknowledge', reviewer: 'test-suite' })
  const acknowledgedPayload = buildBossInboxPayload({ skipDigest: true })
  assert.ok(!acknowledgedPayload.attentionItems.find((entry) => entry.id === 'evolution:opportunity:seo')?.unresolved)

  runAttentionAction('evolution:opportunity:seo', { action: 'reopen', reviewer: 'test-suite' })
  const reopenedPayload = buildBossInboxPayload({ skipDigest: true })
  assert.equal(reopenedPayload.attentionItems.find((entry) => entry.id === 'evolution:opportunity:seo')?.unresolved, true)

  runAttentionAction('evolution:opportunity:seo', { action: 'resolve', reviewer: 'test-suite' })
  const resolvedPayload = buildBossInboxPayload({ skipDigest: true })
  assert.ok(!resolvedPayload.attentionItems.find((entry) => entry.id === 'evolution:opportunity:seo')?.unresolved)

  const feedbackResult = recordAttentionTaskFeedback({
    taskId: created.linkedTask.id,
    requestId: created.linkedRequest.id,
    taskResult: '發佈 3 篇高意圖頁並補 CTA',
    completionValue: 42000,
    didImprove: true,
    rollbackNeeded: false,
    reviewer: 'test-suite',
  })
  assert.ok(feedbackResult.length >= 1)
  assert.equal(getAttentionStateById('evolution:opportunity:seo')?.taskResult, '發佈 3 篇高意圖頁並補 CTA')
  assert.equal(getAttentionStateById('evolution:opportunity:seo')?.didImprove, true)
})

test('candidate preflight blocks non-whitelist scope and oversized line delta', () => {
  const result = runNightlyEvolutionPromotion({ now: Date.now() })
  const seoCandidate = result.candidatePatches.find((entry) => entry.agentId === 'seo')
  assert.ok(seoCandidate)

  const candidatePath = join(pendingDir, `${seoCandidate.id}.json`)
  const outsideTarget = join(tmpdir(), `outside-risk-target-${Date.now()}.md`)
  writeFileSync(outsideTarget, '# outside\n')

  const outsidePayload = {
    ...JSON.parse(readFileSync(candidatePath, 'utf8')),
    target: outsideTarget,
    reviewStatus: 'approved',
  }
  writeFileSync(candidatePath, `${JSON.stringify(outsidePayload, null, 2)}\n`)

  const blockedByScope = getCandidatePatchById(seoCandidate.id)
  assert.equal(blockedByScope?.evolutionStatus, 'blocked_by_missing_guard')
  assert.equal(blockedByScope?.autoApplyEligible, false)
  assert.ok((blockedByScope?.prereqChecks || []).some((check) => check.id === 'scope-whitelist' && check.passed === false))

  const hugeChange = Array.from({ length: 180 }, (_value, index) => `line-${index + 1}`).join('\n')
  const oversizePayload = {
    ...JSON.parse(readFileSync(candidatePath, 'utf8')),
    target: join(seoWorkspace, 'SYSTEM_PROMPT.md'),
    proposedChange: hugeChange,
  }
  writeFileSync(candidatePath, `${JSON.stringify(oversizePayload, null, 2)}\n`)

  const blockedByLineCap = getCandidatePatchById(seoCandidate.id)
  assert.equal(blockedByLineCap?.evolutionStatus, 'blocked_by_missing_guard')
  assert.ok((blockedByLineCap?.prereqChecks || []).some((check) => check.id === 'line-cap' && check.passed === false))
})

test('auto-applied candidate enters canary and rolls back on blocker/risk increase', () => {
  const previousEnv = {
    level: process.env.OPENCLAW_AUTONOMY_LEVEL,
    maxApplyPerCycle: process.env.OPENCLAW_AUTO_APPLY_MAX_PER_CYCLE,
    maxApplyCritical: process.env.OPENCLAW_AUTO_APPLY_MAX_OPEN_CRITICAL,
  }
  try {
    process.env.OPENCLAW_AUTONOMY_LEVEL = '2'
    process.env.OPENCLAW_AUTO_APPLY_MAX_PER_CYCLE = '99'
    process.env.OPENCLAW_AUTO_APPLY_MAX_OPEN_CRITICAL = '99'
    reloadConfig()

    const now = Date.now()
    const result = runNightlyEvolutionPromotion({ now })
    const seoCandidate = result.candidatePatches.find((entry) => entry.agentId === 'seo')
    assert.ok(seoCandidate)

    const candidatePath = join(pendingDir, `${seoCandidate.id}.json`)
    const resetCandidate = {
      ...JSON.parse(readFileSync(candidatePath, 'utf8')),
      applyStatus: null,
      applyMode: null,
      autoAppliedAt: null,
      appliedAt: null,
      appliedBy: null,
      unappliedAt: null,
      unappliedBy: null,
      canaryStatus: 'none',
      canaryStartedAt: null,
      canaryDeadlineAt: null,
      canaryUpdatedAt: null,
      rollbackReason: null,
      rollbackNeeded: false,
    }
    writeFileSync(candidatePath, `${JSON.stringify(resetCandidate, null, 2)}\n`)

    reviewCandidatePatch({
      id: seoCandidate.id,
      reviewStatus: 'approved',
      reviewer: 'test-suite',
    })

    buildEvolutionSnapshot({ now: now + 1000 })
    const running = getCandidatePatchById(seoCandidate.id)
    assert.equal(running?.applyStatus, 'applied')
    assert.equal(running?.canaryStatus, 'running')

    const seoEventsPath = join(seoWorkspace, '.learnings', 'events.jsonl')
    appendFileSync(seoEventsPath, `${JSON.stringify({
      id: `seo:canary-risk:${Date.now()}`,
      version: 1,
      agentId: 'seo',
      runAt: Date.now(),
      blockers: ['登入權限失敗導致流程中斷'],
      qualityRegression: true,
      learned: ['觀察到 canary 期間新增 blocker'],
      nextTests: ['先處理 blocker 再重跑'],
      commercialSignal: { category: 'data-backfill', score: 45, label: '資料回填缺口' },
    })}\n`)

    buildEvolutionSnapshot({ now: now + 5 * 60 * 1000 })
    const rolledBack = getCandidatePatchById(seoCandidate.id)
    assert.equal(rolledBack?.applyStatus, 'rolled_back')
    assert.equal(rolledBack?.canaryStatus, 'rolled_back')
    assert.ok(String(rolledBack?.rollbackReason || '').includes('blocked-risk') || String(rolledBack?.rollbackReason || '').includes('quality'))
    const seoPromptAfterRollback = readFileSync(join(seoWorkspace, 'SYSTEM_PROMPT.md'), 'utf8')
    assert.ok(!seoPromptAfterRollback.includes(`OPENCLAW_EVOLUTION_APPLY:START ${seoCandidate.id}`))
  } finally {
    restoreEnv('OPENCLAW_AUTONOMY_LEVEL', previousEnv.level)
    restoreEnv('OPENCLAW_AUTO_APPLY_MAX_PER_CYCLE', previousEnv.maxApplyPerCycle)
    restoreEnv('OPENCLAW_AUTO_APPLY_MAX_OPEN_CRITICAL', previousEnv.maxApplyCritical)
    reloadConfig()
  }
})

test('autonomy level 2 can auto-approve low-risk pending candidates when policy gates pass', () => {
  const previousEnv = {
    level: process.env.OPENCLAW_AUTONOMY_LEVEL,
    enabled: process.env.OPENCLAW_AUTO_APPROVE_ENABLED,
    minConfidence: process.env.OPENCLAW_AUTO_APPROVE_MIN_CONFIDENCE,
    minImpact: process.env.OPENCLAW_AUTO_APPROVE_MIN_IMPACT,
    minSuccess: process.env.OPENCLAW_AUTO_APPROVE_MIN_SUCCESS_14D,
    maxCritical: process.env.OPENCLAW_AUTO_APPROVE_MAX_OPEN_CRITICAL,
    autoApplyMinSuccess7d: process.env.OPENCLAW_AUTO_APPLY_MIN_SUCCESS_7D,
    autoApplyMaxCritical: process.env.OPENCLAW_AUTO_APPLY_MAX_OPEN_CRITICAL,
    autoApplyMaxPerCycle: process.env.OPENCLAW_AUTO_APPLY_MAX_PER_CYCLE,
    kill: process.env.OPENCLAW_AUTONOMY_KILL_SWITCH,
  }
  try {
    process.env.OPENCLAW_AUTONOMY_LEVEL = '2'
    process.env.OPENCLAW_AUTO_APPROVE_ENABLED = '1'
    process.env.OPENCLAW_AUTO_APPROVE_MIN_CONFIDENCE = '0.8'
    process.env.OPENCLAW_AUTO_APPROVE_MIN_IMPACT = '70'
    process.env.OPENCLAW_AUTO_APPROVE_MIN_SUCCESS_14D = '0.4'
    process.env.OPENCLAW_AUTO_APPROVE_MAX_OPEN_CRITICAL = '99'
    process.env.OPENCLAW_AUTO_APPLY_MIN_SUCCESS_7D = '0'
    process.env.OPENCLAW_AUTO_APPLY_MAX_OPEN_CRITICAL = '99'
    process.env.OPENCLAW_AUTO_APPLY_MAX_PER_CYCLE = '99'
    process.env.OPENCLAW_AUTONOMY_KILL_SWITCH = '0'
    reloadConfig()

    syncEvolutionArtifacts({ now: Date.now() })
    const firstRun = runNightlyEvolutionPromotion({ now: Date.now() })

    // Reset one candidate to pending so we can verify level-2 auto-approve deterministically.
    const target = firstRun.candidatePatches.find((entry) => entry.agentId === 'seo')
    assert.ok(target)
    const candidatePath = join(pendingDir, `${target.id}.json`)
    const resetCandidate = {
      ...JSON.parse(readFileSync(candidatePath, 'utf8')),
      reviewStatus: 'pending',
      reviewedAt: null,
      reviewedBy: null,
      reviewNote: null,
      applyStatus: null,
      applyMode: null,
      autoAppliedAt: null,
      appliedAt: null,
      appliedBy: null,
      canaryStatus: 'none',
      canaryStartedAt: null,
      canaryDeadlineAt: null,
      canaryUpdatedAt: null,
      rollbackNeeded: false,
      rollbackReason: null,
      updatedAt: Date.now(),
    }
    writeFileSync(candidatePath, `${JSON.stringify(resetCandidate, null, 2)}\n`)

    const secondRun = runNightlyEvolutionPromotion({ now: Date.now() + 1200 })
    const autoApproved = secondRun.candidatePatches.find((entry) => entry.id === target.id)
    assert.equal(autoApproved?.reviewStatus, 'approved')
    assert.equal(autoApproved?.reviewedBy, 'evolution-engine:auto-approve')
    assert.equal(autoApproved?.applyMode, 'auto')
  } finally {
    restoreEnv('OPENCLAW_AUTONOMY_LEVEL', previousEnv.level)
    restoreEnv('OPENCLAW_AUTO_APPROVE_ENABLED', previousEnv.enabled)
    restoreEnv('OPENCLAW_AUTO_APPROVE_MIN_CONFIDENCE', previousEnv.minConfidence)
    restoreEnv('OPENCLAW_AUTO_APPROVE_MIN_IMPACT', previousEnv.minImpact)
    restoreEnv('OPENCLAW_AUTO_APPROVE_MIN_SUCCESS_14D', previousEnv.minSuccess)
    restoreEnv('OPENCLAW_AUTO_APPROVE_MAX_OPEN_CRITICAL', previousEnv.maxCritical)
    restoreEnv('OPENCLAW_AUTO_APPLY_MIN_SUCCESS_7D', previousEnv.autoApplyMinSuccess7d)
    restoreEnv('OPENCLAW_AUTO_APPLY_MAX_OPEN_CRITICAL', previousEnv.autoApplyMaxCritical)
    restoreEnv('OPENCLAW_AUTO_APPLY_MAX_PER_CYCLE', previousEnv.autoApplyMaxPerCycle)
    restoreEnv('OPENCLAW_AUTONOMY_KILL_SWITCH', previousEnv.kill)
    reloadConfig()
  }
})

test('autonomy level 3 can auto-apply approved advisory candidate while level 2 keeps it waiting', () => {
  const previousEnv = {
    level: process.env.OPENCLAW_AUTONOMY_LEVEL,
    enabled: process.env.OPENCLAW_AUTO_APPROVE_ENABLED,
    allowApproveAdvisory: process.env.OPENCLAW_AUTO_APPROVE_ALLOW_ADVISORY,
    allowApplyAdvisory: process.env.OPENCLAW_AUTO_APPLY_ALLOW_ADVISORY,
    minApplyAdvisoryConfidence: process.env.OPENCLAW_AUTO_APPLY_ADVISORY_MIN_CONFIDENCE,
    minApplyAdvisoryImpact: process.env.OPENCLAW_AUTO_APPLY_ADVISORY_MIN_IMPACT,
    maxApplyCritical: process.env.OPENCLAW_AUTO_APPLY_MAX_OPEN_CRITICAL,
    maxApplyPerCycle: process.env.OPENCLAW_AUTO_APPLY_MAX_PER_CYCLE,
  }
  try {
    process.env.OPENCLAW_AUTONOMY_LEVEL = '2'
    process.env.OPENCLAW_AUTO_APPROVE_ENABLED = '1'
    process.env.OPENCLAW_AUTO_APPROVE_ALLOW_ADVISORY = '0'
    process.env.OPENCLAW_AUTO_APPLY_ALLOW_ADVISORY = '0'
    process.env.OPENCLAW_AUTO_APPLY_MAX_OPEN_CRITICAL = '99'
    process.env.OPENCLAW_AUTO_APPLY_MAX_PER_CYCLE = '99'
    reloadConfig()

    syncEvolutionArtifacts({ now: Date.now() })
    runNightlyEvolutionPromotion({ now: Date.now() })
    const candidateId = `candidate-autonomy-advisory-${Date.now()}`
    const candidatePath = join(pendingDir, `${candidateId}.json`)
    const advisoryApproved = {
      id: candidateId,
      type: 'agent',
      candidateKind: 'advisory',
      agentId: 'seo',
      agentName: '藍鯨SEO',
      target: join(seoWorkspace, 'SYSTEM_PROMPT.md'),
      reason: 'advisory candidate for level gating test',
      proposedChange: '請把高意圖題群固定列入每日最優先內容策略。',
      evidenceRefs: ['test:evidence:autonomy-advisory'],
      category: 'high-intent-conversion',
      recurrence: 1,
      reviewStatus: 'approved',
      reviewedAt: Date.now(),
      reviewedBy: 'test-suite',
      confidence: 0.95,
      estimatedImpact: 92,
      applyMode: null,
      autoAppliedAt: null,
      applyStatus: null,
      appliedAt: null,
      appliedBy: null,
      canaryStatus: 'none',
      canaryStartedAt: null,
      canaryDeadlineAt: null,
      canaryUpdatedAt: null,
      rollbackNeeded: false,
      rollbackReason: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    writeFileSync(candidatePath, `${JSON.stringify(advisoryApproved, null, 2)}\n`)

    buildEvolutionSnapshot({ now: Date.now() + 1200 })
    const keptWaiting = getCandidatePatchById(candidateId)
    assert.equal(keptWaiting?.applyStatus, null)

    process.env.OPENCLAW_AUTONOMY_LEVEL = '3'
    process.env.OPENCLAW_AUTO_APPROVE_ALLOW_ADVISORY = '1'
    process.env.OPENCLAW_AUTO_APPLY_ALLOW_ADVISORY = '1'
    process.env.OPENCLAW_AUTO_APPLY_ADVISORY_MIN_CONFIDENCE = '0.88'
    process.env.OPENCLAW_AUTO_APPLY_ADVISORY_MIN_IMPACT = '86'
    reloadConfig()

    buildEvolutionSnapshot({ now: Date.now() + 2600 })
    const autoApplied = getCandidatePatchById(candidateId)
    assert.equal(autoApplied?.applyStatus, 'applied')
    assert.equal(autoApplied?.applyMode, 'auto')
    assert.equal(autoApplied?.canaryStatus, 'running')
  } finally {
    restoreEnv('OPENCLAW_AUTONOMY_LEVEL', previousEnv.level)
    restoreEnv('OPENCLAW_AUTO_APPROVE_ENABLED', previousEnv.enabled)
    restoreEnv('OPENCLAW_AUTO_APPROVE_ALLOW_ADVISORY', previousEnv.allowApproveAdvisory)
    restoreEnv('OPENCLAW_AUTO_APPLY_ALLOW_ADVISORY', previousEnv.allowApplyAdvisory)
    restoreEnv('OPENCLAW_AUTO_APPLY_ADVISORY_MIN_CONFIDENCE', previousEnv.minApplyAdvisoryConfidence)
    restoreEnv('OPENCLAW_AUTO_APPLY_ADVISORY_MIN_IMPACT', previousEnv.minApplyAdvisoryImpact)
    restoreEnv('OPENCLAW_AUTO_APPLY_MAX_OPEN_CRITICAL', previousEnv.maxApplyCritical)
    restoreEnv('OPENCLAW_AUTO_APPLY_MAX_PER_CYCLE', previousEnv.maxApplyPerCycle)
    reloadConfig()
  }
})
