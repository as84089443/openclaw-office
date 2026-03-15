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
  tenant_id TEXT NOT NULL REFERENCES fnb_tenants(id),
  name TEXT NOT NULL,
  restaurant_type TEXT NOT NULL,
  address TEXT,
  merchant_time_budget_minutes INTEGER DEFAULT 15,
  status TEXT NOT NULL DEFAULT 'active',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS fnb_merchant_profiles (
  location_id TEXT PRIMARY KEY REFERENCES fnb_locations(id),
  owner_name TEXT,
  line_user_id TEXT,
  primary_goal TEXT,
  weekly_time_budget_minutes INTEGER DEFAULT 15,
  low_touch_mode BOOLEAN DEFAULT TRUE,
  tone_summary TEXT,
  notes TEXT,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS fnb_brand_packs (
  location_id TEXT PRIMARY KEY REFERENCES fnb_locations(id),
  voice TEXT,
  signature_items_json JSONB,
  guardrails_json JSONB,
  seasonal_focus TEXT,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS fnb_operator_accounts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES fnb_tenants(id),
  display_name TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS fnb_operator_location_memberships (
  id TEXT PRIMARY KEY,
  operator_id TEXT NOT NULL REFERENCES fnb_operator_accounts(id),
  location_id TEXT NOT NULL REFERENCES fnb_locations(id),
  role TEXT NOT NULL,
  is_default BOOLEAN DEFAULT FALSE,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE(operator_id, location_id)
);

CREATE TABLE IF NOT EXISTS fnb_line_identities (
  id TEXT PRIMARY KEY,
  provider_user_id TEXT NOT NULL UNIQUE,
  operator_id TEXT NOT NULL REFERENCES fnb_operator_accounts(id),
  tenant_id TEXT NOT NULL REFERENCES fnb_tenants(id),
  display_name TEXT,
  picture_url TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  metadata_json JSONB,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS fnb_menu_items (
  id TEXT PRIMARY KEY,
  location_id TEXT NOT NULL REFERENCES fnb_locations(id),
  name TEXT NOT NULL,
  category TEXT,
  price_cents INTEGER DEFAULT 0,
  is_signature BOOLEAN DEFAULT FALSE,
  is_available BOOLEAN DEFAULT TRUE,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS fnb_channel_connections (
  id TEXT PRIMARY KEY,
  location_id TEXT NOT NULL REFERENCES fnb_locations(id),
  channel TEXT NOT NULL,
  status TEXT NOT NULL,
  metadata_json JSONB,
  last_synced_at BIGINT,
  last_error TEXT,
  expires_at BIGINT
);

CREATE TABLE IF NOT EXISTS fnb_autopilot_rules (
  id TEXT PRIMARY KEY,
  location_id TEXT NOT NULL REFERENCES fnb_locations(id),
  name TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  action_mode TEXT NOT NULL,
  risk_tolerance NUMERIC(5, 4) DEFAULT 0.5,
  enabled BOOLEAN DEFAULT TRUE,
  config_json JSONB,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS fnb_campaign_plans (
  id TEXT PRIMARY KEY,
  location_id TEXT NOT NULL REFERENCES fnb_locations(id),
  period_label TEXT NOT NULL,
  period_start BIGINT NOT NULL,
  period_end BIGINT NOT NULL,
  goal TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  summary TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS fnb_drafts (
  id TEXT PRIMARY KEY,
  campaign_plan_id TEXT REFERENCES fnb_campaign_plans(id),
  location_id TEXT NOT NULL REFERENCES fnb_locations(id),
  channel TEXT NOT NULL,
  draft_type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  asset_status TEXT NOT NULL DEFAULT 'ready',
  risk_score NUMERIC(5, 4) DEFAULT 0.5,
  brand_fit_score NUMERIC(5, 4) DEFAULT 0.8,
  status TEXT NOT NULL DEFAULT 'draft',
  route TEXT,
  scheduled_for BIGINT,
  payload_json JSONB,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS fnb_approval_requests (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL REFERENCES fnb_drafts(id),
  location_id TEXT NOT NULL REFERENCES fnb_locations(id),
  channel TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  merchant_message TEXT NOT NULL,
  last_sent_at BIGINT,
  responded_at BIGINT,
  response_payload_json JSONB
);

CREATE TABLE IF NOT EXISTS fnb_offers (
  id TEXT PRIMARY KEY,
  location_id TEXT NOT NULL REFERENCES fnb_locations(id),
  campaign_plan_id TEXT REFERENCES fnb_campaign_plans(id),
  title TEXT NOT NULL,
  code TEXT NOT NULL,
  channel TEXT NOT NULL,
  cta_url TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  redemption_target INTEGER DEFAULT 0,
  max_redemptions INTEGER DEFAULT 0,
  redeemed_count INTEGER DEFAULT 0,
  expires_at BIGINT,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS fnb_customers (
  id TEXT PRIMARY KEY,
  location_id TEXT NOT NULL REFERENCES fnb_locations(id),
  display_name TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'line',
  status TEXT NOT NULL DEFAULT 'active',
  loyalty_stage TEXT DEFAULT 'new',
  phone TEXT,
  email TEXT,
  last_interaction_at BIGINT,
  total_interactions INTEGER DEFAULT 0,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS fnb_customer_tags (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES fnb_customers(id),
  location_id TEXT NOT NULL REFERENCES fnb_locations(id),
  tag TEXT NOT NULL,
  created_by TEXT,
  created_at BIGINT NOT NULL,
  UNIQUE(customer_id, tag)
);

CREATE TABLE IF NOT EXISTS fnb_customer_notes (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES fnb_customers(id),
  location_id TEXT NOT NULL REFERENCES fnb_locations(id),
  body TEXT NOT NULL,
  created_by TEXT,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS fnb_customer_activity_summary (
  customer_id TEXT PRIMARY KEY REFERENCES fnb_customers(id),
  location_id TEXT NOT NULL REFERENCES fnb_locations(id),
  last_event_type TEXT,
  last_event_at BIGINT,
  coupon_claims INTEGER DEFAULT 0,
  message_count INTEGER DEFAULT 0,
  friend_adds INTEGER DEFAULT 0,
  visit_signals INTEGER DEFAULT 0,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS fnb_short_links (
  id TEXT PRIMARY KEY,
  location_id TEXT NOT NULL REFERENCES fnb_locations(id),
  offer_id TEXT REFERENCES fnb_offers(id),
  campaign_plan_id TEXT REFERENCES fnb_campaign_plans(id),
  slug TEXT NOT NULL UNIQUE,
  destination_url TEXT NOT NULL,
  qr_value TEXT NOT NULL,
  click_count INTEGER DEFAULT 0,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS fnb_coupon_redemptions (
  id TEXT PRIMARY KEY,
  offer_id TEXT NOT NULL REFERENCES fnb_offers(id),
  location_id TEXT NOT NULL REFERENCES fnb_locations(id),
  source TEXT NOT NULL,
  redeemed_at BIGINT NOT NULL,
  value INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS fnb_attribution_events (
  id TEXT PRIMARY KEY,
  location_id TEXT NOT NULL REFERENCES fnb_locations(id),
  campaign_plan_id TEXT REFERENCES fnb_campaign_plans(id),
  draft_id TEXT REFERENCES fnb_drafts(id),
  offer_id TEXT REFERENCES fnb_offers(id),
  source TEXT NOT NULL,
  source_key TEXT,
  event_type TEXT NOT NULL,
  value INTEGER DEFAULT 0,
  metadata_json JSONB,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS fnb_weekly_digests (
  id TEXT PRIMARY KEY,
  location_id TEXT NOT NULL REFERENCES fnb_locations(id),
  period_start BIGINT NOT NULL,
  period_end BIGINT NOT NULL,
  headline TEXT NOT NULL,
  summary_json JSONB NOT NULL,
  recommended_next_action TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS fnb_audit_logs (
  id TEXT PRIMARY KEY,
  location_id TEXT NOT NULL REFERENCES fnb_locations(id),
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  payload_json JSONB,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS fnb_external_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  external_event_id TEXT NOT NULL,
  location_id TEXT,
  event_type TEXT,
  payload_json JSONB,
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
