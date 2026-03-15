import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

function getOpenClawBin() {
  return process.env.OPENCLAW_BIN || 'openclaw'
}

export async function sendDiscordMessage({ target, message, silent = true }) {
  if (!target || !message) {
    return { ok: false, skipped: true, reason: 'missing-target-or-message' }
  }

  const args = [
    'message',
    'send',
    '--channel',
    'discord',
    '--target',
    target,
    '--message',
    message,
    '--json',
  ]

  if (silent) args.push('--silent')

  try {
    const { stdout } = await execFileAsync(getOpenClawBin(), args, {
      timeout: 30_000,
      maxBuffer: 2 * 1024 * 1024,
    })
    const trimmed = String(stdout || '').trim()
    let parsed = null
    if (trimmed) {
      try {
        parsed = JSON.parse(trimmed)
      } catch {
        parsed = null
      }
    }
    return { ok: true, result: parsed, raw: trimmed }
  } catch (error) {
    console.error('[boss-inbox] Discord send failed:', error.message)
    return { ok: false, error: error.message }
  }
}
