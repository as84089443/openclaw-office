import { createHmac, randomUUID, timingSafeEqual } from 'crypto'
import {
  FnbAttributionRepository,
  FnbCampaignRepository,
  FnbChannelConnectionRepository,
  FnbCustomerRepository,
  FnbMerchantCopilotRepository,
  FnbOperatorRepository,
  FnbTenantRepository,
  getFnbEnvironment,
  getFnbPersistence,
  resetFnbPersistenceForTests,
} from './fnb/persistence.js'
import {
  getGoogleBusinessAdapter,
  getLineMessagingAdapter,
} from './fnb/channels.js'
import {
  buildFallbackMerchantCopilotResult,
  buildMerchantCopilotHelpText,
  buildPromptProfileDefaults,
  inferMerchantCopilotRequest,
} from './fnb/merchant-copilot.js'

const DEMO_TENANT_ID = 'tenant_fnb_demo'
const DEMO_LOCATION_ID = 'location_fnb_demo'
const SECRET_KEYS = new Set(['accessToken', 'refreshToken', 'idToken', 'channelAccessToken', 'clientSecret'])
const LINE_OAUTH_COOKIE_NAME = 'fnb_oauth_line_sid'
const MERCHANT_SESSION_COOKIE_NAME = 'fnb_merchant_session'
const DEFAULT_OAUTH_STATE_TTL_MS = 10 * 60 * 1000
const DEFAULT_MERCHANT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const ALLOWED_REDIRECT_PREFIXES = ['/merchant', '/ops', '/office']
const DRAFT_TERMINAL_STATUSES = new Set(['published', 'skipped'])
const APPROVAL_TERMINAL_STATUSES = new Set(['approved', 'skipped', 'rescheduled'])
const MERCHANT_TASK_TERMINAL_STATUSES = new Set(['completed', 'failed', 'ops-review'])
const MERCHANT_REWRITE_WAIT_STATUSES = new Set(['awaiting-rewrite'])

let servicePromise = null

const now = () => Date.now()

function safeJsonParse(value, fallback = null) {
  if (!value) return fallback
  if (typeof value === 'object') return value
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function timestampToIso(value) {
  return value ? new Date(Number(value)).toISOString() : null
}

function addDays(date, days) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function startOfDay(date = new Date()) {
  const next = new Date(date)
  next.setHours(0, 0, 0, 0)
  return next
}

function startOfWeek(date = new Date()) {
  const next = startOfDay(date)
  const day = next.getDay()
  const diff = day === 0 ? -6 : 1 - day
  return addDays(next, diff)
}

function endOfWeek(date = new Date()) {
  const next = addDays(startOfWeek(date), 6)
  next.setHours(23, 59, 59, 999)
  return next
}

function formatPeriod(date) {
  return new Intl.DateTimeFormat('zh-TW', {
    month: 'numeric',
    day: 'numeric',
  }).format(date)
}

function makeSlug(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`
}

function trimTrailingSlashes(value) {
  return String(value || '').replace(/\/+$/, '')
}

function normalizeBaseUrl(value, fallback = 'http://localhost:4200') {
  const raw = trimTrailingSlashes(value || fallback)
  try {
    const parsed = new URL(raw)
    return `${parsed.protocol}//${parsed.host}`
  } catch {
    return trimTrailingSlashes(fallback)
  }
}

