import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const service = await import('../lib/fnb-service.js')

async function configureProvider(provider, { demoMode = true } = {}) {
  const tempDir = mkdtempSync(join(tmpdir(), `openclaw-fnb-${provider}-`))
  process.env.FNB_APP_ENV = provider === 'postgres' ? 'staging' : (demoMode ? 'demo' : 'staging')
  process.env.FNB_DEMO_MODE = demoMode ? '1' : '0'
  process.env.LINE_CHANNEL_SECRET = 'test-line-secret'
  process.env.LINE_CHANNEL_ID = 'test-merchant-channel'
  process.env.FNB_LINE_CHANNEL_SECRET = 'test-line-secret'
  process.env.FNB_LINE_CHANNEL_ID = 'test-merchant-channel'
  process.env.OPENCLAW_OFFICE_DB_PATH = join(tempDir, 'office.db')
  process.env.FNB_SQLITE_PATH = join(tempDir, 'fnb.db')
  delete process.env.LINE_CHANNEL_ACCESS_TOKEN
  delete process.env.LINE_LOGIN_CHANNEL_ID
  delete process.env.LINE_LOGIN_CHANNEL_SECRET
  delete process.env.NEXT_PUBLIC_LINE_LIFF_ID
  delete process.env.LINE_RICH_MENU_IMAGE_BASE64
  delete process.env.FNB_LINE_CHANNEL_ACCESS_TOKEN
  delete process.env.FNB_LINE_LOGIN_CHANNEL_ID
  delete process.env.FNB_LINE_LOGIN_CHANNEL_SECRET
  delete process.env.NEXT_PUBLIC_FNB_LINE_LIFF_ID
  delete process.env.FNB_LINE_RICH_MENU_IMAGE_BASE64
  delete process.env.FNB_LINE_RICH_MENU_IMAGE_BASE64_PATH
  delete process.env.GOOGLE_CLIENT_ID
  delete process.env.GOOGLE_CLIENT_SECRET

  if (provider === 'postgres') {
    process.env.DATABASE_URL = `pg-mem://fnb-${Date.now()}`
    delete process.env.FNB_SQLITE_PATH
  } else {
    delete process.env.DATABASE_URL
  }

  await service.resetFnbServiceForTests()
}

async function assertLowTouchWorkflow(provider) {
  await configureProvider(provider, { demoMode: true })

  const snapshot = await service.getOpsSnapshot()
  assert.equal(snapshot.environment.provider, provider === 'postgres' ? 'postgres' : 'sqlite')
  assert.equal(snapshot.location.name, '阿珠小吃 赤峰店')
  assert.equal(snapshot.merchantProfile.weeklyTimeBudgetMinutes, 15)
  assert.ok(snapshot.pendingApprovals.length >= 1)
  assert.ok(snapshot.pipeline.opsReview.length >= 1)

  const approval = snapshot.pendingApprovals[0]
  const approvalResult = await service.handleMerchantReply(null, 'approve-draft', {
    draftId: approval.draftId,
    actorId: 'test-owner',
  })
  assert.equal(approvalResult.ok, true)

  const afterApproval = await service.getOpsSnapshot()
  assert.equal(afterApproval.pendingApprovals.find((item) => item.draftId === approval.draftId), undefined)
  assert.ok(afterApproval.pipeline.published.find((item) => item.id === approval.draftId))

  const campaignId = afterApproval.latestCampaignPlan.id
  const offerId = afterApproval.offers[0].id

  await service.recordAttribution('line', campaignId, 'coupon-claim', 2, { offerId })
  await service.recordAttribution('google-business-profile', campaignId, 'navigation', 1)

  const digest = await service.generateWeeklyDigest()
  assert.ok(digest.summary.couponClaims >= 2)
  assert.ok(digest.summary.navigations >= 1)
  assert.ok(typeof digest.recommendedNextAction === 'string' && digest.recommendedNextAction.length > 0)
}

