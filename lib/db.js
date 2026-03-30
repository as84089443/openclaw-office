// SQLite Database for OpenClaw Office
// Provides persistent storage for requests and workflow events

import Database from 'better-sqlite3'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { mkdirSync, existsSync, readFileSync, renameSync } from 'fs'

const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
const OFFICE_ROOT = join(MODULE_DIR, '..')
const DEFAULT_DB_PATH = join(OFFICE_ROOT, 'data', 'openclaw-office.db')

function getConfiguredDbPath() {
  return process.env.OPENCLAW_OFFICE_DB_PATH || DEFAULT_DB_PATH
}

function shouldUseMemoryByDefault() {
  return false
}

function ensureDbDirectory(dbPath) {
  if (!dbPath || dbPath === ':memory:') return
  const dataDir = dirname(dbPath)
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })
}

function openDatabase() {
  const requestedPath = getConfiguredDbPath()
  const candidates = shouldUseMemoryByDefault()
    ? [':memory:', requestedPath]
    : [requestedPath]

  if (process.env.NODE_ENV === 'production' && !candidates.includes(':memory:')) {
    candidates.push(':memory:')
  }

  let lastError = null

  for (const candidate of candidates) {
    try {
      ensureDbDirectory(candidate)
      const database = new Database(candidate)
      database.pragma('journal_mode = WAL')
      return { database, path: candidate }
    } catch (error) {
      lastError = error
      console.error(`[db] Failed to open ${candidate}:`, error.message)
    }
  }

  throw lastError || new Error('Failed to initialize office database')
}

const dbRuntime = openDatabase()
export const DB_PATH = dbRuntime.path
export const DB_RUNTIME = {
  path: DB_PATH,
  inMemory: DB_PATH === ':memory:',
}
export const db = dbRuntime.database