function normalizeCallbackUri(value) {
  if (!value) return null
  try {
    const parsed = new URL(value)
    return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/{2,}/g, '/')}`
  } catch {
    return null
  }
}

export function getPublicBaseUrl(fallback = 'http://localhost:4200') {
  return normalizeBaseUrl(process.env.FNB_PUBLIC_BASE_URL, fallback)
}

export function getLineAuthCallbackUri(fallbackOrigin = 'http://localhost:4200') {
  return new URL('/api/auth/line/callback', getPublicBaseUrl(fallbackOrigin)).toString()
}

export function isAllowedLineAuthCallbackUri(candidateUri, requestOrigin = null) {
  const normalizedCandidate = normalizeCallbackUri(candidateUri)
  if (!normalizedCandidate) return false
  const allowed = new Set([
    normalizeCallbackUri(getLineAuthCallbackUri()),
    normalizeCallbackUri(getLineAuthCallbackUri(requestOrigin || getPublicBaseUrl())),
  ].filter(Boolean))
  return allowed.has(normalizedCandidate)
}

function getMerchantLiffId() {
  return process.env.NEXT_PUBLIC_LINE_LIFF_ID || process.env.NEXT_PUBLIC_FNB_LINE_LIFF_ID || ''
}

function getMerchantRichMenuAssetConfigured() {
  return Boolean(
    process.env.LINE_RICH_MENU_IMAGE_BASE64
    || process.env.FNB_LINE_RICH_MENU_IMAGE_BASE64
    || process.env.FNB_LINE_RICH_MENU_IMAGE_BASE64_PATH,
  )
}

function getTokenSigningSecret() {
  return (
    process.env.FNB_INTERNAL_API_TOKEN
    || process.env.LINE_LOGIN_CHANNEL_SECRET
    || process.env.FNB_LINE_LOGIN_CHANNEL_SECRET
    || process.env.LINE_CHANNEL_SECRET
    || process.env.FNB_LINE_CHANNEL_SECRET
    || ''
  )
}

function getRequiredTokenSigningSecret() {
  const secret = getTokenSigningSecret()
  if (secret) return secret
  if (process.env.FNB_DEMO_MODE === '1') return 'fnb-demo-signing-secret'
  throw new Error('Missing token signing secret for LINE auth/session')
}

function normalizeRedirectTo(redirectTo, fallback = '/merchant') {
  const value = String(redirectTo || '').trim()
  if (!value.startsWith('/') || value.startsWith('//')) return fallback
  let parsed
  try {
    parsed = new URL(value, 'http://localhost')
  } catch {
    return fallback
  }
  const allowlisted = ALLOWED_REDIRECT_PREFIXES.some((prefix) => (
    parsed.pathname === prefix || parsed.pathname.startsWith(`${prefix}/`)
  ))
  if (!allowlisted) return fallback
  return `${parsed.pathname}${parsed.search}${parsed.hash}`
}

function encodeSignedPayload(payload) {
  const secret = getRequiredTokenSigningSecret()
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const encodedSignature = createHmac('sha256', secret).update(encodedPayload).digest('base64url')
  return `${encodedPayload}.${encodedSignature}`
}

function decodeSignedPayload(token, expectedType) {
  if (!token || typeof token !== 'string') return null
  const separator = token.lastIndexOf('.')
  if (separator <= 0) return null

  const encodedPayload = token.slice(0, separator)
  const providedSignature = token.slice(separator + 1)
  if (!encodedPayload || !providedSignature) return null

  const secret = getTokenSigningSecret() || (process.env.FNB_DEMO_MODE === '1' ? 'fnb-demo-signing-secret' : '')
  if (!secret) return null
  const expectedSignature = createHmac('sha256', secret).update(encodedPayload).digest('base64url')

  const left = Buffer.from(expectedSignature)
  const right = Buffer.from(providedSignature)
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null

  let payload = null
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'))
  } catch {
    return null
  }

  if (!payload || payload.type !== expectedType) return null
  if (Number(payload.expiresAt || 0) < now()) return null
  return payload
}

function createLineOAuthStateToken({ locationId, redirectTo, redirectUri, stateNonce, nonce }) {
  const issuedAt = now()
  return encodeSignedPayload({
    type: 'line-oauth-state',
    locationId,
    redirectTo: normalizeRedirectTo(redirectTo, '/merchant'),
    redirectUri,
    stateNonce,
    nonce,
    issuedAt,
    expiresAt: issuedAt + DEFAULT_OAUTH_STATE_TTL_MS,
  })
}

function createMerchantSessionToken({ lineUserId, operatorId, defaultLocationId = null }) {
  const issuedAt = now()
  return encodeSignedPayload({
    type: 'merchant-session',
    lineUserId,
    operatorId: operatorId || null,
    defaultLocationId,
    issuedAt,
    expiresAt: issuedAt + DEFAULT_MERCHANT_SESSION_TTL_MS,
  })
}

function buildMerchantBindUrl(locationId, redirectTo = '/merchant') {
  const url = new URL('/api/auth/line/start', getPublicBaseUrl())
  if (locationId) url.searchParams.set('locationId', locationId)
  url.searchParams.set('redirectTo', redirectTo)
  return url.toString()
}

function buildMerchantDashboardUrl(locationId, tab = 'approvals') {
  const url = new URL('/merchant', getPublicBaseUrl())
  if (locationId) url.searchParams.set('locationId', locationId)
  if (tab) url.searchParams.set('tab', tab)
  return url.toString()
}

function buildOpsDashboardUrl(locationId) {
  const url = new URL('/ops', getPublicBaseUrl())
  if (locationId) url.searchParams.set('locationId', locationId)
  return url.toString()
}

function sanitizeMetadata(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeMetadata(item))
  }
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !SECRET_KEYS.has(key))
      .map(([key, item]) => [key, sanitizeMetadata(item)])
  )
}

function normalizeLocation(row) {
  if (!row) return null
  return {
    id: row.id,
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    tenantPlan: row.tenant_plan,
    name: row.name,
    restaurantType: row.restaurant_type,
    address: row.address,
    merchantTimeBudgetMinutes: Number(row.merchant_time_budget_minutes || 15),
    status: row.status,
  }
}

function normalizeProfile(row) {
  if (!row) return null
  return {
    locationId: row.location_id,
    ownerName: row.owner_name,
    lineUserId: row.line_user_id,
    primaryGoal: row.primary_goal,
    weeklyTimeBudgetMinutes: Number(row.weekly_time_budget_minutes || 15),
    lowTouchMode: Boolean(row.low_touch_mode),
    toneSummary: row.tone_summary,
    notes: row.notes,
    updatedAt: timestampToIso(row.updated_at),
  }
}

function normalizeBrandPack(row) {
  if (!row) return null
  return {
    locationId: row.location_id,
    voice: row.voice,
    signatureItems: safeJsonParse(row.signature_items_json, []),
    guardrails: safeJsonParse(row.guardrails_json, []),
    seasonalFocus: row.seasonal_focus,
    updatedAt: timestampToIso(row.updated_at),
  }
}

function normalizeConnection(row, { includeSecrets = false } = {}) {
  if (!row) return null
  const metadata = safeJsonParse(row.metadata_json, {})
  return {
    id: row.id,
    locationId: row.location_id,
    channel: row.channel,
    status: row.status,
    metadata: includeSecrets ? metadata : sanitizeMetadata(metadata),
    lastSyncedAt: timestampToIso(row.last_synced_at),
    lastError: row.last_error,
    expiresAt: timestampToIso(row.expires_at),
  }
}

function normalizeOperatorContext(row) {
  if (!row?.identity) return null
  const memberships = (row.memberships || []).map((membership) => ({
    id: membership.membership_id,
    role: membership.membership_role || membership.operator_role,
    isDefault: Boolean(membership.is_default),
    location: {
      id: membership.location_id,
      tenantId: membership.tenant_id,
      tenantName: membership.tenant_name,
      tenantPlan: membership.tenant_plan,
      name: membership.location_name,
      restaurantType: membership.restaurant_type,
      address: membership.address,
      status: membership.location_status,
    },
  }))

  return {
    lineUserId: row.identity.provider_user_id,
    operator: {
      id: row.identity.operator_id,
      tenantId: row.identity.tenant_id,
      displayName: row.identity.operator_display_name || row.identity.display_name,
      role: row.identity.operator_role,
      status: row.identity.operator_status,
      pictureUrl: row.identity.picture_url,
    },
    identity: {
      id: row.identity.id,
      displayName: row.identity.display_name,
      pictureUrl: row.identity.picture_url,
      metadata: safeJsonParse(row.identity.metadata_json, {}),
      status: row.identity.status,
    },
    memberships,
  }
}

function normalizeCustomer(row) {
  if (!row) return null
  return {
    id: row.id,
    locationId: row.location_id,
    displayName: row.display_name,
    source: row.source,
    status: row.status,
    loyaltyStage: row.loyalty_stage,
    phone: row.phone,
    email: row.email,
    lastInteractionAt: timestampToIso(row.last_interaction_at),
    totalInteractions: Number(row.total_interactions || 0),
    activity: {
      lastEventType: row.last_event_type || null,
      lastEventAt: timestampToIso(row.last_event_at),
      couponClaims: Number(row.coupon_claims || 0),
      messageCount: Number(row.message_count || 0),
      friendAdds: Number(row.friend_adds || 0),
      visitSignals: Number(row.visit_signals || 0),
    },
    tags: (row.tags || []).map((tag) => ({
      id: tag.id,
      tag: tag.tag,
      createdBy: tag.created_by,
      createdAt: timestampToIso(tag.created_at),
    })),
    notes: (row.notes || []).map((note) => ({
      id: note.id,
      body: note.body,
      createdBy: note.created_by,
      createdAt: timestampToIso(note.created_at),
    })),
    createdAt: timestampToIso(row.created_at),
    updatedAt: timestampToIso(row.updated_at),
  }
}

function normalizeMerchantPromptProfile(row) {
  if (!row) return null
  return {
    locationId: row.location_id,
    preferredLanguage: row.preferred_language || 'zh-TW',
    toneSummary: row.tone_summary || '',
    forbiddenPhrases: safeJsonParse(row.forbidden_phrases_json, []),
    preferredCtas: safeJsonParse(row.preferred_ctas_json, []),
    promoPreferences: safeJsonParse(row.promo_preferences_json, {}),
    updatedAt: timestampToIso(row.updated_at),
  }
}

function normalizeMerchantThread(row) {
  if (!row) return null
  return {
    id: row.id,
    tenantId: row.tenant_id,
    locationId: row.location_id,
    operatorId: row.operator_id,
    source: row.source,
    status: row.status,
    title: row.title,
    summary: row.summary,
    latestTaskId: row.latest_task_id,
    metadata: safeJsonParse(row.metadata_json, {}),
    lastMessageAt: timestampToIso(row.last_message_at),
    createdAt: timestampToIso(row.created_at),
    updatedAt: timestampToIso(row.updated_at),
  }
}

function normalizeMerchantMessage(row) {
  if (!row) return null
  return {
    id: row.id,
    threadId: row.thread_id,
    tenantId: row.tenant_id,
    locationId: row.location_id,
    operatorId: row.operator_id,
    externalEventId: row.external_event_id,
    role: row.role,
    source: row.source,
    messageType: row.message_type,
    intent: row.intent,
    body: row.body,
    metadata: safeJsonParse(row.metadata_json, {}),
    createdAt: timestampToIso(row.created_at),
  }
}

function normalizeMerchantTask(row) {
  if (!row) return null
  return {
    id: row.id,
    threadId: row.thread_id,
    tenantId: row.tenant_id,
    locationId: row.location_id,
    operatorId: row.operator_id,
    taskType: row.task_type,
    status: row.status,
    source: row.source,
    dedupeKey: row.dedupe_key,
    title: row.title,
    instructionText: row.instruction_text,
    context: safeJsonParse(row.context_json, {}),
    outputDraftId: row.output_draft_id,
    confidence: row.confidence === null || row.confidence === undefined ? null : Number(row.confidence),
    assignedTo: row.assigned_to,
    handoffRef: row.handoff_ref,
    errorMessage: row.error_message,
    startedAt: timestampToIso(row.started_at),
    completedAt: timestampToIso(row.completed_at),
    createdAt: timestampToIso(row.created_at),
    updatedAt: timestampToIso(row.updated_at),
  }
}

function normalizeMerchantTaskEvent(row) {
  if (!row) return null
  return {
    id: row.id,
    taskId: row.task_id,
    locationId: row.location_id,
    eventType: row.event_type,
    payload: safeJsonParse(row.payload_json, {}),
    createdAt: timestampToIso(row.created_at),
  }
}

function normalizeRule(row) {
  return {
    id: row.id,
    locationId: row.location_id,
    name: row.name,
    triggerType: row.trigger_type,
    actionMode: row.action_mode,
    riskTolerance: Number(row.risk_tolerance || 0),
    enabled: Boolean(row.enabled),
    config: safeJsonParse(row.config_json, {}),
    updatedAt: timestampToIso(row.updated_at),
  }
}

function normalizeCampaignPlan(row) {
  if (!row) return null
  return {
    id: row.id,
    locationId: row.location_id,
    periodLabel: row.period_label,
    periodStart: timestampToIso(row.period_start),
    periodEnd: timestampToIso(row.period_end),
    goal: row.goal,
    status: row.status,
    summary: row.summary,
    createdAt: timestampToIso(row.created_at),
    updatedAt: timestampToIso(row.updated_at),
  }
}

function normalizeDraft(row) {
  return {
    id: row.id,
    campaignPlanId: row.campaign_plan_id,
    locationId: row.location_id,
    channel: row.channel,
    draftType: row.draft_type,
    title: row.title,
    body: row.body,
    assetStatus: row.asset_status,
    riskScore: Number(row.risk_score || 0),
    brandFitScore: Number(row.brand_fit_score || 0),
    status: row.status,
    route: row.route,
    scheduledFor: timestampToIso(row.scheduled_for),
    payload: safeJsonParse(row.payload_json, {}),
    createdAt: timestampToIso(row.created_at),
    updatedAt: timestampToIso(row.updated_at),
  }
}

function normalizeApproval(row) {
  return {
    id: row.id,
    draftId: row.draft_id,
    locationId: row.location_id,
    channel: row.channel,
    status: row.status,
    merchantMessage: row.merchant_message,
    title: row.title,
    body: row.body,
    draftStatus: row.draft_status,
    draftType: row.draft_type,
    riskScore: Number(row.risk_score || 0),
    route: row.route,
    payload: safeJsonParse(row.payload_json, {}),
    scheduledFor: timestampToIso(row.scheduled_for),
    lastSentAt: timestampToIso(row.last_sent_at),
    respondedAt: timestampToIso(row.responded_at),
    responsePayload: safeJsonParse(row.response_payload_json, {}),
  }
}

function normalizeDigest(row) {
  if (!row) return null
  return {
    id: row.id,
    locationId: row.location_id,
    periodStart: timestampToIso(row.period_start),
    periodEnd: timestampToIso(row.period_end),
    headline: row.headline,
    summary: safeJsonParse(row.summary_json, {}),
    recommendedNextAction: row.recommended_next_action,
    createdAt: timestampToIso(row.created_at),
  }
}

function normalizeOffer(row) {
  return {
    id: row.id,
    locationId: row.location_id,
    campaignPlanId: row.campaign_plan_id,
    title: row.title,
    code: row.code,
    channel: row.channel,
    ctaUrl: row.cta_url,
    status: row.status,
    redemptionTarget: Number(row.redemption_target || 0),
    maxRedemptions: Number(row.max_redemptions || 0),
    redeemedCount: Number(row.redeemed_count || 0),
    expiresAt: timestampToIso(row.expires_at),
    createdAt: timestampToIso(row.created_at),
  }
}

function normalizeAudit(row) {
  return {
    id: row.id,
    locationId: row.location_id,
    actorType: row.actor_type,
    actorId: row.actor_id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    payload: safeJsonParse(row.payload_json, {}),
    createdAt: timestampToIso(row.created_at),
  }
}

async function createContext() {
  const persistence = await getFnbPersistence()
  const context = {
    environment: getFnbEnvironment(),
    demoMode: persistence.meta.demoMode,
    persistenceKind: persistence.kind,
    tenantRepository: new FnbTenantRepository(persistence.adapter),
    operatorRepository: new FnbOperatorRepository(persistence.adapter),
    campaignRepository: new FnbCampaignRepository(persistence.adapter),
    channelRepository: new FnbChannelConnectionRepository(persistence.adapter),
    attributionRepository: new FnbAttributionRepository(persistence.adapter),
    customerRepository: new FnbCustomerRepository(persistence.adapter),
    merchantCopilotRepository: new FnbMerchantCopilotRepository(persistence.adapter),
    lineAdapter: getLineMessagingAdapter(),
    googleAdapter: getGoogleBusinessAdapter(),
  }

  if (context.demoMode) {
    await ensureDemoData(context)
  }

  return context
}

async function getContext() {
  if (!servicePromise) {
    servicePromise = createContext()
  }
  return servicePromise
}

export async function resetFnbServiceForTests() {
  servicePromise = null
  await resetFnbPersistenceForTests()
}

async function resolveLocationId(context, locationId) {
  if (locationId) return locationId
  const locations = await context.tenantRepository.listLocations()
  return locations[0]?.id || null
}

function ensureLocationId(locationId, reason = 'operation') {
  if (locationId) return locationId
  const error = new Error(`No merchant location is available for ${reason}. Complete onboarding first.`)
  error.code = 'FNB_LOCATION_REQUIRED'
  throw error
}

function resolveMembership(operatorContext, locationId = null) {
  if (!operatorContext) return null
  if (locationId) {
    return operatorContext.memberships.find((membership) => membership.location.id === locationId) || null
  }
  return operatorContext.memberships.find((membership) => membership.isDefault) || operatorContext.memberships[0] || null
}

async function provisionFallbackOperatorFromMerchantProfile(context, lineUserId, locationRow) {
  if (!lineUserId || !locationRow) return null
  const profile = normalizeProfile(await context.tenantRepository.getMerchantProfile(locationRow.id))
  if (!profile || profile.lineUserId !== lineUserId) return null

  const createdAt = now()
  const existingOperator = await context.operatorRepository.findPrimaryOperatorForLocation(locationRow.id)
  const operatorId = await context.operatorRepository.saveOperator({
    id: existingOperator?.id || undefined,
    tenantId: locationRow.tenant_id || locationRow.tenantId,
    displayName: profile.ownerName || '店主',
    role: 'owner',
    status: 'active',
    createdAt,
    updatedAt: createdAt,
  })

  await context.operatorRepository.saveMembership({
    operatorId,
    locationId: locationRow.id,
    role: 'owner',
    isDefault: true,
    createdAt,
    updatedAt: createdAt,
  })

  await context.operatorRepository.saveLineIdentity({
    providerUserId: lineUserId,
    operatorId,
    tenantId: locationRow.tenant_id || locationRow.tenantId,
    displayName: profile.ownerName || '店主',
    pictureUrl: null,
    metadata: { provisionedFrom: 'merchant-profile' },
    status: 'active',
    createdAt,
    updatedAt: createdAt,
  })

  return normalizeOperatorContext(await context.operatorRepository.resolveLineIdentityContext(lineUserId))
}

async function resolveOperatorContextInternal(context, lineUserId) {
  if (!lineUserId) return null
  const direct = await context.operatorRepository.resolveLineIdentityContext(lineUserId)
  if (direct) return normalizeOperatorContext(direct)

  const legacyLocation = await context.tenantRepository.findLocationByLineUserId(lineUserId)
  if (!legacyLocation) return null
  return provisionFallbackOperatorFromMerchantProfile(context, lineUserId, legacyLocation)
}

async function ensureDefaultRules(context, locationId) {
  const existing = await context.channelRepository.listRules(locationId)
  if (existing.length > 0) return

  const updatedAt = now()
  const rules = [
    {
      id: `${locationId}_rule_google_weekly`,
      locationId,
      name: 'Google 每週更新',
      triggerType: 'weekly-calendar',
      actionMode: 'auto-send',
      riskTolerance: 0.3,
      enabled: true,
      config: {
        channels: ['google-business-profile'],
        draftTypes: ['google-update'],
        requiresConnectedChannel: true,
      },
      updatedAt,
    },
    {
      id: `${locationId}_rule_offpeak_line`,
      locationId,
      name: '離峰熟客券',
      triggerType: 'offpeak-window',
      actionMode: 'merchant-approve',
      riskTolerance: 0.45,
      enabled: true,
      config: {
        channels: ['line'],
        draftTypes: ['offpeak-coupon'],
        authorizedWindows: ['Tue', 'Wed', 'Thu'],
      },
      updatedAt,
    },
    {
      id: `${locationId}_rule_review_reply`,
      locationId,
      name: '評論回覆助手',
      triggerType: 'review-inbox',
      actionMode: 'auto-send',
      riskTolerance: 0.25,
      enabled: true,
      config: {
        channels: ['google-business-profile'],
        draftTypes: ['review-reply'],
        negativeSentimentRoute: 'ops-review',
      },
      updatedAt,
    },
    {
      id: `${locationId}_rule_brand_sensitive`,
      locationId,
      name: '品牌敏感促銷',
      triggerType: 'manual-override',
      actionMode: 'ops-review',
      riskTolerance: 1,
      enabled: true,
      config: {
        draftTypes: ['festival-promo', 'controversial-reply'],
      },
      updatedAt,
    },
  ]

  for (const rule of rules) {
    await context.channelRepository.saveRule(rule)
  }
}

async function ensureDemoData(context) {
  const totalTenants = await context.tenantRepository.countTenants()
  const createdAt = now()
  const secondaryLocationId = 'location_fnb_demo_nanshi'
  await context.tenantRepository.saveTenantAndLocation({
    tenantId: DEMO_TENANT_ID,
    tenantName: '河豚餐飲 Growth OS',
    locationId: DEMO_LOCATION_ID,
    locationName: '阿珠小吃 赤峰店',
    restaurantType: '台式小吃',
    address: '台北市大同區赤峰街 23 號',
    merchantTimeBudgetMinutes: 15,
    createdAt,
    updatedAt: createdAt,
  })

  await context.tenantRepository.saveTenantAndLocation({
    tenantId: DEMO_TENANT_ID,
    tenantName: '河豚餐飲 Growth OS',
    locationId: secondaryLocationId,
    locationName: '阿珠小吃 南西店',
    restaurantType: '台式小吃',
    address: '台北市中山區南京西路 18 巷 7 號',
    merchantTimeBudgetMinutes: 15,
    createdAt,
    updatedAt: createdAt,
  })

  await context.tenantRepository.saveMerchantProfile({
    locationId: DEMO_LOCATION_ID,
    ownerName: '阿珠老闆娘',
    lineUserId: 'line:merchant-azhu',
    primaryGoal: '離峰補客與熟客回流',
    weeklyTimeBudgetMinutes: 15,
    lowTouchMode: true,
    toneSummary: '像熟客推薦一樣直接，不賣弄，不喊太多促銷話術。',
    notes: '平日 14:00-17:00 客流最弱，老闆希望系統少打擾。',
    updatedAt: createdAt,
  })

  await context.tenantRepository.saveBrandPack({
    locationId: DEMO_LOCATION_ID,
    voice: '溫暖、直白、像熟客口碑，不過度促銷。',
    signatureItems: ['麻醬麵', '滷肉飯', '紅油抄手'],
    guardrails: ['避免誇大療效', '避免連發相同促銷', '避免用太像連鎖的制式口吻'],
    seasonalFocus: '梅雨季熱湯與外帶需求',
    updatedAt: createdAt,
  })
  await context.merchantCopilotRepository.savePromptProfile({
    locationId: DEMO_LOCATION_ID,
    ...buildPromptProfileDefaults({
      merchantProfile: {
        toneSummary: '像熟客推薦一樣直接，不賣弄，不喊太多促銷話術。',
        weeklyTimeBudgetMinutes: 15,
        lowTouchMode: true,
      },
      brandPack: {
        voice: '溫暖、直白、像熟客口碑，不過度促銷。',
        guardrails: ['避免誇大療效', '避免連發相同促銷', '避免用太像連鎖的制式口吻'],
      },
    }),
    updatedAt: createdAt,
  })

  await context.tenantRepository.saveMerchantProfile({
    locationId: secondaryLocationId,
    ownerName: '阿珠老闆娘',
    lineUserId: null,
    primaryGoal: '平日晚餐時段穩定新客流入',
    weeklyTimeBudgetMinutes: 15,
    lowTouchMode: true,
    toneSummary: '像熟客推薦一樣直接，不賣弄，不喊太多促銷話術。',
    notes: '南西店目前主要拿來測試多店切換與統一入口。',
    updatedAt: createdAt,
  })

  await context.tenantRepository.saveBrandPack({
    locationId: secondaryLocationId,
    voice: '溫暖、直白、像熟客口碑，不過度促銷。',
    signatureItems: ['滷肉飯', '燙青菜'],
    guardrails: ['避免誇大療效', '避免連發相同促銷'],
    seasonalFocus: '商圈晚餐與外帶需求',
    updatedAt: createdAt,
  })
  await context.merchantCopilotRepository.savePromptProfile({
    locationId: secondaryLocationId,
    ...buildPromptProfileDefaults({
      merchantProfile: {
        toneSummary: '像熟客推薦一樣直接，不賣弄，不喊太多促銷話術。',
        weeklyTimeBudgetMinutes: 15,
        lowTouchMode: true,
      },
      brandPack: {
        voice: '溫暖、直白、像熟客口碑，不過度促銷。',
        guardrails: ['避免誇大療效', '避免連發相同促銷'],
      },
    }),
    updatedAt: createdAt,
  })

  await context.tenantRepository.replaceMenuItems(DEMO_LOCATION_ID, [
    { id: 'menu_1', name: '麻醬麵', category: '主食', priceCents: 9500, isSignature: true },
    { id: 'menu_2', name: '滷肉飯', category: '主食', priceCents: 6500, isSignature: true },
    { id: 'menu_3', name: '紅油抄手', category: '小點', priceCents: 8000, isSignature: true },
    { id: 'menu_4', name: '蛤蜊雞湯', category: '湯品', priceCents: 12000, isSignature: false },
  ], createdAt)

  await context.tenantRepository.replaceMenuItems(secondaryLocationId, [
    { id: 'menu_5', name: '滷肉飯', category: '主食', priceCents: 6500, isSignature: true },
    { id: 'menu_6', name: '白菜滷', category: '配菜', priceCents: 5000, isSignature: false },
    { id: 'menu_7', name: '肝連湯', category: '湯品', priceCents: 7000, isSignature: false },
  ], createdAt)

  await context.channelRepository.saveConnection({
    id: 'conn_line_demo',
    locationId: DEMO_LOCATION_ID,
    channel: 'line',
    status: 'connected',
    metadata: {
      accountName: '@azhufood',
      followerCount: 318,
      autopilotEnabled: true,
    },
    lastSyncedAt: createdAt,
  })

  await context.channelRepository.saveConnection({
    id: 'conn_google_demo',
    locationId: DEMO_LOCATION_ID,
    channel: 'google-business-profile',
    status: 'connected',
    metadata: {
      listingName: '阿珠小吃 赤峰店',
      reviewCount: 126,
      averageRating: 4.6,
    },
    lastSyncedAt: createdAt,
  })

  await context.channelRepository.saveConnection({
    id: 'conn_instagram_demo',
    locationId: DEMO_LOCATION_ID,
    channel: 'instagram',
    status: 'planned',
    metadata: {
      note: 'Phase 2: AI 短影音腳本與代發',
    },
  })

  await context.channelRepository.saveConnection({
    id: 'conn_line_demo_nanshi',
    locationId: secondaryLocationId,
    channel: 'line',
    status: 'connected',
    metadata: {
      accountName: '@azhufood',
      followerCount: 122,
      autopilotEnabled: true,
    },
    lastSyncedAt: createdAt,
  })

  await context.channelRepository.saveConnection({
    id: 'conn_google_demo_nanshi',
    locationId: secondaryLocationId,
    channel: 'google-business-profile',
    status: 'pending',
    metadata: {
      listingName: '阿珠小吃 南西店',
    },
    lastSyncedAt: createdAt,
  })

  const operatorId = await context.operatorRepository.saveOperator({
    id: 'operator_demo_owner',
    tenantId: DEMO_TENANT_ID,
    displayName: '阿珠老闆娘',
    role: 'owner',
    status: 'active',
    createdAt,
    updatedAt: createdAt,
  })

  await context.operatorRepository.saveMembership({
    id: 'membership_demo_primary',
    operatorId,
    locationId: DEMO_LOCATION_ID,
    role: 'owner',
    isDefault: true,
    createdAt,
    updatedAt: createdAt,
  })

  await context.operatorRepository.saveMembership({
    id: 'membership_demo_secondary',
    operatorId,
    locationId: secondaryLocationId,
    role: 'owner',
    isDefault: false,
    createdAt,
    updatedAt: createdAt,
  })

  await context.operatorRepository.saveLineIdentity({
    id: 'line_identity_demo_owner',
    providerUserId: 'line:merchant-azhu',
    operatorId,
    tenantId: DEMO_TENANT_ID,
    displayName: '阿珠老闆娘',
    pictureUrl: null,
    metadata: { seed: true, liffReady: true },
    status: 'active',
    createdAt,
    updatedAt: createdAt,
  })

  const customerSeeds = [
    {
      id: 'customer_demo_1',
      locationId: DEMO_LOCATION_ID,
      displayName: '王小姐',
      loyaltyStage: 'repeat',
      lastInteractionAt: createdAt - 1000 * 60 * 60 * 8,
      totalInteractions: 9,
      tags: ['熟客', '愛麻醬麵'],
      notes: ['偏好不要太辣，常在週三下午來店。'],
      activity: { lastEventType: 'coupon-claim', couponClaims: 3, messageCount: 4, friendAdds: 1, visitSignals: 2 },
    },
    {
      id: 'customer_demo_2',
      locationId: DEMO_LOCATION_ID,
      displayName: '陳先生',
      loyaltyStage: 'new',
      lastInteractionAt: createdAt - 1000 * 60 * 60 * 30,
      totalInteractions: 3,
      tags: ['新客', '外帶'],
      notes: ['上次問過蛤蜊雞湯是否可外帶。'],
      activity: { lastEventType: 'message', couponClaims: 0, messageCount: 2, friendAdds: 1, visitSignals: 1 },
    },
    {
      id: 'customer_demo_3',
      locationId: secondaryLocationId,
      displayName: '林小姐',
      loyaltyStage: 'warm',
      lastInteractionAt: createdAt - 1000 * 60 * 60 * 16,
      totalInteractions: 5,
      tags: ['晚餐常客'],
      notes: ['多半在週五下班後來店，偏好湯品。'],
      activity: { lastEventType: 'navigation', couponClaims: 1, messageCount: 1, friendAdds: 1, visitSignals: 3 },
    },
  ]

  for (const seededLocationId of [DEMO_LOCATION_ID, secondaryLocationId]) {
    const customerCount = await context.customerRepository.countCustomers(seededLocationId)
    if (customerCount > 0) continue

    for (const customer of customerSeeds.filter((item) => item.locationId === seededLocationId)) {
      await context.customerRepository.createCustomer({
        id: customer.id,
        locationId: customer.locationId,
        displayName: customer.displayName,
        source: 'line',
        status: 'active',
        loyaltyStage: customer.loyaltyStage,
        lastInteractionAt: customer.lastInteractionAt,
        totalInteractions: customer.totalInteractions,
        createdAt,
        updatedAt: createdAt,
      })
      await context.customerRepository.saveActivitySummary({
        customerId: customer.id,
        locationId: customer.locationId,
        lastEventType: customer.activity.lastEventType,
        lastEventAt: customer.lastInteractionAt,
        couponClaims: customer.activity.couponClaims,
        messageCount: customer.activity.messageCount,
        friendAdds: customer.activity.friendAdds,
        visitSignals: customer.activity.visitSignals,
        updatedAt: createdAt,
      })
      await context.customerRepository.replaceCustomerTags(
        customer.id,
        customer.locationId,
        customer.tags,
        operatorId,
        createdAt
      )
      for (const note of customer.notes) {
        await context.customerRepository.createCustomerNote({
          id: randomUUID(),
          customerId: customer.id,
          locationId: customer.locationId,
          body: note,
          createdBy: operatorId,
          createdAt,
        })
      }
    }
  }

  await ensureDefaultRules(context, DEMO_LOCATION_ID)
  await ensureDefaultRules(context, secondaryLocationId)

  const latestPlan = await context.campaignRepository.getLatestCampaignPlan(DEMO_LOCATION_ID)
  if (!latestPlan) {
    await generateCampaignPlanInternal(context, DEMO_LOCATION_ID)
    await runAutopilotInternal(context, DEMO_LOCATION_ID)
  }

  const recentEvents = await context.attributionRepository.listRecentEvents(DEMO_LOCATION_ID, 1)
  if (recentEvents.length === 0) {
    await seedDemoAttribution(context, DEMO_LOCATION_ID)
  }

  const latestDigest = await context.campaignRepository.getLatestDigest(DEMO_LOCATION_ID)
  if (!latestDigest || totalTenants === 0) {
    await generateWeeklyDigestInternal(context, DEMO_LOCATION_ID)
  }
}

async function listWorkspaceLocationsInternal(context) {
  const rows = await context.tenantRepository.listLocations()
  return rows.map(normalizeLocation)
}

async function seedDemoAttribution(context, locationId) {
  const latestPlan = normalizeCampaignPlan(await context.campaignRepository.getLatestCampaignPlan(locationId))
  if (!latestPlan) return

  const existing = await context.attributionRepository.listRecentEvents(locationId, 1)
  if (existing.length > 0) return

  const drafts = (await context.campaignRepository.listDraftsByPlan(latestPlan.id)).map(normalizeDraft)
  const offers = (await context.campaignRepository.listOffers(locationId)).map(normalizeOffer)
  const offer = offers[0]

  const samples = [
    ['line', 'friend-add', 18, drafts.find((item) => item.channel === 'line')?.id, offer?.id],
    ['line', 'coupon-claim', 9, drafts.find((item) => item.draftType === 'offpeak-coupon')?.id, offer?.id],
    ['line', 'message', 14, drafts.find((item) => item.channel === 'line')?.id, null],
    ['google-business-profile', 'navigation', 11, drafts.find((item) => item.channel === 'google-business-profile')?.id, null],
    ['google-business-profile', 'call', 6, drafts.find((item) => item.channel === 'google-business-profile')?.id, null],
  ]

  for (const [source, eventType, value, draftId, offerId] of samples) {
    await recordAttributionInternal(context, source, latestPlan.id, eventType, value, {
      locationId,
      draftId,
      offerId,
      metadata: { seed: true },
    })
  }

  if (offer) {
    await context.attributionRepository.createCouponRedemption({
      id: randomUUID(),
      offerId: offer.id,
      locationId,
      source: 'counter-scan',
      redeemedAt: now(),
      value: 3,
    })
    await context.attributionRepository.incrementOfferRedemptions(offer.id)
  }
}

async function getRulesForLocation(context, locationId) {
  return (await context.channelRepository.listRules(locationId)).map(normalizeRule)
}

async function getChannelConnection(context, locationId, channel, options = {}) {
  const row = await context.channelRepository.getConnection(locationId, channel)
  return normalizeConnection(row, options)
}

function buildMerchantTabUrl(locationId, tab = 'approvals', params = {}) {
  const url = new URL('/merchant', getPublicBaseUrl())
  url.searchParams.set('tab', tab)
  url.searchParams.set('locationId', locationId)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, value)
    }
  }
  return url.toString()
}

function buildApprovalMessage(draft, locationId) {
  if (draft.payload?.origin === 'merchant-copilot') {
    return [
      '我先幫你整理好一版草稿。',
      `重點：${draft.title}`,
      draft.body,
      `如果要改，請按「再改」後直接回覆修改方向；可直接同意或跳過。`,
      `需要看完整內容可打開：${buildMerchantTabUrl(locationId || draft.locationId, 'approvals', { draftId: draft.id })}`,
    ].join('\n')
  }

  return [
    `這週我幫你準備了一則 ${draft.channel === 'line' ? 'LINE 回流' : 'Google 更新'} 建議。`,
    `重點：${draft.title}`,
    draft.body,
    `直接回覆：同意 ${draft.id} / 延後 ${draft.id} / 跳過 ${draft.id}`,
    `需要看完整內容可打開：${buildMerchantTabUrl(locationId || draft.locationId, 'approvals', { draftId: draft.id })}`,
  ].join('\n')
}

function isMerchantTaskTerminalStatus(status) {
  return MERCHANT_TASK_TERMINAL_STATUSES.has(status)
}

function summarizeInstruction(text, maxLength = 72) {
  const value = String(text || '').replace(/\s+/g, ' ').trim()
  if (!value || value.length <= maxLength) return value
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`
}