async function assertRealMerchantOnboarding(provider) {
  await configureProvider(provider, { demoMode: false })

  assert.equal(await service.getDefaultLocationId(), null)
  assert.deepEqual(await service.listMerchantLocations(), [])
  assert.deepEqual(await service.getServiceStatus(), {
    environment: provider === 'postgres' ? 'staging' : 'staging',
    provider: provider === 'postgres' ? 'postgres' : 'sqlite',
    demoMode: false,
    lineConfigured: false,
    lineLoginConfigured: false,
    liffConfigured: false,
    richMenuImageConfigured: false,
    googleConfigured: false,
  })

  const onboarding = await service.onboardMerchant({
    tenantName: '真實試點餐飲',
    locationName: '真實試點 民生店',
    restaurantType: '麵館',
    address: '台北市松山區民生東路一段 10 號',
    ownerName: '林店長',
    lineUserId: 'line:pilot-owner',
    primaryGoal: '穩定回流與外送淡時促銷',
    toneSummary: '直接、溫暖、不硬銷',
    voice: '直接、溫暖、不硬銷',
    signatureItems: ['紅燒牛肉麵', '炸排骨飯'],
    guardrails: ['避免誇大療效', '避免連發相同促銷'],
    menuItems: [
      { id: 'beef-noodle', name: '紅燒牛肉麵', category: '主食', priceCents: 22000, isSignature: true },
      { id: 'pork-rice', name: '炸排骨飯', category: '主食', priceCents: 18000, isSignature: true },
    ],
    googleLocationName: 'locations/real-pilot',
    merchantTimeBudgetMinutes: 12,
    weeklyTimeBudgetMinutes: 15,
    lowTouchMode: true,
  })

  assert.equal(onboarding.snapshot.location.name, '真實試點 民生店')
  assert.equal(onboarding.snapshot.workspace.provider, provider === 'postgres' ? 'postgres' : 'sqlite')
  assert.equal(onboarding.snapshot.workspace.demoMode, false)
  assert.equal(onboarding.links.merchantBindUrl.includes(onboarding.locationId), true)
  assert.equal(onboarding.links.merchantDashboardUrl.includes(onboarding.locationId), true)
  assert.equal(onboarding.links.opsDashboardUrl.includes(onboarding.locationId), true)

  const locations = await service.listMerchantLocations()
  assert.equal(locations.length, 1)
  assert.equal(locations[0].name, '真實試點 民生店')
  assert.equal(await service.getDefaultLocationId(), onboarding.locationId)

  const operatorContext = await service.resolveOperatorContext('line:pilot-owner')
  assert.equal(operatorContext.operator.displayName, '林店長')
  assert.equal(operatorContext.memberships.length, 1)
  assert.equal(operatorContext.memberships[0].location.id, onboarding.locationId)

  const merchantHome = await service.getMerchantHome('line:pilot-owner')
  assert.equal(merchantHome.location.id, onboarding.locationId)
  assert.equal(merchantHome.settings.merchantProfile.lowTouchMode, true)
  assert.equal(merchantHome.memberships.length, 1)

  const opsSnapshot = await service.getOpsSnapshot()
  assert.equal(opsSnapshot.location.id, onboarding.locationId)
  assert.equal(opsSnapshot.onboardingChecklist.some((item) => item.id === 'menu-items' && item.done), true)
}

test('sqlite provider supports low-touch merchant workflow', { concurrency: false }, async () => {
  await assertLowTouchWorkflow('sqlite')
})

test('postgres provider supports low-touch merchant workflow', { concurrency: false }, async () => {
  await assertLowTouchWorkflow('postgres')
})

test('sqlite provider can onboard a real merchant from an empty workspace', { concurrency: false }, async () => {
  await assertRealMerchantOnboarding('sqlite')
})

test('postgres provider can onboard a real merchant from an empty workspace', { concurrency: false }, async () => {
  await assertRealMerchantOnboarding('postgres')
})

