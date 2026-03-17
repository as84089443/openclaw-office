// SQLite Database for OpenClaw Office
// Provides persistent storage for requests and workflow events

import Database from 'better-sqlite3'
import { dirname, join } from 'path'
import { mkdirSync, existsSync, readFileSync, renameSync } from 'fs'

function getConfiguredDbPath() {
  return process.env.OPENCLAW_OFFICE_DB_PATH || join(process.cwd(), 'data', 'openclaw-office.db')
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
    title TEXT,
    detail TEXT,
    assigned_agent TEXT,
    status TEXT DEFAULT 'pending',
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

  CREATE INDEX IF NOT EXISTS idx_requests_state ON requests(state);
  CREATE INDEX IF NOT EXISTS idx_requests_created ON requests(created_at);
  CREATE INDEX IF NOT EXISTS idx_events_request ON events(request_id);
  CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
  CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
  CREATE INDEX IF NOT EXISTS idx_tasks_agent ON tasks(assigned_agent);
  CREATE INDEX IF NOT EXISTS idx_tasks_request ON tasks(request_id);
  CREATE INDEX IF NOT EXISTS idx_attention_state_status ON attention_state(status);
  CREATE INDEX IF NOT EXISTS idx_attention_state_agent ON attention_state(agent_id);
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
  INSERT INTO tasks (id, request_id, title, detail, assigned_agent, status, attention_type, priority, needs_decision, estimated_value, completion_value, did_improve, did_improve_score, business_delta, process_score, business_score, rollback_needed, milestone, next_step, continuation_required, pending_action, continuation_checked_at, completion_gate_required, last_update, stale_notified_at, created_at, started_at, completed_at, result)
  VALUES (@id, @request_id, @title, @detail, @assigned_agent, @status, @attention_type, @priority, @needs_decision, @estimated_value, @completion_value, @did_improve, @did_improve_score, @business_delta, @process_score, @business_score, @rollback_needed, @milestone, @next_step, @continuation_required, @pending_action, @continuation_checked_at, @completion_gate_required, @last_update, @stale_notified_at, @created_at, @started_at, @completed_at, @result)
`)

const updateTaskStmt = db.prepare(`
  UPDATE tasks SET
    title = @title,
    detail = @detail,
    assigned_agent = @assigned_agent,
    status = @status,
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
const getTaskByRequestIdStmt = db.prepare('SELECT * FROM tasks WHERE request_id = ? ORDER BY created_at DESC LIMIT 1')
const getActiveTaskByAgentStmt = db.prepare("SELECT * FROM tasks WHERE assigned_agent = ? AND status NOT IN ('completed', 'failed') ORDER BY created_at DESC LIMIT 1")
const getActiveTasksStmt = db.prepare("SELECT * FROM tasks WHERE status NOT IN ('completed', 'failed') ORDER BY created_at DESC LIMIT ?")
const getRecentTasksStmt = db.prepare('SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?')

export function createTask(data) {
  const row = {
    id: data.id || `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    request_id: data.requestId || null,
    title: data.title || null,
    detail: data.detail || null,
    assigned_agent: data.assignedAgent || null,
    status: data.status || 'pending',
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

  const row = {
    id,
    title: data.title ?? existing.title,
    detail: data.detail ?? existing.detail,
    assigned_agent: data.assignedAgent ?? existing.assigned_agent,
    status: data.status ?? existing.status,
    attention_type: data.attentionType ?? existing.attention_type ?? null,
    priority: data.priority ?? existing.priority ?? 0,
    needs_decision: data.needsDecision === undefined ? (existing.needs_decision ?? 0) : (data.needsDecision ? 1 : 0),
    estimated_value: data.estimatedValue ?? existing.estimated_value ?? null,
    completion_value: data.completionValue ?? existing.completion_value ?? null,
    did_improve: data.didImprove === undefined ? (existing.did_improve ?? 0) : (data.didImprove ? 1 : 0),
    did_improve_score: data.didImproveScore ?? existing.did_improve_score ?? null,
    business_delta: data.businessDelta ?? existing.business_delta ?? null,
    process_score: data.processScore ?? existing.process_score ?? null,
    business_score: data.businessScore ?? existing.business_score ?? null,
    rollback_needed: data.rollbackNeeded === undefined ? (existing.rollback_needed ?? 0) : (data.rollbackNeeded ? 1 : 0),
    milestone: data.milestone ?? existing.milestone ?? null,
    next_step: data.nextStep ?? existing.next_step ?? null,
    continuation_required: data.continuationRequired === undefined ? (existing.continuation_required ?? 0) : (data.continuationRequired ? 1 : 0),
    pending_action: data.pendingAction ?? existing.pending_action ?? null,
    continuation_checked_at: data.continuationCheckedAt ?? existing.continuation_checked_at ?? null,
    completion_gate_required: data.completionGateRequired === undefined ? (existing.completion_gate_required ?? 0) : (data.completionGateRequired ? 1 : 0),
    last_update: data.lastUpdate ?? existing.last_update ?? Date.now(),
    stale_notified_at: data.staleNotifiedAt ?? existing.stale_notified_at ?? null,
    started_at: data.startedAt ?? existing.started_at,
    completed_at: data.completedAt ?? existing.completed_at,
    result: data.result ?? existing.result,
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

export function getActiveTaskByAgent(agent) {
  const row = getActiveTaskByAgentStmt.get(agent)
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
  return {
    id: row.id,
    requestId: row.request_id,
    title: row.title,
    detail: row.detail,
    assignedAgent: row.assigned_agent,
    status: row.status,
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