async function getOperatorLineUserIdInternal(context, operatorId) {
  if (!operatorId) return null
  const identity = await context.operatorRepository.getLineIdentityByOperatorId(operatorId)
  return identity?.provider_user_id || null
}

async function ensureMerchantPromptProfileInternal(context, locationId, merchantProfile = null, brandPack = null) {
  const existing = normalizeMerchantPromptProfile(await context.merchantCopilotRepository.getPromptProfile(locationId))
  if (existing) return existing

  const resolvedMerchantProfile = merchantProfile || normalizeProfile(await context.tenantRepository.getMerchantProfile(locationId))
  const resolvedBrandPack = brandPack || normalizeBrandPack(await context.tenantRepository.getBrandPack(locationId))
  const defaults = buildPromptProfileDefaults({
    merchantProfile: resolvedMerchantProfile,
    brandPack: resolvedBrandPack,
  })
  const updatedAt = now()
  await context.merchantCopilotRepository.savePromptProfile({
    locationId,
    preferredLanguage: defaults.preferredLanguage,
    toneSummary: defaults.toneSummary,
    forbiddenPhrases: defaults.forbiddenPhrases,
    preferredCtas: defaults.preferredCtas,
    promoPreferences: defaults.promoPreferences,
    updatedAt,
  })
  return {
    locationId,
    ...defaults,
    updatedAt: new Date(updatedAt).toISOString(),
  }
}

async function findOrCreateMerchantThreadInternal(context, { tenantId, locationId, operatorId, source = 'line', title = 'Merchant Copilot' }) {
  const existing = normalizeMerchantThread(await context.merchantCopilotRepository.findThreadByOperator(locationId, operatorId, source))
  if (existing) return existing

  const createdAt = now()
  const id = await context.merchantCopilotRepository.saveThread({
    tenantId,
    locationId,
    operatorId,
    source,
    status: 'active',
    title,
    summary: null,
    latestTaskId: null,
    metadata: {},
    lastMessageAt: createdAt,
    createdAt,
    updatedAt: createdAt,
  })
  return normalizeMerchantThread(await context.merchantCopilotRepository.getThread(id))
}

async function updateMerchantThreadInternal(context, threadId, patch = {}) {
  const current = normalizeMerchantThread(await context.merchantCopilotRepository.getThread(threadId))
  if (!current) return null
  const updatedAt = patch.updatedAt || now()
  const nextLastMessageAt = patch.lastMessageAt ?? (current.lastMessageAt ? new Date(current.lastMessageAt).getTime() : null)
  await context.merchantCopilotRepository.saveThread({
    id: current.id,
    tenantId: current.tenantId,
    locationId: current.locationId,
    operatorId: current.operatorId,
    source: patch.source || current.source,
    status: patch.status ?? current.status,
    title: patch.title ?? current.title,
    summary: patch.summary ?? current.summary,
    latestTaskId: patch.latestTaskId ?? current.latestTaskId,
    metadata: patch.metadata ?? current.metadata,
    lastMessageAt: nextLastMessageAt,
    createdAt: current.createdAt ? new Date(current.createdAt).getTime() : updatedAt,
    updatedAt,
  })
  return normalizeMerchantThread(await context.merchantCopilotRepository.getThread(threadId))
}

async function createMerchantMessageInternal(context, message) {
  const createdAt = message.createdAt || now()
  const persisted = await context.merchantCopilotRepository.createMessage({
    ...message,
    createdAt,
  })
  await updateMerchantThreadInternal(context, message.threadId, {
    lastMessageAt: createdAt,
    summary: summarizeInstruction(message.body),
    updatedAt: createdAt,
  })
  return normalizeMerchantMessage(await context.merchantCopilotRepository.getMessage(persisted.id))
}

async function buildMerchantCopilotTaskContextInternal(context, locationId, instruction, taskType, sourceDraftId = null) {
  const location = normalizeLocation(await context.tenantRepository.getLocation(locationId))
  const merchantProfile = normalizeProfile(await context.tenantRepository.getMerchantProfile(locationId))
  const brandPack = normalizeBrandPack(await context.tenantRepository.getBrandPack(locationId))
  const promptProfile = await ensureMerchantPromptProfileInternal(context, locationId, merchantProfile, brandPack)
  const menuItems = (await context.tenantRepository.listMenuItems(locationId)).map((row) => ({
    id: row.id,
    name: row.name,
    category: row.category,
    isSignature: Boolean(row.is_signature),
  }))
  const latestDrafts = (await context.campaignRepository.listDraftsByLocation(locationId))
    .slice(0, 3)
    .map(normalizeDraft)
  let sourceDraft = sourceDraftId ? normalizeDraft(await context.campaignRepository.getDraftById(sourceDraftId)) : null
  if (!sourceDraft && taskType === 'rewrite-copy') {
    sourceDraft = latestDrafts.find((draft) => !isDraftTerminalStatus(draft.status)) || latestDrafts[0] || null
  }

  return {
    merchantInstruction: instruction,
    location: location ? {
      id: location.id,
      name: location.name,
      restaurantType: location.restaurantType,
    } : null,
    merchantProfile: merchantProfile ? {
      primaryGoal: merchantProfile.primaryGoal,
      toneSummary: merchantProfile.toneSummary,
      weeklyTimeBudgetMinutes: merchantProfile.weeklyTimeBudgetMinutes,
      lowTouchMode: merchantProfile.lowTouchMode,
    } : null,
    promptProfile,
    brandPack: brandPack ? {
      voice: brandPack.voice,
      signatureItems: brandPack.signatureItems,
      guardrails: brandPack.guardrails,
    } : null,
    menuHighlights: menuItems.slice(0, 4),
    latestDrafts: latestDrafts.map((draft) => ({
      id: draft.id,
      title: draft.title,
      body: draft.body,
      channel: draft.channel,
      draftType: draft.draftType,
      status: draft.status,
    })),
    sourceDraft: sourceDraft ? {
      id: sourceDraft.id,
      title: sourceDraft.title,
      body: sourceDraft.body,
      channel: sourceDraft.channel,
      draftType: sourceDraft.draftType,
      status: sourceDraft.status,
    } : null,
  }
}

async function enrichMerchantTaskInternal(context, task) {
  if (!task) return null
  const [events, outputDraft] = await Promise.all([
    context.merchantCopilotRepository.listTaskEvents(task.id, 10),
    task.outputDraftId ? context.campaignRepository.getDraftById(task.outputDraftId) : Promise.resolve(null),
  ])
  return {
    ...task,
    outputDraft: outputDraft ? normalizeDraft(outputDraft) : null,
    events: events.map(normalizeMerchantTaskEvent).reverse(),
  }
}

async function listMerchantThreadsForLocationInternal(context, locationId, { operatorId = null, limit = 6 } = {}) {
  return (await context.merchantCopilotRepository.listThreads(locationId, { operatorId, limit })).map(normalizeMerchantThread)
}

async function listMerchantMessagesForThreadInternal(context, threadId, limit = 20) {
  return (await context.merchantCopilotRepository.listMessages(threadId, limit)).map(normalizeMerchantMessage).reverse()
}

async function listMerchantTasksForLocationInternal(context, locationId, { threadId = null, limit = 8, statuses = [] } = {}) {
  const rows = await context.merchantCopilotRepository.listTasks(locationId, { threadId, limit, statuses })
  return Promise.all(rows.map((row) => enrichMerchantTaskInternal(context, normalizeMerchantTask(row))))
}

async function createOpenClawHandoffInternal(task) {
  try {
    const [{ createRequest, addEvent }, { analyzeTask, AGENTS }] = await Promise.all([
      import('./db.js'),
      import('./workflow.js'),
    ])
    const routing = analyzeTask(task.instructionText || task.title || 'merchant copilot task')
    const assignedAgent = process.env.FNB_MERCHANT_OPENCLAW_AGENT || routing.agent || 'main'
    const requestId = `fnb_merchant_${task.id}`
    createRequest({
      id: requestId,
      content: task.instructionText,
      from: 'F&B Merchant Copilot',
      state: 'assigned',
      assignedTo: assignedAgent,
      task: {
        id: `merchant_task_${task.id}`,
        title: task.title || 'Merchant Copilot',
        detail: task.instructionText,
        targetAgent: assignedAgent,
        reason: 'Merchant natural-language drafting task',
      },
      createdAt: Date.now(),
      source: 'fnb-merchant-copilot',
    })
    addEvent({
      id: `evt_${requestId}`,
      requestId,
      state: 'assigned',
      agent: assignedAgent,
      agentColor: AGENTS[assignedAgent]?.color || '#888',
      agentName: AGENTS[assignedAgent]?.name || assignedAgent,
      message: 'Merchant Copilot task delegated',
      time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
      timestamp: Date.now(),
    })
    return {
      requestId,
      assignedAgent,
    }
  } catch (error) {
    return {
      requestId: null,
      assignedAgent: 'openclaw',
      error: String(error.message || error),
    }
  }
}

