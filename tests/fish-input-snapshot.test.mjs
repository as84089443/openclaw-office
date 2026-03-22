import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'

const SCRIPT_PATH = '/Users/brian/.openclaw/workspace/agent-system/scripts/generate-fish-input-snapshot.mjs'

function setupBizdevFixture(rootDir) {
  mkdirSync(join(rootDir, 'workspace', 'agent-system', 'logs'), { recursive: true })
  mkdirSync(join(rootDir, 'workspace', 'agent-system', 'data'), { recursive: true })
  mkdirSync(join(rootDir, 'workspace-bizdev'), { recursive: true })

  writeFileSync(
    join(rootDir, 'workspace', 'agent-system', 'logs', 'followup-db.csv'),
    'company,email,date,status,agent,notes\nACME,hello@acme.test,2026-03-22,followup,Brian,from-crm\n',
  )
  writeFileSync(
    join(rootDir, 'workspace', 'agent-system', 'data', 'orders.csv'),
    'client,deal_type\nACME,followup\n',
  )
  writeFileSync(
    join(rootDir, 'workspace-bizdev', 'POTENTIAL_CUSTOMERS.md'),
    '| 公司 | 狀態 |\n| ACME | followup |\n',
  )
}

test('fish input snapshot script writes under OPENCLAW_HOME agent-system logs', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'openclaw-fish-snapshot-'))

  try {
    setupBizdevFixture(tempRoot)

    const raw = execFileSync('node', [SCRIPT_PATH, '--agent', 'bizdev'], {
      env: {
        ...process.env,
        OPENCLAW_HOME: tempRoot,
      },
      encoding: 'utf8',
    }).trim()

    const result = JSON.parse(raw)
    const expectedPrefix = join(tempRoot, 'workspace', 'agent-system', 'logs', 'fish-input-snapshots')

    assert.equal(result.ok, true)
    assert.equal(result.agentId, 'bizdev')
    assert.equal(result.status, 'ready')
    assert.match(result.snapshotPath, new RegExp(`^${expectedPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
    assert.equal(existsSync(result.snapshotPath), true)

    const snapshot = JSON.parse(readFileSync(result.snapshotPath, 'utf8'))
    assert.equal(snapshot.agentId, 'bizdev')
    assert.equal(snapshot.checks.followupRows, 1)
    assert.equal(snapshot.checks.rawFollowupRows, 1)
    assert.equal(snapshot.sources.rawFollowupDbPath, join(tempRoot, 'workspace', 'agent-system', 'logs', 'followup-db.csv'))
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
})