if (DB_RUNTIME.inMemory) {
  console.warn('[db] OpenClaw Office is using in-memory SQLite fallback. Data will not persist across restarts.')
}

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS daily_stats (
    date TEXT PRIMARY KEY,
    messages_received INTEGER DEFAULT 0,
    messages_sent INTEGER DEFAULT 0,
    tokens_input INTEGER DEFAULT 0,
    tokens_output INTEGER DEFAULT 0,
    tasks_completed INTEGER DEFAULT 0,
    total_task_time_ms INTEGER DEFAULT 0,
    estimated_human_time_ms INTEGER DEFAULT 0,
    savings_myr REAL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS requests (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    from_user TEXT DEFAULT 'Boss',
    state TEXT DEFAULT 'received',
    assigned_to TEXT,
    task_id TEXT,
    task_title TEXT,
    task_detail TEXT,
    task_target_agent TEXT,
    task_reason TEXT,
    attention_type TEXT,
    priority INTEGER DEFAULT 0,
    needs_decision INTEGER DEFAULT 0,
    estimated_value REAL,
    attention_notified_at INTEGER,
    created_at INTEGER,
    work_started_at INTEGER,
    completed_at INTEGER,
    result TEXT,
    source TEXT DEFAULT 'api',
    tg_message_id INTEGER,
    chain_id TEXT
  );
  
  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    request_id TEXT,
    state TEXT,
    agent TEXT,
    agent_color TEXT,
    agent_name TEXT,
    message TEXT,
    target_agent TEXT,
    time TEXT,
    timestamp INTEGER,
    result TEXT,
    FOREIGN KEY (request_id) REFERENCES requests(id)
  );
  
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    request_id TEXT,
    parent_task_id TEXT,
    root_task_id TEXT,
    task_type TEXT DEFAULT 'primary',
    source_agent TEXT,
    merge_policy TEXT,
    graph_depth INTEGER DEFAULT 0,
    closed_by_parent INTEGER DEFAULT 0,
    resolution_source TEXT,
    title TEXT,
    detail TEXT,
    assigned_agent TEXT,
    dispatch_session_key TEXT,
    dispatch_run_id TEXT,
    status TEXT DEFAULT 'pending',
    brain_mode TEXT,
    brain_state_json TEXT,
    reviewer_results_json TEXT,
    consensus_json TEXT,
    risk_tier TEXT,
    retry_budget INTEGER DEFAULT 2,
    retry_count INTEGER DEFAULT 0,
    escalation_level INTEGER DEFAULT 0,
    auto_continue_allowed INTEGER DEFAULT 1,
    auto_apply_allowed INTEGER DEFAULT 0,
    human_gate_reason TEXT,
    reusable_memory_json TEXT,
    root_cause TEXT,
    delegation_json TEXT,
    evolution_note TEXT,
    memory_updated_at INTEGER,
    attention_type TEXT,
    priority INTEGER DEFAULT 0,
    needs_decision INTEGER DEFAULT 0,
    estimated_value REAL,
    completion_value REAL,
    did_improve INTEGER DEFAULT 0,
    did_improve_score REAL,
    business_delta REAL,
    process_score REAL,
    business_score REAL,
    rollback_needed INTEGER DEFAULT 0,
    milestone TEXT,
    next_step TEXT,
    continuation_required INTEGER DEFAULT 0,
    pending_action TEXT,
    continuation_checked_at INTEGER,
    completion_gate_required INTEGER DEFAULT 0,
    last_update INTEGER,
    stale_notified_at INTEGER,
    created_at INTEGER,
    started_at INTEGER,
    completed_at INTEGER,
    result TEXT,
    FOREIGN KEY (request_id) REFERENCES requests(id)
  );

  CREATE TABLE IF NOT EXISTS daily_digests (
    date TEXT PRIMARY KEY,
    generated_at INTEGER NOT NULL,
    content TEXT NOT NULL,
    summary_json TEXT,
    delivered_at INTEGER,
    delivery_status TEXT,
    target TEXT
  );

  CREATE TABLE IF NOT EXISTS attention_state (
    id TEXT PRIMARY KEY,
    source TEXT,
    agent_id TEXT,
    attention_type TEXT,
    status TEXT DEFAULT 'open',
    linked_request_id TEXT,
    linked_task_id TEXT,
    latest_event_id TEXT,
    signal_count INTEGER DEFAULT 1,
    signal_score_max REAL DEFAULT 0,
    categories_json TEXT,
    snoozed_until INTEGER,
    assigned_owner TEXT,
    closed_reason TEXT,
    next_review_at INTEGER,
    task_result TEXT,
    completion_value REAL,
    did_improve INTEGER DEFAULT 0,
    did_improve_score REAL,
    business_delta REAL,
    process_score REAL,
    business_score REAL,
    rollback_needed INTEGER DEFAULT 0,
    action_history_json TEXT,
    last_feedback_at INTEGER,
    first_seen_at INTEGER,
    last_seen_at INTEGER,
    resolved_at INTEGER,
    updated_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS lobster_rules (
    id TEXT PRIMARY KEY,
    category TEXT,
    rule_type TEXT,
    title TEXT,
    summary TEXT,
    trigger_key TEXT NOT NULL,
    confidence REAL DEFAULT 0,
    status TEXT DEFAULT 'draft',
    success_count INTEGER DEFAULT 0,
    failure_count INTEGER DEFAULT 0,
    source_task_id TEXT,
    source_root_task_id TEXT,
    evidence_json TEXT,
    rule_json TEXT,
    created_at INTEGER,
    updated_at INTEGER,
    last_seen_at INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_requests_state ON requests(state);
  CREATE INDEX IF NOT EXISTS idx_requests_created ON requests(created_at);
  CREATE INDEX IF NOT EXISTS idx_events_request ON events(request_id);
  CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
  CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
  CREATE INDEX IF NOT EXISTS idx_tasks_agent ON tasks(assigned_agent);
  CREATE INDEX IF NOT EXISTS idx_tasks_request ON tasks(request_id);
  CREATE INDEX IF NOT EXISTS idx_attention_state_status ON attention_state(status);
  CREATE INDEX IF NOT EXISTS idx_attention_state_agent ON attention_state(agent_id);
  CREATE INDEX IF NOT EXISTS idx_lobster_rules_status ON lobster_rules(status);
  CREATE INDEX IF NOT EXISTS idx_lobster_rules_updated ON lobster_rules(updated_at);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_lobster_rules_trigger ON lobster_rules(trigger_key, category);
`)

function migrateAddColumnIfMissing({ table, column, alterSql, logMessage }) {
  try {
    db.prepare(`SELECT ${column} FROM ${table} LIMIT 1`).get()
    return
  } catch {}

  try {
    db.exec(alterSql)
    console.log(logMessage)
  } catch (error) {
    // Concurrent initialization can race across workers during build.
    if (String(error?.message || '').toLowerCase().includes('duplicate column name')) return
    throw error
  }
}

function serializeJsonField(value, fallback = null) {
  if (value === undefined) return fallback
  if (value === null) return null
  try {
    return JSON.stringify(value)
  } catch {
    return fallback
  }
}

function parseJsonField(value, fallback) {
  if (!value) return fallback
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

// Migration: add task_id column to events if missing
migrateAddColumnIfMissing({
  table: 'events',
  column: 'task_id',
  alterSql: 'ALTER TABLE events ADD COLUMN task_id TEXT',
  logMessage: '[DB] Added task_id column to events table',
})
db.exec('CREATE INDEX IF NOT EXISTS idx_events_task ON events(task_id)')

// Migration: add source column if missing
migrateAddColumnIfMissing({
  table: 'requests',
  column: 'source',
  alterSql: "ALTER TABLE requests ADD COLUMN source TEXT DEFAULT 'api'",
  logMessage: '[DB] Added source column to requests table',
})

for (const migration of [
  {
    column: 'parent_task_id',
    alterSql: 'ALTER TABLE tasks ADD COLUMN parent_task_id TEXT',
    logMessage: '[DB] Added parent_task_id column to tasks table',
  },
  {
    column: 'root_task_id',
    alterSql: 'ALTER TABLE tasks ADD COLUMN root_task_id TEXT',
    logMessage: '[DB] Added root_task_id column to tasks table',
  },
  {
    column: 'task_type',
    alterSql: "ALTER TABLE tasks ADD COLUMN task_type TEXT DEFAULT 'primary'",
    logMessage: '[DB] Added task_type column to tasks table',
  },
  {
    column: 'source_agent',
    alterSql: 'ALTER TABLE tasks ADD COLUMN source_agent TEXT',
    logMessage: '[DB] Added source_agent column to tasks table',
  },
  {
    column: 'merge_policy',
    alterSql: 'ALTER TABLE tasks ADD COLUMN merge_policy TEXT',
    logMessage: '[DB] Added merge_policy column to tasks table',
  },
  {
    column: 'graph_depth',
    alterSql: 'ALTER TABLE tasks ADD COLUMN graph_depth INTEGER DEFAULT 0',
    logMessage: '[DB] Added graph_depth column to tasks table',
  },
  {
    column: 'closed_by_parent',
    alterSql: 'ALTER TABLE tasks ADD COLUMN closed_by_parent INTEGER DEFAULT 0',
    logMessage: '[DB] Added closed_by_parent column to tasks table',
  },
  {
    column: 'resolution_source',
    alterSql: 'ALTER TABLE tasks ADD COLUMN resolution_source TEXT',
    logMessage: '[DB] Added resolution_source column to tasks table',
  },
  {
    column: 'reviewer_results_json',
    alterSql: 'ALTER TABLE tasks ADD COLUMN reviewer_results_json TEXT',
    logMessage: '[DB] Added reviewer_results_json column to tasks table',
  },
  {
    column: 'consensus_json',
    alterSql: 'ALTER TABLE tasks ADD COLUMN consensus_json TEXT',
    logMessage: '[DB] Added consensus_json column to tasks table',
  },
  {
    column: 'risk_tier',
    alterSql: 'ALTER TABLE tasks ADD COLUMN risk_tier TEXT',
    logMessage: '[DB] Added risk_tier column to tasks table',
  },
  {
    column: 'retry_budget',
    alterSql: 'ALTER TABLE tasks ADD COLUMN retry_budget INTEGER DEFAULT 2',
    logMessage: '[DB] Added retry_budget column to tasks table',
  },
  {
    column: 'retry_count',
    alterSql: 'ALTER TABLE tasks ADD COLUMN retry_count INTEGER DEFAULT 0',
    logMessage: '[DB] Added retry_count column to tasks table',
  },
  {
    column: 'escalation_level',
    alterSql: 'ALTER TABLE tasks ADD COLUMN escalation_level INTEGER DEFAULT 0',
    logMessage: '[DB] Added escalation_level column to tasks table',
  },
  {
    column: 'auto_continue_allowed',
    alterSql: 'ALTER TABLE tasks ADD COLUMN auto_continue_allowed INTEGER DEFAULT 1',
    logMessage: '[DB] Added auto_continue_allowed column to tasks table',
  },
  {
    column: 'auto_apply_allowed',
    alterSql: 'ALTER TABLE tasks ADD COLUMN auto_apply_allowed INTEGER DEFAULT 0',
    logMessage: '[DB] Added auto_apply_allowed column to tasks table',
  },
  {
    column: 'human_gate_reason',
    alterSql: 'ALTER TABLE tasks ADD COLUMN human_gate_reason TEXT',
    logMessage: '[DB] Added human_gate_reason column to tasks table',
  },
  {
    column: 'reusable_memory_json',
    alterSql: 'ALTER TABLE tasks ADD COLUMN reusable_memory_json TEXT',
    logMessage: '[DB] Added reusable_memory_json column to tasks table',
  },
]) {
  migrateAddColumnIfMissing({
    table: 'tasks',
    column: migration.column,
    alterSql: migration.alterSql,
    logMessage: migration.logMessage,
  })
}

db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id)')
db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_root ON tasks(root_task_id)')
db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_type ON tasks(task_type)')
db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_dispatch_run_id ON tasks(dispatch_run_id)')

// Migration: add tg_message_id column for deterministic correlation
migrateAddColumnIfMissing({
  table: 'requests',
  column: 'tg_message_id',
  alterSql: 'ALTER TABLE requests ADD COLUMN tg_message_id INTEGER',
  logMessage: '[DB] Added tg_message_id column to requests table',
})
db.exec('CREATE INDEX IF NOT EXISTS idx_requests_tg_msg ON requests(tg_message_id)')

// Migration: add chain_id column for multi-step delegation chains
migrateAddColumnIfMissing({
  table: 'requests',
  column: 'chain_id',
  alterSql: 'ALTER TABLE requests ADD COLUMN chain_id TEXT',
  logMessage: '[DB] Added chain_id column to requests table',
})
db.exec('CREATE INDEX IF NOT EXISTS idx_requests_chain ON requests(chain_id)')

migrateAddColumnIfMissing({
  table: 'requests',
  column: 'attention_type',
  alterSql: 'ALTER TABLE requests ADD COLUMN attention_type TEXT',
  logMessage: '[DB] Added attention_type column to requests table',
})
migrateAddColumnIfMissing({
  table: 'requests',
  column: 'priority',
  alterSql: 'ALTER TABLE requests ADD COLUMN priority INTEGER DEFAULT 0',
  logMessage: '[DB] Added priority column to requests table',
})
migrateAddColumnIfMissing({
  table: 'requests',
  column: 'needs_decision',
  alterSql: 'ALTER TABLE requests ADD COLUMN needs_decision INTEGER DEFAULT 0',
  logMessage: '[DB] Added needs_decision column to requests table',
})
migrateAddColumnIfMissing({
  table: 'requests',
  column: 'estimated_value',
  alterSql: 'ALTER TABLE requests ADD COLUMN estimated_value REAL',
  logMessage: '[DB] Added estimated_value column to requests table',
})
migrateAddColumnIfMissing({
  table: 'requests',
  column: 'attention_notified_at',
  alterSql: 'ALTER TABLE requests ADD COLUMN attention_notified_at INTEGER',
  logMessage: '[DB] Added attention_notified_at column to requests table',
})

migrateAddColumnIfMissing({
  table: 'tasks',
  column: 'attention_type',
  alterSql: 'ALTER TABLE tasks ADD COLUMN attention_type TEXT',
  logMessage: '[DB] Added attention_type column to tasks table',
})
migrateAddColumnIfMissing({
  table: 'tasks',
  column: 'priority',
  alterSql: 'ALTER TABLE tasks ADD COLUMN priority INTEGER DEFAULT 0',
  logMessage: '[DB] Added priority column to tasks table',
})
migrateAddColumnIfMissing({
  table: 'tasks',
  column: 'needs_decision',
  alterSql: 'ALTER TABLE tasks ADD COLUMN needs_decision INTEGER DEFAULT 0',
  logMessage: '[DB] Added needs_decision column to tasks table',
})
migrateAddColumnIfMissing({
  table: 'tasks',
  column: 'estimated_value',
  alterSql: 'ALTER TABLE tasks ADD COLUMN estimated_value REAL',
  logMessage: '[DB] Added estimated_value column to tasks table',
})
migrateAddColumnIfMissing({
  table: 'tasks',
  column: 'dispatch_session_key',
  alterSql: 'ALTER TABLE tasks ADD COLUMN dispatch_session_key TEXT',
  logMessage: '[DB] Added dispatch_session_key column to tasks table',
})
migrateAddColumnIfMissing({
  table: 'tasks',
  column: 'dispatch_run_id',
  alterSql: 'ALTER TABLE tasks ADD COLUMN dispatch_run_id TEXT',
  logMessage: '[DB] Added dispatch_run_id column to tasks table',
})
migrateAddColumnIfMissing({
  table: 'tasks',
  column: 'brain_mode',
  alterSql: 'ALTER TABLE tasks ADD COLUMN brain_mode TEXT',
  logMessage: '[DB] Added brain_mode column to tasks table',
})
migrateAddColumnIfMissing({
  table: 'tasks',
  column: 'brain_state_json',
  alterSql: 'ALTER TABLE tasks ADD COLUMN brain_state_json TEXT',
  logMessage: '[DB] Added brain_state_json column to tasks table',
})
migrateAddColumnIfMissing({
  table: 'tasks',
  column: 'root_cause',
  alterSql: 'ALTER TABLE tasks ADD COLUMN root_cause TEXT',
  logMessage: '[DB] Added root_cause column to tasks table',
})
migrateAddColumnIfMissing({
  table: 'tasks',
  column: 'delegation_json',
  alterSql: 'ALTER TABLE tasks ADD COLUMN delegation_json TEXT',
  logMessage: '[DB] Added delegation_json column to tasks table',
})
migrateAddColumnIfMissing({
  table: 'tasks',
  column: 'evolution_note',
  alterSql: 'ALTER TABLE tasks ADD COLUMN evolution_note TEXT',
  logMessage: '[DB] Added evolution_note column to tasks table',
})
migrateAddColumnIfMissing({
  table: 'tasks',
  column: 'memory_updated_at',
  alterSql: 'ALTER TABLE tasks ADD COLUMN memory_updated_at INTEGER',
  logMessage: '[DB] Added memory_updated_at column to tasks table',
})
migrateAddColumnIfMissing({
  table: 'tasks',
  column: 'completion_value',
  alterSql: 'ALTER TABLE tasks ADD COLUMN completion_value REAL',
  logMessage: '[DB] Added completion_value column to tasks table',
})
migrateAddColumnIfMissing({
  table: 'tasks',
  column: 'did_improve',
  alterSql: 'ALTER TABLE tasks ADD COLUMN did_improve INTEGER DEFAULT 0',
  logMessage: '[DB] Added did_improve column to tasks table',
})
migrateAddColumnIfMissing({
  table: 'tasks',
  column: 'rollback_needed',
  alterSql: 'ALTER TABLE tasks ADD COLUMN rollback_needed INTEGER DEFAULT 0',
  logMessage: '[DB] Added rollback_needed column to tasks table',
})
migrateAddColumnIfMissing({
  table: 'tasks',
  column: 'did_improve_score',
  alterSql: 'ALTER TABLE tasks ADD COLUMN did_improve_score REAL',
  logMessage: '[DB] Added did_improve_score column to tasks table',
})
migrateAddColumnIfMissing({
  table: 'tasks',
  column: 'business_delta',
  alterSql: 'ALTER TABLE tasks ADD COLUMN business_delta REAL',
  logMessage: '[DB] Added business_delta column to tasks table',
})
migrateAddColumnIfMissing({
  table: 'tasks',
  column: 'process_score',
  alterSql: 'ALTER TABLE tasks ADD COLUMN process_score REAL',
  logMessage: '[DB] Added process_score column to tasks table',
})
migrateAddColumnIfMissing({
  table: 'tasks',
  column: 'business_score',
  alterSql: 'ALTER TABLE tasks ADD COLUMN business_score REAL',
  logMessage: '[DB] Added business_score column to tasks table',
})
migrateAddColumnIfMissing({
  table: 'tasks',
  column: 'milestone',
  alterSql: 'ALTER TABLE tasks ADD COLUMN milestone TEXT',
  logMessage: '[DB] Added milestone column to tasks table',
})
migrateAddColumnIfMissing({
  table: 'tasks',
  column: 'next_step',
  alterSql: 'ALTER TABLE tasks ADD COLUMN next_step TEXT',
  logMessage: '[DB] Added next_step column to tasks table',
})
migrateAddColumnIfMissing({
  table: 'tasks',
  column: 'last_update',
  alterSql: 'ALTER TABLE tasks ADD COLUMN last_update INTEGER',
  logMessage: '[DB] Added last_update column to tasks table',
})
migrateAddColumnIfMissing({
  table: 'tasks',
  column: 'stale_notified_at',
  alterSql: 'ALTER TABLE tasks ADD COLUMN stale_notified_at INTEGER',
  logMessage: '[DB] Added stale_notified_at column to tasks table',
})
migrateAddColumnIfMissing({
  table: 'tasks',
  column: 'continuation_required',
  alterSql: 'ALTER TABLE tasks ADD COLUMN continuation_required INTEGER DEFAULT 0',
  logMessage: '[DB] Added continuation_required column to tasks table',
})
migrateAddColumnIfMissing({
  table: 'tasks',
  column: 'pending_action',
  alterSql: 'ALTER TABLE tasks ADD COLUMN pending_action TEXT',
  logMessage: '[DB] Added pending_action column to tasks table',
})
migrateAddColumnIfMissing({
  table: 'tasks',
  column: 'continuation_checked_at',
  alterSql: 'ALTER TABLE tasks ADD COLUMN continuation_checked_at INTEGER',
  logMessage: '[DB] Added continuation_checked_at column to tasks table',
})
migrateAddColumnIfMissing({
  table: 'tasks',
  column: 'completion_gate_required',
  alterSql: 'ALTER TABLE tasks ADD COLUMN completion_gate_required INTEGER DEFAULT 0',
  logMessage: '[DB] Added completion_gate_required column to tasks table',
})

migrateAddColumnIfMissing({
  table: 'attention_state',
  column: 'snoozed_until',
  alterSql: 'ALTER TABLE attention_state ADD COLUMN snoozed_until INTEGER',
  logMessage: '[DB] Added snoozed_until column to attention_state table',
})
migrateAddColumnIfMissing({
  table: 'attention_state',
  column: 'assigned_owner',
  alterSql: 'ALTER TABLE attention_state ADD COLUMN assigned_owner TEXT',
  logMessage: '[DB] Added assigned_owner column to attention_state table',
})
migrateAddColumnIfMissing({
  table: 'attention_state',
  column: 'closed_reason',
  alterSql: 'ALTER TABLE attention_state ADD COLUMN closed_reason TEXT',
  logMessage: '[DB] Added closed_reason column to attention_state table',
})
migrateAddColumnIfMissing({
  table: 'attention_state',
  column: 'next_review_at',
  alterSql: 'ALTER TABLE attention_state ADD COLUMN next_review_at INTEGER',
  logMessage: '[DB] Added next_review_at column to attention_state table',
})
migrateAddColumnIfMissing({
  table: 'attention_state',
  column: 'task_result',
  alterSql: 'ALTER TABLE attention_state ADD COLUMN task_result TEXT',
  logMessage: '[DB] Added task_result column to attention_state table',
})
migrateAddColumnIfMissing({
  table: 'attention_state',
  column: 'completion_value',
  alterSql: 'ALTER TABLE attention_state ADD COLUMN completion_value REAL',
  logMessage: '[DB] Added completion_value column to attention_state table',
})
migrateAddColumnIfMissing({
  table: 'attention_state',
  column: 'did_improve',
  alterSql: 'ALTER TABLE attention_state ADD COLUMN did_improve INTEGER DEFAULT 0',
  logMessage: '[DB] Added did_improve column to attention_state table',
})
migrateAddColumnIfMissing({
  table: 'attention_state',
  column: 'rollback_needed',
  alterSql: 'ALTER TABLE attention_state ADD COLUMN rollback_needed INTEGER DEFAULT 0',
  logMessage: '[DB] Added rollback_needed column to attention_state table',
})
migrateAddColumnIfMissing({
  table: 'attention_state',
  column: 'last_feedback_at',
  alterSql: 'ALTER TABLE attention_state ADD COLUMN last_feedback_at INTEGER',
  logMessage: '[DB] Added last_feedback_at column to attention_state table',
})
migrateAddColumnIfMissing({
  table: 'attention_state',
  column: 'did_improve_score',
  alterSql: 'ALTER TABLE attention_state ADD COLUMN did_improve_score REAL',
  logMessage: '[DB] Added did_improve_score column to attention_state table',
})
migrateAddColumnIfMissing({
  table: 'attention_state',
  column: 'business_delta',
  alterSql: 'ALTER TABLE attention_state ADD COLUMN business_delta REAL',
  logMessage: '[DB] Added business_delta column to attention_state table',
})
migrateAddColumnIfMissing({
  table: 'attention_state',
  column: 'process_score',
  alterSql: 'ALTER TABLE attention_state ADD COLUMN process_score REAL',
  logMessage: '[DB] Added process_score column to attention_state table',
})
migrateAddColumnIfMissing({
  table: 'attention_state',
  column: 'business_score',
  alterSql: 'ALTER TABLE attention_state ADD COLUMN business_score REAL',
  logMessage: '[DB] Added business_score column to attention_state table',
})
migrateAddColumnIfMissing({
  table: 'attention_state',
  column: 'action_history_json',
  alterSql: 'ALTER TABLE attention_state ADD COLUMN action_history_json TEXT',
  logMessage: '[DB] Added action_history_json column to attention_state table',
})

// ─────────────────────────────────────────────────────────
// Request Functions
// ─────────────────────────────────────────────────────────
const insertRequestStmt = db.prepare(`
  INSERT INTO requests (id, content, from_user, state, assigned_to, task_id, task_title, task_detail, task_target_agent, task_reason, attention_type, priority, needs_decision, estimated_value, attention_notified_at, created_at, work_started_at, completed_at, result, source, tg_message_id, chain_id)
  VALUES (@id, @content, @from_user, @state, @assigned_to, @task_id, @task_title, @task_detail, @task_target_agent, @task_reason, @attention_type, @priority, @needs_decision, @estimated_value, @attention_notified_at, @created_at, @work_started_at, @completed_at, @result, @source, @tg_message_id, @chain_id)
`)

const updateRequestStmt = db.prepare(`
  UPDATE requests SET
    content = @content,
    from_user = @from_user,
    state = @state,
    assigned_to = @assigned_to,
    task_id = @task_id,
    task_title = @task_title,
    task_detail = @task_detail,
    task_target_agent = @task_target_agent,
    task_reason = @task_reason,
    attention_type = @attention_type,
    priority = @priority,
    needs_decision = @needs_decision,
    estimated_value = @estimated_value,
    attention_notified_at = @attention_notified_at,
    created_at = @created_at,
    work_started_at = @work_started_at,
    completed_at = @completed_at,
    result = @result,
    source = @source,
    chain_id = @chain_id
  WHERE id = @id
`)

const getRequestByIdStmt = db.prepare('SELECT * FROM requests WHERE id = ?')
const getRequestsStmt = db.prepare('SELECT * FROM requests ORDER BY created_at DESC LIMIT ?')
const getActiveRequestsStmt = db.prepare("SELECT * FROM requests WHERE state != 'completed' ORDER BY created_at DESC LIMIT ?")
// FIFO: oldest first — messages are processed in order (fallback for non-Telegram sources)
// Include 'analyzing' because the webhook auto-progresses from received → analyzing at 800ms
const findOldestPendingStmt = db.prepare("SELECT * FROM requests WHERE state IN ('received', 'analyzing') ORDER BY created_at ASC LIMIT 1")
const findOldestIncompleteStmt = db.prepare("SELECT * FROM requests WHERE state NOT IN ('completed') ORDER BY created_at ASC LIMIT 1")

// Deterministic correlation: find request by Telegram message_id
const findByTgMessageIdStmt = db.prepare("SELECT * FROM requests WHERE tg_message_id = ? LIMIT 1")

export function createRequest(data) {
  const row = {
    id: data.id,
    content: data.content,
    from_user: data.from || 'Boss',
    state: data.state || 'received',
    assigned_to: data.assignedTo || null,
    task_id: data.task?.id || null,
    task_title: data.task?.title || null,
    task_detail: data.task?.detail || null,
    task_target_agent: data.task?.targetAgent || null,
    task_reason: data.task?.reason || null,
    attention_type: data.attentionType || null,
    priority: Number.isFinite(data.priority) ? Number(data.priority) : 0,
    needs_decision: data.needsDecision ? 1 : 0,
    estimated_value: Number.isFinite(data.estimatedValue) ? Number(data.estimatedValue) : null,
    attention_notified_at: data.attentionNotifiedAt || null,
    created_at: data.createdAt || Date.now(),
    work_started_at: data.workStartedAt || null,
    completed_at: data.completedAt || null,
    result: data.result || null,
    source: data.source || 'api',
    tg_message_id: data.tgMessageId || null,
    chain_id: data.chainId || null,
  }
  insertRequestStmt.run(row)
  return getRequestById(data.id)
}

export function updateRequest(id, data) {
  const existing = getRequestByIdStmt.get(id)
  if (!existing) return null
  
  const row = {
    id,
    content: data.content ?? existing.content,
    from_user: data.from ?? existing.from_user,
    state: data.state ?? existing.state,
    assigned_to: data.assignedTo ?? existing.assigned_to,
    task_id: data.task?.id ?? existing.task_id,
    task_title: data.task?.title ?? existing.task_title,
    task_detail: data.task?.detail ?? existing.task_detail,
    task_target_agent: data.task?.targetAgent ?? existing.task_target_agent,
    task_reason: data.task?.reason ?? existing.task_reason,
    attention_type: data.attentionType ?? existing.attention_type,
    priority: data.priority ?? existing.priority ?? 0,
    needs_decision: data.needsDecision === undefined ? (existing.needs_decision ?? 0) : (data.needsDecision ? 1 : 0),
    estimated_value: data.estimatedValue ?? existing.estimated_value ?? null,
    attention_notified_at: data.attentionNotifiedAt ?? existing.attention_notified_at ?? null,
    created_at: data.createdAt ?? existing.created_at,
    work_started_at: data.workStartedAt ?? existing.work_started_at,
    completed_at: data.completedAt ?? existing.completed_at,
    result: data.result ?? existing.result,
    source: data.source ?? existing.source ?? 'api',
    chain_id: data.chainId ?? existing.chain_id ?? null,
  }
  updateRequestStmt.run(row)
  return getRequestById(id)
}

export function getRequestById(id) {
  const row = getRequestByIdStmt.get(id)
  return row ? rowToRequest(row) : null
}

export function getRequests(limit = 20, activeOnly = false) {
  const rows = activeOnly 
    ? getActiveRequestsStmt.all(limit)
    : getRequestsStmt.all(limit)
  return rows.map(rowToRequest)
}

// FIFO adoption: return the oldest pending (received/analyzing) request.
// Messages are processed in order, so the oldest pending entry
// always corresponds to the current quick_flow call.
// DEPRECATED: Use findByTgMessageId for reliable correlation
export function findOldestReceived() {
  const row = findOldestPendingStmt.get()
  return row ? rowToRequest(row) : null
}

export function findOldestIncomplete() {
  const row = findOldestIncompleteStmt.get()
  return row ? rowToRequest(row) : null
}

// Deterministic adoption: find request by Telegram message_id
// This is the reliable way to correlate webhook entries with quick_flow calls
export function findByTgMessageId(messageId) {
  if (!messageId) return null
  const row = findByTgMessageIdStmt.get(messageId)
  return row ? rowToRequest(row) : null
}

// Find the most recently completed request in a chain
const findLastCompletedInChainStmt = db.prepare("SELECT * FROM requests WHERE chain_id = ? AND state = 'completed' ORDER BY completed_at DESC LIMIT 1")

export function findLastCompletedInChain(chainId) {
  if (!chainId) return null
  const row = findLastCompletedInChainStmt.get(chainId)
  return row ? rowToRequest(row) : null
}

// Complete all non-completed requests (used on session reset)
const completeAllActiveStmt = db.prepare(`
  UPDATE requests SET state = 'completed', completed_at = ?, result = ?
  WHERE state != 'completed'
`)

export function completeAllActive(reason = 'Session reset') {
  const active = getActiveRequestsStmt.all(100)
  const now = Date.now()
  if (active.length > 0) {
    completeAllActiveStmt.run(now, reason)
  }
  return active.length
}

function rowToRequest(row) {
  return {
    id: row.id,
    content: row.content,
    from: row.from_user,
    state: row.state,
    assignedTo: row.assigned_to,
    task: row.task_id ? {
      id: row.task_id,
      title: row.task_title,
      detail: row.task_detail,
      targetAgent: row.task_target_agent,
      reason: row.task_reason,
    } : null,
    createdAt: row.created_at,
    workStartedAt: row.work_started_at,
    completedAt: row.completed_at,
    result: row.result,
    source: row.source || 'api',
    tgMessageId: row.tg_message_id,
    chainId: row.chain_id,
    attentionType: row.attention_type,
    priority: row.priority || 0,
    needsDecision: Boolean(row.needs_decision),
    estimatedValue: row.estimated_value ?? null,
    attentionNotifiedAt: row.attention_notified_at ?? null,
  }
}

// ─────────────────────────────────────────────────────────
// Task Functions
// ─────────────────────────────────────────────────────────
const insertTaskStmt = db.prepare(`
  INSERT INTO tasks (id, request_id, parent_task_id, root_task_id, task_type, source_agent, merge_policy, graph_depth, closed_by_parent, resolution_source, title, detail, assigned_agent, dispatch_session_key, dispatch_run_id, status, brain_mode, brain_state_json, reviewer_results_json, consensus_json, risk_tier, retry_budget, retry_count, escalation_level, auto_continue_allowed, auto_apply_allowed, human_gate_reason, reusable_memory_json, root_cause, delegation_json, evolution_note, memory_updated_at, attention_type, priority, needs_decision, estimated_value, completion_value, did_improve, did_improve_score, business_delta, process_score, business_score, rollback_needed, milestone, next_step, continuation_required, pending_action, continuation_checked_at, completion_gate_required, last_update, stale_notified_at, created_at, started_at, completed_at, result)
  VALUES (@id, @request_id, @parent_task_id, @root_task_id, @task_type, @source_agent, @merge_policy, @graph_depth, @closed_by_parent, @resolution_source, @title, @detail, @assigned_agent, @dispatch_session_key, @dispatch_run_id, @status, @brain_mode, @brain_state_json, @reviewer_results_json, @consensus_json, @risk_tier, @retry_budget, @retry_count, @escalation_level, @auto_continue_allowed, @auto_apply_allowed, @human_gate_reason, @reusable_memory_json, @root_cause, @delegation_json, @evolution_note, @memory_updated_at, @attention_type, @priority, @needs_decision, @estimated_value, @completion_value, @did_improve, @did_improve_score, @business_delta, @process_score, @business_score, @rollback_needed, @milestone, @next_step, @continuation_required, @pending_action, @continuation_checked_at, @completion_gate_required, @last_update, @stale_notified_at, @created_at, @started_at, @completed_at, @result)
`)

const updateTaskStmt = db.prepare(`
  UPDATE tasks SET
    parent_task_id = @parent_task_id,
    root_task_id = @root_task_id,
    task_type = @task_type,
    source_agent = @source_agent,
    merge_policy = @merge_policy,
    graph_depth = @graph_depth,
    closed_by_parent = @closed_by_parent,
    resolution_source = @resolution_source,
    title = @title,
    detail = @detail,
    assigned_agent = @assigned_agent,
    dispatch_session_key = @dispatch_session_key,
    dispatch_run_id = @dispatch_run_id,
    status = @status,
    brain_mode = @brain_mode,
    brain_state_json = @brain_state_json,
    reviewer_results_json = @reviewer_results_json,
    consensus_json = @consensus_json,
    risk_tier = @risk_tier,
    retry_budget = @retry_budget,
    retry_count = @retry_count,
    escalation_level = @escalation_level,
    auto_continue_allowed = @auto_continue_allowed,
    auto_apply_allowed = @auto_apply_allowed,
    human_gate_reason = @human_gate_reason,
    reusable_memory_json = @reusable_memory_json,
    root_cause = @root_cause,
    delegation_json = @delegation_json,
    evolution_note = @evolution_note,
    memory_updated_at = @memory_updated_at,
    attention_type = @attention_type,
    priority = @priority,
    needs_decision = @needs_decision,
    estimated_value = @estimated_value,
    completion_value = @completion_value,
    did_improve = @did_improve,
    did_improve_score = @did_improve_score,
    business_delta = @business_delta,
    process_score = @process_score,
    business_score = @business_score,
    rollback_needed = @rollback_needed,
    milestone = @milestone,
    next_step = @next_step,
    continuation_required = @continuation_required,
    pending_action = @pending_action,
    continuation_checked_at = @continuation_checked_at,
    completion_gate_required = @completion_gate_required,
    last_update = @last_update,
    stale_notified_at = @stale_notified_at,
    started_at = @started_at,
    completed_at = @completed_at,
    result = @result
  WHERE id = @id
`)

const getTaskByIdStmt = db.prepare('SELECT * FROM tasks WHERE id = ?')
const getTaskByRequestIdStmt = db.prepare(`
  SELECT * FROM tasks
  WHERE request_id = ?
    AND COALESCE(task_type, 'primary') = 'primary'
  ORDER BY
    CASE WHEN status NOT IN ('completed', 'failed') THEN 0 ELSE 1 END ASC,
    COALESCE(last_update, memory_updated_at, completed_at, started_at, created_at) DESC,
    created_at DESC
  LIMIT 1
`)
const getPrimaryTasksByRequestStmt = db.prepare(`
  SELECT * FROM tasks
  WHERE request_id = ?
    AND COALESCE(task_type, 'primary') = 'primary'
  ORDER BY
    CASE WHEN status NOT IN ('completed', 'failed') THEN 0 ELSE 1 END ASC,
    COALESCE(last_update, memory_updated_at, completed_at, started_at, created_at) DESC,
    created_at DESC
`)
const getActiveTaskByAgentStmt = db.prepare("SELECT * FROM tasks WHERE assigned_agent = ? AND status NOT IN ('completed', 'failed') ORDER BY created_at DESC LIMIT 1")
const getTaskByDispatchRunIdStmt = db.prepare("SELECT * FROM tasks WHERE dispatch_run_id = ? AND status NOT IN ('completed', 'failed') ORDER BY created_at DESC LIMIT 1")
const getActiveTasksStmt = db.prepare("SELECT * FROM tasks WHERE status IN ('pending', 'assigned', 'in_progress') ORDER BY created_at DESC LIMIT ?")
const getRecentTasksStmt = db.prepare('SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?')
const getChildTasksByParentStmt = db.prepare(`
  SELECT * FROM tasks
  WHERE parent_task_id = ?
  ORDER BY created_at DESC
  LIMIT ?
`)
const getTaskGraphByRootStmt = db.prepare(`
  SELECT * FROM tasks
  WHERE root_task_id = ?
     OR id = ?
  ORDER BY graph_depth ASC, created_at ASC
  LIMIT ?
`)
const listDuplicatePrimaryTaskRequestsStmt = db.prepare(`
  SELECT request_id, COUNT(*) AS count
  FROM tasks
  WHERE request_id IS NOT NULL
    AND COALESCE(task_type, 'primary') = 'primary'
  GROUP BY request_id
  HAVING COUNT(*) > 1
  ORDER BY count DESC, request_id ASC
`)
const listLobsterRulesStmt = db.prepare(`
  SELECT * FROM lobster_rules
  ORDER BY updated_at DESC, confidence DESC, last_seen_at DESC
  LIMIT ?
`)
const upsertLobsterRuleStmt = db.prepare(`
  INSERT INTO lobster_rules (
    id,
    category,
    rule_type,
    title,
    summary,
    trigger_key,
    confidence,
    status,
    success_count,
    failure_count,
    source_task_id,
    source_root_task_id,
    evidence_json,
    rule_json,
    created_at,
    updated_at,
    last_seen_at
  ) VALUES (
    @id,
    @category,
    @rule_type,
    @title,
    @summary,
    @trigger_key,
    @confidence,
    @status,
    @success_count,
    @failure_count,
    @source_task_id,
    @source_root_task_id,
    @evidence_json,
    @rule_json,
    @created_at,
    @updated_at,
    @last_seen_at
  )
  ON CONFLICT(trigger_key, category) DO UPDATE SET
    rule_type = excluded.rule_type,
    title = excluded.title,
    summary = excluded.summary,
    confidence = excluded.confidence,
    status = excluded.status,
    success_count = excluded.success_count,
    failure_count = excluded.failure_count,
    source_task_id = excluded.source_task_id,
    source_root_task_id = excluded.source_root_task_id,
    evidence_json = excluded.evidence_json,
    rule_json = excluded.rule_json,
    updated_at = excluded.updated_at,
    last_seen_at = excluded.last_seen_at
`)

export function createTask(data) {
  const id = data.id || `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  const taskType = data.taskType || 'primary'
  const parentTaskId = data.parentTaskId || null
  const rootTaskId = data.rootTaskId || (taskType === 'primary' ? id : (parentTaskId || id))
  const graphDepth = Number.isFinite(data.graphDepth)
    ? Number(data.graphDepth)
    : (taskType === 'primary' ? 0 : (parentTaskId ? 1 : 0))
  const row = {
    id,
    request_id: data.requestId || null,
    parent_task_id: parentTaskId,
    root_task_id: rootTaskId,
    task_type: taskType,
    source_agent: data.sourceAgent || null,
    merge_policy: data.mergePolicy || null,
    graph_depth: graphDepth,
    closed_by_parent: data.closedByParent ? 1 : 0,
    resolution_source: data.resolutionSource || null,
    title: data.title || null,
    detail: data.detail || null,
    assigned_agent: data.assignedAgent || null,
    dispatch_session_key: data.dispatchSessionKey || null,
    dispatch_run_id: data.dispatchRunId || null,
    status: data.status || 'pending',
    brain_mode: data.brainMode || null,
    brain_state_json: serializeJsonField(data.brainState, null),
    reviewer_results_json: serializeJsonField(data.reviewerResults, null),
    consensus_json: serializeJsonField(data.consensus, null),
    risk_tier: data.riskTier || null,
    retry_budget: Number.isFinite(data.retryBudget) ? Number(data.retryBudget) : 2,
    retry_count: Number.isFinite(data.retryCount) ? Number(data.retryCount) : 0,
    escalation_level: Number.isFinite(data.escalationLevel) ? Number(data.escalationLevel) : 0,
    auto_continue_allowed: data.autoContinueAllowed === undefined ? 1 : (data.autoContinueAllowed ? 1 : 0),
    auto_apply_allowed: data.autoApplyAllowed ? 1 : 0,
    human_gate_reason: data.humanGateReason || null,
    reusable_memory_json: serializeJsonField(data.reusableMemory, null),
    root_cause: data.rootCause || null,
    delegation_json: serializeJsonField(data.delegationPlan, null),
    evolution_note: data.evolutionNote || null,
    memory_updated_at: data.memoryUpdatedAt || null,
    attention_type: data.attentionType || null,
    priority: Number.isFinite(data.priority) ? Number(data.priority) : 0,
    needs_decision: data.needsDecision ? 1 : 0,
    estimated_value: Number.isFinite(data.estimatedValue) ? Number(data.estimatedValue) : null,
    completion_value: Number.isFinite(data.completionValue) ? Number(data.completionValue) : null,
    did_improve: data.didImprove ? 1 : 0,
    did_improve_score: Number.isFinite(data.didImproveScore) ? Number(data.didImproveScore) : null,
    business_delta: Number.isFinite(data.businessDelta) ? Number(data.businessDelta) : null,
    process_score: Number.isFinite(data.processScore) ? Number(data.processScore) : null,
    business_score: Number.isFinite(data.businessScore) ? Number(data.businessScore) : null,
    rollback_needed: data.rollbackNeeded ? 1 : 0,
    milestone: data.milestone || null,
    next_step: data.nextStep || null,
    continuation_required: data.continuationRequired ? 1 : 0,
    pending_action: data.pendingAction || null,
    continuation_checked_at: data.continuationCheckedAt || null,
    completion_gate_required: data.completionGateRequired ? 1 : 0,
    last_update: data.lastUpdate || Date.now(),
    stale_notified_at: data.staleNotifiedAt || null,
    created_at: data.createdAt || Date.now(),
    started_at: data.startedAt || null,
    completed_at: data.completedAt || null,
    result: data.result || null,
  }
  insertTaskStmt.run(row)
  return getTaskById(row.id)
}

export function updateTask(id, data) {
  const existing = getTaskByIdStmt.get(id)
  if (!existing) return null
  const hasField = (key) => Object.prototype.hasOwnProperty.call(data, key)

  const row = {
    id,
    parent_task_id: hasField('parentTaskId') ? data.parentTaskId : (existing.parent_task_id ?? null),
    root_task_id: hasField('rootTaskId') ? data.rootTaskId : (existing.root_task_id ?? existing.id ?? id),
    task_type: hasField('taskType') ? data.taskType : (existing.task_type ?? 'primary'),
    source_agent: hasField('sourceAgent') ? data.sourceAgent : (existing.source_agent ?? null),
    merge_policy: hasField('mergePolicy') ? data.mergePolicy : (existing.merge_policy ?? null),
    graph_depth: hasField('graphDepth') ? data.graphDepth : (existing.graph_depth ?? 0),
    closed_by_parent: data.closedByParent === undefined ? (existing.closed_by_parent ?? 0) : (data.closedByParent ? 1 : 0),
    resolution_source: hasField('resolutionSource') ? data.resolutionSource : (existing.resolution_source ?? null),
    title: hasField('title') ? data.title : existing.title,
    detail: hasField('detail') ? data.detail : existing.detail,
    assigned_agent: hasField('assignedAgent') ? data.assignedAgent : existing.assigned_agent,
    dispatch_session_key: hasField('dispatchSessionKey') ? data.dispatchSessionKey : (existing.dispatch_session_key ?? null),
    dispatch_run_id: hasField('dispatchRunId') ? data.dispatchRunId : (existing.dispatch_run_id ?? null),
    status: hasField('status') ? data.status : existing.status,
    brain_mode: hasField('brainMode') ? data.brainMode : (existing.brain_mode ?? null),
    brain_state_json: data.brainState === undefined
      ? (existing.brain_state_json ?? null)
      : serializeJsonField(data.brainState, existing.brain_state_json ?? null),
    reviewer_results_json: data.reviewerResults === undefined
      ? (existing.reviewer_results_json ?? null)
      : serializeJsonField(data.reviewerResults, existing.reviewer_results_json ?? null),
    consensus_json: data.consensus === undefined
      ? (existing.consensus_json ?? null)
      : serializeJsonField(data.consensus, existing.consensus_json ?? null),
    risk_tier: hasField('riskTier') ? data.riskTier : (existing.risk_tier ?? null),
    retry_budget: hasField('retryBudget') ? data.retryBudget : (existing.retry_budget ?? 2),
    retry_count: hasField('retryCount') ? data.retryCount : (existing.retry_count ?? 0),
    escalation_level: hasField('escalationLevel') ? data.escalationLevel : (existing.escalation_level ?? 0),
    auto_continue_allowed: data.autoContinueAllowed === undefined ? (existing.auto_continue_allowed ?? 1) : (data.autoContinueAllowed ? 1 : 0),
    auto_apply_allowed: data.autoApplyAllowed === undefined ? (existing.auto_apply_allowed ?? 0) : (data.autoApplyAllowed ? 1 : 0),
    human_gate_reason: hasField('humanGateReason') ? data.humanGateReason : (existing.human_gate_reason ?? null),
    reusable_memory_json: data.reusableMemory === undefined
      ? (existing.reusable_memory_json ?? null)
      : serializeJsonField(data.reusableMemory, existing.reusable_memory_json ?? null),
    root_cause: hasField('rootCause') ? data.rootCause : (existing.root_cause ?? null),
    delegation_json: data.delegationPlan === undefined
      ? (existing.delegation_json ?? null)
      : serializeJsonField(data.delegationPlan, existing.delegation_json ?? null),
    evolution_note: hasField('evolutionNote') ? data.evolutionNote : (existing.evolution_note ?? null),
    memory_updated_at: hasField('memoryUpdatedAt') ? data.memoryUpdatedAt : (existing.memory_updated_at ?? null),
    attention_type: hasField('attentionType') ? data.attentionType : (existing.attention_type ?? null),
    priority: hasField('priority') ? data.priority : (existing.priority ?? 0),
    needs_decision: data.needsDecision === undefined ? (existing.needs_decision ?? 0) : (data.needsDecision ? 1 : 0),
    estimated_value: hasField('estimatedValue') ? data.estimatedValue : (existing.estimated_value ?? null),
    completion_value: hasField('completionValue') ? data.completionValue : (existing.completion_value ?? null),
    did_improve: data.didImprove === undefined ? (existing.did_improve ?? 0) : (data.didImprove ? 1 : 0),
    did_improve_score: hasField('didImproveScore') ? data.didImproveScore : (existing.did_improve_score ?? null),
    business_delta: hasField('businessDelta') ? data.businessDelta : (existing.business_delta ?? null),
    process_score: hasField('processScore') ? data.processScore : (existing.process_score ?? null),
    business_score: hasField('businessScore') ? data.businessScore : (existing.business_score ?? null),
    rollback_needed: data.rollbackNeeded === undefined ? (existing.rollback_needed ?? 0) : (data.rollbackNeeded ? 1 : 0),
    milestone: hasField('milestone') ? data.milestone : (existing.milestone ?? null),
    next_step: hasField('nextStep') ? data.nextStep : (existing.next_step ?? null),
    continuation_required: data.continuationRequired === undefined ? (existing.continuation_required ?? 0) : (data.continuationRequired ? 1 : 0),
    pending_action: hasField('pendingAction') ? data.pendingAction : (existing.pending_action ?? null),
    continuation_checked_at: hasField('continuationCheckedAt') ? data.continuationCheckedAt : (existing.continuation_checked_at ?? null),
    completion_gate_required: data.completionGateRequired === undefined ? (existing.completion_gate_required ?? 0) : (data.completionGateRequired ? 1 : 0),
    last_update: hasField('lastUpdate') ? data.lastUpdate : (existing.last_update ?? Date.now()),
    stale_notified_at: hasField('staleNotifiedAt') ? data.staleNotifiedAt : (existing.stale_notified_at ?? null),
    started_at: hasField('startedAt') ? data.startedAt : existing.started_at,
    completed_at: hasField('completedAt') ? data.completedAt : existing.completed_at,
    result: hasField('result') ? data.result : existing.result,
  }
  updateTaskStmt.run(row)
  return getTaskById(id)
}

export function getTaskById(id) {
  const row = getTaskByIdStmt.get(id)
  return row ? rowToTask(row) : null
}

export function getTaskByRequestId(requestId) {
  const row = getTaskByRequestIdStmt.get(requestId)
  return row ? rowToTask(row) : null
}

export function getPrimaryTasksByRequest(requestId) {
  const rows = getPrimaryTasksByRequestStmt.all(requestId)
  return rows.map(rowToTask)
}

export function getActiveTaskByAgent(agent) {
  const row = getActiveTaskByAgentStmt.get(agent)
  return row ? rowToTask(row) : null
}

export function getTaskByDispatchRunId(runId) {
  if (!runId) return null
  const row = getTaskByDispatchRunIdStmt.get(runId)
  return row ? rowToTask(row) : null
}

export function getActiveTasks(limit = 20) {
  const rows = getActiveTasksStmt.all(limit)
  return rows.map(rowToTask)
}

export function getRecentTasks(limit = 20) {
  const rows = getRecentTasksStmt.all(limit)
  return rows.map(rowToTask)
}

export function getChildTasks(parentTaskId, limit = 20) {
  const rows = getChildTasksByParentStmt.all(parentTaskId, limit)
  return rows.map(rowToTask)
}

export function getTaskGraph(taskOrRootId, limit = 100) {
  const rows = getTaskGraphByRootStmt.all(taskOrRootId, taskOrRootId, limit)
  return rows.map(rowToTask)
}

export function ensurePrimaryTask(requestId, data = {}) {
  if (!requestId) return null

  const existing = getTaskByRequestId(requestId)
  if (existing) {
    return updateTask(existing.id, {
      ...data,
      requestId,
      taskType: 'primary',
      parentTaskId: null,
      rootTaskId: existing.id,
      graphDepth: 0,
      closedByParent: false,
      resolutionSource: null,
    })
  }

  return createTask({
    ...data,
    requestId,
    taskType: 'primary',
    parentTaskId: null,
    rootTaskId: data.rootTaskId || null,
    graphDepth: 0,
    closedByParent: false,
    resolutionSource: null,
  })
}

export function listLobsterRules(limit = 20) {
  const rows = listLobsterRulesStmt.all(limit)
  return rows.map(rowToLobsterRule)
}

export function upsertLobsterRule(rule = {}) {
  const now = Date.now()
  const row = {
    id: rule.id || `rule_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    category: rule.category || 'guardrail',
    rule_type: rule.ruleType || 'advisory',
    title: rule.title || '未命名規則',
    summary: rule.summary || null,
    trigger_key: rule.triggerKey || 'general',
    confidence: Number.isFinite(rule.confidence) ? Number(rule.confidence) : 0,
    status: rule.status || 'draft',
    success_count: Number.isFinite(rule.successCount) ? Number(rule.successCount) : 0,
    failure_count: Number.isFinite(rule.failureCount) ? Number(rule.failureCount) : 0,
    source_task_id: rule.sourceTaskId || null,
    source_root_task_id: rule.sourceRootTaskId || null,
    evidence_json: serializeJsonField(rule.evidence, null),
    rule_json: serializeJsonField(rule.rule, null),
    created_at: rule.createdAt || now,
    updated_at: rule.updatedAt || now,
    last_seen_at: rule.lastSeenAt || now,
  }
  upsertLobsterRuleStmt.run(row)
  return listLobsterRules(200).find((entry) => entry.triggerKey === row.trigger_key && entry.category === row.category) || null
}

// Complete all active tasks (used on session reset)
const completeAllActiveTasksStmt = db.prepare(`
  UPDATE tasks SET status = 'completed', completed_at = ?, result = ?
  WHERE status NOT IN ('completed', 'failed')
`)

export function completeAllActiveTasks(reason = 'Session reset') {
  const now = Date.now()
  const info = completeAllActiveTasksStmt.run(now, reason)
  return info.changes
}

function rowToTask(row) {
  const brainState = parseJsonField(row.brain_state_json, null)
  const reviewerResults = parseJsonField(row.reviewer_results_json, [])
  const consensus = parseJsonField(row.consensus_json, null)
  const reusableMemory = parseJsonField(row.reusable_memory_json, null)
  const delegationPlan = parseJsonField(row.delegation_json, null)
  const researchLoop = brainState?.researchLoop || delegationPlan?.researchLoop || null
  const operatorMode = brainState?.operatorMode || delegationPlan?.operatorMode || null
  const autonomyPolicy = brainState?.autonomyPolicy || delegationPlan?.autonomyPolicy || null
  const outputContract = brainState?.outputContract || delegationPlan?.outputContract || null
  const scope = brainState?.scope || delegationPlan?.scope || null
  const downstreamMatrix = delegationPlan?.downstreamMatrix || null
  return {
    id: row.id,
    requestId: row.request_id,
    parentTaskId: row.parent_task_id ?? null,
    rootTaskId: row.root_task_id ?? row.id,
    taskType: row.task_type ?? 'primary',
    sourceAgent: row.source_agent ?? null,
    mergePolicy: row.merge_policy ?? null,
    graphDepth: Number(row.graph_depth ?? 0) || 0,
    closedByParent: Boolean(row.closed_by_parent),
    resolutionSource: row.resolution_source ?? null,
    title: row.title,
    detail: row.detail,
    assignedAgent: row.assigned_agent,
    dispatchSessionKey: row.dispatch_session_key ?? null,
    dispatchRunId: row.dispatch_run_id ?? null,
    status: row.status,
    brainMode: row.brain_mode ?? null,
    brainState,
    reviewerResults,
    consensus,
    researchLoop,
    operatorMode,
    autonomyPolicy,
    outputContract,
    scope,
    downstreamMatrix,
    riskTier: row.risk_tier ?? null,
    retryBudget: Number(row.retry_budget ?? 2) || 2,
    retryCount: Number(row.retry_count ?? 0) || 0,
    escalationLevel: Number(row.escalation_level ?? 0) || 0,
    autoContinueAllowed: row.auto_continue_allowed === null || row.auto_continue_allowed === undefined ? true : Boolean(row.auto_continue_allowed),
    autoApplyAllowed: Boolean(row.auto_apply_allowed),
    humanGateReason: row.human_gate_reason ?? null,
    reusableMemory,
    rootCause: row.root_cause ?? null,
    delegationPlan,
    evolutionNote: row.evolution_note ?? null,
    memoryUpdatedAt: row.memory_updated_at ?? null,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    result: row.result,
    attentionType: row.attention_type,
    priority: row.priority || 0,
    needsDecision: Boolean(row.needs_decision),
    estimatedValue: row.estimated_value ?? null,
    completionValue: row.completion_value ?? null,
    didImprove: Boolean(row.did_improve),
    didImproveScore: row.did_improve_score ?? null,
    businessDelta: row.business_delta ?? null,
    processScore: row.process_score ?? null,
    businessScore: row.business_score ?? null,
    rollbackNeeded: Boolean(row.rollback_needed),
    milestone: row.milestone ?? null,
    nextStep: row.next_step ?? null,
    continuationRequired: Boolean(row.continuation_required),
    pendingAction: row.pending_action ?? null,
    continuationCheckedAt: row.continuation_checked_at ?? null,
    completionGateRequired: Boolean(row.completion_gate_required),
    lastUpdate: row.last_update ?? null,
    staleNotifiedAt: row.stale_notified_at ?? null,
  }
}

function rowToLobsterRule(row) {
  return {
    id: row.id,
    category: row.category || 'guardrail',
    ruleType: row.rule_type || 'advisory',
    title: row.title || '未命名規則',
    summary: row.summary || null,
    triggerKey: row.trigger_key || 'general',
    confidence: Number(row.confidence ?? 0) || 0,
    status: row.status || 'draft',
    successCount: Number(row.success_count ?? 0) || 0,
    failureCount: Number(row.failure_count ?? 0) || 0,
    sourceTaskId: row.source_task_id || null,
    sourceRootTaskId: row.source_root_task_id || null,
    evidence: parseJsonField(row.evidence_json, []),
    rule: parseJsonField(row.rule_json, null),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    lastSeenAt: row.last_seen_at || null,
  }
}

function reparentTaskGraph(fromTaskId, toTaskId) {
  if (!fromTaskId || !toTaskId || fromTaskId === toTaskId) return
  db.prepare(`
    UPDATE tasks
    SET
      parent_task_id = CASE WHEN parent_task_id = ? THEN ? ELSE parent_task_id END,
      root_task_id = CASE WHEN root_task_id = ? THEN ? ELSE root_task_id END
    WHERE parent_task_id = ?
       OR root_task_id = ?
  `).run(fromTaskId, toTaskId, fromTaskId, toTaskId, fromTaskId, fromTaskId)
}

export function repairPrimaryTaskIntegrity(now = Date.now()) {
  const duplicates = listDuplicatePrimaryTaskRequestsStmt.all()
  if (!duplicates.length) return { duplicateRequestCount: 0, supersededTaskCount: 0, reparentedTaskCount: 0 }

  let supersededTaskCount = 0
  let reparentedTaskCount = 0

  for (const entry of duplicates) {
    const requestId = entry.request_id
    const primaryTasks = getPrimaryTasksByRequest(requestId)
    const canonical = primaryTasks[0] || null
    if (!canonical) continue

    updateTask(canonical.id, {
      taskType: 'primary',
      parentTaskId: null,
      rootTaskId: canonical.id,
      graphDepth: 0,
      closedByParent: false,
      resolutionSource: null,
    })

    for (const duplicate of primaryTasks.slice(1)) {
      const childrenBefore = getChildTasks(duplicate.id, 1000)
      if (childrenBefore.length > 0) {
        reparentTaskGraph(duplicate.id, canonical.id)
        reparentedTaskCount += childrenBefore.length
      }

      const isTerminal = ['completed', 'failed'].includes(String(duplicate.status || '').toLowerCase())
      updateTask(duplicate.id, {
        taskType: 'superseded_primary',
        parentTaskId: canonical.id,
        rootTaskId: canonical.id,
        graphDepth: 1,
        closedByParent: true,
        resolutionSource: 'superseded',
        status: isTerminal ? duplicate.status : 'completed',
        completedAt: duplicate.completedAt || now,
        continuationRequired: false,
        pendingAction: null,
        completionGateRequired: false,
        humanGateReason: null,
        nextStep: `由 canonical primary ${canonical.id} 接手`,
        result: duplicate.result || `Superseded by canonical primary task ${canonical.id}`,
        lastUpdate: now,
      })
      supersededTaskCount += 1
    }

    const request = getRequestById(requestId)
    if (request) {
      const stateMap = {
        pending: 'received',
        assigned: 'assigned',
        in_progress: 'in_progress',
        completed: 'completed',
        failed: 'completed',
      }
      updateRequest(requestId, {
        state: stateMap[canonical.status] || request.state,
        assignedTo: canonical.assignedAgent || request.assignedTo,
        workStartedAt: canonical.startedAt || request.workStartedAt || null,
        completedAt: canonical.completedAt || request.completedAt || null,
        result: canonical.result || request.result || null,
        task: {
          id: canonical.id,
          title: canonical.title || request.task?.title || null,
          detail: canonical.detail || request.task?.detail || null,
          targetAgent: canonical.assignedAgent || request.task?.targetAgent || null,
          reason: request.task?.reason || null,
        },
      })
    }
  }

  return {
    duplicateRequestCount: duplicates.length,
    supersededTaskCount,
    reparentedTaskCount,
  }
}

const primaryTaskIntegrityRepair = repairPrimaryTaskIntegrity()
if (primaryTaskIntegrityRepair.duplicateRequestCount > 0) {
  console.warn(
    `[DB] Repaired ${primaryTaskIntegrityRepair.duplicateRequestCount} request(s) with duplicate primary tasks; superseded ${primaryTaskIntegrityRepair.supersededTaskCount}, reparented ${primaryTaskIntegrityRepair.reparentedTaskCount} child task(s).`,
  )
}

db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_primary_request_unique
  ON tasks(request_id)
  WHERE request_id IS NOT NULL
    AND COALESCE(task_type, 'primary') = 'primary'
`)

const upsertDailyDigestStmt = db.prepare(`
  INSERT INTO daily_digests (date, generated_at, content, summary_json, delivered_at, delivery_status, target)
  VALUES (@date, @generated_at, @content, @summary_json, @delivered_at, @delivery_status, @target)
  ON CONFLICT(date) DO UPDATE SET
    generated_at = excluded.generated_at,
    content = excluded.content,
    summary_json = excluded.summary_json,
    delivered_at = excluded.delivered_at,
    delivery_status = excluded.delivery_status,
    target = excluded.target
`)

const getDailyDigestByDateStmt = db.prepare('SELECT * FROM daily_digests WHERE date = ?')
const getLatestDailyDigestStmt = db.prepare('SELECT * FROM daily_digests ORDER BY date DESC LIMIT 1')

const upsertAttentionStateStmt = db.prepare(`
  INSERT INTO attention_state (
    id,
    source,
    agent_id,
    attention_type,
    status,
    linked_request_id,
    linked_task_id,
    latest_event_id,
    signal_count,
    signal_score_max,
    categories_json,
    snoozed_until,
    assigned_owner,
    closed_reason,
    next_review_at,
    task_result,
    completion_value,
    did_improve,
    did_improve_score,
    business_delta,
    process_score,
    business_score,
    rollback_needed,
    action_history_json,
    last_feedback_at,
    first_seen_at,
    last_seen_at,
    resolved_at,
    updated_at
  )
  VALUES (
    @id,
    @source,
    @agent_id,
    @attention_type,
    @status,
    @linked_request_id,
    @linked_task_id,
    @latest_event_id,
    @signal_count,
    @signal_score_max,
    @categories_json,
    @snoozed_until,
    @assigned_owner,
    @closed_reason,
    @next_review_at,
    @task_result,
    @completion_value,
    @did_improve,
    @did_improve_score,
    @business_delta,
    @process_score,
    @business_score,
    @rollback_needed,
    @action_history_json,
    @last_feedback_at,
    @first_seen_at,
    @last_seen_at,
    @resolved_at,
    @updated_at
  )
  ON CONFLICT(id) DO UPDATE SET
    source = excluded.source,
    agent_id = excluded.agent_id,
    attention_type = excluded.attention_type,
    status = excluded.status,
    linked_request_id = excluded.linked_request_id,
    linked_task_id = excluded.linked_task_id,
    latest_event_id = excluded.latest_event_id,
    signal_count = excluded.signal_count,
    signal_score_max = excluded.signal_score_max,
    categories_json = excluded.categories_json,
    snoozed_until = excluded.snoozed_until,
    assigned_owner = excluded.assigned_owner,
    closed_reason = excluded.closed_reason,
    next_review_at = excluded.next_review_at,
    task_result = excluded.task_result,
    completion_value = excluded.completion_value,
    did_improve = excluded.did_improve,
    did_improve_score = excluded.did_improve_score,
    business_delta = excluded.business_delta,
    process_score = excluded.process_score,
    business_score = excluded.business_score,
    rollback_needed = excluded.rollback_needed,
    action_history_json = excluded.action_history_json,
    last_feedback_at = excluded.last_feedback_at,
    first_seen_at = excluded.first_seen_at,
    last_seen_at = excluded.last_seen_at,
    resolved_at = excluded.resolved_at,
    updated_at = excluded.updated_at
`)

const getAttentionStateByIdStmt = db.prepare('SELECT * FROM attention_state WHERE id = ?')
const getAttentionStateByTaskIdStmt = db.prepare('SELECT * FROM attention_state WHERE linked_task_id = ? ORDER BY updated_at DESC, id ASC')
const getAttentionStateByRequestIdStmt = db.prepare('SELECT * FROM attention_state WHERE linked_request_id = ? ORDER BY updated_at DESC, id ASC')
const listAttentionStatesStmt = db.prepare('SELECT * FROM attention_state ORDER BY updated_at DESC, id ASC')

function rowToDailyDigest(row) {
  if (!row) return null
  let summary = null
  if (row.summary_json) {
    try {
      summary = JSON.parse(row.summary_json)
    } catch {
      summary = null
    }
  }
  return {
    date: row.date,
    generatedAt: row.generated_at,
    content: row.content,
    summary,
    headline: summary?.headline || null,
    sections: Array.isArray(summary?.sections) ? summary.sections : [],
    anomalies: Array.isArray(summary?.anomalies) ? summary.anomalies : [],
    evolution: summary?.evolution || null,
    deliveryChannel: summary?.deliveryChannel || null,
    quietDay: Boolean(summary?.quietDay),
    tomorrowPreview: summary?.tomorrowPreview || null,
    deliveredAt: row.delivered_at ?? null,
    deliveryStatus: row.delivery_status ?? null,
    target: row.target ?? null,
  }
}

export function upsertDailyDigest(data) {
  const row = {
    date: data.date,
    generated_at: data.generatedAt || Date.now(),
    content: data.content || '',
    summary_json: data.summary ? JSON.stringify(data.summary) : null,
    delivered_at: data.deliveredAt || null,
    delivery_status: data.deliveryStatus || null,
    target: data.target || null,
  }
  upsertDailyDigestStmt.run(row)
  return getDailyDigestByDate(row.date)
}

export function getDailyDigestByDate(date) {
  return rowToDailyDigest(getDailyDigestByDateStmt.get(date))
}

export function getLatestDailyDigest() {
  return rowToDailyDigest(getLatestDailyDigestStmt.get())
}

function rowToAttentionState(row) {
  if (!row) return null
  let categories = []
  let actionHistory = []
  if (row.categories_json) {
    try {
      categories = JSON.parse(row.categories_json)
    } catch {
      categories = []
    }
  }
  if (row.action_history_json) {
    try {
      actionHistory = JSON.parse(row.action_history_json)
    } catch {
      actionHistory = []
    }
  }
  return {
    id: row.id,
    source: row.source,
    agentId: row.agent_id,
    attentionType: row.attention_type,
    status: row.status || 'open',
    linkedRequestId: row.linked_request_id || null,
    linkedTaskId: row.linked_task_id || null,
    latestEventId: row.latest_event_id || null,
    signalCount: Number(row.signal_count || 0),
    signalScoreMax: Number(row.signal_score_max || 0),
    categories: Array.isArray(categories) ? categories : [],
    snoozedUntil: row.snoozed_until || null,
    assignedOwner: row.assigned_owner || null,
    closedReason: row.closed_reason || null,
    nextReviewAt: row.next_review_at || null,
    taskResult: row.task_result || null,
    completionValue: row.completion_value ?? null,
    didImprove: Boolean(row.did_improve),
    didImproveScore: row.did_improve_score ?? null,
    businessDelta: row.business_delta ?? null,
    processScore: row.process_score ?? null,
    businessScore: row.business_score ?? null,
    rollbackNeeded: Boolean(row.rollback_needed),
    actionHistory: Array.isArray(actionHistory) ? actionHistory : [],
    lastFeedbackAt: row.last_feedback_at || null,
    firstSeenAt: row.first_seen_at || null,
    lastSeenAt: row.last_seen_at || null,
    resolvedAt: row.resolved_at || null,
    updatedAt: row.updated_at || null,
  }
}

export function getAttentionStateById(id) {
  return rowToAttentionState(getAttentionStateByIdStmt.get(id))
}

export function listAttentionStates() {
  return listAttentionStatesStmt.all().map(rowToAttentionState)
}

export function listAttentionStatesByTaskId(taskId) {
  if (!taskId) return []
  return getAttentionStateByTaskIdStmt.all(taskId).map(rowToAttentionState)
}

export function listAttentionStatesByRequestId(requestId) {
  if (!requestId) return []
  return getAttentionStateByRequestIdStmt.all(requestId).map(rowToAttentionState)
}

export function upsertAttentionState(data) {
  const row = {
    id: data.id,
    source: data.source || null,
    agent_id: data.agentId || null,
    attention_type: data.attentionType || null,
    status: data.status || 'open',
    linked_request_id: data.linkedRequestId || null,
    linked_task_id: data.linkedTaskId || null,
    latest_event_id: data.latestEventId || null,
    signal_count: Number.isFinite(data.signalCount) ? Number(data.signalCount) : 1,
    signal_score_max: Number.isFinite(data.signalScoreMax) ? Number(data.signalScoreMax) : 0,
    categories_json: JSON.stringify(Array.isArray(data.categories) ? data.categories : []),
    snoozed_until: data.snoozedUntil || null,
    assigned_owner: data.assignedOwner || null,
    closed_reason: data.closedReason || null,
    next_review_at: data.nextReviewAt || null,
    task_result: data.taskResult || null,
    completion_value: Number.isFinite(data.completionValue) ? Number(data.completionValue) : null,
    did_improve: data.didImprove ? 1 : 0,
    did_improve_score: Number.isFinite(data.didImproveScore) ? Number(data.didImproveScore) : null,
    business_delta: Number.isFinite(data.businessDelta) ? Number(data.businessDelta) : null,
    process_score: Number.isFinite(data.processScore) ? Number(data.processScore) : null,
    business_score: Number.isFinite(data.businessScore) ? Number(data.businessScore) : null,
    rollback_needed: data.rollbackNeeded ? 1 : 0,
    action_history_json: JSON.stringify(Array.isArray(data.actionHistory) ? data.actionHistory : []),
    last_feedback_at: data.lastFeedbackAt || null,
    first_seen_at: data.firstSeenAt || Date.now(),
    last_seen_at: data.lastSeenAt || data.updatedAt || Date.now(),
    resolved_at: data.resolvedAt || null,
    updated_at: data.updatedAt || Date.now(),
  }
  upsertAttentionStateStmt.run(row)
  return getAttentionStateById(row.id)
}

// ─────────────────────────────────────────────────────────
// Event Functions
// ─────────────────────────────────────────────────────────
const insertEventStmt = db.prepare(`
  INSERT INTO events (id, request_id, state, agent, agent_color, agent_name, message, target_agent, time, timestamp, result)
  VALUES (@id, @request_id, @state, @agent, @agent_color, @agent_name, @message, @target_agent, @time, @timestamp, @result)
`)

const getEventsStmt = db.prepare('SELECT * FROM events ORDER BY timestamp DESC LIMIT ?')
const getEventsPaginatedStmt = db.prepare('SELECT * FROM events ORDER BY timestamp DESC LIMIT ? OFFSET ?')
const countEventsStmt = db.prepare('SELECT COUNT(*) as total FROM events')
const getEventsByRequestStmt = db.prepare('SELECT * FROM events WHERE request_id = ? ORDER BY timestamp DESC')
const updateEventMessageStmt = db.prepare('UPDATE events SET message = ? WHERE id = ?')
const getEventsByRequestAndPlaceholderStmt = db.prepare("SELECT * FROM events WHERE request_id = ? AND message LIKE '%Processing...%'")

export function addEvent(data) {
  const row = {
    id: data.id,
    request_id: data.requestId,
    state: data.state,
    agent: data.agent,
    agent_color: data.agentColor,
    agent_name: data.agentName,
    message: data.message,
    target_agent: data.targetAgent || null,
    time: data.time,
    timestamp: data.timestamp,
    result: data.result || null,
  }
  insertEventStmt.run(row)
}

export function getEvents(limit = 50) {
  const rows = getEventsStmt.all(limit)
  return rows.map(rowToEvent)
}

export function getEventsPaginated(limit = 50, offset = 0) {
  const rows = getEventsPaginatedStmt.all(limit, offset)
  const { total } = countEventsStmt.get()
  return { events: rows.map(rowToEvent), total }
}

export function getEventsByRequest(requestId) {
  const rows = getEventsByRequestStmt.all(requestId)
  return rows.map(rowToEvent)
}

// Auto-repair: fix all broken placeholder events by looking up their request's real content
export function repairAllPlaceholderEvents() {
  const brokenStmt = db.prepare("SELECT DISTINCT request_id FROM events WHERE message LIKE '%Processing...%' AND request_id IS NOT NULL")
  const requestIds = brokenStmt.all()
  let fixed = 0
  for (const { request_id } of requestIds) {
    const req = getRequestById(request_id)
    if (req && req.content && req.content !== 'Processing...') {
      fixed += fixPlaceholderEvents(request_id, req.content)
    }
  }
  // Also fix "Done: task" and "Responding: response" generic fallbacks
  const genericDone = db.prepare(`SELECT e.id, e.request_id, e.message FROM events e WHERE e.message LIKE '%Done: "task"%' AND e.request_id IS NOT NULL`).all()
  for (const row of genericDone) {
    const req = getRequestById(row.request_id)
    if (req && req.content && req.content !== 'Processing...') {
      const clean = req.content.replace(/^\[Telegram[^\]]*\]\s*/s, '').replace(/\[message_id:\s*\d+\]\s*$/, '').trim()
      const short = clean.slice(0, 60) + (clean.length > 60 ? '...' : '')
      updateEventMessageStmt.run(row.message.replace('"task"', `"${short}"`), row.id)
      fixed++
    }
  }
  const genericResp = db.prepare(`SELECT e.id, e.request_id, e.message FROM events e WHERE e.message LIKE '%Responding: "response"%' AND e.request_id IS NOT NULL`).all()
  for (const row of genericResp) {
    const req = getRequestById(row.request_id)
    if (req && req.content && req.content !== 'Processing...') {
      const clean = req.content.replace(/^\[Telegram[^\]]*\]\s*/s, '').replace(/\[message_id:\s*\d+\]\s*$/, '').trim()
      const short = clean.slice(0, 60) + (clean.length > 60 ? '...' : '')
      updateEventMessageStmt.run(row.message.replace('"response"', `"${short}"`), row.id)
      fixed++
    }
  }
  return fixed
}