async function delegateExistingMerchantCopilotTaskInternal(context, taskId) {
  const task = normalizeMerchantTask(await context.merchantCopilotRepository.getTask(taskId))
  if (!task) throw new Error(`Merchant task not found: ${taskId}`)
  if (isMerchantTaskTerminalStatus(task.status)) return enrichMerchantTaskInternal(context, task)

  const handoff = await createOpenClawHandoffInternal(task)
  const updatedAt = now()
  const updated = normalizeMerchantTask(await context.merchantCopilotRepository.updateTask(taskId, {
    status: 'delegated',
    assignedTo: handoff.assignedAgent || 'openclaw',
    handoffRef: handoff.requestId || task.handoffRef,
    errorMessage: handoff.error || null,
    updatedAt,
  }))
  await context.merchantCopilotRepository.createTaskEvent({
    taskId,
    locationId: task.locationId,
    eventType: 'delegated',
    payload: {
      assignedAgent: handoff.assignedAgent || 'openclaw',
      handoffRef: handoff.requestId || null,
      error: handoff.error || null,
    },
    createdAt: updatedAt,
  })
  await context.tenantRepository.insertAuditLog(task.locationId, 'system', 'merchant-copilot.task.delegated', 'merchant-task', taskId, {
    assignedAgent: handoff.assignedAgent || 'openclaw',
    handoffRef: handoff.requestId || null,
    error: handoff.error || null,
  })
  return enrichMerchantTaskInternal(context, updated)
}

async function submitMerchantCopilotMessageInternal(context, { lineUserId, locationId = null, text, externalEventId = null, source = 'line' }) {
  const { operatorContext, membership } = await resolveOperatorMembershipOrThrow(context, lineUserId, locationId)
  const resolvedLocationId = membership.location.id
  const thread = await findOrCreateMerchantThreadInternal(context, {
    tenantId: operatorContext.operator.tenantId,
    locationId: resolvedLocationId,
    operatorId: operatorContext.operator.id,
    source,
    title: `${membership.location.name} Merchant Copilot`,
  })

  await createMerchantMessageInternal(context, {
    threadId: thread.id,
    tenantId: operatorContext.operator.tenantId,
    locationId: resolvedLocationId,
    operatorId: operatorContext.operator.id,
    externalEventId,
    role: 'merchant',
    source,
    messageType: 'text',
    intent: 'merchant-nl-input',
    body: text,
    metadata: {
      lineUserId,
    },
  })

  const intent = inferMerchantCopilotRequest(text, thread)
  if (intent.mode !== 'task') {
    const helpText = intent.helpText || buildMerchantCopilotHelpText()
    await createMerchantMessageInternal(context, {
      threadId: thread.id,
      tenantId: operatorContext.operator.tenantId,
      locationId: resolvedLocationId,
      operatorId: operatorContext.operator.id,
      role: 'assistant',
      source: 'system',
      messageType: 'text',
      intent: 'fallback-help',
      body: helpText,
      metadata: {},
    })
    await updateMerchantThreadInternal(context, thread.id, {
      status: 'active',
      summary: summarizeInstruction(text),
      metadata: {
        ...thread.metadata,
        pendingRewriteDraftId: null,
      },
    })
    return {
      ok: true,
      status: 'help',
      replyText: helpText,
      threadId: thread.id,
    }
  }

  const taskContext = await buildMerchantCopilotTaskContextInternal(
    context,
    resolvedLocationId,
    intent.instruction,
    intent.taskType,
    intent.sourceDraftId || null,
  )
  const createdAt = now()
  const persisted = await context.merchantCopilotRepository.createTask({
    threadId: thread.id,
    tenantId: operatorContext.operator.tenantId,
    locationId: resolvedLocationId,
    operatorId: operatorContext.operator.id,
    taskType: intent.taskType,
    status: 'queued',
    source,
    dedupeKey: externalEventId ? `${source}:${externalEventId}` : null,
    title: intent.title,
    instructionText: intent.instruction,
    context: taskContext,
    createdAt,
    updatedAt: createdAt,
  })

  const task = normalizeMerchantTask(await context.merchantCopilotRepository.getTask(persisted.id))
  if (persisted.inserted) {
    await context.merchantCopilotRepository.createTaskEvent({
      taskId: task.id,
      locationId: resolvedLocationId,
      eventType: 'created',
      payload: {
        taskType: task.taskType,
        sourceDraftId: intent.sourceDraftId || task.context?.sourceDraft?.id || null,
      },
      createdAt,
    })
    await context.tenantRepository.insertAuditLog(resolvedLocationId, 'merchant', 'merchant-copilot.task.created', 'merchant-task', task.id, {
      taskType: task.taskType,
      instructionText: task.instructionText,
      threadId: thread.id,
    }, operatorContext.operator.id)
  }

  await updateMerchantThreadInternal(context, thread.id, {
    status: 'active',
    summary: summarizeInstruction(text),
    latestTaskId: task.id,
    metadata: {
      ...thread.metadata,
      pendingRewriteDraftId: null,
    },
    lastMessageAt: createdAt,
    updatedAt: createdAt,
  })

  const delegatedTask = persisted.inserted
    ? await delegateExistingMerchantCopilotTaskInternal(context, task.id)
    : await enrichMerchantTaskInternal(context, task)

  return {
    ok: true,
    status: persisted.inserted ? 'task-created' : 'duplicate-task',
    replyText: persisted.inserted
      ? '收到，我正在幫你整理文案，完成後會再推回來。'
      : '收到，這則需求我已經在處理了，完成後會再推回來。',
    threadId: thread.id,
    task: delegatedTask,
  }
}

async function buildMerchantCopilotTaskPayloadInternal(context, taskId) {
  const task = normalizeMerchantTask(await context.merchantCopilotRepository.getTask(taskId))
  if (!task) return null
  const thread = normalizeMerchantThread(await context.merchantCopilotRepository.getThread(task.threadId))
  const messages = thread ? await listMerchantMessagesForThreadInternal(context, thread.id, 12) : []
  return {
    task: await enrichMerchantTaskInternal(context, task),
    thread,
    messages,
  }
}

async function claimNextMerchantCopilotTaskInternal(context) {
  const claimed = normalizeMerchantTask(await context.merchantCopilotRepository.claimNextTask())
  if (!claimed) return null
  const createdAt = now()
  await context.merchantCopilotRepository.createTaskEvent({
    taskId: claimed.id,
    locationId: claimed.locationId,
    eventType: 'claimed',
    payload: {
      assignedTo: claimed.assignedTo,
    },
    createdAt,
  })
  return buildMerchantCopilotTaskPayloadInternal(context, claimed.id)
}

async function completeMerchantCopilotTaskInternal(context, taskId, result = null, confidence = null, metadata = {}) {
  const existingTask = normalizeMerchantTask(await context.merchantCopilotRepository.getTask(taskId))
  if (!existingTask) throw new Error(`Merchant task not found: ${taskId}`)
  if (isMerchantTaskTerminalStatus(existingTask.status)) {
    return {
      ok: true,
      task: await enrichMerchantTaskInternal(context, existingTask),
    }
  }

  const completedAt = now()
  const thread = normalizeMerchantThread(await context.merchantCopilotRepository.getThread(existingTask.threadId))
  const lineUserId = await getOperatorLineUserIdInternal(context, existingTask.operatorId)
  const failedMessage = '這則需求我先交給營運協助處理，稍後再回你。'
  const effectiveConfidence = confidence ?? result?.confidence ?? existingTask.confidence ?? 0.78

  if (metadata?.status === 'failed' || result?.status === 'failed') {
    const failedTask = normalizeMerchantTask(await context.merchantCopilotRepository.updateTask(taskId, {
      status: 'failed',
      confidence: effectiveConfidence,
      errorMessage: metadata.error || result?.error || 'Merchant Copilot task failed',
      completedAt,
      updatedAt: completedAt,
    }))
    await context.merchantCopilotRepository.createTaskEvent({
      taskId,
      locationId: existingTask.locationId,
      eventType: 'failed',
      payload: {
        error: failedTask.errorMessage,
      },
      createdAt: completedAt,
    })
    await context.tenantRepository.insertAuditLog(existingTask.locationId, 'system', 'merchant-copilot.task.failed', 'merchant-task', taskId, {
      error: failedTask.errorMessage,
    })
    if (lineUserId) await context.lineAdapter.pushText(lineUserId, failedMessage)
    return {
      ok: false,
      task: await enrichMerchantTaskInternal(context, failedTask),
    }
  }

  if (effectiveConfidence < 0.55) {
    const reviewedTask = normalizeMerchantTask(await context.merchantCopilotRepository.updateTask(taskId, {
      status: 'ops-review',
      confidence: effectiveConfidence,
      errorMessage: 'Low confidence result routed to ops review',
      completedAt,
      updatedAt: completedAt,
    }))
    await context.merchantCopilotRepository.createTaskEvent({
      taskId,
      locationId: existingTask.locationId,
      eventType: 'ops-review',
      payload: {
        confidence: effectiveConfidence,
      },
      createdAt: completedAt,
    })
    await context.tenantRepository.insertAuditLog(existingTask.locationId, 'system', 'merchant-copilot.task.ops-review', 'merchant-task', taskId, {
      confidence: effectiveConfidence,
    })
    if (lineUserId) await context.lineAdapter.pushText(lineUserId, failedMessage)
    return {
      ok: false,
      task: await enrichMerchantTaskInternal(context, reviewedTask),
    }
  }

  const normalizedResult = result?.kind ? result : buildFallbackMerchantCopilotResult(existingTask)
  if (normalizedResult.kind === 'summary') {
    const summaryTask = normalizeMerchantTask(await context.merchantCopilotRepository.updateTask(taskId, {
      status: 'completed',
      confidence: effectiveConfidence,
      completedAt,
      updatedAt: completedAt,
    }))
    const summaryText = normalizedResult.summaryText || buildMerchantCopilotHelpText()
    await context.merchantCopilotRepository.createTaskEvent({
      taskId,
      locationId: existingTask.locationId,
      eventType: 'completed',
      payload: {
        kind: 'summary',
      },
      createdAt: completedAt,
    })
    await createMerchantMessageInternal(context, {
      threadId: existingTask.threadId,
      tenantId: existingTask.tenantId,
      locationId: existingTask.locationId,
      operatorId: existingTask.operatorId,
      role: 'assistant',
      source: 'merchant-copilot',
      messageType: 'text',
      intent: 'summary-result',
      body: summaryText,
      metadata: {
        taskId,
      },
    })
    await updateMerchantThreadInternal(context, thread?.id || existingTask.threadId, {
      status: 'active',
      latestTaskId: existingTask.id,
      summary: summarizeInstruction(summaryText),
      metadata: {
        ...(thread?.metadata || {}),
        pendingRewriteDraftId: null,
      },
      updatedAt: completedAt,
    })
    if (lineUserId) await context.lineAdapter.pushText(lineUserId, summaryText)
    return {
      ok: true,
      task: await enrichMerchantTaskInternal(context, summaryTask),
    }
  }

  let latestPlan = normalizeCampaignPlan(await context.campaignRepository.getLatestCampaignPlan(existingTask.locationId))
  if (!latestPlan) {
    const created = await generateCampaignPlanInternal(context, existingTask.locationId)
    latestPlan = created.campaignPlan
  }

  const artifact = normalizedResult.draft || {}
  const draftId = existingTask.outputDraftId || randomUUID()
  const persistedDraft = await context.campaignRepository.getDraftById(draftId)
  if (!persistedDraft) {
    await context.campaignRepository.createDraft({
      id: draftId,
      campaignPlanId: latestPlan?.id || null,
      locationId: existingTask.locationId,
      channel: artifact.channel || 'line',
      draftType: artifact.draftType || 'merchant-generated-copy',
      title: artifact.title || existingTask.title || '商家 Copilot 草稿',
      body: artifact.body || existingTask.instructionText,
      assetStatus: 'ready',
      riskScore: artifact.riskScore ?? (existingTask.taskType === 'rewrite-copy' ? 0.34 : 0.28),
      brandFitScore: artifact.brandFitScore ?? 0.86,
      status: 'awaiting-approval',
      route: artifact.route || 'merchant-approve',
      scheduledFor: artifact.scheduledFor ? new Date(artifact.scheduledFor).getTime() : null,
      payload: {
        origin: 'merchant-copilot',
        merchantTaskId: existingTask.id,
        instructionText: existingTask.instructionText,
        sourceDraftId: existingTask.context?.sourceDraft?.id || null,
      },
      createdAt: completedAt,
      updatedAt: completedAt,
    })
  }

  const completedTask = normalizeMerchantTask(await context.merchantCopilotRepository.updateTask(taskId, {
    status: 'completed',
    outputDraftId: draftId,
    confidence: effectiveConfidence,
    completedAt,
    updatedAt: completedAt,
  }))
  await context.merchantCopilotRepository.createTaskEvent({
    taskId,
    locationId: existingTask.locationId,
    eventType: 'completed',
    payload: {
      outputDraftId: draftId,
      confidence: effectiveConfidence,
    },
    createdAt: completedAt,
  })
  await createMerchantMessageInternal(context, {
    threadId: existingTask.threadId,
    tenantId: existingTask.tenantId,
    locationId: existingTask.locationId,
    operatorId: existingTask.operatorId,
    role: 'assistant',
    source: 'merchant-copilot',
    messageType: 'text',
    intent: 'draft-result',
    body: artifact.summaryText || artifact.body || artifact.title || '已完成一版草稿',
    metadata: {
      taskId,
      draftId,
    },
  })
  await updateMerchantThreadInternal(context, thread?.id || existingTask.threadId, {
    status: 'active',
    latestTaskId: existingTask.id,
    summary: summarizeInstruction(artifact.title || artifact.body || existingTask.instructionText),
    metadata: {
      ...(thread?.metadata || {}),
      pendingRewriteDraftId: null,
    },
    updatedAt: completedAt,
  })
  await context.tenantRepository.insertAuditLog(existingTask.locationId, 'system', 'merchant-copilot.task.completed', 'merchant-task', taskId, {
    outputDraftId: draftId,
    confidence: effectiveConfidence,
  })
  await sendApprovalCardInternal(context, existingTask.locationId, draftId, 'line')
  return {
    ok: true,
    task: await enrichMerchantTaskInternal(context, completedTask),
    draft: normalizeDraft(await context.campaignRepository.getDraftById(draftId)),
  }
}

