import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tempRoot = mkdtempSync(join(tmpdir(), 'openclaw-autoresearch-'))
const openclawHome = tempRoot
const artifactsDir = join(openclawHome, 'artifacts', 'autoresearch-mlx')
const controlRoomDir = join(artifactsDir, 'control-room')
const strategyDir = join(artifactsDir, 'strategy')
const overnightDir = join(artifactsDir, 'overnight')
const runsDir = join(artifactsDir, 'runs')
const projectDir = join(openclawHome, 'Projects', 'autoresearch-mlx')
const agentDir = join(openclawHome, 'agent')
const cronDir = join(openclawHome, 'cron')

mkdirSync(controlRoomDir, { recursive: true })
mkdirSync(strategyDir, { recursive: true })
mkdirSync(overnightDir, { recursive: true })
mkdirSync(runsDir, { recursive: true })
mkdirSync(projectDir, { recursive: true })
mkdirSync(agentDir, { recursive: true })
mkdirSync(cronDir, { recursive: true })

writeFileSync(
  join(agentDir, 'status.json'),
  JSON.stringify({
    fish: {
      'dev-fish': {
        phase: 'RUNNING',
        currentTask: 'AutoResearch MLX Codex loop (manual-20260325-0900)',
        lastAction: 'Running experiments',
        lastActionAt: '2026-03-25T01:00:00.000Z',
        nextStep: 'QA review (manual-20260325-0900)',
        health: 'green',
        blockers: [],
      },
      qa: {
        phase: 'REVIEW',
        currentTask: 'AutoResearch MLX QA pass (manual-20260325-0900)',
        health: 'green',
        blockers: [],
      },
      'memory-distiller': {
        phase: 'READY',
        currentTask: 'AutoResearch MLX handoff captured (manual-20260325-0900)',
        health: 'green',
        blockers: [],
      },
    },
  }, null, 2),
)

writeFileSync(
  join(controlRoomDir, 'runtime.json'),
  JSON.stringify({
    status: 'running',
    note: 'Codex loop in progress',
    runTag: 'manual-20260325-0900',
    mode: 'manual',
    source: 'ui',
    startedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    updatedAt: new Date().toISOString(),
    softMinutes: 90,
    hardMinutes: 120,
    maxExperiments: 6,
    outputLogPath: join(controlRoomDir, 'manual-run.log'),
  }, null, 2),
)

writeFileSync(
  join(controlRoomDir, 'manual-config.json'),
  JSON.stringify({
    version: 1,
    updatedAt: '2026-03-25T00:30:00.000Z',
    softMinutes: 90,
    hardMinutes: 120,
    maxExperiments: 6,
  }, null, 2),
)

writeFileSync(
  join(controlRoomDir, 'manual-run.log'),
  ['started_at=2026-03-25T00:30:00.000Z', 'cmd=python3 runner.py', 'experiment 1 complete'].join('\n'),
)

writeFileSync(
  join(strategyDir, 'strategy-config.json'),
  JSON.stringify({
    version: 1,
    updatedAt: '2026-03-25T00:40:00.000Z',
    primaryModel: 'gpt-5.3-codex',
    breakthroughModel: 'gpt-5.4',
  }, null, 2),
)

writeFileSync(
  join(strategyDir, 'fleet-state.json'),
  JSON.stringify({
    updatedAt: '2026-03-25T00:45:00.000Z',
    primaryModel: 'gpt-5.3-codex',
    breakthroughModel: 'gpt-5.4',
    primaryPlateauCount: 1,
    lastPrimaryRunTag: 'manual-20260325-0900',
    lastPrimaryResult: 'keep',
  }, null, 2),
)

writeFileSync(
  join(strategyDir, '2026-03-25-strategy.json'),
  JSON.stringify({
    generatedAt: '2026-03-25T00:50:00.000Z',
    recommendation: 'keep running',
  }, null, 2),
)

writeFileSync(
  join(strategyDir, 'manual-20260325-0900-plan.json'),
  JSON.stringify({
    generatedAt: '2026-03-25T00:48:00.000Z',
    selectedLaneId: 'optimizer',
    selectedLaneLabel: '最佳化與學習率',
    selectedLaneGoal: '先從 learning rate 比例、weight decay 與 optimizer 係數找低風險改善。',
    selectedLaneWhyNow: '研究記憶顯示這條線近期最容易穩定改善。',
    selectedLaneFocus: ['weight decay', 'matrix lr / unembedding lr 比例'],
    selectedLaneAvoid: ['一次同時大改模型架構'],
    nextLaneId: 'schedule',
    nextLaneLabel: '訓練節奏與收尾排程',
    nextLaneGoal: '調 warmup、warmdown、anneal 與訓練節奏。',
    planSummary: '這輪先跑最佳化與學習率，先找低風險改善。',
    stableMemoryCallout: '最近最穩的是「最佳化與學習率」：Lower weight decay。',
    searchSpacePath: join(strategyDir, 'search-space.json'),
    researchMemoryPath: join(strategyDir, 'research-memory.json'),
    searchSpace: {
      allowedFiles: ['train.py', 'results.tsv'],
    },
  }, null, 2),
)