export function updateEventMessage(eventId, message) {
  updateEventMessageStmt.run(message, eventId)
}

// Retroactively fix all "Processing..." events for a request with real content
export function fixPlaceholderEvents(requestId, realContent) {
  const rows = getEventsByRequestAndPlaceholderStmt.all(requestId)
  const clean = realContent.replace(/^\[Telegram[^\]]*\]\s*/s, '').replace(/\[message_id:\s*\d+\]\s*$/, '').trim()
  const short = clean.slice(0, 60) + (clean.length > 60 ? '...' : '')
  for (const row of rows) {
    const newMsg = row.message
      .replace(/"Processing\.\.\."/, `"${short}"`)
      .replace(/Processing\.\.\./, short)
    updateEventMessageStmt.run(newMsg, row.id)
  }
  return rows.length
}

function rowToEvent(row) {
  return {
    id: row.id,
    requestId: row.request_id,
    state: row.state,
    agent: row.agent,
    agentColor: row.agent_color,
    agentName: row.agent_name,
    message: row.message,
    targetAgent: row.target_agent,
    time: row.time,
    timestamp: row.timestamp,
    result: row.result,
  }
}

// ─────────────────────────────────────────────────────────
// Data Migration from JSON files
// ─────────────────────────────────────────────────────────
const LEGACY_DATA_DIR = dirname(getConfiguredDbPath())
const REQUESTS_FILE = join(LEGACY_DATA_DIR, 'requests.json')
const EVENTS_FILE = join(LEGACY_DATA_DIR, 'workflow-events.json')