async function evaluateAutopilotInternal(context, locationId, draftId, riskScore = null, ruleSet = null) {
  const resolvedLocationId = await resolveLocationId(context, locationId)
  const draftRow = await context.campaignRepository.getDraftById(draftId)
  if (!draftRow) throw new Error(`Draft not found: ${draftId}`)

  const draft = normalizeDraft(draftRow)
  const effectiveRisk = riskScore ?? draft.riskScore
  const rules = (ruleSet || await getRulesForLocation(context, resolvedLocationId)).filter((rule) => rule.enabled)
  const connection = await getChannelConnection(context, resolvedLocationId, draft.channel)
  const reasons = []

  if (!connection || connection.status !== 'connected') {
    reasons.push('channel disconnected')
    await context.campaignRepository.updateDraftRoute(draftId, 'ops-review', 'needs-ops-review', now())
    await context.tenantRepository.insertAuditLog(resolvedLocationId, 'system', 'autopilot.routed', 'draft', draftId, {
      route: 'ops-review',
      reasons,
      riskScore: effectiveRisk,
    })
    return { route: 'ops-review', status: 'needs-ops-review', reasons, riskScore: effectiveRisk }
  }

  if (draft.assetStatus !== 'ready') {
    reasons.push('missing asset')
    await context.campaignRepository.updateDraftRoute(draftId, 'ops-review', 'needs-ops-review', now())
    await context.tenantRepository.insertAuditLog(resolvedLocationId, 'system', 'autopilot.routed', 'draft', draftId, {
      route: 'ops-review',
      reasons,
      riskScore: effectiveRisk,
    })
    return { route: 'ops-review', status: 'needs-ops-review', reasons, riskScore: effectiveRisk }
  }

  const matchingRules = rules.filter((rule) => {
    const config = rule.config || {}
    const channelMatch = !config.channels || config.channels.includes(draft.channel)
    const typeMatch = !config.draftTypes || config.draftTypes.includes(draft.draftType)
    return channelMatch && typeMatch
  })

  const opsRule = matchingRules.find((rule) => rule.actionMode === 'ops-review')
  if (opsRule) {
    reasons.push(`matched ops rule: ${opsRule.name}`)
    await context.campaignRepository.updateDraftRoute(draftId, 'ops-review', 'needs-ops-review', now())
    await context.tenantRepository.insertAuditLog(resolvedLocationId, 'system', 'autopilot.routed', 'draft', draftId, {
      route: 'ops-review',
      reasons,
      riskScore: effectiveRisk,
    })
    return { route: 'ops-review', status: 'needs-ops-review', reasons, riskScore: effectiveRisk }
  }

  const autoRule = matchingRules.find((rule) => rule.actionMode === 'auto-send' && effectiveRisk <= rule.riskTolerance)
  if (autoRule) {
    reasons.push(`matched auto rule: ${autoRule.name}`)
    await context.campaignRepository.updateDraftRoute(draftId, 'auto-send', 'queued', now())
    await context.tenantRepository.insertAuditLog(resolvedLocationId, 'system', 'autopilot.routed', 'draft', draftId, {
      route: 'auto-send',
      reasons,
      riskScore: effectiveRisk,
    })
    return { route: 'auto-send', status: 'queued', reasons, riskScore: effectiveRisk }
  }

  const approvalRule = matchingRules.find((rule) => rule.actionMode === 'merchant-approve')
  if (approvalRule || effectiveRisk <= 0.55) {
    reasons.push(approvalRule ? `matched approval rule: ${approvalRule.name}` : 'risk requires merchant approval')
    await context.campaignRepository.updateDraftRoute(draftId, 'merchant-approve', 'awaiting-approval', now())
    await context.tenantRepository.insertAuditLog(resolvedLocationId, 'system', 'autopilot.routed', 'draft', draftId, {
      route: 'merchant-approve',
      reasons,
      riskScore: effectiveRisk,
    })
    return { route: 'merchant-approve', status: 'awaiting-approval', reasons, riskScore: effectiveRisk }
  }

  reasons.push('risk above safe threshold')
  await context.campaignRepository.updateDraftRoute(draftId, 'ops-review', 'needs-ops-review', now())
  await context.tenantRepository.insertAuditLog(resolvedLocationId, 'system', 'autopilot.routed', 'draft', draftId, {
    route: 'ops-review',
    reasons,
    riskScore: effectiveRisk,
  })
  return { route: 'ops-review', status: 'needs-ops-review', reasons, riskScore: effectiveRisk }
}

async function sendApprovalCardInternal(context, locationId, draftId, channel = 'line') {
  const resolvedLocationId = await resolveLocationId(context, locationId)
  const draft = normalizeDraft(await context.campaignRepository.getDraftById(draftId))
  if (!draft) throw new Error(`Draft not found: ${draftId}`)

  const merchantProfile = normalizeProfile(await context.tenantRepository.getMerchantProfile(resolvedLocationId))
  const primaryOperator = await context.operatorRepository.findPrimaryOperatorForLocation(resolvedLocationId)
  const lineIdentity = primaryOperator
    ? await context.operatorRepository.getLineIdentityByOperatorId(primaryOperator.id)
    : null
  const recipientLineUserId = lineIdentity?.provider_user_id || merchantProfile?.lineUserId || null
  const message = buildApprovalMessage(draft, resolvedLocationId)
  const existing = await context.campaignRepository.getApprovalByDraft(draftId)
  const approvalId = await context.campaignRepository.saveApprovalRequest({
    id: existing?.id || randomUUID(),
    draftId,
    locationId: resolvedLocationId,
    channel,
    status: 'pending',
    merchantMessage: message,
    lastSentAt: now(),
  })

  let delivery = { ok: true, mode: 'simulated', reason: 'No outbound channel selected' }
  const approvalDetailUrl = buildMerchantTabUrl(resolvedLocationId, 'approvals', { draftId, approvalId })
  if (channel === 'line' && recipientLineUserId) {
    delivery = await context.lineAdapter.pushApprovalRequest(recipientLineUserId, {
      draftId,
      approvalId,
      title: draft.title,
      body: draft.body,
      scheduledFor: draft.scheduledFor,
      riskScore: draft.riskScore,
      rewriteEnabled: draft.payload?.origin === 'merchant-copilot',
      liffUrl: approvalDetailUrl,
    })
  }

  await context.tenantRepository.insertAuditLog(resolvedLocationId, 'system', 'approval.requested', 'draft', draftId, {
    channel,
    sentTo: recipientLineUserId || 'merchant',
    delivery,
  })

  return {
    id: approvalId,
    locationId: resolvedLocationId,
    draftId,
    channel,
    recipient: lineIdentity?.display_name || merchantProfile?.ownerName || '店家',
    message,
    detailUrl: approvalDetailUrl,
    delivery,
    actions: [
      { id: 'approve-draft', label: '同意排程' },
      { id: 'reschedule-draft', label: '延到明天' },
      { id: 'skip-draft', label: '這次先跳過' },
    ],
  }
}

function buildLinePublishMessage(draft) {
  return `${draft.title}\n${draft.body}`
}

function isDraftTerminalStatus(status) {
  return DRAFT_TERMINAL_STATUSES.has(status)
}

function isApprovalTerminalStatus(status) {
  return APPROVAL_TERMINAL_STATUSES.has(status)
}

async function publishScheduledInternal(context, channel, payload) {
  const draftId = payload?.draftId
  const draft = normalizeDraft(await context.campaignRepository.getDraftById(draftId))
  if (!draft) throw new Error(`Draft not found: ${draftId}`)
  if (draft.status === 'published') {
    return {
      ok: true,
      channel,
      draftId,
      mode: 'idempotent',
      status: 'already-published',
    }
  }
  if (draft.status === 'skipped') {
    return {
      ok: false,
      route: 'ops-review',
      reason: 'draft already skipped',
      draftId,
    }
  }

  const connection = await getChannelConnection(context, draft.locationId, channel, { includeSecrets: true })
  if (!connection || connection.status !== 'connected') {
    await context.campaignRepository.updateDraftRoute(draftId, 'ops-review', 'needs-ops-review', now())
    await context.tenantRepository.insertAuditLog(draft.locationId, 'system', 'publish.blocked', 'draft', draftId, {
      channel,
      reason: 'channel disconnected',
    })
    return {
      ok: false,
      route: 'ops-review',
      reason: 'channel disconnected',
    }
  }

  let publishResult
  if (channel === 'line') {
    const recipient = payload?.recipientUserId || connection.metadata?.testRecipientUserId
    if (recipient) {
      publishResult = await context.lineAdapter.pushText(recipient, buildLinePublishMessage(draft))
    } else {
      publishResult = {
        ok: true,
        mode: 'simulated',
        reason: 'LINE audience recipient not configured for pilot',
      }
    }
  } else if (channel === 'google-business-profile') {
    publishResult = await context.googleAdapter.publishDraft(connection, draft, payload)
  } else {
    publishResult = {
      ok: true,
      mode: 'simulated',
      reason: `${channel} adapter not enabled in v1`,
    }
  }

  if (!publishResult.ok) {
    await context.campaignRepository.updateDraftRoute(draftId, 'ops-review', 'needs-ops-review', now())
    await context.channelRepository.saveConnection({
      locationId: draft.locationId,
      channel,
      status: connection.status,
      metadata: connection.metadata,
      lastSyncedAt: now(),
      lastError: publishResult.error,
      expiresAt: connection.expiresAt ? new Date(connection.expiresAt).getTime() : null,
    })
    await context.tenantRepository.insertAuditLog(draft.locationId, 'system', 'publish.failed', 'draft', draftId, {
      channel,
      error: publishResult.error,
    })
    return {
      ok: false,
      route: 'ops-review',
      reason: publishResult.error,
    }
  }

  const scheduledFor = payload?.scheduledFor ? new Date(payload.scheduledFor).getTime() : draft.scheduledFor ? new Date(draft.scheduledFor).getTime() : null
  await context.campaignRepository.updateDraftStatus(draftId, 'published', scheduledFor, now())
  await context.channelRepository.saveConnection({
    locationId: draft.locationId,
    channel,
    status: connection.status,
    metadata: connection.metadata,
    lastSyncedAt: now(),
    lastError: null,
    expiresAt: connection.expiresAt ? new Date(connection.expiresAt).getTime() : null,
  })
  await context.tenantRepository.insertAuditLog(draft.locationId, 'system', 'publish.completed', 'draft', draftId, {
    channel,
    payload,
    publishResult,
  })

  return {
    ok: true,
    channel,
    externalId: `${channel}_${Date.now()}`,
    publishedAt: new Date().toISOString(),
    draftId,
    mode: publishResult.mode,
  }
}

async function handleMerchantReplyInternal(context, locationId, messageIntent, payload = {}) {
  let resolvedLocationId = await resolveLocationId(context, locationId)
  const actedAt = now()

  if (messageIntent === 'approve-draft') {
    const draft = normalizeDraft(await context.campaignRepository.getDraftById(payload.draftId))
    const approvalRow = await context.campaignRepository.getApprovalByDraft(payload.draftId)
    const approval = normalizeApproval(approvalRow)
    if (!draft || !approval) throw new Error('Approval target not found')
    resolvedLocationId = draft.locationId
    if (draft.status === 'published') {
      return {
        ok: true,
        status: 'already-published',
        draftId: draft.id,
      }
    }
    if (isDraftTerminalStatus(draft.status)) {
      return {
        ok: true,
        status: `already-${draft.status}`,
        draftId: draft.id,
      }
    }
    if (isApprovalTerminalStatus(approval.status)) {
      return {
        ok: true,
        status: `already-${approval.status}`,
        draftId: draft.id,
      }
    }

    const updated = await context.campaignRepository.updateApproval(approval.id, 'approved', actedAt, payload, 'pending')
    if (!updated) {
      return {
        ok: true,
        status: 'already-processed',
        draftId: draft.id,
      }
    }
    await context.tenantRepository.insertAuditLog(resolvedLocationId, 'merchant', 'approval.approved', 'draft', draft.id, payload, payload.actorId || 'owner')
    return publishScheduledInternal(context, draft.channel, {
      draftId: draft.id,
      locationId: resolvedLocationId,
      scheduledFor: draft.scheduledFor,
      approvedBy: payload.actorId || 'owner',
    })
  }

  if (messageIntent === 'skip-draft') {
    const approvalRow = await context.campaignRepository.getApprovalByDraft(payload.draftId)
    const approval = normalizeApproval(approvalRow)
    if (!approval) throw new Error('Approval target not found')
    resolvedLocationId = approval.locationId || resolvedLocationId
    if (isApprovalTerminalStatus(approval.status)) {
      return {
        ok: true,
        status: `already-${approval.status}`,
        draftId: payload.draftId,
      }
    }
    const updated = await context.campaignRepository.updateApproval(approval.id, 'skipped', actedAt, payload, 'pending')
    if (!updated) {
      return {
        ok: true,
        status: 'already-processed',
        draftId: payload.draftId,
      }
    }
    const draft = normalizeDraft(await context.campaignRepository.getDraftById(payload.draftId))
    if (draft && !isDraftTerminalStatus(draft.status)) {
      await context.campaignRepository.updateDraftStatus(payload.draftId, 'skipped', null, actedAt)
    }
    await context.tenantRepository.insertAuditLog(resolvedLocationId, 'merchant', 'approval.skipped', 'draft', payload.draftId, payload, payload.actorId || 'owner')
    return {
      ok: true,
      status: 'skipped',
      draftId: payload.draftId,
    }
  }

  if (messageIntent === 'reschedule-draft') {
    const approvalRow = await context.campaignRepository.getApprovalByDraft(payload.draftId)
    const approval = normalizeApproval(approvalRow)
    if (!approval) throw new Error('Approval target not found')
    resolvedLocationId = approval.locationId || resolvedLocationId
    if (isApprovalTerminalStatus(approval.status)) {
      return {
        ok: true,
        status: `already-${approval.status}`,
        draftId: payload.draftId,
      }
    }
    const scheduledFor = payload.scheduledFor || addDays(new Date(), 1).toISOString()
    const updated = await context.campaignRepository.updateApproval(approval.id, 'rescheduled', actedAt, { ...payload, scheduledFor }, 'pending')
    if (!updated) {
      return {
        ok: true,
        status: 'already-processed',
        draftId: payload.draftId,
      }
    }
    const draft = normalizeDraft(await context.campaignRepository.getDraftById(payload.draftId))
    if (draft && !isDraftTerminalStatus(draft.status)) {
      await context.campaignRepository.updateDraftStatus(payload.draftId, 'queued', new Date(scheduledFor).getTime(), actedAt)
    }
    await context.tenantRepository.insertAuditLog(resolvedLocationId, 'merchant', 'approval.rescheduled', 'draft', payload.draftId, {
      ...payload,
      scheduledFor,
    }, payload.actorId || 'owner')
    return {
      ok: true,
      status: 'queued',
      draftId: payload.draftId,
      scheduledFor,
    }
  }

  if (messageIntent === 'rewrite-draft') {
    const draft = normalizeDraft(await context.campaignRepository.getDraftById(payload.draftId))
    if (!draft) throw new Error('Approval target not found')
    resolvedLocationId = draft.locationId || resolvedLocationId
    const lineUserId = payload.lineUserId || (String(payload.actorId || '').startsWith('line:') ? payload.actorId : null)
    if (!lineUserId) {
      return {
        ok: false,
        status: 'ops-review',
        replyText: '這則需求我先交給營運協助處理，稍後再回你。',
      }
    }
    const operatorContext = await resolveOperatorContextInternal(context, lineUserId)
    const membership = resolveMembership(operatorContext, resolvedLocationId)
    if (!operatorContext || !membership) {
      return {
        ok: false,
        status: 'ops-review',
        replyText: '這則需求我先交給營運協助處理，稍後再回你。',
      }
    }
    const thread = await findOrCreateMerchantThreadInternal(context, {
      tenantId: operatorContext.operator.tenantId,
      locationId: membership.location.id,
      operatorId: operatorContext.operator.id,
      source: 'line',
      title: `${membership.location.name} Merchant Copilot`,
    })
    await updateMerchantThreadInternal(context, thread.id, {
      status: 'awaiting-rewrite',
      latestTaskId: thread.latestTaskId,
      metadata: {
        ...thread.metadata,
        pendingRewriteDraftId: draft.id,
      },
      summary: summarizeInstruction(`等待商家補充修改方向：${draft.title}`),
      updatedAt: actedAt,
    })
    await createMerchantMessageInternal(context, {
      threadId: thread.id,
      tenantId: operatorContext.operator.tenantId,
      locationId: membership.location.id,
      operatorId: operatorContext.operator.id,
      role: 'assistant',
      source: 'merchant-copilot',
      messageType: 'text',
      intent: 'awaiting-rewrite',
      body: '好，直接回覆你想修改的方向，例如「更像熟客口吻」或「縮短到 LINE 推播長度」。',
      metadata: {
        draftId: draft.id,
      },
      createdAt: actedAt,
    })
    await context.tenantRepository.insertAuditLog(resolvedLocationId, 'merchant', 'merchant-copilot.rewrite-requested', 'draft', draft.id, payload, operatorContext.operator.id)
    return {
      ok: true,
      status: 'awaiting-input',
      draftId: draft.id,
      replyText: '好，直接回覆你想修改的方向，例如「更像熟客口吻」或「縮短到 LINE 推播長度」。',
    }
  }

  if (messageIntent === 'report-stock-issue') {
    await context.tenantRepository.insertAuditLog(resolvedLocationId, 'merchant', 'merchant.reported-stock-issue', 'location', resolvedLocationId, payload, payload.actorId || 'owner')
    return {
      ok: true,
      status: 'logged',
      message: '庫存/停售回報已記錄，後續草稿會避開此品項。',
    }
  }

  if (messageIntent === 'submit-store-update') {
    await context.tenantRepository.insertAuditLog(resolvedLocationId, 'merchant', 'merchant.submitted-update', 'location', resolvedLocationId, payload, payload.actorId || 'owner')
    return {
      ok: true,
      status: 'logged',
      message: '店家更新已收下，系統會在下一輪內容中套用。',
    }
  }

  if (messageIntent === 'request-summary') {
    const digest = await generateWeeklyDigestInternal(context, resolvedLocationId)
    await context.tenantRepository.insertAuditLog(resolvedLocationId, 'merchant', 'merchant.requested-summary', 'weekly-digest', digest.id, payload, payload.actorId || 'owner')
    return {
      ok: true,
      status: 'generated',
      digest,
    }
  }

  if (messageIntent === 'open-liff') {
    return {
      ok: true,
      status: 'redirect',
      url: buildMerchantTabUrl(resolvedLocationId, payload.tab || 'approvals'),
    }
  }

  throw new Error(`Unsupported merchant intent: ${messageIntent}`)
}