writeFileSync(
  join(strategyDir, 'search-space.json'),
  JSON.stringify({
    version: 1,
    updatedAt: '2026-03-25T00:41:00.000Z',
    goalMetric: 'val_bpb',
    fixedBudgetMinutes: 5,
    allowedFiles: ['train.py', 'results.tsv'],
    lanes: [
      { id: 'optimizer', label: '最佳化與學習率', goal: '先從 learning rate 比例、weight decay 與 optimizer 係數找低風險改善。' },
      { id: 'schedule', label: '訓練節奏與收尾排程', goal: '調 warmup、warmdown、anneal 與訓練節奏。' },
    ],
    orchestration: {
      planner: 'dev-fish-strategy-planner',
      executor: 'dev-fish',
      revalidator: 'qa',
      distiller: 'memory-distiller',
    },
  }, null, 2),
)

writeFileSync(
  join(strategyDir, 'research-memory.json'),
  JSON.stringify({
    version: 1,
    updatedAt: '2026-03-25T00:52:00.000Z',
    entries: [
      {
        runTag: 'manual-20260325-0900',
        laneId: 'optimizer',
        laneLabel: '最佳化與學習率',
        qaStatus: 'PASS',
        revalidationVerdict: 'stable',
        validatedImprovement: 0.11,
      },
    ],
    laneStats: {
      optimizer: {
        runs: 1,
        passes: 1,
        stablePasses: 1,
        needsWorkRuns: 0,
        blockedRuns: 0,
        avgImprovement: 0.11,
      },
    },
    recommendedPatterns: [
      {
        laneId: 'optimizer',
        label: '最佳化與學習率',
        summary: '近 1 輪在「最佳化與學習率」最穩，平均改善 0.110000。',
        confidence: 0.55,
      },
    ],
    avoidPatterns: [],
  }, null, 2),
)

writeFileSync(
  join(projectDir, 'results.tsv'),
  [
    'commit\tval_bpb\tmemory_gb\tstatus\tdescription',
    'abc123\t1.45\t31.2\tbaseline\tbaseline',
    'def456\t1.31\t33.8\tkeep\tcodex improvement',
  ].join('\n'),
)

writeFileSync(
  join(cronDir, 'jobs.json'),
  JSON.stringify({
    jobs: [
      {
        id: 'nightly-job',
        name: 'dev-fish-autoresearch-nightly',
        enabled: true,
        schedule: { expr: '0 2 * * *', tz: 'Asia/Taipei' },
        state: { nextRunAtMs: Date.now() + 60 * 60 * 1000, lastRunAtMs: Date.now() - 60 * 60 * 1000 },
      },
      {
        id: 'watch-job',
        name: 'admin-autoresearch-nightly-watch',
        enabled: true,
        schedule: { expr: '30 9 * * *', tz: 'Asia/Taipei' },
        state: { nextRunAtMs: Date.now() + 2 * 60 * 60 * 1000, lastRunAtMs: Date.now() - 2 * 60 * 60 * 1000 },
      },
    ],
  }, null, 2),
)

const codexRunDir = join(runsDir, 'manual-20260325-0900-codex-01')
mkdirSync(codexRunDir, { recursive: true })
writeFileSync(
  join(codexRunDir, 'manifest.json'),
  JSON.stringify({
    runTag: 'manual-20260325-0900',
    model: 'gpt-5.3-codex',
    branch: 'main',
    head: 'def456',
    codexLogin: 'ready',
    proxyReady: true,
  }, null, 2),
)
writeFileSync(
  join(codexRunDir, 'summary.md'),
  [
    '# AutoResearch MLX Summary',
    '- Final kept commit: `def456`',
    '- Peak memory: **33.8 GB**',
    '## Key experiment idea kept',
    '1. Tighten the scheduler and keep the stronger variant.',
  ].join('\n'),
)
writeFileSync(
  join(codexRunDir, 'qa-check.md'),
  [
    '# AutoResearch MLX QA Check',
    '- QA verdict: **pass**',
    '- Verdict note: `stable after codex patch`',
  ].join('\n'),
)
writeFileSync(
  join(codexRunDir, 'revalidation.md'),
  [
    '# AutoResearch MLX Revalidation',
    '- Revalidation verdict: `stable`',
    '- Mean val_bpb: `1.305000`',
    '- val_bpb spread: `0.006000`',
  ].join('\n'),
)
writeFileSync(
  join(codexRunDir, 'revalidation.json'),
  JSON.stringify({
    verdict: 'stable',
    meanValBpb: 1.305,
    valSpread: 0.006,
    meanMemoryGb: 33.4,
  }, null, 2),
)
writeFileSync(
  join(codexRunDir, 'memory-distiller-handoff.md'),
  [
    '# AutoResearch MLX Memory Distiller Handoff',
    '- Best val_bpb: 1.31',
  ].join('\n'),
)