function migrateFromJson() {
  let migrated = false
  
  // Migrate requests
  if (existsSync(REQUESTS_FILE)) {
    try {
      const requests = JSON.parse(readFileSync(REQUESTS_FILE, 'utf8'))
      const existingCount = db.prepare('SELECT COUNT(*) as count FROM requests').get().count
      
      if (existingCount === 0 && requests.length > 0) {
        console.log(`[DB] Migrating ${requests.length} requests from JSON...`)
        for (const req of requests) {
          try {
            createRequest(req)
          } catch (e) {
            console.error(`[DB] Failed to migrate request ${req.id}:`, e.message)
          }
        }
        migrated = true
      }
    } catch (e) {
      console.error('[DB] Failed to read requests.json:', e.message)
    }
  }
  
  // Migrate events
  if (existsSync(EVENTS_FILE)) {
    try {
      const events = JSON.parse(readFileSync(EVENTS_FILE, 'utf8'))
      const existingCount = db.prepare('SELECT COUNT(*) as count FROM events').get().count
      
      if (existingCount === 0 && events.length > 0) {
        console.log(`[DB] Migrating ${events.length} events from JSON...`)
        for (const evt of events) {
          try {
            addEvent(evt)
          } catch (e) {
            console.error(`[DB] Failed to migrate event ${evt.id}:`, e.message)
          }
        }
        migrated = true
      }
    } catch (e) {
      console.error('[DB] Failed to read workflow-events.json:', e.message)
    }
  }
  
  // Backup JSON files after successful migration
  if (migrated) {
    const timestamp = Date.now()
    if (existsSync(REQUESTS_FILE)) {
      renameSync(REQUESTS_FILE, `${REQUESTS_FILE}.bak.${timestamp}`)
      console.log('[DB] Backed up requests.json')
    }
    if (existsSync(EVENTS_FILE)) {
      renameSync(EVENTS_FILE, `${EVENTS_FILE}.bak.${timestamp}`)
      console.log('[DB] Backed up workflow-events.json')
    }
  }
}