test('line webhook deduplicates redelivery events', { concurrency: false }, async () => {
  await configureProvider('sqlite')
  const snapshot = await service.getOpsSnapshot()
  const approval = snapshot.pendingApprovals[0]

  const payload = {
    events: [
      {
        webhookEventId: 'evt-line-1',
        type: 'message',
        timestamp: Date.now(),
        replyToken: 'reply-token-1',
        source: {
          type: 'user',
          userId: 'line:merchant-azhu',
        },
        message: {
          type: 'text',
          text: `跳過 ${approval.draftId}`,
        },
      },
    ],
  }

  const rawBody = JSON.stringify(payload)
  const signature = createHmac('sha256', process.env.LINE_CHANNEL_SECRET).update(rawBody, 'utf8').digest('base64')

  const first = await service.processLineWebhook(rawBody, signature)
  const second = await service.processLineWebhook(rawBody, signature)

  assert.equal(first.ok, true)
  assert.equal(second.ok, true)
  assert.equal(second.processed[0].status, 'duplicate')

  const after = await service.getOpsSnapshot()
  assert.equal(after.pendingApprovals.find((item) => item.draftId === approval.draftId), undefined)
  assert.equal(after.pipeline.published.find((item) => item.id === approval.draftId), undefined)
})

test('merchant line identity resolves to operator context with multi-location memberships', { concurrency: false }, async () => {
  await configureProvider('sqlite')

  const operatorContext = await service.resolveOperatorContext('line:merchant-azhu')
  assert.equal(operatorContext.operator.displayName, '阿珠老闆娘')
  assert.equal(operatorContext.memberships.length, 2)
  assert.equal(operatorContext.memberships[0].location.name, '阿珠小吃 赤峰店')

  const primaryHome = await service.getMerchantHome('line:merchant-azhu')
  assert.equal(primaryHome.location.name, '阿珠小吃 赤峰店')
  assert.ok(primaryHome.customers.length >= 2)

  const secondaryMembership = operatorContext.memberships.find((membership) => membership.location.name === '阿珠小吃 南西店')
  const secondaryHome = await service.getMerchantHome('line:merchant-azhu', secondaryMembership.location.id)
  assert.equal(secondaryHome.location.name, '阿珠小吃 南西店')
  assert.equal(secondaryHome.customers.length, 1)
})

test('merchant can update lightweight customer tags and notes', { concurrency: false }, async () => {
  await configureProvider('sqlite')

  const home = await service.getMerchantHome('line:merchant-azhu')
  const customer = home.customers[0]

  const notedCustomer = await service.saveCustomerNote(customer.id, '測試備註：常在下雨天訂外帶。', home.operator.id)
  assert.equal(notedCustomer.notes[0].body, '測試備註：常在下雨天訂外帶。')

  const taggedCustomer = await service.setCustomerTags(customer.id, ['熟客', '雨天外帶'], home.operator.id)
  assert.deepEqual(taggedCustomer.tags.map((tag) => tag.tag), ['熟客', '雨天外帶'])
})

test('approval reply is idempotent after draft reaches terminal status', { concurrency: false }, async () => {
  await configureProvider('sqlite')
  const snapshot = await service.getOpsSnapshot()
  const approval = snapshot.pendingApprovals[0]

  const first = await service.handleMerchantReply(null, 'approve-draft', {
    draftId: approval.draftId,
    actorId: 'test-owner',
  })
  const second = await service.handleMerchantReply(null, 'approve-draft', {
    draftId: approval.draftId,
    actorId: 'test-owner',
  })

  assert.equal(first.ok, true)
  assert.equal(second.ok, true)
  assert.ok(String(second.status || '').startsWith('already-'))
})

test('attribution sourceKey deduplicates repeated events', { concurrency: false }, async () => {
  await configureProvider('sqlite')
  const snapshot = await service.getOpsSnapshot()
  const campaignId = snapshot.latestCampaignPlan.id
  const sourceKey = `dedupe-test-${Date.now()}`

  const first = await service.recordAttribution('line', campaignId, 'message', 1, { sourceKey })
  const second = await service.recordAttribution('line', campaignId, 'message', 1, { sourceKey })

  assert.equal(second.duplicated, true)
  assert.equal(first.id, second.id)
})

