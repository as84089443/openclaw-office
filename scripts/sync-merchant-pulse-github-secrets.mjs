import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  envFilePath,
  getArgValue,
  hasFlag,
  readEnvMap,
} from './superfish-utils.mjs'

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const RUNTIME_ENV_PATH = join(PROJECT_ROOT, 'runtime', '.env.production')
const PACKAGE_JSON_PATH = join(PROJECT_ROOT, 'package.json')

function parseGitHubRepo(url) {
  const text = String(url || '').trim()
  const httpsMatch = text.match(/github\.com[/:]([^/]+)\/([^/.]+?)(?:\.git)?$/i)
  if (httpsMatch) return `${httpsMatch[1]}/${httpsMatch[2]}`
  return ''
}

async function resolveDefaultRepo() {
  try {
    const packageJson = JSON.parse(await readFile(PACKAGE_JSON_PATH, 'utf8'))
    const repo = parseGitHubRepo(packageJson?.repository?.url)
    if (repo) return repo
  } catch {}
  return 'as84089443/openclaw-office'
}

async function collectEnvMap() {
  const customEnvPath = getArgValue('--env-file')
  const runtimeEnv = await readEnvMap(RUNTIME_ENV_PATH)
  const localEnv = await readEnvMap(envFilePath())
  const customEnv = customEnvPath ? await readEnvMap(customEnvPath) : {}
  return { ...runtimeEnv, ...localEnv, ...customEnv }
}

function resolveSecretValues(envMap) {
  const pulseBaseUrl = process.env.FNB_PULSE_BASE_URL
    || envMap.FNB_PULSE_BASE_URL
    || process.env.FNB_PUBLIC_BASE_URL
    || envMap.FNB_PUBLIC_BASE_URL
    || ''
  const adminToken = process.env.FNB_INTERNAL_API_TOKEN || envMap.FNB_INTERNAL_API_TOKEN || ''

  const missing = []
  if (!pulseBaseUrl) missing.push('FNB_PULSE_BASE_URL (or FNB_PUBLIC_BASE_URL)')
  if (!adminToken) missing.push('FNB_INTERNAL_API_TOKEN')

  if (missing.length) {
    throw new Error(`Missing required values: ${missing.join(', ')}`)
  }

  if (!/^https?:\/\//i.test(pulseBaseUrl)) {
    throw new Error('FNB_PULSE_BASE_URL must be an absolute http(s) URL')
  }

  return {
    FNB_PULSE_BASE_URL: pulseBaseUrl,
    FNB_INTERNAL_API_TOKEN: adminToken,
  }
}

function runGh(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('gh', args, {
      cwd: PROJECT_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
      ...options,
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr })
        return
      }
      reject(new Error(stderr.trim() || stdout.trim() || `gh ${args.join(' ')} failed with exit code ${code}`))
    })

    if (options.stdinText !== undefined) {
      child.stdin.write(options.stdinText)
    }
    child.stdin.end()
  })
}

async function ensureGhAuth() {
  await runGh(['auth', 'status'])
}

async function setSecret(repo, name, value) {
  await runGh(['secret', 'set', name, '--repo', repo, '--app', 'actions'], { stdinText: value })
}

async function main() {
  const repo = getArgValue('--repo') || process.env.GITHUB_REPOSITORY || await resolveDefaultRepo()
  const dryRun = hasFlag('--dry-run')
  const envMap = await collectEnvMap()
  const secrets = resolveSecretValues(envMap)

  await ensureGhAuth()

  if (!dryRun) {
    for (const [name, value] of Object.entries(secrets)) {
      await setSecret(repo, name, value)
    }
  }

  console.log(JSON.stringify({
    ok: true,
    repo,
    dryRun,
    secrets: Object.keys(secrets),
    sourceFiles: [
      '.env.local',
      'runtime/.env.production',
      getArgValue('--env-file') || null,
    ].filter(Boolean),
  }, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