// Run migration on module load
migrateFromJson()

// ─────────────────────────────────────────────────────────
// Stats Functions
// ─────────────────────────────────────────────────────────
const AGENT_HOURLY_RATES = {
  wickedman: 18.98,  // RM 75 = $18.98
  py: 18.98,         // RM 75 = $18.98
  vigil: 15.94,      // RM 63 = $15.94
  quill: 11.13,      // RM 44 = $11.13
  savy: 8.60,        // RM 34 = $8.60
  gantt: 22.26,      // RM 88 = $22.26
}

const CLAUDE_PRICING = {
  opus: { input: 15, output: 75 },    // per 1M tokens
  sonnet: { input: 3, output: 15 },
}

function getTodayDate() {
  return new Date().toISOString().split('T')[0]
}

function ensureTodayStats() {
  const today = getTodayDate()
  const existing = db.prepare('SELECT * FROM daily_stats WHERE date = ?').get(today)
  if (!existing) {
    db.prepare(`
      INSERT INTO daily_stats (date, messages_received, messages_sent, tokens_input, tokens_output, tasks_completed, total_task_time_ms, estimated_human_time_ms, savings_myr)
      VALUES (?, 0, 0, 0, 0, 0, 0, 0, 0)
    `).run(today)
  }
}

export function incrementMessages(type = 'received') {
  ensureTodayStats()
  const today = getTodayDate()
  const column = type === 'sent' ? 'messages_sent' : 'messages_received'
  db.prepare(`UPDATE daily_stats SET ${column} = ${column} + 1 WHERE date = ?`).run(today)
}

