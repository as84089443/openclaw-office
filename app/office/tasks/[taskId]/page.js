async function getTask(taskId) {
  const base = process.env.NEXT_PUBLIC_BASE_URL || 'http://127.0.0.1:4200'
  try {
    const res = await fetch(`${base}/api/workflow?type=tasks&limit=100`, { cache: 'no-store' })
    const data = await res.json()
    return (data.tasks || []).find((task) => task.id === taskId) || null
  } catch {
    return null
  }
}

const STATUS_META = {
  pending: { label: '待處理', progress: 20, next: '等待開始處理' },
  in_progress: { label: '進行中', progress: 60, next: '持續執行中' },
  completed: { label: '已完成', progress: 100, next: '等待你查看結果' },
  failed: { label: '失敗', progress: 100, next: '需要人工介入' },
}

function formatTime(ts) {
  if (!ts) return '—'
  try {
    return new Date(ts).toLocaleString('zh-TW', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return '—'
  }
}

export default async function TaskDetailPage({ params }) {
  const { taskId } = await params
  const task = await getTask(taskId)

  if (!task) {
    return (
      <main className="min-h-screen p-6 text-white">
        <div className="glass-card mx-auto max-w-3xl rounded-2xl p-6">
          <div className="text-xl font-bold">找不到任務</div>
          <div className="mt-2 text-sm text-gray-400">taskId: {taskId}</div>
        </div>
      </main>
    )
  }

  const meta = STATUS_META[task.status] || STATUS_META.in_progress

  return (
    <main className="min-h-screen p-6 text-white">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="glass-card rounded-2xl p-6">
          <div className="text-xs uppercase tracking-[0.2em] text-cyan-300">任務詳情</div>
          <h1 className="mt-3 text-2xl font-bold">{task.title || task.detail || task.id}</h1>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-gray-800">
            <div className="h-full rounded-full bg-cyan-400" style={{ width: `${meta.progress}%` }} />
          </div>
          <div className="mt-3 grid gap-3 text-sm text-gray-300 sm:grid-cols-2">
            <div><span className="text-gray-500">狀態：</span>{meta.label}</div>
            <div><span className="text-gray-500">進度：</span>{meta.progress}%</div>
            <div><span className="text-gray-500">下一步：</span>{meta.next}</div>
            <div><span className="text-gray-500">代理：</span>{task.assignedAgent || '未指派'}</div>
            <div><span className="text-gray-500">建立：</span>{formatTime(task.createdAt)}</div>
            <div><span className="text-gray-500">開始：</span>{formatTime(task.startedAt)}</div>
            <div><span className="text-gray-500">完成：</span>{formatTime(task.completedAt)}</div>
            <div><span className="text-gray-500">需求決策：</span>{task.needsDecision ? '是' : '否'}</div>
          </div>
        </div>

        <div className="glass-card rounded-2xl p-6">
          <div className="text-xs uppercase tracking-[0.2em] text-purple-300">內容</div>
          <div className="mt-3 whitespace-pre-wrap text-sm leading-7 text-gray-200">
            {task.detail || task.title || '—'}
          </div>
        </div>

        <div className="glass-card rounded-2xl p-6">
          <div className="text-xs uppercase tracking-[0.2em] text-green-300">附加資訊</div>
          <div className="mt-3 grid gap-3 text-sm text-gray-300 sm:grid-cols-2">
            <div><span className="text-gray-500">requestId：</span>{task.requestId || '—'}</div>
            <div><span className="text-gray-500">priority：</span>{task.priority ?? '—'}</div>
            <div><span className="text-gray-500">attentionType：</span>{task.attentionType || '—'}</div>
            <div><span className="text-gray-500">estimatedValue：</span>{task.estimatedValue ?? '—'}</div>
            <div><span className="text-gray-500">rollbackNeeded：</span>{task.rollbackNeeded ? '是' : '否'}</div>
            <div><span className="text-gray-500">最後更新：</span>{formatTime(task.completedAt || task.startedAt || task.createdAt)}</div>
          </div>
        </div>
      </div>
    </main>
  )
}
