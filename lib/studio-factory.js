import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const execFileAsync = promisify(execFile)

const OPENCLAW_HOME = resolve(process.env.OPENCLAW_HOME || join(process.cwd(), '..'))
const FACTORY_ROOT = resolve(
  process.env.OPENCLAW_STUDIO_FACTORY_ROOT
  || join(OPENCLAW_HOME, 'workspace-content', 'youtube-shorts-ai-factory')
)
const FACTORY_PYTHON = process.env.OPENCLAW_STUDIO_FACTORY_PYTHON
  || join(FACTORY_ROOT, '.venv', 'bin', 'python')
const STUDIO_CLI = join(FACTORY_ROOT, 'scripts', 'studio_cli.py')

function ensureFactoryRuntime() {
  if (!existsSync(FACTORY_ROOT)) {
    throw new Error(`studio_factory_root_not_found:${FACTORY_ROOT}`)
  }
  if (!existsSync(STUDIO_CLI)) {
    throw new Error(`studio_cli_not_found:${STUDIO_CLI}`)
  }
  if (!existsSync(FACTORY_PYTHON)) {
    throw new Error(`studio_python_not_found:${FACTORY_PYTHON}`)
  }
}

function parseJson(stdout) {
  const trimmed = String(stdout || '').trim()
  if (!trimmed) return {}
  return JSON.parse(trimmed)
}

function inferStatusCode(payload) {
  const message = String(payload?.message || payload?.error || '')
  if (
    message.includes('business_not_found')
    || message.includes('content_not_found')
    || message.includes('recommendation_not_found')
  ) {
    return 404
  }
  if (
    message.includes('payload_must_be_object')
    || message.includes('unknown_action')
    || message.includes('invalid')
  ) {
    return 400
  }
  return 500
}

export class StudioFactoryError extends Error {
  constructor(message, options = {}) {
    super(message)
    this.name = 'StudioFactoryError'
    this.payload = options.payload || null
    this.statusCode = options.statusCode || 500
  }
}

export async function runStudioAction(action, payload = {}) {
  ensureFactoryRuntime()
  try {
    const { stdout } = await execFileAsync(
      FACTORY_PYTHON,
      [STUDIO_CLI, action, '--payload', JSON.stringify(payload)],
      {
        cwd: FACTORY_ROOT,
        env: {
          ...process.env,
          PYTHONIOENCODING: 'utf-8',
        },
        timeout: 120000,
        maxBuffer: 10 * 1024 * 1024,
      }
    )
    const parsed = parseJson(stdout)
    if (parsed?.status === 'error') {
      throw new StudioFactoryError(
        parsed.message || parsed.error || 'Studio action failed',
        {
          payload: parsed,
          statusCode: inferStatusCode(parsed),
        }
      )
    }
    return parsed
  } catch (error) {
    try {
      const payload = parseJson(error?.stdout || '')
      if (payload && typeof payload === 'object' && Object.keys(payload).length > 0) {
        throw new StudioFactoryError(
          payload.message || payload.error || 'Studio action failed',
          {
            payload,
            statusCode: inferStatusCode(payload),
          }
        )
      }
    } catch (parsedError) {
      if (parsedError instanceof StudioFactoryError) {
        throw parsedError
      }
    }
    throw error
  }
}

export function getStudioFactoryInfo() {
  return {
    root: FACTORY_ROOT,
    python: FACTORY_PYTHON,
    cli: STUDIO_CLI,
  }
}
