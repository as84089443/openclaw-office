import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { NextResponse } from 'next/server'
import {
  assertOfficeApiRequest,
  getOfficeRequestErrorStatus,
} from '../../../../lib/office-route-auth.js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const preferredScriptPath = path.join(homedir(), '.openclaw', 'scripts', 'work-mode.sh')
const fallbackScriptPath = path.join(process.cwd(), 'scripts', 'work-mode.sh')

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`
}

function resolveScriptPath() {
  if (existsSync(preferredScriptPath)) return preferredScriptPath
  if (existsSync(fallbackScriptPath)) return fallbackScriptPath
  throw new Error('找不到工作模式腳本')
}

function parseScriptOutput(rawOutput, scriptPath, action) {
  const text = String(rawOutput || '').trim()
  if (!text) {
    throw new Error(`${action} 沒有回傳任何內容`)
  }

  try {
    const payload = JSON.parse(text)
    return {
      ...payload,
      scriptPath,
    }
  } catch (_error) {
    throw new Error(`${action} 回傳了無法解析的 JSON`)
  }
}

function runWorkModeCommand(action) {
  const scriptPath = resolveScriptPath()
  const command = `/bin/bash ${shellQuote(scriptPath)} ${action}`
  const output = execSync(command, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  return parseScriptOutput(output, scriptPath, action)
}

function buildCommandError(error, fallbackMessage) {
  const stdout = String(error?.stdout || '').trim()
  const stderr = String(error?.stderr || '').trim()

  return {
    ok: false,
    error: fallbackMessage,
    detail: stderr || stdout || error?.message || '未知錯誤',
    scriptPath: existsSync(preferredScriptPath) ? preferredScriptPath : fallbackScriptPath,
  }
}

export async function GET(request) {
  try {
    assertOfficeApiRequest(request)
    return NextResponse.json(runWorkModeCommand('status'))
  } catch (error) {
    const status = error?.name === 'OfficeRequestAuthError'
      ? getOfficeRequestErrorStatus(error, 401)
      : 500

    if (status === 500) {
      return NextResponse.json(
        buildCommandError(error, '讀取工作模式狀態失敗'),
        { status },
      )
    }

    return NextResponse.json({ ok: false, error: error.message }, { status })
  }
}

export async function POST(request) {
  try {
    assertOfficeApiRequest(request)

    const body = await request.json().catch(() => ({}))
    const requestedMode = body?.mode
    if (requestedMode !== 'work' && requestedMode !== 'normal') {
      return NextResponse.json(
        { ok: false, error: 'mode 必須是 work 或 normal' },
        { status: 400 },
      )
    }

    const action = requestedMode === 'work' ? 'activate' : 'deactivate'
    return NextResponse.json(runWorkModeCommand(action))
  } catch (error) {
    const status = error?.name === 'OfficeRequestAuthError'
      ? getOfficeRequestErrorStatus(error, 401)
      : 500

    if (status === 500) {
      return NextResponse.json(
        buildCommandError(error, '切換工作模式失敗'),
        { status },
      )
    }

    return NextResponse.json({ ok: false, error: error.message }, { status })
  }
}
