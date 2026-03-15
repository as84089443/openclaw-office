#!/usr/bin/env node

import { copyFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(__dirname, '..')

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      ...(options.env || {}),
    },
    ...options,
  })

  if (result.status !== 0) {
    process.exit(result.status || 1)
  }
}

function ensureFile(target, source) {
  if (!existsSync(target) && existsSync(source)) {
    copyFileSync(source, target)
    console.log(`[demo] created ${target.replace(`${projectRoot}/`, '')}`)
  }
}

function main() {
  ensureFile(join(projectRoot, '.env.local'), join(projectRoot, '.env.example'))
  ensureFile(
    join(projectRoot, 'openclaw-office.config.json'),
    join(projectRoot, 'openclaw-office.config.example.json')
  )

  if (!existsSync(join(projectRoot, 'node_modules'))) {
    console.log('[demo] node_modules missing, running npm install...')
    run('npm', ['install'])
  }

  console.log('[demo] rebuilding better-sqlite3 for current Node version...')
  run('npm', ['rebuild', 'better-sqlite3'])

  console.log('[demo] starting F&B Copilot on http://localhost:4200')
  const child = spawn('npm', ['run', 'dev'], {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      OPENCLAW_OFFICE_DISABLE_GATEWAY: '1',
    },
  })

  child.on('exit', (code) => {
    process.exit(code || 0)
  })
}

main()