async function recordAttributionInternal(context, source, campaignId, eventType, value = 1, extra = {}) {
  const campaign = campaignId ? await context.campaignRepository.getCampaignPlanById(campaignId) : null
  const locationId = extra.locationId || campaign?.location_id || await resolveLocationId(context, null)
  const eventId = extra.eventId || randomUUID()
  const sourceKey = extra.sourceKey || extra.eventId || null
  const persisted = await context.attributionRepository.recordEvent({
    id: eventId,
    locationId,
    campaignPlanId: campaignId || null,
    draftId: extra.draftId || null,
    offerId: extra.offerId || null,
    source,
    eventType,
    value,
    sourceKey,
    metadata: extra.metadata || {},
    createdAt: now(),
  })
  if (!persisted.inserted) {
    return {
      id: persisted.id,
      duplicated: true,
      locationId,
      campaignId,
      source,
      eventType,
      value,
      metadata: extra.metadata || {},
    }
  }

  if (eventType === 'coupon-claim' || eventType === 'link-click') {
    await context.attributionRepository.incrementShortLinkClicks(campaignId || null, extra.offerId || null)
  }
  if (eventType === 'coupon-redemption' && extra.offerId) {
    await context.attributionRepository.incrementOfferRedemptions(extra.offerId)
  }

  await context.tenantRepository.insertAuditLog(locationId, 'system', 'attribution.recorded', 'campaign', campaignId, {
    source,
    eventType,
    value,
    draftId: extra.draftId,
    offerId: extra.offerId,
  })

  return {
    id: eventId,
    locationId,
    campaignId,
    source,
    eventType,
    value,
    metadata: extra.metadata || {},
  }
}

async function generateWeeklyDigestInternal(context, locationId, period = {}) {
  const resolvedLocationId = await resolveLocationId(context, locationId)
  const start = period.start ? new Date(period.start) : addDays(new Date(), -6)
  const end = period.end ? new Date(period.end) : new Date()
  start.setHours(0, 0, 0, 0)
  end.setHours(23, 59, 59, 999)

  const metricRows = await context.attributionRepository.getMetricsByEventType(resolvedLocationId, start.getTime(), end.getTime())
  const metrics = Object.fromEntries(metricRows.map((row) => [row.event_type, {
    count: Number(row.count || 0),
    total: Number(row.total || 0),
  }]))

  const published = await context.attributionRepository.getPublishedDraftCount(resolvedLocationId, start.getTime(), end.getTime())
  const autoPublished = await context.attributionRepository.getAutoPublishedCount(resolvedLocationId, start.getTime(), end.getTime())
  const couponClaims = metrics['coupon-claim']?.total || 0
  const friendAdds = metrics['friend-add']?.total || 0
  const navigations = metrics.navigation?.total || 0
  const calls = metrics.call?.total || 0
  const messages = metrics.message?.total || 0

  let headline = '本週系統穩定幫你維持曝光與回流'
  if (couponClaims >= 8) headline = '離峰熟客券開始有明顯反應，值得繼續'
  else if (friendAdds >= 20) headline = '新客流入不錯，接下來要把回流接住'
  else if (navigations + calls >= 12) headline = 'Google 商家更新有帶動來電與導航'

  let recommendedNextAction = '下週延續離峰熟客券，並補一張熱賣品項實拍照。'
  if (couponClaims < 5) recommendedNextAction = '把離峰優惠改成更明確的組合價，再測一次週二到週四。'
  if (friendAdds >= 20) recommendedNextAction = '針對新加好友者補一則三天內到店提醒，提高首次回流。'

  const location = normalizeLocation(await context.tenantRepository.getLocation(resolvedLocationId))
  const summary = {
    publishedDrafts: published,
    autoPublished,
    couponClaims,
    friendAdds,
    navigations,
    calls,
    messages,
    merchantTimeSavedMinutes: autoPublished * 6 + published * 3,
    timeBudgetMinutes: location?.merchantTimeBudgetMinutes || 15,
  }

  const digestId = randomUUID()
  await context.campaignRepository.createDigest({
    id: digestId,
    locationId: resolvedLocationId,
    periodStart: start.getTime(),
    periodEnd: end.getTime(),
    headline,
    summary,
    recommendedNextAction,
    createdAt: now(),
  })
  await context.tenantRepository.insertAuditLog(resolvedLocationId, 'system', 'digest.generated', 'weekly-digest', digestId, {
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
    summary,
  })

  return normalizeDigest(await context.campaignRepository.getLatestDigest(resolvedLocationId))
}

async function generateCampaignPlanInternal(context, locationId) {
  const resolvedLocationId = await resolveLocationId(context, locationId)
  const weekStart = startOfWeek(addDays(new Date(), 7))
  const weekEnd = endOfWeek(weekStart)
  const planId = randomUUID()
  const createdAt = now()
  const location = normalizeLocation(await context.tenantRepository.getLocation(resolvedLocationId))
  const publicBaseUrl = getPublicBaseUrl()

  await context.campaignRepository.createCampaignPlan({
    id: planId,
    locationId: resolvedLocationId,
    periodLabel: `${formatPeriod(weekStart)} - ${formatPeriod(weekEnd)} 成長計畫`,
    periodStart: weekStart.getTime(),
    periodEnd: weekEnd.getTime(),
    goal: '離峰補客、熟客回流、Google 商家穩定更新',
    status: 'scheduled',
    summary: '系統預設只保留 3 個要店家處理的決策，其他由 autopilot 與營運後台接手。',
    createdAt,
    updatedAt: createdAt,
  })

  const offerId = randomUUID()
  const offerCode = `AZHU${String(new Date().getMonth() + 1).padStart(2, '0')}${String(new Date().getDate()).padStart(2, '0')}`
  await context.campaignRepository.createOffer({
    id: offerId,
    locationId: resolvedLocationId,
    campaignPlanId: planId,
    title: '離峰熟客麵食升級券',
    code: offerCode,
    channel: 'line',
    ctaUrl: `${publicBaseUrl}/r/${offerCode}`,
    status: 'active',
    redemptionTarget: 18,
    maxRedemptions: 40,
    redeemedCount: 0,
    expiresAt: addDays(weekEnd, 2).getTime(),
    createdAt,
  })

  await context.campaignRepository.createShortLink({
    id: randomUUID(),
    locationId: resolvedLocationId,
    offerId,
    campaignPlanId: planId,
    slug: makeSlug('azhu'),
    destinationUrl: `${publicBaseUrl}/r/${offerCode}`,
    qrValue: `AZHU-QRPAYLOAD-${Date.now()}`,
    clickCount: 0,
    createdAt,
  })

  const drafts = [
    {
      id: randomUUID(),
      campaignPlanId: planId,
      locationId: resolvedLocationId,
      channel: 'google-business-profile',
      draftType: 'google-update',
      title: '本週 Google 商家更新：雨天熱湯 + 熟客回訪提醒',
      body: '這週主打蛤蜊雞湯與麻醬麵，雨天想吃熱的可直接來店內用，也歡迎先打電話詢問現場位子。',
      assetStatus: 'ready',
      riskScore: 0.18,
      brandFitScore: 0.92,
      status: 'draft',
      route: null,
      scheduledFor: addDays(weekStart, 0).setHours(11, 0, 0, 0),
      payload: { cta: '導航到店', surfaces: ['google-post', 'photo-refresh'] },
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: randomUUID(),
      campaignPlanId: planId,
      locationId: resolvedLocationId,
      channel: 'line',
      draftType: 'offpeak-coupon',
      title: '平日下午離峰熟客券',
      body: `週二到週四 14:00-17:00 來店出示本訊息，麻醬麵或滷肉飯可免費升級小菜一份。券碼 ${offerCode}。`,
      assetStatus: 'ready',
      riskScore: 0.39,
      brandFitScore: 0.88,
      status: 'draft',
      route: null,
      scheduledFor: addDays(weekStart, 1).setHours(13, 30, 0, 0),
      payload: { offerId, cta: '領券', ctaUrl: `${publicBaseUrl}/r/${offerCode}`, surfaces: ['line-push'] },
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: randomUUID(),
      campaignPlanId: planId,
      locationId: resolvedLocationId,
      channel: 'google-business-profile',
      draftType: 'review-reply',
      title: 'Google 五星評論回覆草稿',
      body: '謝謝你特地來吃，也很開心你喜歡麻醬麵。下次來可以試試紅油抄手，我們再招待你。',
      assetStatus: 'ready',
      riskScore: 0.16,
      brandFitScore: 0.86,
      status: 'draft',
      route: null,
      scheduledFor: addDays(weekStart, 2).setHours(16, 0, 0, 0),
      payload: { reviewId: 'google-review-demo', surfaces: ['review-reply'] },
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: randomUUID(),
      campaignPlanId: planId,
      locationId: resolvedLocationId,
      channel: 'line',
      draftType: 'festival-promo',
      title: '端午預熱活動草稿',
      body: '端午連假前預告套餐方案，若要主打限量粽香套餐，建議補拍新品圖後再發。',
      assetStatus: 'needs-photo',
      riskScore: 0.78,
      brandFitScore: 0.73,
      status: 'draft',
      route: null,
      scheduledFor: addDays(weekStart, 4).setHours(10, 0, 0, 0),
      payload: { surfaces: ['line-push'], needsMerchantInput: true },
      createdAt,
      updatedAt: createdAt,
    },
  ]

  for (const draft of drafts) {
    await context.campaignRepository.createDraft(draft)
  }

  await context.tenantRepository.insertAuditLog(resolvedLocationId, 'system', 'campaign.generated', 'campaign-plan', planId, {
    locationName: location?.name,
    draftCount: drafts.length,
  })

  return {
    campaignPlan: normalizeCampaignPlan(await context.campaignRepository.getCampaignPlanById(planId)),
    drafts: (await context.campaignRepository.listDraftsByPlan(planId)).map(normalizeDraft),
  }
}

async function runAutopilotInternal(context, locationId) {
  const resolvedLocationId = await resolveLocationId(context, locationId)
  const drafts = (await context.campaignRepository.listDraftsByLocation(resolvedLocationId)).map(normalizeDraft)
  const rules = await getRulesForLocation(context, resolvedLocationId)

  let autoPublished = 0
  let merchantApprovals = 0
  let opsReviews = 0

  for (const draft of drafts) {
    if (!['draft', 'queued', 'awaiting-approval', 'needs-ops-review'].includes(draft.status)) continue
    if (draft.status === 'published' || draft.status === 'skipped') continue

    const routing = await evaluateAutopilotInternal(context, resolvedLocationId, draft.id, draft.riskScore, rules)
    if (routing.route === 'auto-send') {
      const publishResult = await publishScheduledInternal(context, draft.channel, {
        draftId: draft.id,
        locationId: resolvedLocationId,
        scheduledFor: draft.scheduledFor,
        ctaUrl: draft.payload?.ctaUrl,
        reviewId: draft.payload?.reviewId,
      })
      if (publishResult.ok) autoPublished += 1
      else opsReviews += 1
      continue
    }
    if (routing.route === 'merchant-approve') {
      await sendApprovalCardInternal(context, resolvedLocationId, draft.id, 'line')
      merchantApprovals += 1
      continue
    }
    opsReviews += 1
  }

  await context.tenantRepository.insertAuditLog(resolvedLocationId, 'system', 'autopilot.executed', 'location', resolvedLocationId, {
    autoPublished,
    merchantApprovals,
    opsReviews,
  })

  return {
    locationId: resolvedLocationId,
    autoPublished,
    merchantApprovals,
    opsReviews,
  }
}

function buildOnboardingChecklist({ merchantProfile, brandPack, menuItems, channels, googleConfigured = true }) {
  const lineChannel = channels.find((item) => item.channel === 'line')
  const googleChannel = channels.find((item) => item.channel === 'google-business-profile')
  return [
    {
      id: 'merchant-profile',
      label: '店家基本資料',
      done: Boolean(merchantProfile?.ownerName && merchantProfile?.primaryGoal),
    },
    {
      id: 'brand-pack',
      label: '品牌語氣與限制',
      done: Boolean(brandPack?.voice && brandPack?.guardrails?.length),
    },
    {
      id: 'menu-items',
      label: '菜單上傳',
      done: menuItems.length > 0,
    },
    {
      id: 'line-channel',
      label: 'LINE 串接',
      done: lineChannel?.status === 'connected',
    },
    {
      id: 'google-channel',
      label: googleConfigured ? 'Google 商家串接' : 'Google 商家串接（選用）',
      done: googleConfigured ? googleChannel?.status === 'connected' : true,
    },
  ]
}

function buildAlerts({ channels, pendingApprovals, pipeline, merchantTasks = [], googleConfigured = true }) {
  const alerts = []
  for (const channel of channels) {
    if (!googleConfigured && channel.channel === 'google-business-profile') {
      continue
    }
    if (channel.status !== 'connected' && channel.status !== 'planned') {
      alerts.push({
        id: `channel-${channel.channel}`,
        severity: 'warning',
        code: 'channel-disconnected',
        message: `${channel.channel} 授權異常，需要重新連線`,
      })
    }
    if (channel.lastError) {
      alerts.push({
        id: `channel-error-${channel.channel}`,
        severity: 'error',
        code: 'channel-last-error',
        message: `${channel.channel} 最近一次發送失敗：${channel.lastError}`,
      })
    }
  }

  if (pendingApprovals.length > 3) {
    alerts.push({
      id: 'merchant-load-high',
      severity: 'warning',
      code: 'merchant-load-high',
      message: `待店家決策已達 ${pendingApprovals.length} 件，超出低負擔目標`,
    })
  }

  if (pipeline.opsReview.length > 0) {
    alerts.push({
      id: 'ops-review-backlog',
      severity: 'info',
      code: 'ops-review-backlog',
      message: `有 ${pipeline.opsReview.length} 件草稿卡在 ops-review`,
    })
  }

  const failedTasks = merchantTasks.filter((task) => task.status === 'failed')
  if (failedTasks.length > 0) {
    alerts.push({
      id: 'merchant-copilot-failed',
      severity: 'error',
      code: 'merchant-copilot-failed',
      message: `有 ${failedTasks.length} 件 Merchant Copilot 任務失敗，需人工接手`,
    })
  }

  const reviewedTasks = merchantTasks.filter((task) => task.status === 'ops-review')
  if (reviewedTasks.length > 0) {
    alerts.push({
      id: 'merchant-copilot-ops-review',
      severity: 'warning',
      code: 'merchant-copilot-ops-review',
      message: `有 ${reviewedTasks.length} 件 Merchant Copilot 任務因低信心轉入 ops review`,
    })
  }

  return alerts
}

function filterMerchantChannelsForSnapshot(channels, { googleConfigured = true } = {}) {
  if (googleConfigured) return channels
  return channels.filter((channel) => {
    if (channel.channel !== 'google-business-profile') return true
    return channel.status === 'connected' || Boolean(channel.lastError)
  })
}