test('merchant natural language webhook creates task and completion returns approval draft', { concurrency: false }, async () => {
  await configureProvider('sqlite')

  const payload = {
    events: [
      {
        webhookEventId: 'evt-line-nl-1',
        type: 'message',
        timestamp: Date.now(),
        replyToken: 'reply-token-nl-1',
        source: {
          type: 'user',
          userId: 'line:merchant-azhu',
        },
        message: {
          type: 'text',
          text: '幫我寫這週平日下午茶促銷文案，口吻像熟客推薦。',
        },
      },
    ],
  }

  const rawBody = JSON.stringify(payload)
  const signature = createHmac('sha256', process.env.LINE_CHANNEL_SECRET).update(rawBody, 'utf8').digest('base64')
  const webhookResult = await service.processLineWebhook(rawBody, signature)

  assert.equal(webhookResult.ok, true)
  assert.equal(webhookResult.processed[0].result.status, 'draft-ready')
  assert.ok(webhookResult.processed[0].result.replyText.includes('待審核卡片'))

  const homeAfterWebhook = await service.getMerchantHome('line:merchant-azhu')
  assert.equal(homeAfterWebhook.merchantCopilot.tasks[0].status, 'completed')
  assert.ok(homeAfterWebhook.approvals.some((approval) => approval.payload?.origin === 'merchant-copilot'))
})

test('rewrite command moves thread into awaiting input and next message creates rewrite task', { concurrency: false }, async () => {
  await configureProvider('sqlite')

  const initial = await service.submitMerchantCopilotMessage('line:merchant-azhu', null, '幫我寫這週平日下午茶促銷文案')
  assert.equal(initial.status, 'draft-ready')
  const draftId = initial.draft.id

  const rewritePrompt = await service.handleMerchantReply(null, 'rewrite-draft', {
    draftId,
    actorId: 'line:merchant-azhu',
    lineUserId: 'line:merchant-azhu',
  })
  assert.equal(rewritePrompt.status, 'awaiting-input')

  const rewriteTask = await service.submitMerchantCopilotMessage('line:merchant-azhu', null, '更像熟客口吻，縮短成 LINE 推播長度')
  assert.equal(rewriteTask.status, 'draft-ready')
  assert.equal(rewriteTask.task.taskType, 'rewrite-copy')
  assert.equal(rewriteTask.task.context.sourceDraft.id, draftId)
})

test('explicit generate request does not reuse previous draft just because it mentions tone', { concurrency: false }, async () => {
  await configureProvider('sqlite')

  const first = await service.submitMerchantCopilotMessage('line:merchant-azhu', null, '幫我寫這週平日下午茶促銷文案')
  assert.equal(first.task.taskType, 'generate-copy')
  assert.match(first.draft.title, /下午茶|促銷/)

  const second = await service.submitMerchantCopilotMessage('line:merchant-azhu', null, '幫我寫晚餐推薦，口吻像熟客推薦')
  assert.equal(second.status, 'draft-ready')
  assert.equal(second.task.taskType, 'generate-copy')
  assert.equal(second.task.context.sourceDraft, null)
  assert.match(second.draft.title, /晚餐推薦/)
  assert.match(second.draft.body, /晚餐/)
  assert.doesNotMatch(second.draft.body, /平日下午茶/)
})

test('unbound line webhook replies with binding instructions instead of staying silent', { concurrency: false }, async () => {
  await configureProvider('sqlite', { demoMode: false })

  await service.onboardMerchant({
    tenantName: '綁定測試租戶',
    locationName: '綁定測試店',
    restaurantType: '便當',
    ownerName: '測試店長',
  })

  const payload = {
    events: [
      {
        webhookEventId: 'evt-line-unbound-1',
        type: 'message',
        timestamp: Date.now(),
        replyToken: 'reply-token-unbound-1',
        source: {
          type: 'user',
          userId: 'line:unbound-user',
        },
        message: {
          type: 'text',
          text: '幫我寫這週平日下午茶促銷文案',
        },
      },
    ],
  }

  const rawBody = JSON.stringify(payload)
  const signature = createHmac('sha256', process.env.LINE_CHANNEL_SECRET).update(rawBody, 'utf8').digest('base64')
  const result = await service.processLineWebhook(rawBody, signature)

  assert.equal(result.ok, true)
  assert.equal(result.processed[0].status, 'binding-required')
  assert.equal(result.processed[0].result.status, 'binding-required')
  assert.ok(result.processed[0].result.replyText.includes('/api/auth/line/start'))
})

