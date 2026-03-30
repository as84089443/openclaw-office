import { test, expect } from '@playwright/test'

const mockedResearchSnapshot = {
  live: {},
  control: {
    status: 'running',
    note: 'AutoResearch 程式進化進行中。',
    isActive: true,
    progressPct: 38,
    softProgressPct: 52,
    runTag: 'manual-20260329-1200',
    researchKind: 'evolve',
    requestedResearchTopic: '請先找出這個系統最值得做成可持續進化能力的一個 bottleneck。',
    researchTopic: '請先找出這個系統最值得做成可持續進化能力的一個 bottleneck，直接改碼、驗證效果，並整理下一輪可延續的進化方向。',
    targetLabel: 'OpenClaw 魚群 Agents',
    targetPath: '/Users/brian/.openclaw',
    continuationSourceRunTag: 'manual-20260329-1130',
    continuationReason: '延續上一輪已浮出的 readiness 候選。',
    codeMemoryReason: '已載入最近交付記憶，避免重複踩到已知無效路線。',
    readinessCandidateAgentId: 'invoice',
    readinessCandidateSeverity: 'blocked',
    readinessCandidateSummary: '報價 20260315-004 的 invoice handoff 尚未 ready。',
    readinessCandidateBlockerCode: 'invoice_missing_tax_id',
    readinessCandidateBlockerLabel: '缺客戶統編',
    readinessCandidateNextStep: '先補齊報價 20260315-004 的客戶統編，更新 invoice intake 後再重跑 invoice handoff。',
    readinessCandidatePreview: 'invoice / 缺客戶統編 (invoice_missing_tax_id)',
    readinessCandidateSource: 'live-fallback',
    readinessCandidateReason: '這輪起跑於 readiness persistence 上線前，已從目前共享 fleet readiness 候選回補當前鎖定的 blocker。',
  },
  repo: {
    activeWorkspaceLabel: 'OpenClaw 魚群 Agents',
    activeWorkspacePath: '/Users/brian/.openclaw',
    projectDir: '/Users/brian/.openclaw',
    researchKind: 'evolve',
  },
  strategy: {
    researchKind: 'evolve',
    primaryModel: 'gpt-5.3-codex',
    breakthroughModel: 'gpt-5.4',
    availableModels: ['gpt-5.3-codex', 'gpt-5.4'],
    userResearchTopic: '請先找出這個系統最值得做成可持續進化能力的一個 bottleneck，直接改碼、驗證效果，並整理下一輪可延續的進化方向。',
    currentLane: {},
    nextLane: {},
    searchSpace: { lanes: [], allowedFiles: [], orchestration: {} },
    researchMemory: { recommendedPatterns: [], avoidPatterns: [], entryCount: 0 },
    codeDeliveryMemory: {
      verifiedPatterns: [],
      avoidPatterns: [],
      recentNextSteps: [],
      entryCount: 0,
      passCount: 0,
      passRate: null,
      updatedAt: null,
    },
    fleetReadinessCandidates: {
      entryCount: 1,
      updatedAt: '2026-03-29T04:12:00.000Z',
      topCandidate: {
        agentId: 'invoice',
        severity: 'blocked',
        summary: '報價 20260315-004 的 invoice handoff 尚未 ready。',
        blockerCode: 'invoice_missing_tax_id',
        blockerLabel: '缺客戶統編',
        nextStep: '先補齊報價 20260315-004 的客戶統編，更新 invoice intake 後再重跑 invoice handoff。',
        preview: 'invoice / 缺客戶統編 (invoice_missing_tax_id)',
      },
      candidates: [
        {
          agentId: 'invoice',
          severity: 'blocked',
          summary: '報價 20260315-004 的 invoice handoff 尚未 ready。',
          blockerCode: 'invoice_missing_tax_id',
          blockerLabel: '缺客戶統編',
          nextStep: '先補齊報價 20260315-004 的客戶統編，更新 invoice intake 後再重跑 invoice handoff。',
          preview: 'invoice / 缺客戶統編 (invoice_missing_tax_id)',
        },
      ],
    },
  },
  manualControl: {
    softMinutes: 120,
    hardMinutes: 180,
    maxExperiments: 8,
  },
  schedule: {
    nightly: { enabled: true, timeValue: '02:30' },
    watch: { enabled: true, timeValue: '10:45' },
  },
  metrics: {
    bestKeepValBpb: null,
    baselineValBpb: null,
    deltaFromBaseline: null,
    latestMemoryGb: 5.8,
    revalidationVerdict: null,
    revalidationMeanValBpb: null,
    revalidationSpread: null,
  },
  highlights: {
    qaVerdict: 'pass',
    qaVerdictNote: 'QA 檢查通過。',
    peakMemory: '5.8 GB',
    changedFiles: [],
    verificationItems: [],
    improvementNextSteps: [],
  },
  artifacts: {
    evolveRun: {
      manifest: {
        loop: {
          currentIteration: 14,
          completedIterations: 13,
          maxIterations: 20,
        },
      },
      startupContext: {
        requestedResearchTopic: '請先找出這個系統最值得做成可持續進化能力的一個 bottleneck。',
        resolvedResearchTopic: '請先找出這個系統最值得做成可持續進化能力的一個 bottleneck，直接改碼、驗證效果，並整理下一輪可延續的進化方向。',
        continuationSourceRunTag: 'manual-20260329-1130',
        threadId: '019d37c0-08fb-71b0-a969-78e8170c7442',
        iteration: 14,
        loop: {
          completedIterations: 13,
        },
        readinessCandidateAgentId: 'invoice',
        readinessCandidateBlockerCode: 'invoice_missing_tax_id',
        readinessCandidateBlockerLabel: '缺客戶統編',
        readinessCandidateSource: 'live-fallback',
        readinessCandidateReason: '這輪起跑於 readiness persistence 上線前，已從目前共享 fleet readiness 候選回補當前鎖定的 blocker。',
        readinessCandidateNextStep: '先補齊報價 20260315-004 的客戶統編，更新 invoice intake 後再重跑 invoice handoff。',
      },
      codexEvents: [],
    },
    summary: {
      path: '/Users/brian/.openclaw/artifacts/manual/summary.md',
    },
    qaReport: {
      path: '/Users/brian/.openclaw/artifacts/manual/qa-check.md',
    },
    revalidationReport: {
      path: '/Users/brian/.openclaw/artifacts/manual/revalidation.md',
    },
  },
}

