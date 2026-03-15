import { randomUUID } from 'crypto'
import Database from 'better-sqlite3'
import { existsSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { Pool } from 'pg'

function getSqlitePath() {
  // Render free runtime can expose a read-only app filesystem.
  // If no external database is configured in production, fallback to memory.
  if (
    process.env.NODE_ENV === 'production'
    && !process.env.DATABASE_URL
    && !process.env.FNB_SQLITE_PATH
    && !process.env.OPENCLAW_OFFICE_DB_PATH
  ) {
    return ':memory:'
  }
  return process.env.FNB_SQLITE_PATH
    || process.env.OPENCLAW_OFFICE_DB_PATH
    || join(process.cwd(), 'data', 'openclaw-office.db')
}

export function getFnbEnvironment() {
  if (process.env.FNB_APP_ENV) return process.env.FNB_APP_ENV
  if (process.env.FNB_DEMO_MODE === '1') return 'demo'
  if (process.env.DATABASE_URL) return process.env.NODE_ENV === 'production' ? 'production' : 'staging'
  return 'demo'
}

function splitSqlStatements(sql) {
  return sql
    .split(/;\s*\n/g)
    .map((statement) => statement.trim())
    .filter(Boolean)
}

function toPostgresSql(sql) {
  let index = 0
  return sql.replace(/\?/g, () => `$${++index}`)
}

class SqliteAdapter {
  constructor(db) {
    this.db = db
    this.kind = 'sqlite'
  }

  async exec(sql) {
    this.db.exec(sql)
  }

  async get(sql, params = []) {
    return this.db.prepare(sql).get(...params) || null
  }

  async all(sql, params = []) {
    return this.db.prepare(sql).all(...params)
  }

  async run(sql, params = []) {
    const result = this.db.prepare(sql).run(...params)
    return {
      changes: result.changes,
      lastInsertRowid: result.lastInsertRowid,
    }
  }
}

class PostgresAdapter {
  constructor(client) {
    this.client = client
    this.kind = 'postgres'
  }

  async exec(sql) {
    for (const statement of splitSqlStatements(sql)) {
      await this.client.query(statement)
    }
  }

  async get(sql, params = []) {
    const result = await this.client.query(toPostgresSql(sql), params)
    return result.rows[0] || null
  }

  async all(sql, params = []) {
    const result = await this.client.query(toPostgresSql(sql), params)
    return result.rows
  }

  async run(sql, params = []) {
    const result = await this.client.query(toPostgresSql(sql), params)
    return {
      changes: result.rowCount || 0,
      rows: result.rows,
    }
  }
}

const FNB_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS fnb_tenants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    plan TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    locale TEXT DEFAULT 'zh-TW',
    timezone TEXT DEFAULT 'Asia/Taipei',
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS fnb_locations (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    restaurant_type TEXT NOT NULL,
    address TEXT,
    merchant_time_budget_minutes INTEGER DEFAULT 15,
    status TEXT NOT NULL DEFAULT 'active',
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    FOREIGN KEY (tenant_id) REFERENCES fnb_tenants(id)
  );

  CREATE TABLE IF NOT EXISTS fnb_merchant_profiles (
    location_id TEXT PRIMARY KEY,
    owner_name TEXT,
    line_user_id TEXT,
    primary_goal TEXT,
    weekly_time_budget_minutes INTEGER DEFAULT 15,
    low_touch_mode INTEGER DEFAULT 1,
    tone_summary TEXT,
    notes TEXT,
    updated_at BIGINT NOT NULL,
    FOREIGN KEY (location_id) REFERENCES fnb_locations(id)
  );

  CREATE TABLE IF NOT EXISTS fnb_brand_packs (
    location_id TEXT PRIMARY KEY,
    voice TEXT,
    signature_items_json TEXT,
    guardrails_json TEXT,
    seasonal_focus TEXT,
    updated_at BIGINT NOT NULL,
    FOREIGN KEY (location_id) REFERENCES fnb_locations(id)
  );

  CREATE TABLE IF NOT EXISTS fnb_operator_accounts (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    FOREIGN KEY (tenant_id) REFERENCES fnb_tenants(id)
  );

  CREATE TABLE IF NOT EXISTS fnb_operator_location_memberships (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL,
    location_id TEXT NOT NULL,
    role TEXT NOT NULL,
    is_default INTEGER DEFAULT 0,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    UNIQUE(operator_id, location_id),
    FOREIGN KEY (operator_id) REFERENCES fnb_operator_accounts(id),
    FOREIGN KEY (location_id) REFERENCES fnb_locations(id)
  );

  CREATE TABLE IF NOT EXISTS fnb_line_identities (
    id TEXT PRIMARY KEY,
    provider_user_id TEXT NOT NULL UNIQUE,
    operator_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    display_name TEXT,
    picture_url TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    metadata_json TEXT,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    FOREIGN KEY (operator_id) REFERENCES fnb_operator_accounts(id),
    FOREIGN KEY (tenant_id) REFERENCES fnb_tenants(id)
  );

  CREATE TABLE IF NOT EXISTS fnb_menu_items (
    id TEXT PRIMARY KEY,
    location_id TEXT NOT NULL,
    name TEXT NOT NULL,
    category TEXT,
    price_cents INTEGER DEFAULT 0,
    is_signature INTEGER DEFAULT 0,
    is_available INTEGER DEFAULT 1,
    updated_at BIGINT NOT NULL,
    FOREIGN KEY (location_id) REFERENCES fnb_locations(id)
  );

  CREATE TABLE IF NOT EXISTS fnb_channel_connections (
    id TEXT PRIMARY KEY,
    location_id TEXT NOT NULL,
    channel TEXT NOT NULL,
    status TEXT NOT NULL,
    metadata_json TEXT,
    last_synced_at BIGINT,
    last_error TEXT,
    expires_at BIGINT,
    FOREIGN KEY (location_id) REFERENCES fnb_locations(id)
  );

  CREATE TABLE IF NOT EXISTS fnb_autopilot_rules (
    id TEXT PRIMARY KEY,
    location_id TEXT NOT NULL,
    name TEXT NOT NULL,
    trigger_type TEXT NOT NULL,
    action_mode TEXT NOT NULL,
    risk_tolerance REAL DEFAULT 0.5,
    enabled INTEGER DEFAULT 1,
    config_json TEXT,
    updated_at BIGINT NOT NULL,
    FOREIGN KEY (location_id) REFERENCES fnb_locations(id)
  );

  CREATE TABLE IF NOT EXISTS fnb_campaign_plans (
    id TEXT PRIMARY KEY,
    location_id TEXT NOT NULL,
    period_label TEXT NOT NULL,
    period_start BIGINT NOT NULL,
    period_end BIGINT NOT NULL,
    goal TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    summary TEXT,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    FOREIGN KEY (location_id) REFERENCES fnb_locations(id)
  );

  CREATE TABLE IF NOT EXISTS fnb_drafts (
    id TEXT PRIMARY KEY,
    campaign_plan_id TEXT,
    location_id TEXT NOT NULL,
    channel TEXT NOT NULL,
    draft_type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    asset_status TEXT NOT NULL DEFAULT 'ready',
    risk_score REAL DEFAULT 0.5,
    brand_fit_score REAL DEFAULT 0.8,
    status TEXT NOT NULL DEFAULT 'draft',
    route TEXT,
    scheduled_for BIGINT,
    payload_json TEXT,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    FOREIGN KEY (campaign_plan_id) REFERENCES fnb_campaign_plans(id),
    FOREIGN KEY (location_id) REFERENCES fnb_locations(id)
  );

  CREATE TABLE IF NOT EXISTS fnb_approval_requests (
    id TEXT PRIMARY KEY,
    draft_id TEXT NOT NULL,
    location_id TEXT NOT NULL,
    channel TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    merchant_message TEXT NOT NULL,
    last_sent_at BIGINT,
    responded_at BIGINT,
    response_payload_json TEXT,
    FOREIGN KEY (draft_id) REFERENCES fnb_drafts(id),
    FOREIGN KEY (location_id) REFERENCES fnb_locations(id)
  );

  CREATE TABLE IF NOT EXISTS fnb_offers (
    id TEXT PRIMARY KEY,
    location_id TEXT NOT NULL,
    campaign_plan_id TEXT,
    title TEXT NOT NULL,
    code TEXT NOT NULL,
    channel TEXT NOT NULL,
    cta_url TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    redemption_target INTEGER DEFAULT 0,
    max_redemptions INTEGER DEFAULT 0,
    redeemed_count INTEGER DEFAULT 0,
    expires_at BIGINT,
    created_at BIGINT NOT NULL,
    FOREIGN KEY (location_id) REFERENCES fnb_locations(id),
    FOREIGN KEY (campaign_plan_id) REFERENCES fnb_campaign_plans(id)
  );

  CREATE TABLE IF NOT EXISTS fnb_customers (
    id TEXT PRIMARY KEY,
    location_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'line',
    status TEXT NOT NULL DEFAULT 'active',
    loyalty_stage TEXT DEFAULT 'new',
    phone TEXT,
    email TEXT,
    last_interaction_at BIGINT,
    total_interactions INTEGER DEFAULT 0,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    FOREIGN KEY (location_id) REFERENCES fnb_locations(id)
  );

  CREATE TABLE IF NOT EXISTS fnb_customer_tags (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    location_id TEXT NOT NULL,
    tag TEXT NOT NULL,
    created_by TEXT,
    created_at BIGINT NOT NULL,
    UNIQUE(customer_id, tag),
    FOREIGN KEY (customer_id) REFERENCES fnb_customers(id),
    FOREIGN KEY (location_id) REFERENCES fnb_locations(id)
  );

  CREATE TABLE IF NOT EXISTS fnb_customer_notes (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    location_id TEXT NOT NULL,
    body TEXT NOT NULL,
    created_by TEXT,
    created_at BIGINT NOT NULL,
    FOREIGN KEY (customer_id) REFERENCES fnb_customers(id),
    FOREIGN KEY (location_id) REFERENCES fnb_locations(id)
  );

  CREATE TABLE IF NOT EXISTS fnb_customer_activity_summary (
    customer_id TEXT PRIMARY KEY,
    location_id TEXT NOT NULL,
    last_event_type TEXT,
    last_event_at BIGINT,
    coupon_claims INTEGER DEFAULT 0,
    message_count INTEGER DEFAULT 0,
    friend_adds INTEGER DEFAULT 0,
    visit_signals INTEGER DEFAULT 0,
    updated_at BIGINT NOT NULL,
    FOREIGN KEY (customer_id) REFERENCES fnb_customers(id),
    FOREIGN KEY (location_id) REFERENCES fnb_locations(id)
  );

  CREATE TABLE IF NOT EXISTS fnb_short_links (
    id TEXT PRIMARY KEY,
    location_id TEXT NOT NULL,
    offer_id TEXT,
    campaign_plan_id TEXT,
    slug TEXT NOT NULL UNIQUE,
    destination_url TEXT NOT NULL,
    qr_value TEXT NOT NULL,
    click_count INTEGER DEFAULT 0,
    created_at BIGINT NOT NULL,
    FOREIGN KEY (location_id) REFERENCES fnb_locations(id),
    FOREIGN KEY (offer_id) REFERENCES fnb_offers(id),
    FOREIGN KEY (campaign_plan_id) REFERENCES fnb_campaign_plans(id)
  );

  CREATE TABLE IF NOT EXISTS fnb_coupon_redemptions (
    id TEXT PRIMARY KEY,
    offer_id TEXT NOT NULL,
    location_id TEXT NOT NULL,
    source TEXT NOT NULL,
    redeemed_at BIGINT NOT NULL,
    value INTEGER DEFAULT 0,
    FOREIGN KEY (offer_id) REFERENCES fnb_offers(id),
    FOREIGN KEY (location_id) REFERENCES fnb_locations(id)
  );

  CREATE TABLE IF NOT EXISTS fnb_attribution_events (
    id TEXT PRIMARY KEY,
    location_id TEXT NOT NULL,
    campaign_plan_id TEXT,
    draft_id TEXT,
    offer_id TEXT,
    source TEXT NOT NULL,
    source_key TEXT,
    event_type TEXT NOT NULL,
    value INTEGER DEFAULT 0,
    metadata_json TEXT,
    created_at BIGINT NOT NULL,
    FOREIGN KEY (location_id) REFERENCES fnb_locations(id),
    FOREIGN KEY (campaign_plan_id) REFERENCES fnb_campaign_plans(id),
    FOREIGN KEY (draft_id) REFERENCES fnb_drafts(id),
    FOREIGN KEY (offer_id) REFERENCES fnb_offers(id)
  );

  CREATE TABLE IF NOT EXISTS fnb_weekly_digests (
    id TEXT PRIMARY KEY,
    location_id TEXT NOT NULL,
    period_start BIGINT NOT NULL,
    period_end BIGINT NOT NULL,
    headline TEXT NOT NULL,
    summary_json TEXT NOT NULL,
    recommended_next_action TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    FOREIGN KEY (location_id) REFERENCES fnb_locations(id)
  );

  CREATE TABLE IF NOT EXISTS fnb_audit_logs (
    id TEXT PRIMARY KEY,
    location_id TEXT NOT NULL,
    actor_type TEXT NOT NULL,
    actor_id TEXT,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    payload_json TEXT,
    created_at BIGINT NOT NULL,
    FOREIGN KEY (location_id) REFERENCES fnb_locations(id)
  );

  CREATE TABLE IF NOT EXISTS fnb_external_events (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    external_event_id TEXT NOT NULL,
    location_id TEXT,
    event_type TEXT,
    payload_json TEXT,
    processed_at BIGINT NOT NULL,
    UNIQUE(provider, external_event_id)
  );

  CREATE INDEX IF NOT EXISTS idx_fnb_locations_tenant ON fnb_locations(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_fnb_operator_accounts_tenant ON fnb_operator_accounts(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_fnb_operator_memberships_operator ON fnb_operator_location_memberships(operator_id, location_id);
  CREATE INDEX IF NOT EXISTS idx_fnb_line_identities_user ON fnb_line_identities(provider_user_id);
  CREATE INDEX IF NOT EXISTS idx_fnb_drafts_location ON fnb_drafts(location_id, status);
  CREATE INDEX IF NOT EXISTS idx_fnb_drafts_route ON fnb_drafts(location_id, route);
  CREATE INDEX IF NOT EXISTS idx_fnb_approvals_location ON fnb_approval_requests(location_id, status);
  CREATE INDEX IF NOT EXISTS idx_fnb_customers_location ON fnb_customers(location_id, updated_at);
  CREATE INDEX IF NOT EXISTS idx_fnb_customer_tags_customer ON fnb_customer_tags(customer_id, tag);
  CREATE INDEX IF NOT EXISTS idx_fnb_customer_notes_customer ON fnb_customer_notes(customer_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_fnb_events_location ON fnb_attribution_events(location_id, created_at);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_fnb_events_source_key ON fnb_attribution_events(location_id, source, source_key);
  CREATE INDEX IF NOT EXISTS idx_fnb_digests_location ON fnb_weekly_digests(location_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_fnb_audit_logs_location ON fnb_audit_logs(location_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_fnb_external_events_provider ON fnb_external_events(provider, external_event_id);
`

let persistencePromise = null

async function createAdapter() {
  const databaseUrl = process.env.DATABASE_URL
  if (databaseUrl) {
    if (databaseUrl.startsWith('pg-mem://')) {
      const { newDb } = await import('pg-mem')
      const mem = newDb()
      const { Pool: MemPool } = mem.adapters.createPg()
      const pool = new MemPool()
      return {
        kind: 'postgres',
        adapter: new PostgresAdapter(pool),
        close: async () => pool.end(),
      }
    }

    const pool = new Pool({
      connectionString: databaseUrl,
      ssl: process.env.DATABASE_SSL === '1' ? { rejectUnauthorized: false } : undefined,
    })
    return {
      kind: 'postgres',
      adapter: new PostgresAdapter(pool),
      close: async () => pool.end(),
    }
  }

  const sqlitePath = getSqlitePath()
  const dir = dirname(sqlitePath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const db = new Database(sqlitePath)
  db.pragma('journal_mode = WAL')

  return {
    kind: 'sqlite',
    adapter: new SqliteAdapter(db),
    close: async () => db.close(),
  }
}

async function createPersistence() {
  const { adapter, kind, close } = await createAdapter()
  await adapter.exec(FNB_SCHEMA_SQL)
  try {
    await adapter.exec('ALTER TABLE fnb_attribution_events ADD COLUMN source_key TEXT;')
  } catch {
    // Column already exists.
  }
  await adapter.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_fnb_events_source_key ON fnb_attribution_events(location_id, source, source_key);')

  return {
    kind,
    adapter,
    close,
    meta: {
      environment: getFnbEnvironment(),
      demoMode: process.env.FNB_DEMO_MODE === '1' || (!process.env.DATABASE_URL && getFnbEnvironment() === 'demo'),
    },
  }
}

export async function getFnbPersistence() {
  if (!persistencePromise) {
    persistencePromise = createPersistence()
  }
  return persistencePromise
}

export async function initializeFnbPersistence() {
  return getFnbPersistence()
}

export async function resetFnbPersistenceForTests() {
  if (persistencePromise) {
    const persistence = await persistencePromise
    await persistence.close()
  }
  persistencePromise = null
}

function toJson(value) {
  return JSON.stringify(value ?? null)
}

export class FnbTenantRepository {
  constructor(adapter) {
    this.adapter = adapter
  }

  async countTenants() {
    const row = await this.adapter.get('SELECT COUNT(*) AS total FROM fnb_tenants')
    return Number(row?.total || 0)
  }

  async listLocations() {
    return this.adapter.all(`
      SELECT l.*, t.name AS tenant_name, t.plan AS tenant_plan
      FROM fnb_locations l
      JOIN fnb_tenants t ON t.id = l.tenant_id
      ORDER BY l.created_at ASC
    `)
  }

  async getLocation(locationId) {
    return this.adapter.get(`
      SELECT l.*, t.name AS tenant_name, t.plan AS tenant_plan
      FROM fnb_locations l
      JOIN fnb_tenants t ON t.id = l.tenant_id
      WHERE l.id = ?
    `, [locationId])
  }

  async saveTenantAndLocation({
    tenantId,
    tenantName,
    plan = 'growth',
    locale = 'zh-TW',
    timezone = 'Asia/Taipei',
    locationId,
    locationName,
    restaurantType,
    address = null,
    merchantTimeBudgetMinutes = 15,
    status = 'active',
    createdAt,
    updatedAt,
  }) {
    const tenant = await this.adapter.get('SELECT id FROM fnb_tenants WHERE id = ?', [tenantId])
    if (tenant) {
      await this.adapter.run(`
        UPDATE fnb_tenants
        SET name = ?, plan = ?, status = ?, locale = ?, timezone = ?, updated_at = ?
        WHERE id = ?
      `, [tenantName, plan, status, locale, timezone, updatedAt, tenantId])
    } else {
      await this.adapter.run(`
        INSERT INTO fnb_tenants (id, name, plan, status, locale, timezone, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [tenantId, tenantName, plan, status, locale, timezone, createdAt, updatedAt])
    }

    const location = await this.adapter.get('SELECT id FROM fnb_locations WHERE id = ?', [locationId])
    if (location) {
      await this.adapter.run(`
        UPDATE fnb_locations
        SET tenant_id = ?, name = ?, restaurant_type = ?, address = ?, merchant_time_budget_minutes = ?, status = ?, updated_at = ?
        WHERE id = ?
      `, [tenantId, locationName, restaurantType, address, merchantTimeBudgetMinutes, status, updatedAt, locationId])
    } else {
      await this.adapter.run(`
        INSERT INTO fnb_locations (id, tenant_id, name, restaurant_type, address, merchant_time_budget_minutes, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [locationId, tenantId, locationName, restaurantType, address, merchantTimeBudgetMinutes, status, createdAt, updatedAt])
    }
  }

  async getMerchantProfile(locationId) {
    return this.adapter.get('SELECT * FROM fnb_merchant_profiles WHERE location_id = ?', [locationId])
  }

  async saveMerchantProfile(profile) {
    const existing = await this.getMerchantProfile(profile.locationId)
    if (existing) {
      await this.adapter.run(`
        UPDATE fnb_merchant_profiles
        SET owner_name = ?, line_user_id = ?, primary_goal = ?, weekly_time_budget_minutes = ?, low_touch_mode = ?, tone_summary = ?, notes = ?, updated_at = ?
        WHERE location_id = ?
      `, [
        profile.ownerName,
        profile.lineUserId,
        profile.primaryGoal,
        profile.weeklyTimeBudgetMinutes,
        profile.lowTouchMode ? 1 : 0,
        profile.toneSummary,
        profile.notes,
        profile.updatedAt,
        profile.locationId,
      ])
      return
    }

    await this.adapter.run(`
      INSERT INTO fnb_merchant_profiles (location_id, owner_name, line_user_id, primary_goal, weekly_time_budget_minutes, low_touch_mode, tone_summary, notes, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      profile.locationId,
      profile.ownerName,
      profile.lineUserId,
      profile.primaryGoal,
      profile.weeklyTimeBudgetMinutes,
      profile.lowTouchMode ? 1 : 0,
      profile.toneSummary,
      profile.notes,
      profile.updatedAt,
    ])
  }

  async getBrandPack(locationId) {
    return this.adapter.get('SELECT * FROM fnb_brand_packs WHERE location_id = ?', [locationId])
  }

  async saveBrandPack(pack) {
    const existing = await this.getBrandPack(pack.locationId)
    if (existing) {
      await this.adapter.run(`
        UPDATE fnb_brand_packs
        SET voice = ?, signature_items_json = ?, guardrails_json = ?, seasonal_focus = ?, updated_at = ?
        WHERE location_id = ?
      `, [
        pack.voice,
        toJson(pack.signatureItems),
        toJson(pack.guardrails),
        pack.seasonalFocus,
        pack.updatedAt,
        pack.locationId,
      ])
      return
    }

    await this.adapter.run(`
      INSERT INTO fnb_brand_packs (location_id, voice, signature_items_json, guardrails_json, seasonal_focus, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [
      pack.locationId,
      pack.voice,
      toJson(pack.signatureItems),
      toJson(pack.guardrails),
      pack.seasonalFocus,
      pack.updatedAt,
    ])
  }

  async listMenuItems(locationId) {
    return this.adapter.all(`
      SELECT * FROM fnb_menu_items
      WHERE location_id = ?
      ORDER BY is_signature DESC, name ASC
    `, [locationId])
  }

  async replaceMenuItems(locationId, items, updatedAt) {
    await this.adapter.run('DELETE FROM fnb_menu_items WHERE location_id = ?', [locationId])
    for (const item of items) {
      await this.adapter.run(`
        INSERT INTO fnb_menu_items (id, location_id, name, category, price_cents, is_signature, is_available, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        item.id || randomUUID(),
        locationId,
        item.name,
        item.category || null,
        item.priceCents || 0,
        item.isSignature ? 1 : 0,
        item.isAvailable === false ? 0 : 1,
        updatedAt,
      ])
    }
  }

  async listAuditLogs(locationId, limit = 12) {
    return this.adapter.all(`
      SELECT * FROM fnb_audit_logs
      WHERE location_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `, [locationId, limit])
  }

  async insertAuditLog(locationId, actorType, action, entityType, entityId, payload = {}, actorId = null) {
    await this.adapter.run(`
      INSERT INTO fnb_audit_logs (id, location_id, actor_type, actor_id, action, entity_type, entity_id, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [randomUUID(), locationId, actorType, actorId, action, entityType, entityId, toJson(payload), Date.now()])
  }

  async countAuditActions(locationId, action, start, end) {
    const row = await this.adapter.get(`
      SELECT COUNT(*) AS total
      FROM fnb_audit_logs
      WHERE location_id = ? AND action = ? AND created_at BETWEEN ? AND ?
    `, [locationId, action, start, end])
    return Number(row?.total || 0)
  }

  async findLocationByLineUserId(lineUserId) {
    return this.adapter.get(`
      SELECT l.*, t.name AS tenant_name, t.plan AS tenant_plan
      FROM fnb_merchant_profiles p
      JOIN fnb_locations l ON l.id = p.location_id
      JOIN fnb_tenants t ON t.id = l.tenant_id
      WHERE p.line_user_id = ?
    `, [lineUserId])
  }
}

export class FnbOperatorRepository {
  constructor(adapter) {
    this.adapter = adapter
  }

  async getOperatorById(operatorId) {
    return this.adapter.get('SELECT * FROM fnb_operator_accounts WHERE id = ?', [operatorId])
  }

  async getLineIdentity(providerUserId) {
    return this.adapter.get('SELECT * FROM fnb_line_identities WHERE provider_user_id = ?', [providerUserId])
  }

  async getLineIdentityByOperatorId(operatorId) {
    return this.adapter.get(`
      SELECT *
      FROM fnb_line_identities
      WHERE operator_id = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `, [operatorId])
  }

  async saveOperator(operator) {
    const existing = operator.id ? await this.getOperatorById(operator.id) : null
    if (existing) {
      await this.adapter.run(`
        UPDATE fnb_operator_accounts
        SET display_name = ?, role = ?, status = ?, updated_at = ?
        WHERE id = ?
      `, [operator.displayName, operator.role, operator.status || 'active', operator.updatedAt, existing.id])
      return existing.id
    }

    const id = operator.id || randomUUID()
    await this.adapter.run(`
      INSERT INTO fnb_operator_accounts (id, tenant_id, display_name, role, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      operator.tenantId,
      operator.displayName,
      operator.role,
      operator.status || 'active',
      operator.createdAt,
      operator.updatedAt,
    ])
    return id
  }

  async getMembership(operatorId, locationId) {
    return this.adapter.get(`
      SELECT * FROM fnb_operator_location_memberships
      WHERE operator_id = ? AND location_id = ?
    `, [operatorId, locationId])
  }

  async saveMembership(membership) {
    const existing = await this.getMembership(membership.operatorId, membership.locationId)
    if (membership.isDefault) {
      await this.adapter.run(`
        UPDATE fnb_operator_location_memberships
        SET is_default = 0, updated_at = ?
        WHERE operator_id = ?
      `, [membership.updatedAt, membership.operatorId])
    }

    if (existing) {
      await this.adapter.run(`
        UPDATE fnb_operator_location_memberships
        SET role = ?, is_default = ?, updated_at = ?
        WHERE id = ?
      `, [
        membership.role,
        membership.isDefault ? 1 : 0,
        membership.updatedAt,
        existing.id,
      ])
      return existing.id
    }

    const id = membership.id || randomUUID()
    await this.adapter.run(`
      INSERT INTO fnb_operator_location_memberships (id, operator_id, location_id, role, is_default, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      membership.operatorId,
      membership.locationId,
      membership.role,
      membership.isDefault ? 1 : 0,
      membership.createdAt,
      membership.updatedAt,
    ])
    return id
  }

  async saveLineIdentity(identity) {
    const existing = await this.getLineIdentity(identity.providerUserId)
    if (existing) {
      await this.adapter.run(`
        UPDATE fnb_line_identities
        SET operator_id = ?, tenant_id = ?, display_name = ?, picture_url = ?, status = ?, metadata_json = ?, updated_at = ?
        WHERE id = ?
      `, [
        identity.operatorId,
        identity.tenantId,
        identity.displayName || null,
        identity.pictureUrl || null,
        identity.status || 'active',
        toJson(identity.metadata),
        identity.updatedAt,
        existing.id,
      ])
      return existing.id
    }

    const id = identity.id || randomUUID()
    await this.adapter.run(`
      INSERT INTO fnb_line_identities (id, provider_user_id, operator_id, tenant_id, display_name, picture_url, status, metadata_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      identity.providerUserId,
      identity.operatorId,
      identity.tenantId,
      identity.displayName || null,
      identity.pictureUrl || null,
      identity.status || 'active',
      toJson(identity.metadata),
      identity.createdAt,
      identity.updatedAt,
    ])
    return id
  }

  async findPrimaryOperatorForLocation(locationId) {
    return this.adapter.get(`
      SELECT o.*, m.location_id, m.role AS membership_role, m.is_default
      FROM fnb_operator_accounts o
      JOIN fnb_operator_location_memberships m ON m.operator_id = o.id
      WHERE m.location_id = ?
      ORDER BY m.is_default DESC, o.created_at ASC
      LIMIT 1
    `, [locationId])
  }

  async listOperatorMemberships(operatorId) {
    return this.adapter.all(`
      SELECT
        o.id AS operator_id,
        o.display_name,
        o.role AS operator_role,
        o.status AS operator_status,
        m.id AS membership_id,
        m.role AS membership_role,
        m.is_default,
        l.id AS location_id,
        l.name AS location_name,
        l.restaurant_type,
        l.address,
        l.status AS location_status,
        l.tenant_id,
        t.name AS tenant_name,
        t.plan AS tenant_plan
      FROM fnb_operator_accounts o
      JOIN fnb_operator_location_memberships m ON m.operator_id = o.id
      JOIN fnb_locations l ON l.id = m.location_id
      JOIN fnb_tenants t ON t.id = l.tenant_id
      WHERE o.id = ?
      ORDER BY m.is_default DESC, l.created_at ASC
    `, [operatorId])
  }

  async resolveLineIdentityContext(providerUserId) {
    const identity = await this.adapter.get(`
      SELECT
        i.*,
        o.display_name AS operator_display_name,
        o.role AS operator_role,
        o.status AS operator_status
      FROM fnb_line_identities i
      JOIN fnb_operator_accounts o ON o.id = i.operator_id
      WHERE i.provider_user_id = ?
    `, [providerUserId])
    if (!identity) return null

    const memberships = await this.listOperatorMemberships(identity.operator_id)
    return {
      identity,
      memberships,
    }
  }
}

export class FnbChannelConnectionRepository {
  constructor(adapter) {
    this.adapter = adapter
  }

  async listConnections(locationId) {
    return this.adapter.all(`
      SELECT * FROM fnb_channel_connections
      WHERE location_id = ?
      ORDER BY channel ASC
    `, [locationId])
  }

  async getConnection(locationId, channel) {
    return this.adapter.get(`
      SELECT * FROM fnb_channel_connections
      WHERE location_id = ? AND channel = ?
    `, [locationId, channel])
  }

  async saveConnection(connection) {
    const existing = await this.getConnection(connection.locationId, connection.channel)
    if (existing) {
      await this.adapter.run(`
        UPDATE fnb_channel_connections
        SET status = ?, metadata_json = ?, last_synced_at = ?, last_error = ?, expires_at = ?
        WHERE id = ?
      `, [
        connection.status,
        toJson(connection.metadata),
        connection.lastSyncedAt || null,
        connection.lastError || null,
        connection.expiresAt || null,
        existing.id,
      ])
      return { ...existing, id: existing.id }
    }

    const id = connection.id || randomUUID()
    await this.adapter.run(`
      INSERT INTO fnb_channel_connections (id, location_id, channel, status, metadata_json, last_synced_at, last_error, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      connection.locationId,
      connection.channel,
      connection.status,
      toJson(connection.metadata),
      connection.lastSyncedAt || null,
      connection.lastError || null,
      connection.expiresAt || null,
    ])
    return { id }
  }

  async listRules(locationId) {
    return this.adapter.all(`
      SELECT * FROM fnb_autopilot_rules
      WHERE location_id = ?
      ORDER BY name ASC
    `, [locationId])
  }

  async saveRule(rule) {
    const existing = await this.adapter.get('SELECT id FROM fnb_autopilot_rules WHERE id = ?', [rule.id])
    if (existing) {
      await this.adapter.run(`
        UPDATE fnb_autopilot_rules
        SET name = ?, trigger_type = ?, action_mode = ?, risk_tolerance = ?, enabled = ?, config_json = ?, updated_at = ?
        WHERE id = ?
      `, [
        rule.name,
        rule.triggerType,
        rule.actionMode,
        rule.riskTolerance,
        rule.enabled ? 1 : 0,
        toJson(rule.config),
        rule.updatedAt,
        rule.id,
      ])
      return
    }

    await this.adapter.run(`
      INSERT INTO fnb_autopilot_rules (id, location_id, name, trigger_type, action_mode, risk_tolerance, enabled, config_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      rule.id,
      rule.locationId,
      rule.name,
      rule.triggerType,
      rule.actionMode,
      rule.riskTolerance,
      rule.enabled ? 1 : 0,
      toJson(rule.config),
      rule.updatedAt,
    ])
  }
}

export class FnbCampaignRepository {
  constructor(adapter) {
    this.adapter = adapter
  }

  async getLatestCampaignPlan(locationId) {
    return this.adapter.get(`
      SELECT *
      FROM fnb_campaign_plans
      WHERE location_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `, [locationId])
  }

  async getCampaignPlanById(id) {
    return this.adapter.get('SELECT * FROM fnb_campaign_plans WHERE id = ?', [id])
  }

  async createCampaignPlan(plan) {
    await this.adapter.run(`
      INSERT INTO fnb_campaign_plans (id, location_id, period_label, period_start, period_end, goal, status, summary, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      plan.id,
      plan.locationId,
      plan.periodLabel,
      plan.periodStart,
      plan.periodEnd,
      plan.goal,
      plan.status,
      plan.summary,
      plan.createdAt,
      plan.updatedAt,
    ])
  }

  async listDraftsByLocation(locationId) {
    return this.adapter.all(`
      SELECT *
      FROM fnb_drafts
      WHERE location_id = ?
      ORDER BY created_at DESC
    `, [locationId])
  }

  async listDraftsByPlan(planId) {
    return this.adapter.all(`
      SELECT *
      FROM fnb_drafts
      WHERE campaign_plan_id = ?
      ORDER BY created_at ASC
    `, [planId])
  }

  async getDraftById(id) {
    return this.adapter.get('SELECT * FROM fnb_drafts WHERE id = ?', [id])
  }

  async createDraft(draft) {
    await this.adapter.run(`
      INSERT INTO fnb_drafts (id, campaign_plan_id, location_id, channel, draft_type, title, body, asset_status, risk_score, brand_fit_score, status, route, scheduled_for, payload_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      draft.id,
      draft.campaignPlanId,
      draft.locationId,
      draft.channel,
      draft.draftType,
      draft.title,
      draft.body,
      draft.assetStatus,
      draft.riskScore,
      draft.brandFitScore,
      draft.status,
      draft.route,
      draft.scheduledFor,
      toJson(draft.payload),
      draft.createdAt,
      draft.updatedAt,
    ])
  }

  async updateDraftRoute(id, route, status, updatedAt) {
    const result = await this.adapter.run(`
      UPDATE fnb_drafts
      SET route = ?, status = ?, updated_at = ?
      WHERE id = ? AND status NOT IN ('published', 'skipped')
    `, [route, status, updatedAt, id])
    return Number(result?.changes || 0) > 0
  }

  async updateDraftStatus(id, status, scheduledFor, updatedAt) {
    const existing = await this.getDraftById(id)
    if (!existing) return false
    if ((existing.status === 'published' || existing.status === 'skipped') && status !== existing.status) {
      return false
    }
    const result = await this.adapter.run(`
      UPDATE fnb_drafts
      SET status = ?, scheduled_for = ?, updated_at = ?
      WHERE id = ?
    `, [status, scheduledFor ?? existing?.scheduled_for ?? null, updatedAt, id])
    return Number(result?.changes || 0) > 0
  }

  async getApprovalByDraft(draftId) {
    return this.adapter.get(`
      SELECT * FROM fnb_approval_requests
      WHERE draft_id = ?
      ORDER BY last_sent_at DESC
      LIMIT 1
    `, [draftId])
  }

  async saveApprovalRequest(approval) {
    const existing = await this.getApprovalByDraft(approval.draftId)
    if (existing) {
      await this.adapter.run(`
        UPDATE fnb_approval_requests
        SET status = ?, merchant_message = ?, last_sent_at = ?, responded_at = ?, response_payload_json = ?
        WHERE id = ?
      `, [
        approval.status,
        approval.merchantMessage,
        approval.lastSentAt,
        approval.respondedAt || null,
        toJson(approval.responsePayload),
        existing.id,
      ])
      return existing.id
    }

    const id = approval.id || randomUUID()
    await this.adapter.run(`
      INSERT INTO fnb_approval_requests (id, draft_id, location_id, channel, status, merchant_message, last_sent_at, responded_at, response_payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      approval.draftId,
      approval.locationId,
      approval.channel,
      approval.status,
      approval.merchantMessage,
      approval.lastSentAt,
      approval.respondedAt || null,
      toJson(approval.responsePayload),
    ])
    return id
  }

  async updateApproval(id, status, respondedAt, responsePayload, expectedCurrentStatus = null) {
    if (expectedCurrentStatus) {
      const result = await this.adapter.run(`
        UPDATE fnb_approval_requests
        SET status = ?, responded_at = ?, response_payload_json = ?
        WHERE id = ? AND status = ?
      `, [status, respondedAt, toJson(responsePayload), id, expectedCurrentStatus])
      return Number(result?.changes || 0) > 0
    }
    const result = await this.adapter.run(`
      UPDATE fnb_approval_requests
      SET status = ?, responded_at = ?, response_payload_json = ?
      WHERE id = ?
    `, [status, respondedAt, toJson(responsePayload), id])
    return Number(result?.changes || 0) > 0
  }

  async listPendingApprovals(locationId) {
    return this.adapter.all(`
      SELECT a.*, d.title, d.body, d.risk_score, d.route, d.status AS draft_status, d.scheduled_for, d.draft_type
      FROM fnb_approval_requests a
      JOIN fnb_drafts d ON d.id = a.draft_id
      WHERE a.location_id = ? AND a.status = 'pending'
      ORDER BY a.last_sent_at DESC
    `, [locationId])
  }

  async createOffer(offer) {
    await this.adapter.run(`
      INSERT INTO fnb_offers (id, location_id, campaign_plan_id, title, code, channel, cta_url, status, redemption_target, max_redemptions, redeemed_count, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      offer.id,
      offer.locationId,
      offer.campaignPlanId,
      offer.title,
      offer.code,
      offer.channel,
      offer.ctaUrl,
      offer.status,
      offer.redemptionTarget,
      offer.maxRedemptions,
      offer.redeemedCount,
      offer.expiresAt,
      offer.createdAt,
    ])
  }

  async listOffers(locationId) {
    return this.adapter.all(`
      SELECT * FROM fnb_offers
      WHERE location_id = ?
      ORDER BY created_at DESC
    `, [locationId])
  }

  async createShortLink(shortLink) {
    await this.adapter.run(`
      INSERT INTO fnb_short_links (id, location_id, offer_id, campaign_plan_id, slug, destination_url, qr_value, click_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      shortLink.id,
      shortLink.locationId,
      shortLink.offerId,
      shortLink.campaignPlanId,
      shortLink.slug,
      shortLink.destinationUrl,
      shortLink.qrValue,
      shortLink.clickCount || 0,
      shortLink.createdAt,
    ])
  }

  async getShortLinkByOffer(offerId) {
    return this.adapter.get('SELECT * FROM fnb_short_links WHERE offer_id = ? LIMIT 1', [offerId])
  }

  async createDigest(digest) {
    await this.adapter.run(`
      INSERT INTO fnb_weekly_digests (id, location_id, period_start, period_end, headline, summary_json, recommended_next_action, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      digest.id,
      digest.locationId,
      digest.periodStart,
      digest.periodEnd,
      digest.headline,
      toJson(digest.summary),
      digest.recommendedNextAction,
      digest.createdAt,
    ])
  }

  async getLatestDigest(locationId) {
    return this.adapter.get(`
      SELECT *
      FROM fnb_weekly_digests
      WHERE location_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `, [locationId])
  }

  async countDigests(locationId, start, end) {
    const row = await this.adapter.get(`
      SELECT COUNT(*) AS total
      FROM fnb_weekly_digests
      WHERE location_id = ? AND created_at BETWEEN ? AND ?
    `, [locationId, start, end])
    return Number(row?.total || 0)
  }
}

export class FnbAttributionRepository {
  constructor(adapter) {
    this.adapter = adapter
  }

  async findEventBySourceKey(locationId, source, sourceKey) {
    if (!sourceKey) return null
    return this.adapter.get(`
      SELECT id
      FROM fnb_attribution_events
      WHERE location_id = ? AND source = ? AND source_key = ?
      LIMIT 1
    `, [locationId, source, sourceKey])
  }

  async recordEvent(event) {
    const existing = await this.findEventBySourceKey(event.locationId, event.source, event.sourceKey)
    if (existing) {
      return { inserted: false, id: existing.id }
    }

    try {
      await this.adapter.run(`
        INSERT INTO fnb_attribution_events (id, location_id, campaign_plan_id, draft_id, offer_id, source, source_key, event_type, value, metadata_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        event.id,
        event.locationId,
        event.campaignPlanId || null,
        event.draftId || null,
        event.offerId || null,
        event.source,
        event.sourceKey || null,
        event.eventType,
        event.value,
        toJson(event.metadata),
        event.createdAt,
      ])
      return { inserted: true, id: event.id }
    } catch {
      const duplicated = await this.findEventBySourceKey(event.locationId, event.source, event.sourceKey)
      if (duplicated) {
        return { inserted: false, id: duplicated.id }
      }
      throw new Error('Failed to record attribution event')
    }
  }

  async listRecentEvents(locationId, limit = 10) {
    return this.adapter.all(`
      SELECT *
      FROM fnb_attribution_events
      WHERE location_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `, [locationId, limit])
  }

  async getMetricsByEventType(locationId, start, end) {
    return this.adapter.all(`
      SELECT event_type, COUNT(*) AS count, COALESCE(SUM(value), 0) AS total
      FROM fnb_attribution_events
      WHERE location_id = ? AND created_at BETWEEN ? AND ?
      GROUP BY event_type
    `, [locationId, start, end])
  }

  async getPublishedDraftCount(locationId, start, end) {
    const row = await this.adapter.get(`
      SELECT COUNT(*) AS total
      FROM fnb_drafts
      WHERE location_id = ? AND status = 'published' AND updated_at BETWEEN ? AND ?
    `, [locationId, start, end])
    return Number(row?.total || 0)
  }

  async getAutoPublishedCount(locationId, start, end) {
    const row = await this.adapter.get(`
      SELECT COUNT(*) AS total
      FROM fnb_drafts
      WHERE location_id = ? AND status = 'published' AND route = 'auto-send' AND updated_at BETWEEN ? AND ?
    `, [locationId, start, end])
    return Number(row?.total || 0)
  }

  async incrementShortLinkClicks(campaignPlanId, offerId) {
    await this.adapter.run(`
      UPDATE fnb_short_links
      SET click_count = click_count + 1
      WHERE campaign_plan_id = ? OR offer_id = ?
    `, [campaignPlanId || null, offerId || null])
  }

  async incrementOfferRedemptions(offerId) {
    await this.adapter.run(`
      UPDATE fnb_offers
      SET redeemed_count = redeemed_count + 1
      WHERE id = ?
    `, [offerId])
  }

  async createCouponRedemption(redemption) {
    await this.adapter.run(`
      INSERT INTO fnb_coupon_redemptions (id, offer_id, location_id, source, redeemed_at, value)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [
      redemption.id,
      redemption.offerId,
      redemption.locationId,
      redemption.source,
      redemption.redeemedAt,
      redemption.value || 0,
    ])
  }

  async countEvents(locationId, start, end) {
    const row = await this.adapter.get(`
      SELECT COUNT(*) AS total
      FROM fnb_attribution_events
      WHERE location_id = ? AND created_at BETWEEN ? AND ?
    `, [locationId, start, end])
    return Number(row?.total || 0)
  }

  async hasExternalEvent(provider, externalEventId) {
    const row = await this.adapter.get(`
      SELECT id FROM fnb_external_events
      WHERE provider = ? AND external_event_id = ?
    `, [provider, externalEventId])
    return Boolean(row)
  }

  async recordExternalEvent({ provider, externalEventId, locationId = null, eventType = null, payload = {} }) {
    if (await this.hasExternalEvent(provider, externalEventId)) {
      return false
    }

    try {
      await this.adapter.run(`
        INSERT INTO fnb_external_events (id, provider, external_event_id, location_id, event_type, payload_json, processed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [randomUUID(), provider, externalEventId, locationId, eventType, toJson(payload), Date.now()])
      return true
    } catch {
      return false
    }
  }
}

export class FnbCustomerRepository {
  constructor(adapter) {
    this.adapter = adapter
  }

  async listCustomers(locationId, filters = {}) {
    const rows = await this.adapter.all(`
      SELECT c.*, s.last_event_type, s.last_event_at, s.coupon_claims, s.message_count, s.friend_adds, s.visit_signals
      FROM fnb_customers c
      LEFT JOIN fnb_customer_activity_summary s ON s.customer_id = c.id
      WHERE c.location_id = ?
      ORDER BY c.last_interaction_at DESC, c.updated_at DESC
    `, [locationId])

    const normalizedQuery = filters.query ? String(filters.query).trim().toLowerCase() : ''
    const normalizedTag = filters.tag ? String(filters.tag).trim().toLowerCase() : ''
    const customers = []

    for (const row of rows) {
      const tags = await this.listCustomerTags(row.id)
      const notes = await this.listCustomerNotes(row.id, 3)
      const matchesQuery = !normalizedQuery || row.display_name.toLowerCase().includes(normalizedQuery)
      const matchesTag = !normalizedTag || tags.some((tag) => tag.tag.toLowerCase() === normalizedTag)
      if (!matchesQuery || !matchesTag) continue
      customers.push({
        ...row,
        tags,
        notes,
      })
    }

    return customers
  }

  async getCustomer(customerId) {
    return this.adapter.get(`
      SELECT c.*, s.last_event_type, s.last_event_at, s.coupon_claims, s.message_count, s.friend_adds, s.visit_signals
      FROM fnb_customers c
      LEFT JOIN fnb_customer_activity_summary s ON s.customer_id = c.id
      WHERE c.id = ?
    `, [customerId])
  }

  async createCustomer(customer) {
    await this.adapter.run(`
      INSERT INTO fnb_customers (id, location_id, display_name, source, status, loyalty_stage, phone, email, last_interaction_at, total_interactions, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      customer.id,
      customer.locationId,
      customer.displayName,
      customer.source || 'line',
      customer.status || 'active',
      customer.loyaltyStage || 'new',
      customer.phone || null,
      customer.email || null,
      customer.lastInteractionAt || null,
      customer.totalInteractions || 0,
      customer.createdAt,
      customer.updatedAt,
    ])
  }

  async saveActivitySummary(summary) {
    const existing = await this.adapter.get('SELECT customer_id FROM fnb_customer_activity_summary WHERE customer_id = ?', [summary.customerId])
    if (existing) {
      await this.adapter.run(`
        UPDATE fnb_customer_activity_summary
        SET location_id = ?, last_event_type = ?, last_event_at = ?, coupon_claims = ?, message_count = ?, friend_adds = ?, visit_signals = ?, updated_at = ?
        WHERE customer_id = ?
      `, [
        summary.locationId,
        summary.lastEventType || null,
        summary.lastEventAt || null,
        summary.couponClaims || 0,
        summary.messageCount || 0,
        summary.friendAdds || 0,
        summary.visitSignals || 0,
        summary.updatedAt,
        summary.customerId,
      ])
      return
    }

    await this.adapter.run(`
      INSERT INTO fnb_customer_activity_summary (customer_id, location_id, last_event_type, last_event_at, coupon_claims, message_count, friend_adds, visit_signals, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      summary.customerId,
      summary.locationId,
      summary.lastEventType || null,
      summary.lastEventAt || null,
      summary.couponClaims || 0,
      summary.messageCount || 0,
      summary.friendAdds || 0,
      summary.visitSignals || 0,
      summary.updatedAt,
    ])
  }

  async listCustomerTags(customerId) {
    return this.adapter.all(`
      SELECT *
      FROM fnb_customer_tags
      WHERE customer_id = ?
      ORDER BY tag ASC
    `, [customerId])
  }

  async replaceCustomerTags(customerId, locationId, tags, actorId, createdAt) {
    await this.adapter.run('DELETE FROM fnb_customer_tags WHERE customer_id = ?', [customerId])
    for (const tag of tags) {
      const normalizedTag = String(tag).trim()
      if (!normalizedTag) continue
      await this.adapter.run(`
        INSERT INTO fnb_customer_tags (id, customer_id, location_id, tag, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [randomUUID(), customerId, locationId, normalizedTag, actorId || null, createdAt])
    }
  }

  async listCustomerNotes(customerId, limit = 10) {
    return this.adapter.all(`
      SELECT *
      FROM fnb_customer_notes
      WHERE customer_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `, [customerId, limit])
  }

  async createCustomerNote(note) {
    await this.adapter.run(`
      INSERT INTO fnb_customer_notes (id, customer_id, location_id, body, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [
      note.id,
      note.customerId,
      note.locationId,
      note.body,
      note.createdBy || null,
      note.createdAt,
    ])
  }

  async countCustomers(locationId) {
    const row = await this.adapter.get(`
      SELECT COUNT(*) AS total
      FROM fnb_customers
      WHERE location_id = ?
    `, [locationId])
    return Number(row?.total || 0)
  }
}