async function getOpsSnapshotInternal(context, locationId) {
  const resolvedLocationId = await resolveLocationId(context, locationId)
  const location = normalizeLocation(await context.tenantRepository.getLocation(resolvedLocationId))
  if (!location) return null

  const merchantProfile = normalizeProfile(await context.tenantRepository.getMerchantProfile(resolvedLocationId))
  const brandPack = normalizeBrandPack(await context.tenantRepository.getBrandPack(resolvedLocationId))
  const promptProfile = await ensureMerchantPromptProfileInternal(context, resolvedLocationId, merchantProfile, brandPack)
  const rawChannels = (await context.channelRepository.listConnections(resolvedLocationId)).map((row) => normalizeConnection(row))
  const googleConfigured = context.googleAdapter.isConfigured()
  const channels = filterMerchantChannelsForSnapshot(rawChannels, { googleConfigured })
  const rules = (await context.channelRepository.listRules(resolvedLocationId)).map(normalizeRule)
  const latestPlan = normalizeCampaignPlan(await context.campaignRepository.getLatestCampaignPlan(resolvedLocationId))
  const drafts = (await context.campaignRepository.listDraftsByLocation(resolvedLocationId)).map(normalizeDraft)
  const pendingApprovals = (await context.campaignRepository.listPendingApprovals(resolvedLocationId)).map(normalizeApproval)
  const latestDigest = normalizeDigest(await context.campaignRepository.getLatestDigest(resolvedLocationId))
  const menuItems = (await context.tenantRepository.listMenuItems(resolvedLocationId)).map((row) => ({
    id: row.id,
    name: row.name,
    category: row.category,
    priceCents: Number(row.price_cents || 0),
    isSignature: Boolean(row.is_signature),
    isAvailable: Boolean(row.is_available),
  }))
  const offers = await Promise.all((await context.campaignRepository.listOffers(resolvedLocationId)).map(async (row) => ({
    ...normalizeOffer(row),
    shortLink: await context.campaignRepository.getShortLinkByOffer(row.id),
  })))
  const recentEvents = (await context.attributionRepository.listRecentEvents(resolvedLocationId, 10)).map((row) => ({
    id: row.id,
    source: row.source,
    eventType: row.event_type,
    value: Number(row.value || 0),
    createdAt: timestampToIso(row.created_at),
  }))
  const audits = (await context.tenantRepository.listAuditLogs(resolvedLocationId, 12)).map(normalizeAudit)
  const locations = await listWorkspaceLocationsInternal(context)
  const merchantThreads = await listMerchantThreadsForLocationInternal(context, resolvedLocationId, { limit: 6 })
  const merchantTasks = await listMerchantTasksForLocationInternal(context, resolvedLocationId, { limit: 12 })

  const thisWeekStart = startOfWeek(new Date())
  const thisWeekEnd = endOfWeek(new Date())
  const metricsRows = await context.attributionRepository.getMetricsByEventType(resolvedLocationId, thisWeekStart.getTime(), thisWeekEnd.getTime())
  const metricsMap = Object.fromEntries(metricsRows.map((row) => [row.event_type, Number(row.total || 0)]))
  const publishedThisWeek = await context.attributionRepository.getPublishedDraftCount(resolvedLocationId, thisWeekStart.getTime(), thisWeekEnd.getTime())
  const autoPublishedThisWeek = await context.attributionRepository.getAutoPublishedCount(resolvedLocationId, thisWeekStart.getTime(), thisWeekEnd.getTime())
  const attributedEventsCount = await context.attributionRepository.countEvents(resolvedLocationId, thisWeekStart.getTime(), thisWeekEnd.getTime())
  const digestViews = await context.tenantRepository.countAuditActions(resolvedLocationId, 'merchant.requested-summary', thisWeekStart.getTime(), thisWeekEnd.getTime())
  const digestsGenerated = await context.campaignRepository.countDigests(resolvedLocationId, thisWeekStart.getTime(), thisWeekEnd.getTime())
  const onboardingChecklist = buildOnboardingChecklist({ merchantProfile, brandPack, menuItems, channels, googleConfigured })

  const relevantChannels = channels.filter((item) => item.channel === 'line' || item.channel === 'google-business-profile')
  const healthyChannels = relevantChannels.filter((item) => item.status === 'connected').length
  const channelHealthScore = relevantChannels.length > 0
    ? Math.round((healthyChannels / relevantChannels.length) * 100)
    : 0

  const pipeline = {
    autoSend: drafts.filter((draft) => draft.route === 'auto-send' && draft.status !== 'published'),
    merchantApprove: drafts.filter((draft) => draft.route === 'merchant-approve' && draft.status !== 'published' && draft.status !== 'skipped'),
    opsReview: drafts.filter((draft) => draft.route === 'ops-review' || draft.status === 'needs-ops-review'),
    published: drafts.filter((draft) => draft.status === 'published'),
  }

  const alerts = buildAlerts({ channels, pendingApprovals, pipeline, merchantTasks, googleConfigured })

  return {
    snapshotAt: new Date().toISOString(),
    environment: {
      mode: context.environment,
      provider: context.persistenceKind,
      demoMode: context.demoMode,
    },
    tenant: {
      id: location.tenantId,
      name: location.tenantName,
      plan: location.tenantPlan,
    },
    location,
    merchantProfile,
    brandPack,
    promptProfile,
    menuItems,
    channels,
    autopilotRules: rules,
    latestCampaignPlan: latestPlan,
    pipeline,
    pendingApprovals,
    offers,
    latestDigest,
    recentEvents,
    audits,
    alerts,
    merchantCopilot: {
      promptProfile,
      threads: merchantThreads,
      tasks: merchantTasks,
      stuckTasks: merchantTasks.filter((task) => ['delegated', 'in_progress', 'ops-review', 'failed'].includes(task.status)),
    },
    onboardingChecklist,
    kpis: {
      pendingMerchantDecisions: pendingApprovals.length,
      autopilotSuccessRate: publishedThisWeek > 0 ? Math.round((autoPublishedThisWeek / publishedThisWeek) * 100) : 0,
      digestReadRate: digestsGenerated > 0 ? Math.round((digestViews / digestsGenerated) * 100) : 0,
      attributedEventsCount,
      channelHealthScore,
    },
    metrics: {
      publishedThisWeek,
      autoPublishedThisWeek,
      merchantApprovalsPending: pendingApprovals.length,
      friendAdds: metricsMap['friend-add'] || 0,
      couponClaims: metricsMap['coupon-claim'] || 0,
      navigations: metricsMap.navigation || 0,
      calls: metricsMap.call || 0,
      messages: metricsMap.message || 0,
      merchantTimeSavedMinutes: autoPublishedThisWeek * 6 + publishedThisWeek * 3,
      merchantTimeBudgetMinutes: merchantProfile?.weeklyTimeBudgetMinutes || 15,
    },
    locations,
    workspace: {
      provider: context.persistenceKind,
      environment: context.environment,
      demoMode: context.demoMode,
      locationCount: locations.length,
      publicBaseUrl: getPublicBaseUrl(),
    },
    links: {
      merchantBindUrl: buildMerchantBindUrl(resolvedLocationId),
      merchantDashboardUrl: buildMerchantDashboardUrl(resolvedLocationId),
      opsDashboardUrl: buildOpsDashboardUrl(resolvedLocationId),
    },
  }
}

async function resolveOperatorMembershipOrThrow(context, lineUserId, locationId = null) {
  const operatorContext = await resolveOperatorContextInternal(context, lineUserId)
  if (!operatorContext) throw new Error('LINE operator is not bound to any merchant account')
  const membership = resolveMembership(operatorContext, locationId)
  if (!membership) throw new Error('Operator does not have access to the requested location')
  return { operatorContext, membership }
}

async function listCustomersInternal(context, locationId, filters = {}) {
  const rows = await context.customerRepository.listCustomers(locationId, filters)
  return rows.map(normalizeCustomer)
}

async function getMerchantHomeInternal(context, lineUserId, locationId = null) {
  const { operatorContext, membership } = await resolveOperatorMembershipOrThrow(context, lineUserId, locationId)
  const snapshot = await getOpsSnapshotInternal(context, membership.location.id)
  const customers = await listCustomersInternal(context, membership.location.id, {})
  const threads = await listMerchantThreadsForLocationInternal(context, membership.location.id, {
    operatorId: operatorContext.operator.id,
    limit: 4,
  })
  const activeThread = threads[0] || null
  const activeThreadMessages = activeThread
    ? await listMerchantMessagesForThreadInternal(context, activeThread.id, 12)
    : []
  const merchantTasks = activeThread
    ? await listMerchantTasksForLocationInternal(context, membership.location.id, {
      threadId: activeThread.id,
      limit: 8,
    })
    : []

  return {
    operator: operatorContext.operator,
    identity: operatorContext.identity,
    memberships: operatorContext.memberships,
    activeMembership: membership,
    location: snapshot.location,
    approvals: snapshot.pendingApprovals,
    latestDigest: snapshot.latestDigest,
    settings: {
      merchantProfile: snapshot.merchantProfile,
      brandPack: snapshot.brandPack,
      channels: snapshot.channels,
      menuItems: snapshot.menuItems,
      onboardingChecklist: snapshot.onboardingChecklist,
    },
    customers,
    alerts: snapshot.alerts,
    merchantCopilot: {
      promptProfile: snapshot.promptProfile,
      threads,
      activeThreadId: activeThread?.id || null,
      activeThreadMessages,
      tasks: merchantTasks,
    },
    metrics: snapshot.metrics,
    kpis: snapshot.kpis,
    snapshotAt: snapshot.snapshotAt,
  }
}

async function listPendingApprovalsForOperatorInternal(context, lineUserId, locationId = null) {
  const { membership } = await resolveOperatorMembershipOrThrow(context, lineUserId, locationId)
  return (await context.campaignRepository.listPendingApprovals(membership.location.id)).map(normalizeApproval)
}

async function saveCustomerNoteInternal(context, customerId, note, actorId) {
  const customer = await context.customerRepository.getCustomer(customerId)
  if (!customer) throw new Error(`Customer not found: ${customerId}`)
  const body = String(note || '').trim()
  if (!body) throw new Error('Customer note cannot be empty')

  await context.customerRepository.createCustomerNote({
    id: randomUUID(),
    customerId,
    locationId: customer.location_id,
    body,
    createdBy: actorId || null,
    createdAt: now(),
  })
  await context.tenantRepository.insertAuditLog(customer.location_id, 'merchant', 'customer.note.saved', 'customer', customerId, {
    note: body,
  }, actorId || null)
  return normalizeCustomer({
    ...(await context.customerRepository.getCustomer(customerId)),
    tags: await context.customerRepository.listCustomerTags(customerId),
    notes: await context.customerRepository.listCustomerNotes(customerId, 10),
  })
}

async function setCustomerTagsInternal(context, customerId, tags, actorId) {
  const customer = await context.customerRepository.getCustomer(customerId)
  if (!customer) throw new Error(`Customer not found: ${customerId}`)
  const normalizedTags = Array.from(new Set((tags || []).map((tag) => String(tag).trim()).filter(Boolean)))
  await context.customerRepository.replaceCustomerTags(customerId, customer.location_id, normalizedTags, actorId, now())
  await context.tenantRepository.insertAuditLog(customer.location_id, 'merchant', 'customer.tags.updated', 'customer', customerId, {
    tags: normalizedTags,
  }, actorId || null)
  return normalizeCustomer({
    ...(await context.customerRepository.getCustomer(customerId)),
    tags: await context.customerRepository.listCustomerTags(customerId),
    notes: await context.customerRepository.listCustomerNotes(customerId, 10),
  })
}

export async function getDefaultLocationId() {
  const context = await getContext()
  return resolveLocationId(context, null)
}

export async function listMerchantLocations() {
  const context = await getContext()
  return listWorkspaceLocationsInternal(context)
}

export async function resolveOperatorContext(lineUserId) {
  const context = await getContext()
  return resolveOperatorContextInternal(context, lineUserId)
}

export async function getMerchantHome(lineUserId, locationId = null) {
  const context = await getContext()
  return getMerchantHomeInternal(context, lineUserId, locationId)
}

export async function listPendingApprovalsForOperator(lineUserId, locationId = null) {
  const context = await getContext()
  return listPendingApprovalsForOperatorInternal(context, lineUserId, locationId)
}

export async function listCustomers(locationId, filters = {}) {
  const context = await getContext()
  return listCustomersInternal(context, locationId, filters)
}

export async function saveCustomerNote(customerId, note, actorId) {
  const context = await getContext()
  return saveCustomerNoteInternal(context, customerId, note, actorId)
}

export async function setCustomerTags(customerId, tags, actorId) {
  const context = await getContext()
  return setCustomerTagsInternal(context, customerId, tags, actorId)
}

export async function submitMerchantCopilotMessage(lineUserId, locationId, text, options = {}) {
  const context = await getContext()
  return submitMerchantCopilotMessageInternal(context, {
    lineUserId,
    locationId,
    text,
    externalEventId: options.externalEventId || null,
    source: options.source || 'line',
  })
}

export async function listMerchantThreads(lineUserId, locationId = null) {
  const context = await getContext()
  const { operatorContext, membership } = await resolveOperatorMembershipOrThrow(context, lineUserId, locationId)
  return {
    threads: await listMerchantThreadsForLocationInternal(context, membership.location.id, {
      operatorId: operatorContext.operator.id,
      limit: 8,
    }),
    activeLocationId: membership.location.id,
  }
}

export async function getMerchantThreadMessages(lineUserId, threadId, locationId = null) {
  const context = await getContext()
  const { operatorContext, membership } = await resolveOperatorMembershipOrThrow(context, lineUserId, locationId)
  const thread = normalizeMerchantThread(await context.merchantCopilotRepository.getThread(threadId))
  if (!thread || thread.locationId !== membership.location.id || thread.operatorId !== operatorContext.operator.id) {
    throw new Error('Merchant thread not found for operator')
  }
  return {
    thread,
    messages: await listMerchantMessagesForThreadInternal(context, threadId, 24),
  }
}

export async function getMerchantCopilotTask(lineUserId, taskId, locationId = null) {
  const context = await getContext()
  const { operatorContext, membership } = await resolveOperatorMembershipOrThrow(context, lineUserId, locationId)
  const task = normalizeMerchantTask(await context.merchantCopilotRepository.getTask(taskId))
  if (!task || task.locationId !== membership.location.id || task.operatorId !== operatorContext.operator.id) {
    throw new Error('Merchant task not found for operator')
  }
  return enrichMerchantTaskInternal(context, task)
}

export async function delegateMerchantCopilotTask(locationId, threadId, taskType, instructions, taskContext = {}) {
  const context = await getContext()
  const thread = normalizeMerchantThread(await context.merchantCopilotRepository.getThread(threadId))
  if (!thread || thread.locationId !== locationId) {
    throw new Error('Merchant thread not found for delegation')
  }
  const createdAt = now()
  const persisted = await context.merchantCopilotRepository.createTask({
    threadId,
    tenantId: thread.tenantId,
    locationId,
    operatorId: thread.operatorId,
    taskType,
    status: 'queued',
    source: 'internal',
    dedupeKey: taskContext.dedupeKey || null,
    title: taskContext.title || 'Merchant Copilot task',
    instructionText: instructions,
    context: taskContext,
    createdAt,
    updatedAt: createdAt,
  })
  return delegateExistingMerchantCopilotTaskInternal(context, persisted.id)
}

export async function claimNextMerchantCopilotTask() {
  const context = await getContext()
  return claimNextMerchantCopilotTaskInternal(context)
}

export async function completeMerchantCopilotTask(taskId, result = null, confidence = null, metadata = {}) {
  const context = await getContext()
  return completeMerchantCopilotTaskInternal(context, taskId, result, confidence, metadata)
}

export async function evaluateAutopilot(locationId, draftId, riskScore = null, ruleSet = null) {
  const context = await getContext()
  return evaluateAutopilotInternal(context, locationId, draftId, riskScore, ruleSet)
}

export async function sendApprovalCard(locationId, draftId, channel = 'line') {
  const context = await getContext()
  return sendApprovalCardInternal(context, locationId, draftId, channel)
}

export async function publishScheduled(channel, payload) {
  const context = await getContext()
  return publishScheduledInternal(context, channel, payload)
}

export async function handleMerchantReply(locationId, messageIntent, payload = {}) {
  const context = await getContext()
  return handleMerchantReplyInternal(context, locationId, messageIntent, payload)
}

export async function recordAttribution(source, campaignId, eventType, value = 1, extra = {}) {
  const context = await getContext()
  return recordAttributionInternal(context, source, campaignId, eventType, value, extra)
}

