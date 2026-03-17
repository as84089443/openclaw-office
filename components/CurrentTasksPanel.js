'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'

const STATUS_MAP = {
  pending: { label: '待處理', color: 'text-yellow-300', dot: 'bg-yellow-400', progress: 20, next: '等待開始處理' },
  in_progress: { label: '進行中', color: 'text-cyan-300', dot: 'bg-cyan-400', progress: 60, next: '持續執行中' },
  completed: { label: '已完成', color: 'text-green-300', dot: 'bg-green-400', progress: 100, next: '等待你查看結果' },
  failed: { label: '失敗', color: 'text-red-300', dot: 'bg-red-400', progress: 100, next: '需要人工介入' },
}

function formatAgent(agent) {
  if (!agent) return '未指派'
  return agent
}

function formatTime(ts) {
  if (!ts) return '剛剛'
  try {
    return new Date(ts).toLocaleString('zh-TW', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return '剛剛'
  }
}

export default function CurrentTasksPanel() {
  const [tasks, setTasks] = useState([])
  const [devSessions, setDevSessions] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true

    const fetchTasks = async () => {
      try {
        const [tasksRes, sessionsRes] = await Promise.all([
          fetch('/api/workflow?type=tasks&active=true&limit=8'),
          fetch('/api/dev-sessions'),
        ])
        const tasksData = await tasksRes.json()
        const sessionsData = await sessionsRes.json()
        if (!alive) return
        setTasks(tasksData.tasks || [])
        setDevSessions(sessionsData.sessions || [])
      } catch (error) {
        console.error('Failed to fetch current tasks:', error)
      } finally {
        if (alive) setLoading(false)
      }
    }

    fetchTasks()
    const interval = setInterval(fetchTasks, 10000)
    return () => {
      alive = false
      clearInterval(interval)
    }
  }, [])

  const activeCount = useMemo(() => tasks.length + devSessions.length, [tasks.length, devSessions.length])

  return (
    <motion.div
      className="glass-card rounded-xl overflow-hidden"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
    >
      <div className="flex items-center justify-between border-b border-cyan-900/30 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">🧩</span>
          <h3 className="font-display text-sm text-cyan-300">目前任務</h3>
        </div>
        <div className="text-xs text-gray-400">{activeCount} 筆</div>
      </div>

      <div className="p-3 space-y-3 max-h-[420px] overflow-y-auto">
        {loading ? (
          <div className="text-sm text-gray-500">讀取中…</div>
        ) : (tasks.length === 0 && devSessions.length === 0) ? (
          <div className="rounded-lg border border-gray-800 bg-black/20 p-3 text-sm text-gray-500">
            目前沒有進行中的任務
          </div>
        ) : (
          <>
            {devSessions.map((session) => (
              <div
                key={`session-${session.id}`}
                className="rounded-lg border border-fuchsia-800/60 bg-fuchsia-950/10 p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-white">{session.title || session.sessionKey}</div>
                    {session.detail ? <div className="mt-1 line-clamp-2 text-xs text-gray-400">{session.detail}</div> : null}
                  </div>
                  <div className="shrink-0 text-xs text-fuchsia-300">開發中</div>
                </div>

                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-gray-800">
                  <div className="h-full rounded-full bg-fuchsia-400" style={{ width: '65%' }} />
                </div>

                <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-fuchsia-400" />
                    <span>{session.channel || 'openclaw session'}</span>
                  </div>
                  <span>LIVE</span>
                </div>

                <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
                  <span>最新開發動作</span>
                  <span>{formatTime(session.updatedAt)}</span>
                </div>
              </div>
            ))}

            {tasks.map((task) => {
              const status = STATUS_MAP[task.status] || STATUS_MAP.in_progress
              const summary = task.title || task.detail || task.requestId || task.id
              const detail = task.detail && task.detail !== task.title ? task.detail : null
              const milestone = task.milestone || status.label
              const nextStep = task.nextStep || status.next
              const updatedAt = task.lastUpdate || task.completedAt || task.startedAt || task.createdAt
              const stale = updatedAt ? (Date.now() - Number(updatedAt) > 24 * 60 * 60 * 1000) : false
              return (
                <Link
                  key={task.id}
                  href={`/office/tasks/${task.id}`}
                  className="block rounded-lg border border-gray-800 bg-black/20 p-3 transition hover:border-cyan-500/40 hover:bg-cyan-950/10"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-white">{summary}</div>
                      {detail ? <div className="mt-1 line-clamp-2 text-xs text-gray-400">{detail}</div> : null}
                    </div>
                    <div className={`shrink-0 text-xs ${status.color}`}>{milestone}</div>
                  </div>

                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-gray-800">
                    <div className="h-full rounded-full bg-cyan-400" style={{ width: `${status.progress}%` }} />
                  </div>

                  <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${status.dot}`} />
                      <span>{formatAgent(task.assignedAgent)}</span>
                    </div>
                    <span>{status.progress}%</span>
                  </div>

                  <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
                    <span>{nextStep}</span>
                    <span>{formatTime(updatedAt)}</span>
                  </div>

                  {(task.needsDecision || task.rollbackNeeded || task.attentionType || stale) ? (
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                      {task.needsDecision ? <span className="rounded-full border border-yellow-500/40 bg-yellow-500/10 px-2 py-1 text-yellow-300">待你決策</span> : null}
                      {task.rollbackNeeded ? <span className="rounded-full border border-red-500/40 bg-red-500/10 px-2 py-1 text-red-300">阻塞/需處理</span> : null}
                      {stale ? <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-amber-300">過久未更新</span> : null}
                      {task.attentionType ? <span className="rounded-full border border-purple-500/40 bg-purple-500/10 px-2 py-1 text-purple-300">{task.attentionType}</span> : null}
                    </div>
                  ) : null}
                </Link>
              )
            })}
          </>
        )}
      </div>
    </motion.div>
  )
}