process.env.OPENCLAW_HOME = openclawHome
process.env.OFFICE_ADMIN_TOKEN = 'office-secret'

const route = await import('../app/api/autoresearch/route.js')

function createRequestLike({ headers = {}, cookieValue = null, body = null } = {}) {
  const normalizedHeaders = new Headers(headers)
  return {
    headers: normalizedHeaders,
    cookies: {
      get(name) {
        if (name !== 'office_admin_session' || !cookieValue) return undefined
        return { value: cookieValue }
      },
    },
    async json() {
      return body
    },
  }
}

async function readJsonResponse(response) {
  return JSON.parse(await response.text())
}

test('autoresearch GET requires office auth', async () => {
  const response = await route.GET(createRequestLike())
  const payload = await readJsonResponse(response)

  assert.equal(response.status, 401)
  assert.match(payload.error, /存取權限|Unauthorized/i)
})

test('autoresearch GET returns snapshot with live, strategy, metrics, and artifacts', async () => {
  const response = await route.GET(createRequestLike({
    headers: { 'x-office-token': 'office-secret' },
  }))
  const payload = await readJsonResponse(response)

  assert.equal(response.status, 200)
  assert.equal(payload.live.ownerAgent, 'dev-fish')
  assert.equal(payload.live.runTag, 'manual-20260325-0900')
  assert.equal(payload.control.status, 'running')
  assert.equal(payload.strategy.primaryModel, 'gpt-5.3-codex')
  assert.equal(payload.strategy.breakthroughModel, 'gpt-5.4')
  assert.equal(payload.strategy.currentLane.label, '最佳化與學習率')
  assert.equal(payload.strategy.nextLane.label, '訓練節奏與收尾排程')
  assert.equal(payload.strategy.searchSpace.allowedFiles[0], 'train.py')
  assert.equal(payload.strategy.researchMemory.entryCount, 1)
  assert.ok(Array.isArray(payload.strategy.availableModels))
  assert.equal(payload.metrics.bestKeepValBpb, 1.31)
  assert.equal(payload.metrics.revalidationVerdict, 'stable')
  assert.equal(payload.highlights.qaVerdict, 'pass')
  assert.equal(payload.repo.projectDir, projectDir)
  assert.equal(payload.artifacts.codexRun.manifest.runTag, 'manual-20260325-0900')
  assert.equal(payload.artifacts.revalidationReport.path, join(codexRunDir, 'revalidation.md'))
})

test('autoresearch PATCH updates schedule, strategy, and manual control config', async () => {
  const response = await route.PATCH(createRequestLike({
    headers: { 'x-office-token': 'office-secret' },
    body: {
      nightlyTime: '03:15',
      watchTime: '10:45',
      nightlyEnabled: false,
      watchEnabled: true,
      primaryModel: 'gpt-5.4',
      breakthroughModel: 'gpt-5.3-codex',
      softMinutes: 120,
      hardMinutes: 180,
      maxExperiments: 8,
    },
  }))
  const payload = await readJsonResponse(response)
  const jobs = JSON.parse(readFileSync(join(cronDir, 'jobs.json'), 'utf-8'))
  const strategyConfig = JSON.parse(readFileSync(join(strategyDir, 'strategy-config.json'), 'utf-8'))
  const manualConfig = JSON.parse(readFileSync(join(controlRoomDir, 'manual-config.json'), 'utf-8'))

  assert.equal(response.status, 200)
  assert.equal(payload.ok, true)
  assert.equal(payload.schedule.nightly.enabled, false)
  assert.equal(payload.schedule.nightly.timeValue, '03:15')
  assert.equal(payload.schedule.watch.timeValue, '10:45')
  assert.equal(payload.strategy.primaryModel, 'gpt-5.4')
  assert.equal(payload.strategy.breakthroughModel, 'gpt-5.3-codex')
  assert.equal(payload.manualControl.softMinutes, 120)
  assert.equal(payload.manualControl.hardMinutes, 180)
  assert.equal(payload.manualControl.maxExperiments, 8)
  assert.equal(jobs.jobs.find((job) => job.name === 'dev-fish-autoresearch-nightly').enabled, false)
  assert.equal(jobs.jobs.find((job) => job.name === 'admin-autoresearch-nightly-watch').schedule.expr, '45 10 * * *')
  assert.equal(strategyConfig.primaryModel, 'gpt-5.4')
  assert.equal(manualConfig.hardMinutes, 180)
})
