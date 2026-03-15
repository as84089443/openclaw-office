import { randomBytes } from 'node:crypto'
import { execFile as execFileCallback } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)

const scriptDir = dirname(fileURLToPath(import.meta.url))

export const PROJECT_ROOT = join(scriptDir, '..')
export const DEFAULT_PUBLIC_BASE_URL = 'https://copilot.bw-space.com'
export const DEFAULT_OUTPUT_DIR = join(PROJECT_ROOT, 'data', 'fnb-merchant')
export const DEFAULT_MERCHANT_BRAND_NAME = 'BW-Copilot Merchant'

export function envFilePath() {
  return join(PROJECT_ROOT, '.env.local')
}

export function exampleEnvFilePath() {
  return join(PROJECT_ROOT, '.env.example')
}

export function generateInternalToken() {
  return randomBytes(32).toString('hex')
}

export async function ensureDir(pathname) {
  await mkdir(pathname, { recursive: true })
}

export async function readEnvMap(pathname = envFilePath()) {
  let content = ''
  try {
    content = await readFile(pathname, 'utf8')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }

  const env = {}
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!match) continue
    let value = match[2] ?? ''
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    env[match[1]] = value
  }
  return env
}

function serializeEnvValue(value) {
  const text = String(value ?? '')
  return /[\s"'`]/.test(text) ? JSON.stringify(text) : text
}

export async function upsertEnvFile(entries, pathname = envFilePath()) {
  let content = ''
  try {
    content = await readFile(pathname, 'utf8')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }

  const lines = content ? content.split(/\r?\n/) : []
  const updates = new Map(
    Object.entries(entries).filter(([, value]) => value !== undefined),
  )
  const seen = new Set()

  const nextLines = lines.map((line) => {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!match) return line
    const key = match[1]
    if (!updates.has(key)) return line
    seen.add(key)
    return `${key}=${serializeEnvValue(updates.get(key))}`
  })

  for (const [key, value] of updates.entries()) {
    if (seen.has(key)) continue
    nextLines.push(`${key}=${serializeEnvValue(value)}`)
  }

  const output = `${nextLines.filter((line, index, array) => !(index === array.length - 1 && line === '')).join('\n')}\n`
  await writeFile(pathname, output, 'utf8')
  return pathname
}

export function getArgValue(name) {
  const inlinePrefix = `${name}=`
  const inline = process.argv.find((argument) => argument.startsWith(inlinePrefix))
  if (inline) return inline.slice(inlinePrefix.length)

  const index = process.argv.indexOf(name)
  if (index === -1) return null
  return process.argv[index + 1] ?? null
}

export function hasFlag(name) {
  return process.argv.includes(name)
}

export async function runCommand(command, args, options = {}) {
  try {
    return await execFile(command, args, options)
  } catch (error) {
    const stderr = error?.stderr ? String(error.stderr).trim() : ''
    const message = stderr || error?.message || `Command failed: ${command}`
    throw new Error(message)
  }
}

export async function fetchJson(url, options = {}) {
  const response = await fetch(url, options)
  const text = await response.text()
  const data = text ? safeJsonParse(text) : {}
  if (!response.ok) {
    const detail = data?.message || data?.error_description || data?.error || text || `${response.status} ${response.statusText}`
    throw new Error(detail)
  }
  return data
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text }
  }
}

export function resolveEnvValue(name, envMap = {}) {
  return process.env[name] ?? envMap[name] ?? ''
}

export function requireEnvValue(name, envMap = {}) {
  const value = resolveEnvValue(name, envMap)
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

export function resolveBaseUrl(envMap = {}) {
  return resolveEnvValue('FNB_PUBLIC_BASE_URL', envMap) || DEFAULT_PUBLIC_BASE_URL
}

export function isHttpsUrl(value) {
  return /^https:\/\//i.test(String(value || ''))
}

export function resolveMerchantBrandName(envMap = {}) {
  return resolveEnvValue('FNB_LINE_BRAND_NAME', envMap) || DEFAULT_MERCHANT_BRAND_NAME
}