test('line auth callback uri stays normalized when public base url has trailing slash', { concurrency: false }, async () => {
  await configureProvider('sqlite')
  const originalBaseUrl = process.env.FNB_PUBLIC_BASE_URL
  const originalLineLoginChannelId = process.env.LINE_LOGIN_CHANNEL_ID
  const originalLineLoginChannelSecret = process.env.LINE_LOGIN_CHANNEL_SECRET
  process.env.FNB_PUBLIC_BASE_URL = 'https://copilot.bw-space.com/'
  process.env.LINE_LOGIN_CHANNEL_ID = 'test-line-login-channel'
  process.env.LINE_LOGIN_CHANNEL_SECRET = 'test-line-login-secret'

  try {
    const auth = await service.createLineAuthUrl({ origin: 'https://copilot.bw-space.com' })
    const statePayload = service.decodeLineAuthState(auth.state)
    assert.equal(auth.redirectUri, 'https://copilot.bw-space.com/api/auth/line/callback')
    assert.equal(statePayload.redirectUri, 'https://copilot.bw-space.com/api/auth/line/callback')
  } finally {
    if (originalBaseUrl === undefined) {
      delete process.env.FNB_PUBLIC_BASE_URL
    } else {
      process.env.FNB_PUBLIC_BASE_URL = originalBaseUrl
    }
    if (originalLineLoginChannelId === undefined) {
      delete process.env.LINE_LOGIN_CHANNEL_ID
    } else {
      process.env.LINE_LOGIN_CHANNEL_ID = originalLineLoginChannelId
    }
    if (originalLineLoginChannelSecret === undefined) {
      delete process.env.LINE_LOGIN_CHANNEL_SECRET
    } else {
      process.env.LINE_LOGIN_CHANNEL_SECRET = originalLineLoginChannelSecret
    }
  }
})

test('line auth callback uri allowlist accepts normalized callback uri only', { concurrency: false }, async () => {
  await configureProvider('sqlite')
  const originalBaseUrl = process.env.FNB_PUBLIC_BASE_URL
  process.env.FNB_PUBLIC_BASE_URL = 'https://copilot.bw-space.com/'

  try {
    assert.equal(
      service.isAllowedLineAuthCallbackUri(
        'https://copilot.bw-space.com//api/auth/line/callback',
        'https://copilot.bw-space.com',
      ),
      true,
    )
    assert.equal(
      service.isAllowedLineAuthCallbackUri(
        'https://evil.example.com/api/auth/line/callback',
        'https://copilot.bw-space.com',
      ),
      false,
    )
  } finally {
    if (originalBaseUrl === undefined) {
      delete process.env.FNB_PUBLIC_BASE_URL
    } else {
      process.env.FNB_PUBLIC_BASE_URL = originalBaseUrl
    }
  }
})

test('line auth url requires existing merchant location in non-demo mode', { concurrency: false }, async () => {
  await configureProvider('sqlite', { demoMode: false })
  process.env.LINE_LOGIN_CHANNEL_ID = 'test-line-login-channel'
  process.env.LINE_LOGIN_CHANNEL_SECRET = 'test-line-login-secret'
  await service.resetFnbServiceForTests()

  await assert.rejects(
    () => service.createLineAuthUrl({ origin: 'https://copilot.bw-space.com' }),
    /No merchant location is available for LINE login/,
  )
})

test('google warning is suppressed when google oauth is not configured', { concurrency: false }, async () => {
  await configureProvider('sqlite', { demoMode: false })

  const onboarding = await service.onboardMerchant({
    tenantName: 'No Google Pilot',
    locationName: 'No Google 店',
    ownerName: '店長',
    menuItems: [{ id: 'a', name: '套餐 A', category: '主食', priceCents: 12000, isSignature: true }],
  })

  const snapshot = await service.getOpsSnapshot(onboarding.locationId)
  const channelNames = snapshot.channels.map((channel) => channel.channel)
  const googleWarnings = snapshot.alerts.filter((alert) => String(alert.message).includes('google-business-profile'))

  assert.equal(channelNames.includes('google-business-profile'), false)
  assert.equal(googleWarnings.length, 0)
})