function buildMockedResearchSnapshot({
  control = {},
  startupContext = {},
} = {}) {
  return {
    ...mockedResearchSnapshot,
    control: {
      ...mockedResearchSnapshot.control,
      ...control,
    },
    artifacts: {
      ...mockedResearchSnapshot.artifacts,
      evolveRun: {
        ...mockedResearchSnapshot.artifacts.evolveRun,
        startupContext: {
          ...mockedResearchSnapshot.artifacts.evolveRun.startupContext,
          ...startupContext,
        },
      },
    },
  }
}

const mockedIdleResearchSnapshot = buildMockedResearchSnapshot({
  control: {
    status: 'idle',
    note: '',
    isActive: false,
    progressPct: 0,
    softProgressPct: 0,
    runTag: '',
  },
})

const mockedStartedResearchSnapshot = buildMockedResearchSnapshot({
  control: {
    status: 'running',
    note: 'AutoResearch 程式進化進行中。',
    isActive: true,
    progressPct: 4,
    softProgressPct: 3,
    runTag: 'manual-20260329-1215',
    readinessCandidateSource: 'fleet-readiness-top-candidate',
    readinessCandidateReason: '這輪會優先從目前魚群 readiness top candidate 開始。',
  },
  startupContext: {
    readinessCandidateSource: 'fleet-readiness-top-candidate',
    readinessCandidateReason: '這輪會優先從目前魚群 readiness top candidate 開始。',
  },
})

const mockedStartResponse = {
  runTag: 'manual-20260329-1215',
  researchKind: 'evolve',
  readinessCandidateReason: '這輪會優先從目前魚群 readiness top candidate 開始。',
  readinessCandidateAgentId: 'invoice',
  readinessCandidateBlockerLabel: '缺客戶統編',
  readinessCandidateBlockerCode: 'invoice_missing_tax_id',
  readinessCandidateSource: 'fleet-readiness-top-candidate',
  readinessCandidateNextStep: '先補齊報價 20260315-004 的客戶統編，更新 invoice intake 後再重跑 invoice handoff。',
}

