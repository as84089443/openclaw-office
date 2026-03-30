import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
      'research-fish': {
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
    childPid: process.pid,
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
      planner: 'research-fish-strategy-planner',
      executor: 'research-fish',
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
        name: 'research-fish-autoresearch-nightly',
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
    codexLogin: 'Logged in using ChatGPT',
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
const previousCodexRunDir = join(runsDir, 'manual-20260324-2200-codex-01')
mkdirSync(previousCodexRunDir, { recursive: true })
writeFileSync(
  join(previousCodexRunDir, 'manifest.json'),
  JSON.stringify({
    runTag: 'manual-20260324-2200',
    model: 'gpt-5.3-codex',
    branch: 'main',
    head: 'abc999',
    codexLogin: 'Logged in using ChatGPT',
    proxyReady: true,
  }, null, 2),
)
writeFileSync(
  join(previousCodexRunDir, 'summary.md'),
  [
    '# AutoResearch MLX Summary',
    '- Final kept commit: `abc999`',
    '- Peak memory: **34.1 GB**',
    '## Key experiment idea kept',
    '1. Lower weight decay and keep the stronger variant.',
  ].join('\n'),
)
writeFileSync(
  join(previousCodexRunDir, 'qa-check.md'),
  [
    '# AutoResearch MLX QA Check',
    '- QA verdict: **pass**',
    '- Verdict note: `stable after codex patch`',
  ].join('\n'),
)
writeFileSync(
  join(previousCodexRunDir, 'revalidation.md'),
  [
    '# AutoResearch MLX Revalidation',
    '- Revalidation verdict: `stable`',
    '- Mean val_bpb: `1.305000`',
    '- val_bpb spread: `0.006000`',
  ].join('\n'),
)
writeFileSync(
  join(previousCodexRunDir, 'revalidation.json'),
  JSON.stringify({
    verdict: 'stable',
    meanValBpb: 1.305,
    valSpread: 0.006,
    meanMemoryGb: 33.4,
  }, null, 2),
)
writeFileSync(
  join(previousCodexRunDir, 'memory-distiller-handoff.md'),
  [
    '# AutoResearch MLX Memory Distiller Handoff',
    '- Best val_bpb: 1.31',
  ].join('\n'),
)

const improveRunDir = join(runsDir, 'manual-20260328-0105-improve-01')
mkdirSync(improveRunDir, { recursive: true })
writeFileSync(
  join(improveRunDir, 'manifest.json'),
  JSON.stringify({
    runTag: 'manual-20260328-0105',
    mode: 'improve',
    researchKind: 'improve',
    model: 'gpt-5.3-codex',
    targetPath: join(openclawHome, 'openclaw-office'),
    targetLabel: 'AutoPen',
    userResearchTopic: '請先修 AutoPen 最影響 SEO 的一個問題，直接改碼並驗證結果。',
    branch: 'codex/program-improve',
    head: 'impr123',
    codexLogin: 'Logged in using ChatGPT',
    proxyReady: true,
  }, null, 2),
)
writeFileSync(
  join(improveRunDir, 'summary.md'),
  [
    '# 程式改善摘要',
    '## 這輪鎖定的問題',
    'AutoPen SEO 設定頁缺少明確儲存結果提示。',
    '## 這次實際改了什麼',
    '- 補上成功與失敗提示。',
    '- 收斂儲存按鈕狀態。 ',
  ].join('\n'),
)
writeFileSync(
  join(improveRunDir, 'qa-check.md'),
  [
    '# AutoResearch 程式改善驗證',
    '- 驗證狀態：通過',
    '- 驗證指令：npm run build',
    '- 驗證結果：頁面可正常編譯並保留既有流程。',
  ].join('\n'),
)
writeFileSync(
  join(improveRunDir, 'revalidation.md'),
  [
    '# AutoResearch 程式改善後續確認',
    '- 再走一次 AutoPen SEO 儲存流程。',
    '- 補一次實際點擊驗證。',
  ].join('\n'),
)
writeFileSync(
  join(improveRunDir, 'memory-distiller-handoff.md'),
  [
    '# 記憶整理交接',
    '- 小範圍 UI 反饋改善最容易驗證。',
  ].join('\n'),
)
writeFileSync(
  join(improveRunDir, 'result.json'),
  JSON.stringify({
    mode: 'improve',
    headline: '補上 AutoPen SEO 設定儲存反饋',
    problem: 'AutoPen SEO 設定頁缺少明確儲存結果提示。',
    changedFiles: [
      { path: 'components/SeoSettingsPanel.js', summary: '補上儲存成功與失敗提示' },
      { path: 'app/autopen/page.js', summary: '整理按鈕狀態與提交流程' },
    ],
    verification: [
      { command: 'npm run build', status: 'pass', summary: '建置成功' },
      { command: 'node --test tests/autoresearch.test.mjs', status: 'pass', summary: '控制台測試通過' },
    ],
    overallStatus: 'pass',
    nextSteps: ['補一次實際瀏覽器流程驗證', '確認提示文案是否符合使用者語氣'],
  }, null, 2),
)

const evolveRunDir = join(runsDir, 'manual-20260328-0215-evolve-01')
mkdirSync(evolveRunDir, { recursive: true })
writeFileSync(
  join(evolveRunDir, 'manifest.json'),
  JSON.stringify({
    runTag: 'manual-20260328-0215',
    mode: 'evolve',
    researchKind: 'evolve',
    model: 'gpt-5.3-codex',
    targetPath: join(openclawHome, 'openclaw-office'),
    targetLabel: 'AutoPen',
    userResearchTopic: '請先找出 AutoPen 最值得做成持續進化能力的一個 bottleneck，直接改碼、驗證效果，並整理下一輪延續方向。',
    resolvedResearchTopic: [
      '請先找出 AutoPen 最值得做成持續進化能力的一個 bottleneck，直接改碼、驗證效果，並整理下一輪延續方向。',
      '',
      '延續上下文（自動接續 AutoPen 的 manual-20260327-2330）：',
      '- 上一輪瓶頸：AutoPen 缺少可延續的研究流程回饋',
      '- 這輪優先延續：直接啟動下一輪 AutoPen 程式進化',
      '',
      '交付記憶（最近 3 輪程式改善 / 進化）：',
      '- 最近最穩方向：驗證通過 2 次，最近一次保留了可延續的程式進化模式',
    ].join('\n'),
    branch: 'codex/program-evolve',
    head: 'evo123',
    codexLogin: 'Logged in using ChatGPT',
    proxyReady: true,
    loop: {
      enabled: true,
      maxIterations: 8,
      completedIterations: 2,
      currentIteration: 2,
      threadId: '019d3557-3237-7183-8965-5925a35b5906',
      stopReason: 'iteration-budget-remaining',
    },
  }, null, 2),
)
writeFileSync(
  join(evolveRunDir, 'startup-context.json'),
  JSON.stringify({
    requestedResearchTopic: '請先找出 AutoPen 最值得做成持續進化能力的一個 bottleneck，直接改碼、驗證效果，並整理下一輪延續方向。',
    resolvedResearchTopic: [
      '請先找出 AutoPen 最值得做成持續進化能力的一個 bottleneck，直接改碼、驗證效果，並整理下一輪延續方向。',
      '',
      '延續上下文（自動接續 AutoPen 的 manual-20260327-2330）：',
      '- 上一輪瓶頸：AutoPen 缺少可延續的研究流程回饋',
      '- 這輪優先延續：直接啟動下一輪 AutoPen 程式進化',
    ].join('\n'),
    continuationSourceRunTag: 'manual-20260327-2330',
    continuationReason: '已自動接續 AutoPen 在 manual-20260327-2330 的已驗證進化結果，這輪會先沿著有效做法與下一步往前推。',
    codeMemoryReason: '已載入最近 3 輪程式改善 / 進化記憶，這輪會優先沿著通過率較高的方向前進，並避開最近反覆卡住的路線。',
    codeMemoryEntryCount: 3,
    codeMemoryPreview: '驗證通過 2 次，最近一次保留了可延續的程式進化模式',
    readinessCandidateAgentId: 'invoice',
    readinessCandidateSeverity: 'blocked',
    readinessCandidateSummary: '報價 20260315-004 的 invoice handoff 尚未 ready。',
    readinessCandidateBlockerCode: 'invoice_missing_tax_id',
    readinessCandidateBlockerLabel: '缺客戶統編',
    readinessCandidateNextStep: '先補齊客戶統編，再重跑 invoice handoff。',
    readinessCandidatePreview: 'invoice：報價 20260315-004 的 invoice handoff 尚未 ready。 結構化卡點：缺客戶統編 (invoice_missing_tax_id) 下一步：先補齊客戶統編，再重跑 invoice handoff。',
    readinessCandidateSource: 'fleet-readiness-top-candidate',
    readinessCandidateReason: '已載入目前魚群 readiness 候選；如果上一輪有效方向已不值得延續，這輪會優先從最新 blocker 中只挑一個最高槓桿 bottleneck。',
    iteration: 2,
    threadId: '019d3557-3237-7183-8965-5925a35b5906',
    loop: {
      enabled: true,
      maxIterations: 8,
      completedIterations: 2,
      currentIteration: 2,
      threadId: '019d3557-3237-7183-8965-5925a35b5906',
    },
  }, null, 2),
)
writeFileSync(
  join(evolveRunDir, 'summary.md'),
  [
    '# 程式進化摘要',
    '## 這輪鎖定的進化瓶頸',
    'AutoPen 缺少可延續的研究流程回饋，完成後不容易把下一輪方向接起來。',
    '## 這次實際進化了什麼',
    '- 補上 mode-aware 的進化摘要與下一步欄位。',
    '- 讓控制台可直接顯示進化驗證結果與延續方向。',
  ].join('\n'),
)
writeFileSync(
  join(evolveRunDir, 'qa-check.md'),
  [
    '# AutoResearch 程式進化驗證',
    '- 驗證狀態：通過',
    '- 驗證指令：npm run build',
    '- 驗證結果：控制台可正確顯示程式進化模式。',
  ].join('\n'),
)
writeFileSync(
  join(evolveRunDir, 'revalidation.md'),
  [
    '# AutoResearch 程式進化後續確認',
    '- 再跑一次 AutoPen 程式進化，確認下一輪延續方向有被保留下來。',
    '- 補一次實際點擊驗證與 log tail 檢查。',
  ].join('\n'),
)
writeFileSync(
  join(evolveRunDir, 'memory-distiller-handoff.md'),
  [
    '# 記憶整理交接',
    '- 高槓桿 bottleneck 要搭配明確驗證與下一輪延續方向。',
  ].join('\n'),
)
writeFileSync(
  join(evolveRunDir, 'result.json'),
  JSON.stringify({
    mode: 'evolve',
    headline: '把 AutoPen 研究流程補成可延續的程式進化模式',
    problem: 'AutoPen 缺少可延續的研究流程回饋，完成後不容易把下一輪方向接起來。',
    changedFiles: [
      { path: 'components/AutoResearchControlRoom.js', summary: '補上程式進化控制台呈現與文案' },
      { path: 'lib/autoresearch-snapshot.js', summary: '讓 snapshot 可讀取 evolve artifacts' },
    ],
    verification: [
      { command: 'npm run build', status: 'pass', summary: '建置成功' },
      { command: 'node --test tests/autoresearch.test.mjs', status: 'pass', summary: '控制台測試通過' },
    ],
    overallStatus: 'pass',
    nextSteps: ['直接啟動下一輪 AutoPen 程式進化', '補一次真實瀏覽器驗證'],
  }, null, 2),
)

const evolveNeedsWorkRunDir = join(runsDir, 'manual-20260327-2330-evolve-01')
mkdirSync(evolveNeedsWorkRunDir, { recursive: true })
writeFileSync(
  join(evolveNeedsWorkRunDir, 'manifest.json'),
  JSON.stringify({
    runTag: 'manual-20260327-2330',
    mode: 'evolve',
    researchKind: 'evolve',
    model: 'gpt-5.3-codex',
    targetPath: join(openclawHome, 'openclaw-office'),
    targetLabel: 'AutoPen',
    userResearchTopic: '請先找出 AutoPen 最值得做成持續進化能力的一個 bottleneck，直接修改程式、驗證效果，並把下一輪可延續的進化方向整理清楚。',
    branch: 'codex/program-evolve-memory',
    head: 'evo099',
    codexLogin: 'Logged in using ChatGPT',
    proxyReady: true,
  }, null, 2),
)
writeFileSync(
  join(evolveNeedsWorkRunDir, 'result.json'),
  JSON.stringify({
    mode: 'evolve',
    headline: '嘗試把 AutoPen 進化摘要只放在單一報表',
    problem: 'AutoPen 的交付記憶還不夠結構化，最近卡住時不容易避開失敗路線。',
    changedFiles: [
      { path: 'lib/autoresearch-snapshot.js', summary: '只補單次摘要讀取' },
    ],
    verification: [
      { command: 'npm run build', status: 'pass', summary: '建置成功' },
      { command: 'node --test tests/autoresearch.test.mjs', status: 'fail', summary: '沒有留下可延續的記憶聚合' },
    ],
    overallStatus: 'needs-work',
    nextSteps: ['把最近通過與卡住的方向都整理成交付記憶', '讓下一輪 topic 能自動避開重複踩雷的路線'],
  }, null, 2),
)

process.env.OPENCLAW_HOME = openclawHome
process.env.OFFICE_ADMIN_TOKEN = 'office-secret'

const route = await import('../app/api/autoresearch/route.js')
const control = await import('../lib/autoresearch-control.js')

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

async function waitForFileContent(path, attempts = 20, delayMs = 50) {
  for (let index = 0; index < attempts; index += 1) {
    try {
      return readFileSync(path, 'utf-8')
    } catch {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
  throw new Error(`Timed out waiting for file: ${path}`)
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
  assert.equal(payload.live.ownerAgent, 'research-fish')
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
  assert.equal(payload.artifacts.codexRun.manifest.codexLogin, 'Logged in using ChatGPT')
  assert.equal(payload.artifacts.summary.path, join(codexRunDir, 'summary.md'))
  assert.equal(payload.artifacts.summary.source, 'current')
  assert.equal(payload.artifacts.qaReport.path, join(previousCodexRunDir, 'qa-check.md'))
  assert.equal(payload.artifacts.qaReport.source, 'recent')
  assert.match(payload.artifacts.qaReport.statusNote, /上一輪已完成的 QA 報告/)
  assert.equal(payload.artifacts.revalidationReport.path, join(previousCodexRunDir, 'revalidation.md'))
  assert.equal(payload.artifacts.revalidationReport.source, 'recent')
  assert.equal(payload.artifacts.memoryHandoff.path, join(previousCodexRunDir, 'memory-distiller-handoff.md'))
})

test('autoresearch POST start returns readiness source and forwards it to the control runner', async () => {
  const runtimePath = join(controlRoomDir, 'runtime.json')
  const statusPath = join(agentDir, 'status.json')
  const originalRuntime = readFileSync(runtimePath, 'utf-8')
  const originalStatus = readFileSync(statusPath, 'utf-8')
  const scriptsDir = join(openclawHome, 'scripts')
  const runnerPath = join(scriptsDir, 'autoresearch-mlx-control-runner.py')
  const invocationPath = join(controlRoomDir, 'start-runner-invocation.json')
  let originalRunner = null

  try {
    try {
      originalRunner = readFileSync(runnerPath, 'utf-8')
    } catch {
      originalRunner = null
    }

    mkdirSync(scriptsDir, { recursive: true })
    rmSync(invocationPath, { force: true })
    writeFileSync(
      runnerPath,
      [
        '#!/usr/bin/env python3',
        'import json',
        'import sys',
        `path = r"""${invocationPath}"""`,
        'payload = {',
        '  "argv": sys.argv[1:],',
        '}',
        'with open(path, "w", encoding="utf-8") as handle:',
        '  json.dump(payload, handle, ensure_ascii=False, indent=2)',
        '',
      ].join('\n'),
    )

    writeFileSync(
      runtimePath,
      JSON.stringify({
        status: 'completed',
        note: '上一輪已完成。',
        runTag: 'manual-20260329-1150',
        mode: 'evolve',
        source: 'ui',
        researchKind: 'evolve',
        childPid: null,
        childProcessGroupId: null,
        startedAt: '2026-03-29T03:50:00.000Z',
        finishedAt: '2026-03-29T04:10:00.000Z',
        updatedAt: '2026-03-29T04:10:00.000Z',
        outputLogPath: join(controlRoomDir, 'previous-run.log'),
      }, null, 2),
    )

    writeFileSync(
      statusPath,
      JSON.stringify({
        fish: {
          'research-fish': {
            phase: 'READY',
            currentTask: 'Waiting for next AutoResearch run',
            lastAction: 'Ready',
            lastActionAt: '2026-03-29T04:10:00.000Z',
            nextStep: 'Start next evolve run',
            health: 'green',
            blockers: [],
          },
          invoice: {
            phase: 'BLOCKED',
            currentTask: null,
            lastAction: '最新有效執行訊號仍受阻：報價 20260315-004 的 invoice handoff 尚未 ready。',
            lastActionAt: '2026-03-29T04:00:00.000Z',
            nextStep: '先補齊客戶統編，再重跑 invoice handoff。',
            health: 'yellow',
            blockerCode: 'invoice_missing_tax_id',
            blockers: ['報價 20260315-004 的 invoice handoff 尚未 ready。', '客戶統編'],
          },
          booking: {
            phase: 'IDLE',
            currentTask: null,
            lastAction: '最新有效執行訊號需持續觀察：最新 studio booking request 衝堂待改期。',
            lastActionAt: '2026-03-29T04:12:00.000Z',
            nextStep: '先確認最新 booking request 的上游回應；若為衝堂就改期。',
            health: 'yellow',
            blockerCode: 'booking_conflict_suggested',
            blockers: ['最新 studio booking request 衝堂待改期。', 'requestStatus=conflict_suggested'],
          },
          qa: {
            phase: 'IDLE',
            currentTask: null,
            lastAction: '最新有效執行訊號需持續觀察：今日 health-check 尚未補跑。',
            lastActionAt: '2026-03-29T03:55:00.000Z',
            nextStep: '補跑今日 health-check。',
            health: 'yellow',
            blockers: ['今日 health-check 尚未補跑。'],
          },
          'memory-distiller': {
            phase: 'READY',
            currentTask: 'AutoResearch handoff captured',
            health: 'green',
            blockers: [],
          },
        },
      }, null, 2),
    )

    const response = await route.POST(createRequestLike({
      headers: { 'x-office-token': 'office-secret' },
      body: {
        action: 'start',
        researchKind: 'evolve',
        researchTopic: '請先找出這個系統最值得做成可持續進化能力的一個 bottleneck，直接改碼、驗證效果，並整理下一輪可延續的進化方向。',
        targetPath: openclawHome,
        targetLabel: 'OpenClaw 魚群 Agents',
        softMinutes: 120,
        hardMinutes: 150,
        maxExperiments: 8,
      },
    }))
    const payload = await readJsonResponse(response)
    const invocation = JSON.parse(await waitForFileContent(invocationPath))

    assert.equal(response.status, 200)
    assert.equal(payload.researchKind, 'evolve')
    assert.equal(payload.readinessCandidateAgentId, 'invoice')
    assert.equal(payload.readinessCandidateBlockerCode, 'invoice_missing_tax_id')
    assert.equal(payload.readinessCandidateSource, 'fleet-readiness-top-candidate')
    assert.match(payload.readinessCandidateReason, /readiness 候選/)
    assert.match(invocation.argv.join(' '), /--readiness-candidate-agent-id invoice/)
    assert.match(invocation.argv.join(' '), /--readiness-candidate-blocker-code invoice_missing_tax_id/)
    assert.match(invocation.argv.join(' '), /--readiness-candidate-source fleet-readiness-top-candidate/)
  } finally {
    writeFileSync(runtimePath, originalRuntime)
    writeFileSync(statusPath, originalStatus)
    if (originalRunner == null) rmSync(runnerPath, { force: true })
    else writeFileSync(runnerPath, originalRunner)
    rmSync(invocationPath, { force: true })
  }
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
  assert.equal(jobs.jobs.find((job) => job.name === 'research-fish-autoresearch-nightly').enabled, false)
  assert.equal(jobs.jobs.find((job) => job.name === 'admin-autoresearch-nightly-watch').schedule.expr, '45 10 * * *')
  assert.equal(strategyConfig.primaryModel, 'gpt-5.4')
  assert.equal(manualConfig.hardMinutes, 180)
})

test('autoresearch continuation seed carries forward the latest successful evolve run', async () => {
  const deliveryMemory = await control.getAutoResearchCodeDeliveryMemory({
    targetPath: join(openclawHome, 'openclaw-office'),
    targetLabel: 'AutoPen',
  })
  const continuation = await control.getAutoResearchContinuationSeed({
    researchKind: 'evolve',
    targetPath: join(openclawHome, 'openclaw-office'),
    targetLabel: 'AutoPen',
  })
  const topic = control.buildContinuedResearchTopic(
    'evolve',
    '請延續 AutoPen 的程式進化，直接改碼、驗證結果，並整理下一輪方向。',
    continuation,
    deliveryMemory,
  )

  assert.equal(deliveryMemory.entryCount, 3)
  assert.equal(deliveryMemory.passCount, 2)
  assert.equal(deliveryMemory.needsWorkCount, 1)
  assert.match(deliveryMemory.verifiedPatterns[0].summary, /驗證通過/)
  assert.match(deliveryMemory.avoidPatterns[0].summary, /先別重複投入同一路徑/)
  assert.match(deliveryMemory.recentNextSteps[0], /直接啟動下一輪 AutoPen 程式進化/)
  assert.equal(continuation.runTag, 'manual-20260328-0215')
  assert.equal(continuation.targetLabel, 'AutoPen')
  assert.match(continuation.headline, /可延續的程式進化模式/)
  assert.match(continuation.nextStepsSummary, /直接啟動下一輪 AutoPen 程式進化/)
  assert.match(topic, /延續上下文/)
  assert.match(topic, /交付記憶/)
  assert.match(topic, /上一輪瓶頸：AutoPen 缺少可延續的研究流程回饋/)
  assert.match(topic, /這輪優先延續：直接啟動下一輪 AutoPen 程式進化/)
  assert.match(topic, /最近最穩方向：/)
  assert.match(topic, /近期先避開：/)
})

test('fleet readiness candidates surface blocked and monitor fish for OpenClaw evolve topics', async () => {
  const statusPath = join(agentDir, 'status.json')
  const originalStatus = readFileSync(statusPath, 'utf-8')

  try {
    writeFileSync(
      statusPath,
      JSON.stringify({
        fish: {
          'research-fish': {
            phase: 'EXECUTING',
            currentTask: 'AutoResearch program evolve (manual-20260329-1200)',
            lastAction: 'Evolving OpenClaw',
            lastActionAt: '2026-03-29T04:10:00.000Z',
            nextStep: 'wait',
            health: 'green',
            blockers: [],
          },
          invoice: {
            phase: 'BLOCKED',
            currentTask: null,
            lastAction: '最新有效執行訊號仍受阻：報價 20260315-004 的 invoice handoff 尚未 ready。',
            lastActionAt: '2026-03-29T04:00:00.000Z',
            nextStep: '先補齊客戶統編，再重跑 invoice handoff。',
            health: 'yellow',
            blockerCode: 'invoice_missing_tax_id',
            blockers: ['報價 20260315-004 的 invoice handoff 尚未 ready。', '客戶統編'],
          },
          booking: {
            phase: 'IDLE',
            currentTask: null,
            lastAction: '最新有效執行訊號需持續觀察：最新 studio booking request 衝堂待改期。',
            lastActionAt: '2026-03-29T04:12:00.000Z',
            nextStep: '先確認最新 booking request 的上游回應；若為衝堂就改期。',
            health: 'yellow',
            blockerCode: 'booking_conflict_suggested',
            blockers: ['最新 studio booking request 衝堂待改期。', 'requestStatus=conflict_suggested'],
          },
          qa: {
            phase: 'IDLE',
            currentTask: null,
            lastAction: '最新有效執行訊號需持續觀察：今日 health-check 尚未補跑。',
            lastActionAt: '2026-03-29T03:55:00.000Z',
            nextStep: '補跑今日 health-check。',
            health: 'yellow',
            blockers: ['今日 health-check 尚未補跑。'],
          },
          'memory-distiller': {
            phase: 'READY',
            currentTask: 'handoff ready',
            health: 'green',
            blockers: [],
          },
        },
      }, null, 2),
    )

    const candidates = await control.getAutoResearchFleetReadinessCandidates({
      targetPath: openclawHome,
      targetLabel: 'OpenClaw 魚群 Agents',
    })
    const topic = control.buildContinuedResearchTopic(
      'evolve',
      '請先找出這個系統最值得做成可持續進化能力的一個 bottleneck，直接改碼、驗證效果，並整理下一輪可延續的進化方向。',
      null,
      null,
      candidates,
    )

    assert.equal(candidates.entryCount, 3)
    assert.equal(candidates.topCandidate.agentId, 'invoice')
    assert.equal(candidates.topCandidate.blockerCode, 'invoice_missing_tax_id')
    assert.equal(candidates.candidates[1].agentId, 'booking')
    assert.equal(candidates.candidates[1].blockerCode, 'booking_conflict_suggested')
    assert.match(candidates.candidates[0].preview, /invoice_missing_tax_id/)
    assert.match(candidates.candidates[1].preview, /booking_conflict_suggested/)
    assert.match(topic, /目前魚群 readiness 候選/)
    assert.match(topic, /blockerCode/)
    assert.match(topic, /invoice_missing_tax_id/)
    assert.match(topic, /booking_conflict_suggested/)
    assert.match(topic, /invoice/)
    assert.match(topic, /booking/)
    assert.match(topic, /只挑一個最高槓桿 bottleneck/)
  } finally {
    writeFileSync(statusPath, originalStatus)
  }
})

test('buildFleetReadinessCandidateSignal returns structured top-candidate fields', () => {
  const signal = control.buildFleetReadinessCandidateSignal({
    agentId: 'invoice',
    severity: 'blocked',
    summary: '報價 20260315-004 的 invoice handoff 尚未 ready。',
    blockerCode: 'invoice_missing_tax_id',
    blockerLabel: '缺客戶統編',
    nextStep: '先補齊客戶統編，再重跑 invoice handoff。',
  })

  assert.equal(signal.readinessCandidateAgentId, 'invoice')
  assert.equal(signal.readinessCandidateSeverity, 'blocked')
  assert.equal(signal.readinessCandidateSummary, '報價 20260315-004 的 invoice handoff 尚未 ready。')
  assert.equal(signal.readinessCandidateBlockerCode, 'invoice_missing_tax_id')
  assert.equal(signal.readinessCandidateBlockerLabel, '缺客戶統編')
  assert.equal(signal.readinessCandidateNextStep, '先補齊客戶統編，再重跑 invoice handoff。')
  assert.equal(signal.readinessCandidateSource, 'fleet-readiness-top-candidate')
  assert.match(signal.readinessCandidatePreview, /invoice_missing_tax_id/)
})

test('autoresearch GET returns improve snapshot for code-improvement mode', async () => {
  const runtimePath = join(controlRoomDir, 'runtime.json')
  const statusPath = join(agentDir, 'status.json')
  const originalRuntime = readFileSync(runtimePath, 'utf-8')
  const originalStatus = readFileSync(statusPath, 'utf-8')

  try {
    writeFileSync(
      runtimePath,
      JSON.stringify({
        status: 'completed',
        note: 'AutoResearch 已完成這輪程式改善。',
        runTag: 'manual-20260328-0105',
        mode: 'improve',
        source: 'ui',
        researchKind: 'improve',
        researchTopic: '請先修 AutoPen 最影響 SEO 的一個問題，直接改碼並驗證結果。',
        targetPath: join(openclawHome, 'openclaw-office'),
        targetLabel: 'AutoPen',
        softMinutes: 90,
        hardMinutes: 120,
        maxExperiments: 6,
        outputLogPath: join(controlRoomDir, 'manual-run.log'),
        startedAt: '2026-03-28T01:05:00.000Z',
        finishedAt: '2026-03-28T01:42:00.000Z',
        updatedAt: '2026-03-28T01:42:00.000Z',
      }, null, 2),
    )

    writeFileSync(
      statusPath,
      JSON.stringify({
        fish: {
          'research-fish': {
            phase: 'COMPLETED',
            currentTask: 'AutoResearch program improve (manual-20260328-0105)',
            lastAction: 'Improving AutoPen',
            lastActionAt: '2026-03-28T01:42:00.000Z',
            nextStep: 'Review summary',
            health: 'green',
            blockers: [],
          },
          qa: {
            phase: 'PASS',
            currentTask: 'AutoResearch improve QA pass (manual-20260328-0105)',
            health: 'green',
            blockers: [],
          },
          'memory-distiller': {
            phase: 'READY',
            currentTask: 'AutoResearch improve handoff captured (manual-20260328-0105)',
            health: 'green',
            blockers: [],
          },
        },
      }, null, 2),
    )

    const response = await route.GET(createRequestLike({
      headers: { 'x-office-token': 'office-secret' },
    }))
    const payload = await readJsonResponse(response)

    assert.equal(response.status, 200)
    assert.equal(payload.live.researchKind, 'improve')
    assert.equal(payload.repo.activeWorkspaceLabel, 'AutoPen')
    assert.equal(payload.metrics.bestKeepValBpb, null)
    assert.equal(payload.metrics.changedFilesCount, 2)
    assert.equal(payload.metrics.verificationStatus, 'pass')
    assert.equal(payload.highlights.improvementHeadline, '補上 AutoPen SEO 設定儲存反饋')
    assert.equal(payload.highlights.changedFiles[0].path, 'components/SeoSettingsPanel.js')
    assert.equal(payload.highlights.verificationItems[0].command, 'npm run build')
    assert.equal(payload.artifacts.summary.path, join(improveRunDir, 'summary.md'))
    assert.equal(payload.artifacts.result.overallStatus, 'pass')
  } finally {
    writeFileSync(runtimePath, originalRuntime)
    writeFileSync(statusPath, originalStatus)
  }
})

test('autoresearch GET returns evolve snapshot for code-evolution mode', async () => {
  const runtimePath = join(controlRoomDir, 'runtime.json')
  const statusPath = join(agentDir, 'status.json')
  const originalRuntime = readFileSync(runtimePath, 'utf-8')
  const originalStatus = readFileSync(statusPath, 'utf-8')

  try {
    writeFileSync(
      runtimePath,
      JSON.stringify({
        status: 'completed',
        note: 'AutoResearch 已完成這輪程式進化。',
        runTag: 'manual-20260328-0215',
        mode: 'evolve',
        source: 'ui',
        researchKind: 'evolve',
        requestedResearchTopic: '請先找出 AutoPen 最值得做成持續進化能力的一個 bottleneck，直接改碼、驗證效果，並整理下一輪延續方向。',
        researchTopic: '請先找出 AutoPen 最值得做成持續進化能力的一個 bottleneck，直接改碼、驗證效果，並整理下一輪延續方向。',
        targetPath: join(openclawHome, 'openclaw-office'),
        targetLabel: 'AutoPen',
        softMinutes: 120,
        hardMinutes: 150,
        maxExperiments: 8,
        readinessCandidateAgentId: 'invoice',
        readinessCandidateSeverity: 'blocked',
        readinessCandidateSummary: '報價 20260315-004 的 invoice handoff 尚未 ready。',
        readinessCandidateBlockerCode: 'invoice_missing_tax_id',
        readinessCandidateBlockerLabel: '缺客戶統編',
        readinessCandidateNextStep: '先補齊客戶統編，再重跑 invoice handoff。',
        readinessCandidatePreview: 'invoice：報價 20260315-004 的 invoice handoff 尚未 ready。 結構化卡點：缺客戶統編 (invoice_missing_tax_id) 下一步：先補齊客戶統編，再重跑 invoice handoff。',
        readinessCandidateSource: 'fleet-readiness-top-candidate',
        readinessCandidateReason: '已載入目前魚群 readiness 候選；如果上一輪有效方向已不值得延續，這輪會優先從最新 blocker 中只挑一個最高槓桿 bottleneck。',
        outputLogPath: join(controlRoomDir, 'manual-run.log'),
        startedAt: '2026-03-28T02:15:00.000Z',
        finishedAt: '2026-03-28T02:58:00.000Z',
        updatedAt: '2026-03-28T02:58:00.000Z',
      }, null, 2),
    )

    writeFileSync(
      statusPath,
      JSON.stringify({
        fish: {
          'research-fish': {
            phase: 'COMPLETED',
            currentTask: 'AutoResearch program evolve (manual-20260328-0215)',
            lastAction: 'Evolving AutoPen',
            lastActionAt: '2026-03-28T02:58:00.000Z',
            nextStep: 'Review summary',
            health: 'green',
            blockers: [],
          },
          qa: {
            phase: 'PASS',
            currentTask: 'AutoResearch evolve QA pass (manual-20260328-0215)',
            health: 'green',
            blockers: [],
          },
          'memory-distiller': {
            phase: 'READY',
            currentTask: 'AutoResearch evolve handoff captured (manual-20260328-0215)',
            health: 'green',
            blockers: [],
          },
        },
      }, null, 2),
    )

    const response = await route.GET(createRequestLike({
      headers: { 'x-office-token': 'office-secret' },
    }))
    const payload = await readJsonResponse(response)

    assert.equal(response.status, 200)
    assert.equal(payload.live.researchKind, 'evolve')
    assert.equal(payload.repo.activeWorkspaceLabel, 'AutoPen')
    assert.equal(payload.metrics.bestKeepValBpb, null)
    assert.equal(payload.metrics.changedFilesCount, 2)
    assert.equal(payload.metrics.verificationStatus, 'pass')
    assert.equal(payload.metrics.codeDeliveryRunCount, 3)
    assert.equal(payload.metrics.readinessCandidateCount, 0)
    assert.equal(payload.highlights.improvementHeadline, '把 AutoPen 研究流程補成可延續的程式進化模式')
    assert.equal(payload.highlights.changedFiles[0].path, 'components/AutoResearchControlRoom.js')
    assert.equal(payload.highlights.verificationItems[0].command, 'npm run build')
    assert.equal(payload.control.requestedResearchTopic, '請先找出 AutoPen 最值得做成持續進化能力的一個 bottleneck，直接改碼、驗證效果，並整理下一輪延續方向。')
    assert.equal(payload.control.readinessCandidateAgentId, 'invoice')
    assert.equal(payload.control.readinessCandidateBlockerCode, 'invoice_missing_tax_id')
    assert.equal(payload.control.readinessCandidateBlockerLabel, '缺客戶統編')
    assert.equal(payload.control.readinessCandidateSource, 'fleet-readiness-top-candidate')
    assert.match(payload.control.readinessCandidateReason, /readiness 候選/)
    assert.equal(payload.strategy.codeDeliveryMemory.entryCount, 3)
    assert.equal(payload.strategy.codeDeliveryMemory.passCount, 2)
    assert.match(payload.strategy.codeDeliveryMemory.verifiedPatterns[0].summary, /驗證通過/)
    assert.match(payload.strategy.codeDeliveryMemory.avoidPatterns[0].summary, /先別重複投入同一路徑/)
    assert.equal(payload.strategy.fleetReadinessCandidates.entryCount, 0)
    assert.equal(payload.artifacts.summary.path, join(evolveRunDir, 'summary.md'))
    assert.equal(payload.artifacts.result.mode, 'evolve')
    assert.equal(payload.artifacts.evolveRun.startupContext.continuationSourceRunTag, 'manual-20260327-2330')
    assert.equal(payload.artifacts.evolveRun.startupContext.readinessCandidateAgentId, 'invoice')
    assert.equal(payload.artifacts.evolveRun.startupContext.readinessCandidateBlockerCode, 'invoice_missing_tax_id')
    assert.equal(payload.artifacts.evolveRun.startupContext.readinessCandidateBlockerLabel, '缺客戶統編')
    assert.equal(payload.artifacts.evolveRun.startupContext.readinessCandidateSource, 'fleet-readiness-top-candidate')
    assert.equal(payload.artifacts.evolveRun.startupContext.loop.completedIterations, 2)
    assert.match(payload.artifacts.evolveRun.startupContext.resolvedResearchTopic, /延續上下文/)
  } finally {
    writeFileSync(runtimePath, originalRuntime)
    writeFileSync(statusPath, originalStatus)
  }
})

test('autoresearch GET returns fleet readiness candidates for OpenClaw evolve target', async () => {
  const runtimePath = join(controlRoomDir, 'runtime.json')
  const statusPath = join(agentDir, 'status.json')
  const originalRuntime = readFileSync(runtimePath, 'utf-8')
  const originalStatus = readFileSync(statusPath, 'utf-8')

  try {
    writeFileSync(
      runtimePath,
      JSON.stringify({
        status: 'completed',
        note: 'AutoResearch 已完成這輪程式進化。',
        runTag: 'manual-20260329-1200',
        mode: 'evolve',
        source: 'ui',
        researchKind: 'evolve',
        requestedResearchTopic: '請先找出這個系統最值得做成可持續進化能力的一個 bottleneck，直接改碼、驗證效果，並整理下一輪可延續的進化方向。',
        researchTopic: '請先找出這個系統最值得做成可持續進化能力的一個 bottleneck，直接改碼、驗證效果，並整理下一輪可延續的進化方向。',
        targetPath: openclawHome,
        targetLabel: 'OpenClaw 魚群 Agents',
        softMinutes: 120,
        hardMinutes: 150,
        maxExperiments: 8,
        outputLogPath: join(controlRoomDir, 'manual-run.log'),
        startedAt: '2026-03-29T04:00:00.000Z',
        finishedAt: '2026-03-29T04:20:00.000Z',
        updatedAt: '2026-03-29T04:20:00.000Z',
      }, null, 2),
    )

    writeFileSync(
      statusPath,
      JSON.stringify({
        fish: {
          'research-fish': {
            phase: 'COMPLETED',
            currentTask: 'AutoResearch program evolve (manual-20260329-1200)',
            lastAction: 'Evolving OpenClaw',
            lastActionAt: '2026-03-29T04:20:00.000Z',
            nextStep: 'Review summary',
            health: 'green',
            blockers: [],
          },
          invoice: {
            phase: 'BLOCKED',
            currentTask: null,
            lastAction: '最新有效執行訊號仍受阻：報價 20260315-004 的 invoice handoff 尚未 ready。',
            lastActionAt: '2026-03-29T04:00:00.000Z',
            nextStep: '先補齊客戶統編，再重跑 invoice handoff。',
            health: 'yellow',
            blockerCode: 'invoice_missing_tax_id',
            blockers: ['報價 20260315-004 的 invoice handoff 尚未 ready。', '客戶統編'],
          },
          booking: {
            phase: 'IDLE',
            currentTask: null,
            lastAction: '最新有效執行訊號需持續觀察：最新 studio booking request 衝堂待改期。',
            lastActionAt: '2026-03-29T04:12:00.000Z',
            nextStep: '先確認最新 booking request 的上游回應；若為衝堂就改期。',
            health: 'yellow',
            blockerCode: 'booking_conflict_suggested',
            blockers: ['最新 studio booking request 衝堂待改期。', 'requestStatus=conflict_suggested'],
          },
          qa: {
            phase: 'IDLE',
            currentTask: null,
            lastAction: '最新有效執行訊號需持續觀察：今日 health-check 尚未補跑。',
            lastActionAt: '2026-03-29T03:55:00.000Z',
            nextStep: '補跑今日 health-check。',
            health: 'yellow',
            blockers: ['今日 health-check 尚未補跑。'],
          },
          'memory-distiller': {
            phase: 'READY',
            currentTask: 'AutoResearch evolve handoff captured (manual-20260329-1200)',
            health: 'green',
            blockers: [],
          },
        },
      }, null, 2),
    )

    const response = await route.GET(createRequestLike({
      headers: { 'x-office-token': 'office-secret' },
    }))
    const payload = await readJsonResponse(response)

    assert.equal(response.status, 200)
    assert.equal(payload.repo.activeWorkspaceLabel, 'OpenClaw 魚群 Agents')
    assert.equal(payload.metrics.readinessCandidateCount, 3)
    assert.equal(payload.strategy.fleetReadinessCandidates.topCandidate.agentId, 'invoice')
    assert.equal(payload.strategy.fleetReadinessCandidates.topCandidate.blockerCode, 'invoice_missing_tax_id')
    assert.equal(payload.strategy.fleetReadinessCandidates.topCandidate.blockerLabel, '缺客戶統編')
    assert.equal(payload.highlights.readinessTopCandidate.agentId, 'invoice')
    assert.equal(payload.highlights.readinessTopCandidate.blockerCode, 'invoice_missing_tax_id')
    assert.equal(payload.highlights.readinessTopCandidate.blockerLabel, '缺客戶統編')
    assert.equal(payload.highlights.nextRunCandidates[1].agentId, 'booking')
    assert.equal(payload.highlights.nextRunCandidates[1].blockerCode, 'booking_conflict_suggested')
    assert.equal(payload.highlights.nextRunCandidates[1].blockerLabel, 'booking 衝堂待改期')
  } finally {
    writeFileSync(runtimePath, originalRuntime)
    writeFileSync(statusPath, originalStatus)
  }
})

test('autoresearch GET hydrates active control readiness signal from live fleet candidates', async () => {
  const runtimePath = join(controlRoomDir, 'runtime.json')
  const statusPath = join(agentDir, 'status.json')
  const originalRuntime = readFileSync(runtimePath, 'utf-8')
  const originalStatus = readFileSync(statusPath, 'utf-8')

  try {
    writeFileSync(
      runtimePath,
      JSON.stringify({
        status: 'running',
        note: 'AutoResearch 程式進化進行中。',
        runTag: 'manual-20260329-1200',
        mode: 'evolve',
        source: 'ui',
        researchKind: 'evolve',
        requestedResearchTopic: '請先找出這個系統最值得做成可持續進化能力的一個 bottleneck，直接改碼、驗證效果，並整理下一輪可延續的進化方向。',
        researchTopic: '請先找出這個系統最值得做成可持續進化能力的一個 bottleneck，直接改碼、驗證效果，並整理下一輪可延續的進化方向。',
        targetPath: openclawHome,
        targetLabel: 'OpenClaw 魚群 Agents',
        softMinutes: 360,
        hardMinutes: 420,
        maxExperiments: 20,
        childPid: process.pid,
        childProcessGroupId: process.pid,
        outputLogPath: join(controlRoomDir, 'manual-run.log'),
        startedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        updatedAt: new Date().toISOString(),
      }, null, 2),
    )

    writeFileSync(
      statusPath,
      JSON.stringify({
        fish: {
          'research-fish': {
            phase: 'EXECUTING',
            currentTask: 'AutoResearch program evolve (manual-20260329-1200)',
            lastAction: 'Evolving OpenClaw',
            lastActionAt: '2026-03-29T05:15:00.000Z',
            nextStep: 'Review summary',
            health: 'green',
            blockers: [],
          },
          invoice: {
            phase: 'BLOCKED',
            currentTask: null,
            lastAction: '最新有效執行訊號仍受阻：報價 20260315-004 的 invoice handoff 尚未 ready。',
            lastActionAt: '2026-03-29T05:10:00.000Z',
            nextStep: '先補齊報價 20260315-004 的客戶統編，更新 invoice intake 後再重跑 invoice handoff。',
            health: 'yellow',
            blockerCode: 'invoice_missing_tax_id',
            blockers: ['報價 20260315-004 的 invoice handoff 尚未 ready。', '客戶統編'],
          },
          booking: {
            phase: 'IDLE',
            currentTask: null,
            lastAction: '最新有效執行訊號需持續觀察：最新 studio booking request 衝堂待改期。',
            lastActionAt: '2026-03-29T05:12:00.000Z',
            nextStep: '先確認最新 booking request 的上游回應；若為衝堂就改期。',
            health: 'yellow',
            blockerCode: 'booking_conflict_suggested',
            blockers: ['最新 studio booking request 衝堂待改期。', 'requestStatus=conflict_suggested'],
          },
          qa: {
            phase: 'IDLE',
            currentTask: null,
            lastAction: '最新有效執行訊號需持續觀察：今日 health-check 尚未補跑。',
            lastActionAt: '2026-03-29T05:00:00.000Z',
            nextStep: '補跑今日 health-check。',
            health: 'yellow',
            blockers: ['今日 health-check 尚未補跑。'],
          },
          'memory-distiller': {
            phase: 'READY',
            currentTask: 'AutoResearch evolve handoff captured (manual-20260329-1200)',
            health: 'green',
            blockers: [],
          },
        },
      }, null, 2),
    )

    const response = await route.GET(createRequestLike({
      headers: { 'x-office-token': 'office-secret' },
    }))
    const payload = await readJsonResponse(response)

    assert.equal(response.status, 200)
    assert.equal(payload.control.isActive, true)
    assert.equal(payload.control.readinessCandidateAgentId, 'invoice')
    assert.equal(payload.control.readinessCandidateBlockerCode, 'invoice_missing_tax_id')
    assert.equal(payload.control.readinessCandidateBlockerLabel, '缺客戶統編')
    assert.equal(payload.control.readinessCandidateSource, 'live-fallback')
    assert.match(payload.control.readinessCandidateReason, /回補當前鎖定的 blocker/)
  } finally {
    writeFileSync(runtimePath, originalRuntime)
    writeFileSync(statusPath, originalStatus)
  }
})

test('manual max experiments auto-raises after repeated fast cap hits', async () => {
  const manualConfigPath = join(controlRoomDir, 'manual-config.json')
  const originalManualConfig = readFileSync(manualConfigPath, 'utf-8')
  const autoRaiseRunDirs = [
    join(runsDir, 'manual-20260329-0410-evolve-01'),
    join(runsDir, 'manual-20260329-0400-improve-01'),
    join(runsDir, 'manual-20260329-0350-program-01'),
  ]

  try {
    writeFileSync(
      manualConfigPath,
      JSON.stringify({
        version: 1,
        updatedAt: '2026-03-29T01:00:00.000Z',
        softMinutes: 90,
        hardMinutes: 120,
        maxExperiments: 6,
      }, null, 2),
    )

    for (const [index, dir] of autoRaiseRunDirs.entries()) {
      mkdirSync(dir, { recursive: true })
      const mode = index === 0 ? 'evolve' : (index === 1 ? 'improve' : 'program')
      const runTag = index === 0
        ? 'manual-20260329-0410'
        : (index === 1 ? 'manual-20260329-0400' : 'manual-20260329-0350')
      writeFileSync(
        join(dir, 'manifest.json'),
        JSON.stringify({
          runTag,
          mode,
          researchKind: mode,
          targetPath: join(openclawHome, 'openclaw-office'),
          targetLabel: 'AutoPen',
          loop: {
            enabled: true,
            maxIterations: 6,
            completedIterations: 6,
            currentIteration: 6,
            stopReason: 'max-iterations-reached',
            timeBudgetMinutes: 90,
            remainingBudgetMinutes: 38,
          },
        }, null, 2),
      )
      writeFileSync(
        join(dir, 'result.json'),
        JSON.stringify({
          mode,
          headline: `iteration ${index + 1}`,
          problem: '測試自動上調實驗上限',
          overallStatus: 'pass',
          nextSteps: ['繼續下一輪'],
          loop: {
            maxIterations: 6,
            completedIterations: 6,
            stopReason: 'max-iterations-reached',
            timeBudgetMinutes: 90,
            remainingBudgetMinutes: 38,
          },
        }, null, 2),
      )
    }

    const manualControl = await control.getAutoResearchManualConfigSnapshot()
    const persisted = JSON.parse(readFileSync(manualConfigPath, 'utf-8'))

    assert.equal(manualControl.maxExperiments, 8)
    assert.equal(persisted.maxExperiments, 8)
    assert.equal(persisted.autoAdjustedFrom, 6)
    assert.match(manualControl.autoAdjustedReason || '', /撞到實驗上限/)
    assert.equal(manualControl.recentFastCapHitRunTags.length, 3)
  } finally {
    writeFileSync(manualConfigPath, originalManualConfig)
    for (const dir of autoRaiseRunDirs) {
      rmSync(dir, { recursive: true, force: true })
    }
  }
})
