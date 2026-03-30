import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const officeRoot = resolve(new URL('..', import.meta.url).pathname)
const dbModulePath = join(officeRoot, 'lib', 'db.js')
const expectedDefaultDbPath = join(officeRoot, 'data', 'openclaw-office.db')

function readResolvedDbPath(cwd, extraEnv = {}) {
  const script = `const mod = await import(${JSON.stringify(dbModulePath)}); process.stdout.write(String(mod.DB_PATH));`
  return execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
    cwd,
    env: {
      ...process.env,
      ...extraEnv,
    },
    encoding: 'utf8',
  }).trim()
}

test('db default path is anchored to openclaw-office root instead of process.cwd()', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'office-db-path-'))
  const nestedCwd = join(tempRoot, 'workspace-research-fish')
  mkdirSync(nestedCwd, { recursive: true })

  const resolvedDbPath = readResolvedDbPath(nestedCwd)

  assert.equal(resolvedDbPath, expectedDefaultDbPath)
})

test('OPENCLAW_OFFICE_DB_PATH still overrides the default path', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'office-db-path-env-'))
  const customDbPath = join(tempRoot, 'custom', 'office.db')
  mkdirSync(join(tempRoot, 'workspace-qa'), { recursive: true })
  writeFileSync(join(tempRoot, 'sentinel.txt'), 'ok')

  const resolvedDbPath = readResolvedDbPath(join(tempRoot, 'workspace-qa'), {
    OPENCLAW_OFFICE_DB_PATH: customDbPath,
  })

  assert.equal(resolvedDbPath, customDbPath)
})