export async function generateWeeklyDigest(locationId, period = {}) {
  const context = await getContext()
  return generateWeeklyDigestInternal(context, locationId, period)
}

export async function generateCampaignPlan(locationId) {
  const context = await getContext()
  return generateCampaignPlanInternal(context, locationId)
}

export async function runAutopilot(locationId) {
  const context = await getContext()
  return runAutopilotInternal(context, locationId)
}

export async function getOpsSnapshot(locationId) {
  const context = await getContext()
  return getOpsSnapshotInternal(context, locationId)
}

export async function onboardMerchant(payload = {}) {
  const context = await getContext()
  const createdAt = now()
  const tenantId = payload.tenantId || `tenant_${randomUUID().slice(0, 8)}`
  const locationId = payload.locationId || `location_${randomUUID().slice(0, 8)}`
  const existingLine = await getChannelConnection(context, locationId, 'line', { includeSecrets: true })
  const existingGoogle = await getChannelConnection(context, locationId, 'google-business-profile', { includeSecrets: true })

  await context.tenantRepository.saveTenantAndLocation({
    tenantId,
    tenantName: payload.tenantName || payload.locationName || '新餐飲店家',
    plan: payload.plan || 'growth',
    locale: payload.locale || 'zh-TW',
    timezone: payload.timezone || 'Asia/Taipei',
    locationId,
    locationName: payload.locationName || '未命名店家',
    restaurantType: payload.restaurantType || '餐飲',
    address: payload.address || null,
    merchantTimeBudgetMinutes: payload.merchantTimeBudgetMinutes || 15,
    createdAt,
    updatedAt: createdAt,
  })

  await context.tenantRepository.saveMerchantProfile({
    locationId,
    ownerName: payload.ownerName || '店主',
    lineUserId: payload.lineUserId || null,
    primaryGoal: payload.primaryGoal || '穩定回流與 Google 更新',
    weeklyTimeBudgetMinutes: payload.weeklyTimeBudgetMinutes || 15,
    lowTouchMode: payload.lowTouchMode !== false,
    toneSummary: payload.toneSummary || '直接、溫暖、不過度推銷',
    notes: payload.notes || null,
    updatedAt: createdAt,
  })

  await context.tenantRepository.saveBrandPack({
    locationId,
    voice: payload.voice || payload.toneSummary || '直接、溫暖、不過度推銷',
    signatureItems: payload.signatureItems || [],
    guardrails: payload.guardrails || ['避免誇大療效', '避免連發相同促銷'],
    seasonalFocus: payload.seasonalFocus || '',
    updatedAt: createdAt,
  })

  await context.merchantCopilotRepository.savePromptProfile({
    locationId,
    ...buildPromptProfileDefaults({
      merchantProfile: {
        toneSummary: payload.toneSummary || payload.voice || '直接、溫暖、不過度推銷',
        weeklyTimeBudgetMinutes: payload.weeklyTimeBudgetMinutes || 15,
        lowTouchMode: payload.lowTouchMode !== false,
      },
      brandPack: {
        voice: payload.voice || payload.toneSummary || '直接、溫暖、不過度推銷',
        guardrails: payload.guardrails || ['避免誇大療效', '避免連發相同促銷'],
      },
    }),
    updatedAt: createdAt,
  })

  await context.tenantRepository.replaceMenuItems(locationId, payload.menuItems || [], createdAt)
  await ensureDefaultRules(context, locationId)

  let operatorId = payload.operatorId || null
  if (payload.ownerName || payload.lineUserId) {
    operatorId = await context.operatorRepository.saveOperator({
      id: operatorId || undefined,
      tenantId,
      displayName: payload.ownerName || '店主',
      role: payload.role || 'owner',
      status: 'active',
      createdAt,
      updatedAt: createdAt,
    })
    await context.operatorRepository.saveMembership({
      operatorId,
      locationId,
      role: payload.role || 'owner',
      isDefault: true,
      createdAt,
      updatedAt: createdAt,
    })
  }

  if (payload.lineUserId && operatorId) {
    await context.operatorRepository.saveLineIdentity({
      providerUserId: payload.lineUserId,
      operatorId,
      tenantId,
      displayName: payload.ownerName || '店主',
      pictureUrl: payload.pictureUrl || null,
      metadata: {
        source: 'onboarding',
      },
      status: 'active',
      createdAt,
      updatedAt: createdAt,
    })
  }

  await context.channelRepository.saveConnection({
    locationId,
    channel: 'line',
    status: existingLine?.status || (payload.lineUserId ? 'connected' : 'pending'),
    metadata: {
      ...existingLine?.metadata,
      accountName: payload.lineAccountName || existingLine?.metadata?.accountName || null,
    },
    lastSyncedAt: existingLine?.lastSyncedAt ? new Date(existingLine.lastSyncedAt).getTime() : (payload.lineUserId ? createdAt : null),
    lastError: existingLine?.lastError || null,
    expiresAt: existingLine?.expiresAt ? new Date(existingLine.expiresAt).getTime() : null,
  })

  const shouldSetupGoogleChannel = Boolean(existingGoogle || payload.googleLocationName || context.googleAdapter.isConfigured())
  if (shouldSetupGoogleChannel) {
    await context.channelRepository.saveConnection({
      locationId,
      channel: 'google-business-profile',
      status: existingGoogle?.status || (payload.googleLocationName ? 'connected' : 'pending'),
      metadata: {
        ...existingGoogle?.metadata,
        locationName: payload.googleLocationName || existingGoogle?.metadata?.locationName || null,
        listingName: payload.locationName || existingGoogle?.metadata?.listingName || null,
      },
      lastSyncedAt: existingGoogle?.lastSyncedAt ? new Date(existingGoogle.lastSyncedAt).getTime() : (payload.googleLocationName ? createdAt : null),
      lastError: existingGoogle?.lastError || null,
      expiresAt: existingGoogle?.expiresAt ? new Date(existingGoogle.expiresAt).getTime() : null,
    })
  }

  await context.tenantRepository.insertAuditLog(locationId, 'system', 'merchant.onboarded', 'location', locationId, {
    tenantId,
    locationId,
    channels: ['line', 'google-business-profile'],
  })

  const snapshot = await getOpsSnapshotInternal(context, locationId)
  return {
    tenantId,
    locationId,
    links: {
      merchantBindUrl: buildMerchantBindUrl(locationId),
      merchantDashboardUrl: buildMerchantDashboardUrl(locationId),
      opsDashboardUrl: buildOpsDashboardUrl(locationId),
    },
    snapshot,
  }
}

export async function createLineAuthUrl({ locationId, origin, redirectTo = '/merchant' }) {
  const context = await getContext()
  const resolvedLocationId = ensureLocationId(
    await resolveLocationId(context, locationId),
    'LINE login',
  )
  const redirectUri = getLineAuthCallbackUri(origin)
  const stateNonce = randomUUID()
  const nonce = randomUUID()
  const state = createLineOAuthStateToken({
    locationId: resolvedLocationId,
    redirectTo,
    redirectUri,
    stateNonce,
    nonce,
  })

  return {
    stateNonce,
    nonce,
    state,
    redirectUri,
    url: context.lineAdapter.buildAuthUrl({ redirectUri, state, nonce }),
  }
}

function parseJwtPayload(token) {
  if (!token || typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length < 2) return null
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

export function decodeLineAuthState(stateToken) {
  return decodeSignedPayload(stateToken, 'line-oauth-state')
}

export function issueMerchantSession({ lineUserId, operatorId, defaultLocationId = null }) {
  if (!lineUserId) throw new Error('lineUserId is required for merchant session')
  return createMerchantSessionToken({ lineUserId, operatorId, defaultLocationId })
}

export function decodeMerchantSession(sessionToken) {
  return decodeSignedPayload(sessionToken, 'merchant-session')
}

export function getLineOAuthCookieName() {
  return LINE_OAUTH_COOKIE_NAME
}

export function getMerchantSessionCookieName() {
  return MERCHANT_SESSION_COOKIE_NAME
}

export async function completeLineAuth({ locationId, code, redirectUri, expectedNonce = null }) {
  const context = await getContext()
  const resolvedLocationId = ensureLocationId(
    await resolveLocationId(context, locationId),
    'LINE binding',
  )
  const auth = await context.lineAdapter.exchangeCode({ code, redirectUri })
  const idTokenPayload = parseJwtPayload(auth.idToken)
  if (expectedNonce && idTokenPayload?.nonce !== expectedNonce) {
    throw new Error('Invalid LINE OAuth nonce')
  }
  const existingProfile = normalizeProfile(await context.tenantRepository.getMerchantProfile(resolvedLocationId))
  const location = normalizeLocation(await context.tenantRepository.getLocation(resolvedLocationId))
  const createdAt = now()

  await context.tenantRepository.saveMerchantProfile({
    locationId: resolvedLocationId,
    ownerName: existingProfile?.ownerName || auth.profile.displayName || '店主',
    lineUserId: auth.profile.userId,
    primaryGoal: existingProfile?.primaryGoal || '穩定回流與 Google 更新',
    weeklyTimeBudgetMinutes: existingProfile?.weeklyTimeBudgetMinutes || 15,
    lowTouchMode: existingProfile?.lowTouchMode !== false,
    toneSummary: existingProfile?.toneSummary || '直接、溫暖、不過度推銷',
    notes: existingProfile?.notes || null,
    updatedAt: now(),
  })

  await context.channelRepository.saveConnection({
    locationId: resolvedLocationId,
    channel: 'line',
    status: 'connected',
    metadata: {
      accountName: auth.profile.displayName,
      accessToken: auth.accessToken,
      refreshToken: auth.refreshToken,
      idToken: auth.idToken,
      scope: auth.scope,
      profile: auth.profile,
    },
    lastSyncedAt: now(),
    expiresAt: auth.expiresIn ? now() + auth.expiresIn * 1000 : null,
  })

  const existingPrimary = await context.operatorRepository.findPrimaryOperatorForLocation(resolvedLocationId)
  const operatorId = await context.operatorRepository.saveOperator({
    id: existingPrimary?.id || undefined,
    tenantId: location.tenantId,
    displayName: auth.profile.displayName || existingProfile?.ownerName || '店主',
    role: existingPrimary?.membership_role || 'owner',
    status: 'active',
    createdAt,
    updatedAt: createdAt,
  })
  await context.operatorRepository.saveMembership({
    operatorId,
    locationId: resolvedLocationId,
    role: 'owner',
    isDefault: true,
    createdAt,
    updatedAt: createdAt,
  })
  await context.operatorRepository.saveLineIdentity({
    providerUserId: auth.profile.userId,
    operatorId,
    tenantId: location.tenantId,
    displayName: auth.profile.displayName || existingProfile?.ownerName || '店主',
    pictureUrl: auth.profile.pictureUrl || null,
    metadata: {
      scope: auth.scope,
      profile: auth.profile,
    },
    status: 'active',
    createdAt,
    updatedAt: createdAt,
  })

  await context.tenantRepository.insertAuditLog(resolvedLocationId, 'system', 'channel.connected', 'channel-connection', 'line', {
    channel: 'line',
    userId: auth.profile.userId,
  })

  return {
    locationId: resolvedLocationId,
    channel: 'line',
    operatorId,
    profile: auth.profile,
  }
}

export async function createGoogleAuthUrl({ locationId, origin, redirectTo = '/ops', googleLocationName = null }) {
  const context = await getContext()
  const resolvedLocationId = ensureLocationId(
    await resolveLocationId(context, locationId),
    'Google authorization',
  )
  const redirectUri = new URL('/api/auth/google/callback', getPublicBaseUrl(origin)).toString()
  const state = Buffer.from(JSON.stringify({
    locationId: resolvedLocationId,
    redirectTo,
    googleLocationName,
    issuedAt: now(),
  })).toString('base64url')

  return {
    state,
    redirectUri,
    url: context.googleAdapter.buildAuthUrl({ redirectUri, state }),
  }
}

export async function completeGoogleAuth({ locationId, code, redirectUri, googleLocationName = null }) {
  const context = await getContext()
  const resolvedLocationId = ensureLocationId(
    await resolveLocationId(context, locationId),
    'Google binding',
  )
  const tokens = await context.googleAdapter.exchangeCode({ code, redirectUri })
  const existing = await getChannelConnection(context, resolvedLocationId, 'google-business-profile', { includeSecrets: true })

  await context.channelRepository.saveConnection({
    locationId: resolvedLocationId,
    channel: 'google-business-profile',
    status: 'connected',
    metadata: {
      ...existing?.metadata,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || existing?.metadata?.refreshToken || null,
      tokenType: tokens.token_type,
      scope: tokens.scope,
      locationName: googleLocationName || existing?.metadata?.locationName || null,
    },
    lastSyncedAt: now(),
    expiresAt: tokens.expires_in ? now() + tokens.expires_in * 1000 : null,
  })

  await context.tenantRepository.insertAuditLog(resolvedLocationId, 'system', 'channel.connected', 'channel-connection', 'google-business-profile', {
    channel: 'google-business-profile',
    locationName: googleLocationName || existing?.metadata?.locationName || null,
  })

  return {
    locationId: resolvedLocationId,
    channel: 'google-business-profile',
    expiresIn: tokens.expires_in,
  }
}

function buildLineReplyText(result) {
  if (!result) return '收到，已處理。'
  if (result.replyText) return result.replyText
  if (result.status === 'redirect') return `請從這裡打開操作頁：${result.url}`
  if (result.status === 'skipped') return '這次先跳過，我不會替你發出這則內容。'
  if (result.status === 'queued') return `已改期，新的排程時間是 ${result.scheduledFor || '明天'}。`
  if (result.ok) return '已收到，系統會照你的決定繼續處理。'
  return '收到，但這件事需要營運同事介入。'
}

export async function processLineWebhook(rawBody, signature) {
  const context = await getContext()
  if (!context.lineAdapter.verifyWebhookSignature(rawBody, signature)) {
    throw new Error('Invalid LINE webhook signature')
  }

  const payload = JSON.parse(rawBody)
  const processed = []

  for (const event of payload.events || []) {
    const externalEventId = event.webhookEventId || `${event.timestamp}:${event.replyToken || event.source?.userId || 'unknown'}`
    const lineUserId = event.source?.userId
    const operatorContext = lineUserId ? await resolveOperatorContextInternal(context, lineUserId) : null
    const membership = resolveMembership(operatorContext, null)
    const locationId = membership?.location.id || null
    const inserted = await context.attributionRepository.recordExternalEvent({
      provider: 'line',
      externalEventId,
      locationId,
      eventType: event.type,
      payload: event,
    })
    if (!inserted) {
      processed.push({ externalEventId, status: 'duplicate' })
      continue
    }

    const command = context.lineAdapter.parseEventIntent(event)
    if (command && locationId) {
      const result = await handleMerchantReplyInternal(context, locationId, command.messageIntent, {
        ...command.payload,
        actorId: lineUserId,
        lineUserId,
      })

      if (event.replyToken) {
        await context.lineAdapter.replyText(event.replyToken, buildLineReplyText(result))
      }
      processed.push({ externalEventId, status: 'processed', result })
      continue
    }

    if (event.type === 'message' && event.message?.type === 'text' && locationId) {
      const result = await submitMerchantCopilotMessageInternal(context, {
        lineUserId,
        locationId,
        text: event.message.text,
        externalEventId,
        source: 'line',
      })
      if (event.replyToken) {
        await context.lineAdapter.replyText(event.replyToken, buildLineReplyText(result))
      }
      processed.push({ externalEventId, status: 'processed', result })
      continue
    }

    if (!locationId) {
      processed.push({ externalEventId, status: 'ignored' })
      continue
    }
    processed.push({ externalEventId, status: 'ignored' })
  }

  return {
    ok: true,
    processed,
  }
}

export async function getServiceStatus() {
  const context = await getContext()
  return {
    environment: context.environment,
    provider: context.persistenceKind,
    demoMode: context.demoMode,
    lineConfigured: context.lineAdapter.isConfigured(),
    lineLoginConfigured: context.lineAdapter.isLoginConfigured(),
    liffConfigured: Boolean(getMerchantLiffId()),
    richMenuImageConfigured: getMerchantRichMenuAssetConfigured(),
    googleConfigured: context.googleAdapter.isConfigured(),
  }
}
