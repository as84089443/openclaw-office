import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'

const SESSIONS_DIR = process.env.OPENCLAW_SESSIONS_DIR || '/Users/brian/.openclaw/agents/main/sessions'
const ACTIVE_WINDOW_MS = 2 * 60 * 60 * 1000

function extractText(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (!item) return ''
        if (typeof item === 'string') return item
        if (item.type === 'text') return item.text || ''
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

function trimText(text, max = 140) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim()
  if (!clean) return ''
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

function summarizeSession(file) {
  const filePath = join(SESSIONS_DIR, file)
  const stat = statSync(filePath)
  const updatedAt = stat.mtime.getTime()
  const lines = readFileSync(filePath, 'utf-8').split('\n').filter(Boolean)

  let sessionId = file.replace('.jsonl', '')
  let sessionKey = sessionId
  let channel = null
  let lastRole = null
  let lastText = ''

  for (const line of lines) {
    try {
      const entry = JSON.parse(line)
      if (entry.type === 'session') {
        sessionId = entry.id || sessionId
        sessionKey = entry.sessionKey || sessionKey
        channel = entry.channel || channel
      }
      if (entry.type === 'message' && entry.message) {
        lastRole = entry.message.role || lastRole
        const text = extractText(entry.message.content)
        if (text) lastText = text
      }
    } catch {}
  }

  return {
    id: sessionId,
    sessionKey,
    channel,
    updatedAt,
    isActive: (Date.now() - updatedAt) <= ACTIVE_WINDOW_MS,
    title: trimText(lastText || sessionKey || sessionId, 90),
    detail: trimText(lastText, 180),
    role: lastRole,
  }
}

export async function GET() {
  try {
    if (!existsSync(SESSIONS_DIR)) {
      return Response.json({ sessions: [], ok: false, error: 'sessions dir not found' })
    }

    const sessions = readdirSync(SESSIONS_DIR)
      .filter((name) => name.endsWith('.jsonl') && !name.includes('.deleted'))
      .map(summarizeSession)
      .filter((session) => session.isActive)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 8)

    return Response.json({ ok: true, sessions })
  } catch (error) {
    return Response.json({ ok: false, sessions: [], error: error.message }, { status: 500 })
  }
}