export function addTokens(inputTokens, outputTokens) {
  ensureTodayStats()
  const today = getTodayDate()
  db.prepare(`
    UPDATE daily_stats 
    SET tokens_input = tokens_input + ?, tokens_output = tokens_output + ?
    WHERE date = ?
  `).run(inputTokens, outputTokens, today)
}

export function recordTaskCompletion(agent, taskTimeMs) {
  ensureTodayStats()
  const today = getTodayDate()
  
  // Estimate: AI takes X ms, human would take 10X (conservative)
  const humanMultiplier = 10
  const humanTimeMs = taskTimeMs * humanMultiplier
  const hourlyRate = AGENT_HOURLY_RATES[agent] || 11
  const savingsMyr = (humanTimeMs / 3600000) * hourlyRate  // ms to hours, now in USD
  
  db.prepare(`
    UPDATE daily_stats 
    SET tasks_completed = tasks_completed + 1,
        total_task_time_ms = total_task_time_ms + ?,
        estimated_human_time_ms = estimated_human_time_ms + ?,
        savings_myr = savings_myr + ?
    WHERE date = ?
  `).run(taskTimeMs, humanTimeMs, savingsMyr, today)
  
  return savingsMyr
}

export function calculateCost(inputTokens, outputTokens, model = 'opus') {
  const pricing = CLAUDE_PRICING[model]
  return (inputTokens / 1000000 * pricing.input) + (outputTokens / 1000000 * pricing.output)
}

export function getTodayStats() {
  ensureTodayStats()
  const today = getTodayDate()
  return db.prepare('SELECT * FROM daily_stats WHERE date = ?').get(today)
}

export function getAllTimeStats() {
  const result = db.prepare(`
    SELECT 
      SUM(messages_received) as messages_received,
      SUM(messages_sent) as messages_sent,
      SUM(tokens_input) as tokens_input,
      SUM(tokens_output) as tokens_output,
      SUM(tasks_completed) as tasks_completed,
      SUM(total_task_time_ms) as total_task_time_ms,
      SUM(estimated_human_time_ms) as estimated_human_time_ms,
      SUM(savings_myr) as savings_myr
    FROM daily_stats
  `).get()
  
  return {
    messages_received: result.messages_received || 0,
    messages_sent: result.messages_sent || 0,
    tokens_input: result.tokens_input || 0,
    tokens_output: result.tokens_output || 0,
    tasks_completed: result.tasks_completed || 0,
    total_task_time_ms: result.total_task_time_ms || 0,
    estimated_human_time_ms: result.estimated_human_time_ms || 0,
    savings_myr: result.savings_myr || 0,
  }
}

export { AGENT_HOURLY_RATES, CLAUDE_PRICING }

export default db