test.describe('Surface Smoke', () => {
  test('homepage shows current BW entry points', async ({ page }) => {
    const response = await page.goto('/', { waitUntil: 'domcontentloaded' })
    expect(response?.status()).toBe(200)

    await expect(page.getByText('OpenClaw BW Copilot')).toBeVisible()
    await expect(page.getByRole('link', { name: /Merchant Copilot/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /Ops Console/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /BW Office/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /Browser Runtime/i })).toBeVisible()
  })

  test('office route opens Boss Inbox dashboard shell', async ({ page }) => {
    const response = await page.goto('/office', { waitUntil: 'domcontentloaded' })
    expect(response?.status()).toBe(200)

    await expect(page.getByText('Boss Inbox')).toBeVisible()
    await expect(page.getByRole('button', { name: /Refresh/i })).toBeVisible()
  })

  test('ops route renders console shell', async ({ page }) => {
    const response = await page.goto('/ops', { waitUntil: 'domcontentloaded' })
    expect(response?.status()).toBe(200)

    await expect(page.getByText(/BW Copilot/i).first()).toBeVisible()
  })

  test('browser route renders runtime dashboard shell', async ({ page }) => {
    const response = await page.goto('/browser', { waitUntil: 'domcontentloaded' })
    expect(response?.status()).toBe(200)

    await expect(page.getByText(/Browser/i).first()).toBeVisible()
  })

  test('research route shows readiness source in the evolve evidence card', async ({ page }) => {
    await page.route('**/api/office/session', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          configured: false,
          authenticated: true,
          authSource: 'disabled',
        }),
      })
    })
    await page.route('**/api/autoresearch', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockedResearchSnapshot),
      })
    })

    const response = await page.goto('/research', { waitUntil: 'domcontentloaded' })
    expect(response?.status()).toBe(200)

    await expect(page.getByText('AutoResearch 控制台')).toBeVisible()
    await expect(page.getByText('自動迭代證據')).toBeVisible()
    await expect(page.getByText(/本輪鎖定卡點：/)).toContainText('invoice')
    await expect(page.getByText(/本輪鎖定卡點：/)).toContainText('缺客戶統編')
    await expect(page.getByText('訊號來源：live snapshot 即時回補 (live-fallback)')).toBeVisible()
    await expect(page.getByText('這輪起跑於 readiness persistence 上線前，已從目前共享 fleet readiness 候選回補當前鎖定的 blocker。')).toBeVisible()
  })

  test('research start notice shows readiness source from the start response', async ({ page }) => {
    let currentSnapshot = mockedIdleResearchSnapshot

    await page.route('**/api/office/session', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          configured: false,
          authenticated: true,
          authSource: 'disabled',
        }),
      })
    })
    await page.route('**/api/autoresearch', async (route) => {
      const method = route.request().method()
      if (method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(currentSnapshot),
        })
        return
      }

      if (method === 'POST') {
        currentSnapshot = mockedStartedResearchSnapshot
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(mockedStartResponse),
        })
        return
      }

      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: `unexpected method: ${method}` }),
      })
    })

    const response = await page.goto('/research', { waitUntil: 'domcontentloaded' })
    expect(response?.status()).toBe(200)

    const startButton = page.getByRole('button', { name: '開始進化' })
    await expect(startButton).toBeEnabled()
    await startButton.click()

    const notice = page.locator('div').filter({ hasText: '已送出程式進化指令' }).last()
    await expect(notice).toBeVisible()
    await expect(notice).toContainText('已送出程式進化指令，這輪執行標記是 manual-20260329-1215。')
    await expect(notice).toContainText('readiness 候選：invoice / 缺客戶統編')
    await expect(notice).toContainText('訊號來源：啟動時鎖定的魚群候選 (fleet-readiness-top-candidate)')
    await expect(notice).toContainText('下一步：先補齊報價 20260315-004 的客戶統編，更新 invoice intake 後再重跑 invoice handoff。')
  })
})

test.describe('API Smoke', () => {
  test('GET /api/health returns JSON', async ({ request }) => {
    const res = await request.get('/api/health')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toBeDefined()
  })

  test('GET /api/config returns canonical config payload', async ({ request }) => {
    const res = await request.get('/api/config')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('agents')
  })

  test('GET /api/stats returns stats payload', async ({ request }) => {
    const res = await request.get('/api/stats')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toBeDefined()
  })

  test('GET /api/workflow returns workflow payload', async ({ request }) => {
    const res = await request.get('/api/workflow')
    expect(res.status()).toBe(200)
  })

  test('GET /api/boss-inbox returns boss inbox payload', async ({ request }) => {
    const authStateRes = await request.get('/api/office/session')
    expect(authStateRes.status()).toBe(200)
    const authState = await authStateRes.json()

    const res = await request.get('/api/boss-inbox')
    if (authState.configured && !authState.authenticated) {
      expect(res.status()).toBe(401)
      return
    }

    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('attentionItems')
  })

  test('GET /api/office/session returns office auth state', async ({ request }) => {
    const res = await request.get('/api/office/session')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('configured')
    expect(body).toHaveProperty('authenticated')
  })
})

test.describe('Routing', () => {
  test('unknown route returns 404', async ({ page }) => {
    const res = await page.goto('/nonexistent-page-xyz', { waitUntil: 'domcontentloaded' })
    expect(res?.status()).toBe(404)
  })
})
