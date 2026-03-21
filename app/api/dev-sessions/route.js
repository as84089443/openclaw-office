import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import {
  buildConversationCategories,
  getAgentMeta,
  listAgentSessionDirectories,
  resolveSessionAgent,
} from '../../../lib/session-routing.js'

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

function summarizeSession({ file, filePath, storedAgentId }) {
  const stat = statSync(filePath)
  const updatedAt = stat.mtime.getTime()
  const lines = readFileSync(filePath, 'utf-8').split('\n').filter(Boolean)

  let sessionId = file.replace('.jsonl', '')
  let sessionKey = sessionId
  let channel = null
  let groupId = null
  let origin = null
  let lastRole = null
  let lastText = ''

  for (const line of lines) {
    try {
      const entry = JSON.parse(line)
      if (entry.type === 'session') {
        sessionId = entry.id || sessionId
        sessionKey = entry.sessionKey || sessionKey
        channel = entry.channel || channel
        groupId = entry.groupId || groupId
        origin = entry.origin || origin
      }
      if (entry.type === 'message' && entry.message) {
        lastRole = entry.message.role || lastRole
        const text = extractText(entry.message.content)
        if (text) lastText = text
      }
    } catch {}
  }

  const resolution = resolveSessionAgent({
    sessionKey,
    agentId: storedAgentId,
    channel,
    groupId,
    origin,
  })
  const agentMeta = getAgentMeta(resolution.agentId)

  return {
    id: sessionId,
    sessionKey,
    channel,
    groupId,
    updatedAt,
    isActive: (Date.now() - updatedAt) <= ACTIVE_WINDOW_MS,
    title: trimText(lastText || sessionKey || sessionId, 90),
    detail: trimText(lastText, 180),
    role: lastRole,
    storedAgentId: resolution.storedAgentId || storedAgentId || null,
    agentId: resolution.agentId || null,
    agentName: agentMeta.name,
    agentEmoji: agentMeta.emoji,
    conversationCategory: resolution.agentId || 'unassigned',
    resolutionSource: resolution.source,
    bindingKey: resolution.bindingKey,
  }
}

export async function GET() {
  try {
    const sessionDirs = listAgentSessionDirectories()
    if (sessionDirs.length === 0) {
      return Response.json({ sessions: [], categories: [], ok: false, error: 'sessions dir not found' })
    }

    const sessionFiles = sessionDirs.flatMap(({ agentId, dir }) => {
      if (!existsSync(dir)) return []
      return readdirSync(dir)
        .filter((name) => name.endsWith('.jsonl') && !name.includes('.deleted'))
        .map((name) => ({
          file: name,
          filePath: join(dir, name),
          storedAgentId: agentId,
        }))
    })

    const sessions = sessionFiles
      .map(summarizeSession)
      .filter((session) => session.isActive)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 24)

    const categories = buildConversationCategories(sessions)

    return Response.json({ ok: true, sessions, categories })
  } catch (error) {
    return Response.json({ ok: false, sessions: [], categories: [], error: error.message }, { status: 500 })
  }
}
