'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Activity,
  BrainCircuit,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Cpu,
  FlaskConical,
  Gauge,
  GitBranch,
  Play,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  Square,
  TerminalSquare,
} from 'lucide-react'

const PHASE_LABELS = {
  BLOCKED: '卡住待處理',
  COMPLETED: '已完成',
  ERROR: '異常',
  EXECUTING: '執行中',
  FAILED: '失敗',
  IDLE: '待命中',
  IN_PROGRESS: '進行中',
  PASS: '通過',
  RUNNING: '執行中',
}

function formatTimestamp(value) {
  if (!value) return '讀取中'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-TW', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date)
}

function formatShortTimestamp(value) {
  if (!value) return '待更新'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-TW', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '0 分鐘'
  const totalMinutes = Math.max(1, Math.round(ms / 60000))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours && minutes) return `${hours} 小時 ${minutes} 分`
  if (hours) return `${hours} 小時`
  return `${minutes} 分`
}

function formatMinuteValue(value, fallback = '待設定') {
  const minutes = Number(value)
  if (!Number.isFinite(minutes) || minutes <= 0) return fallback
  return `${minutes} 分鐘`
}

function formatBpb(value) {
  return typeof value === 'number' ? value.toFixed(6) : '待更新'
}

function formatImprovement(value) {
  if (typeof value !== 'number') return '待更新'
  if (value > 0) return `改善 ${value.toFixed(6)}`
  if (value < 0) return `退步 ${Math.abs(value).toFixed(6)}`
  return '持平 0.000000'
}

function phaseTone(phase) {
  if (phase === 'EXECUTING' || phase === 'RUNNING') return '#39ff14'
  if (phase === 'BLOCKED') return '#ffb703'
  return '#94a3b8'
}

function healthTone(health) {
  if (health === 'green') return '#39ff14'
  if (health === 'yellow') return '#ffb703'
  if (health === 'red') return '#ff0040'
  return '#64748b'
}

function translatePhase(value, fallback = '待命中') {
  if (!value) return fallback
  return PHASE_LABELS[String(value).trim().toUpperCase()] || value
}

function translateVerdict(value, fallback = '待更新') {
  if (!value) return fallback
  const normalized = String(value).replaceAll('`', '').trim().toUpperCase()
  if (normalized === 'PASS') return '通過'
  if (normalized === 'FAIL') return '未通過'
  return value
}

function translateStrategyRole(value, fallback = '待更新') {
  if (!value) return fallback
  const normalized = String(value).replaceAll('`', '').trim().toLowerCase()
  if (normalized === 'primary') return '主力模式'
  if (normalized === 'breakthrough') return '突破模式'
  return value
}

function humanizeProxyStatus(value) {
  if (value === true) return '已就緒'
  if (value === false) return '未連線'
  return '尚未確認'
}

function humanizeCodexLogin(value) {
  if (!value) return '尚未確認'
  if (/chatgpt/i.test(value)) return '已用 ChatGPT 方案登入'
  return value
}

function humanizeControlStatus(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized || normalized === 'idle') return '尚未啟動'
  if (normalized === 'queued') return '準備啟動'
  if (normalized === 'running') return '優化進行中'
  if (normalized === 'stopping') return '正在停止'
  if (normalized === 'completed') return '這輪已完成'
  if (normalized === 'stopped') return '已手動停止'
  if (normalized === 'failed') return '執行異常'
  return value
}

function humanizeRuntimeNote(value) {
  if (!value) return null
  return String(value)
    .replaceAll('AutoResearch MLX', 'AutoResearch')
    .replace('夜跑執行中。', '研究流程執行中。')
}

function controlTone(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'running') return '#39ff14'
  if (normalized === 'stopping') return '#ffb703'
  if (normalized === 'failed') return '#ff0040'
  if (normalized === 'completed') return '#00f5ff'
  return '#94a3b8'
}

function humanizeCronStatus(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized || normalized === 'pending') return '尚未執行'
  if (normalized === 'ok') return '最近一次正常'
  if (normalized === 'error') return '最近一次失敗'
  return value
}

function findModelOption(options, id) {
  if (!Array.isArray(options) || !id) return null
  return options.find((option) => option?.id === id) || null
}

function formatScheduleNextRun(schedule) {
  if (!schedule?.enabled) return '已停用'
  return formatTimestamp(schedule?.nextRunAt)
}

function runtimeWindowStatus(runtime) {
  if (!runtime?.isActive) return '等待下一輪開始'
  if ((runtime.remainingToSoftMs || 0) > 0) {
    return `距離建議收尾還有 ${formatDuration(runtime.remainingToSoftMs)}`
  }
  if ((runtime.remainingMs || 0) > 0) {
    return `已進入收尾緩衝，距離最晚截止還有 ${formatDuration(runtime.remainingMs)}`
  }
  return '已到最晚截止時間'
}

function humanizeActionText(value, fallback = '目前沒有新的訊號。') {
  if (!value) return fallback
  const text = String(value).trim()

  let localized = text
    .replace(/^AutoResearch MLX fleet handoff complete \((.+)\)$/i, 'AutoResearch 研究收尾完成（$1）')
    .replace(/^AutoResearch MLX QA pass \((.+)\)$/i, 'QA 檢查通過（$1）')
    .replace(/^AutoResearch MLX handoff captured \((.+)\)$/i, '研究結論已整理進記憶交接（$1）')
    .replace(/^AutoResearch MLX baseline \((.+)\)$/i, '正在建立這輪的基準成績（$1）')
    .replace(/^AutoResearch MLX Codex loop \((.+)\)$/i, '正在讓 Codex 提出並驗證新的優化方案（$1）')
    .replace(/^Running baseline on (.+)$/i, '正在為 $1 建立基準成績')
    .replace(/^Running bounded Codex experiment loop on (.+)$/i, '正在讓 Codex 在 $1 上反覆提出、修改並驗證新方案')
    .replace(/^Collect baseline metrics$/i, '正在整理 baseline 指標，準備進入下一輪優化')
    .replace(/^Review (.+\/summary\.md) when complete$/i, '等這輪實驗結束後，會自動整理摘要與結果')
    .replace(/^Review (.+)$/i, '建議下一步查看：$1')
    .replace('daily QA 已跑，但今日 health-check 尚未完成', '今日健康檢查尚未完成')

  localized = localizeSentence(localized)
  return localized
}

function humanizeExperimentDescription(value) {
  if (!value) return '未命名實驗'
  if (value === 'baseline') return '基準成績'
  if (/^lower weight decay to ([0-9.]+)$/i.test(value)) {
    return `把權重衰減降到 ${value.match(/^lower weight decay to ([0-9.]+)$/i)?.[1]}`
  }
  return localizeSentence(value)
}

function localizeSentence(value) {
  if (!value) return value
  const text = String(value)
    .replace(/\bplateau\b/g, '停滯')
    .replace(/\bimprovement\b/g, '改善')
    .replace(/\bstep efficiency\b/g, '每步效率')
    .replace(/\bregularization\b/g, '正則化')
    .replace(/\bleaner batch\b/g, '較精簡的批次設定')
    .replace(/\bbatch\b/g, '批次')
    .replace(/\banneal\b/g, '衰減排程')
    .replace(/\bplaybook\b/g, '操作手冊')
    .replace('確認 改善 不是單次巧合。', '確認這次改善不是單次巧合。')
    .trim()

  const lowered = text.match(/^(\d+)\.\s+Lower `([^`]+)` from `([^`]+)` to `([^`]+)` in `([^`]+)` while keeping architecture and LR schedule unchanged\.$/)
  if (lowered) {
    const [, order, name, from, to, file] = lowered
    return `${order}. 將權重衰減 \`${name}\` 從 \`${from}\` 降到 \`${to}\`，位置在 \`${file}\`；模型架構與學習率排程維持不變。`
  }

  const loweredInline = text.match(/^lower `([^`]+)` from `([^`]+)` to `([^`]+)` in (.+)$/i)
  if (loweredInline) {
    const [, name, from, to, file] = loweredInline
    return `將權重衰減 \`${name}\` 從 \`${from}\` 降到 \`${to}\`，位置在 ${file}`
  }

  const raised = text.match(/^(\d+)\.\s+Increase `([^`]+)` from `([^`]+)` to `([^`]+)` in `([^`]+)` while keeping architecture and LR schedule unchanged\.$/)
  if (raised) {
    const [, order, name, from, to, file] = raised
    return `${order}. 將 \`${name}\` 從 \`${from}\` 提高到 \`${to}\`，位置在 \`${file}\`；模型架構與學習率排程維持不變。`
  }

  const improved = text.match(/^- The single experiment improved validation bits-per-byte from `?([^` ]+)`? to `?([^` ]+)`?\.$/)
  if (improved) {
    const [, from, to] = improved
    return `- 這次單一實驗把驗證 bits-per-byte 從 \`${from}\` 改善到 \`${to}\`。`
  }

  const resultLogged = text.match(/^- Result logged in `([^`]+)` and retained on branch tip\.$/)
  if (resultLogged) {
    return `- 結果已寫進 \`${resultLogged[1]}\`，並保留在目前分支最新提交。`
  }

  const completedLoop = text.match(/^Completed one experiment loop on `([^`]+)` and kept the winning change\.$/)
  if (completedLoop) {
    return `已完成 \`${completedLoop[1]}\` 這輪實驗，並保留最佳變更。`
  }

  const bestVsBaseline = text.match(/^- Best `val_bpb`: \*\*([^*]+)\*\* \((?:improved|改善) from baseline `([^`]+)`\)$/)
  if (bestVsBaseline) {
    return `- 目前最佳 val_bpb：**${bestVsBaseline[1]}**（比基準 \`${bestVsBaseline[2]}\` 更好）`
  }

  const keyIdea = text.match(/^- Key experiment idea: (.+)$/)
  if (keyIdea) {
    return `- 關鍵實驗作法：${localizeSentence(keyIdea[1])}`
  }

  const loggedLink = text.match(/^- Logged result in (.+)$/)
  if (loggedLink) {
    return `- 已把結果記錄到 ${loggedLink[1]}`
  }

  const finalHash = text.match(/^- Final kept commit hash: (.+)$/)
  if (finalHash) {
    return `- 最終保留 commit：${finalHash[1]}`
  }

  const summaryWritten = text.match(/^- Summary written to (.+)$/)
  if (summaryWritten) {
    return `- 摘要已寫到 ${summaryWritten[1]}`
  }

  if (text === 'Repo is clean and left on the best kept commit.') {
    return '工作目錄乾淨，目前停在最佳保留 commit。'
  }

  return text
}

function replaceLabeledMarkdownLine(line, label, localizedLabel, transform = (value) => value) {
  const prefix = `- ${label}:`
  if (!line.startsWith(prefix)) return line
  return `- ${localizedLabel}：${transform(line.slice(prefix.length).trim())}`
}

function localizeArtifactContent(content) {
  if (!content) return '尚未產生內容。'

  return content
    .split('\n')
    .map((line) => {
      if (!line.trim()) return line

      const headingMap = {
        '## Key experiment idea kept': '## 這輪保留下來的關鍵作法',
        '## Outcome': '## 這輪結果',
        '## Evidence': '## 判定依據',
        '## Retest': '## 下一步複驗',
        '## Candidate Learnings': '## 候選學習',
      }

      if (line.startsWith('# AutoResearch MLX Summary')) {
        return line.replace('# AutoResearch MLX Summary', '# AutoResearch 研究摘要')
      }
      if (line.startsWith('# AutoResearch MLX QA Check')) {
        return line.replace('# AutoResearch MLX QA Check', '# AutoResearch QA 檢查')
      }
      if (line.startsWith('# AutoResearch MLX Memory Distiller Handoff')) {
        return line.replace('# AutoResearch MLX Memory Distiller Handoff', '# AutoResearch 記憶整理交接')
      }
      if (headingMap[line.trim()]) return headingMap[line.trim()]

      let localized = line
      localized = replaceLabeledMarkdownLine(localized, 'Run tag', '這輪標記')
      localized = replaceLabeledMarkdownLine(localized, 'Owner agent', '負責魚')
      localized = replaceLabeledMarkdownLine(localized, 'Model', '使用模型')
      localized = replaceLabeledMarkdownLine(localized, 'Strategy role', '策略角色', (value) => translateStrategyRole(value, value))
      localized = replaceLabeledMarkdownLine(localized, 'Branch', '研究分支')
      localized = replaceLabeledMarkdownLine(localized, 'Final kept commit', '最終保留 commit')
      localized = replaceLabeledMarkdownLine(localized, 'Best `val_bpb`', '目前最佳 val_bpb')
      localized = replaceLabeledMarkdownLine(localized, 'Baseline `val_bpb`', '基準 val_bpb')
      localized = replaceLabeledMarkdownLine(localized, 'QA verdict', 'QA 判定', (value) => translateVerdict(value, value))
      localized = replaceLabeledMarkdownLine(localized, 'Verdict note', 'QA 補充說明')
      localized = replaceLabeledMarkdownLine(localized, 'Baseline val_bpb', '基準 val_bpb')
      localized = replaceLabeledMarkdownLine(localized, 'Best keep val_bpb', '最佳保留 val_bpb')
      localized = replaceLabeledMarkdownLine(localized, 'Improvement delta', '改善幅度')
      localized = replaceLabeledMarkdownLine(localized, 'Peak memory', '記憶體峰值')
      localized = replaceLabeledMarkdownLine(localized, 'Underlying run exit code', '執行結束碼')
      localized = replaceLabeledMarkdownLine(localized, 'Best val_bpb', '最佳 val_bpb')

      return localizeSentence(localized)
    })
    .join('\n')
}

function extractShellCommand(summary) {
  if (!summary) return null
  const direct = summary.match(/^\/bin\/zsh -lc ['"](.+)['"]$/s)
  if (!direct?.[1]) return null
  return direct[1].replace(/\n+/g, ' ').trim()
}

function humanizeEventType(value) {
  const normalized = String(value || '').toLowerCase()
  if (normalized === 'item.started') return '開始執行'
  if (normalized === 'item.completed') return '執行完成'
  if (normalized === 'turn.completed') return '本輪完成'
  if (normalized === 'raw') return '原始紀錄'
  return value || '事件'
}

function humanizeEventStatus(value) {
  const normalized = String(value || '').toLowerCase()
  if (!normalized) return '已記錄'
  if (normalized === 'in_progress') return '進行中'
  if (normalized === 'completed') return '已完成'
  return translatePhase(value, value)
}

function humanizeEventSummary(event) {
  const summary = event?.summary || ''
  const extracted = extractShellCommand(summary)

  if (summary === 'event') {
    return '本輪事件已記錄完成。'
  }

  if (extracted?.includes('cat >') && extracted.includes('/summary.md')) {
    return '正在寫入這輪研究摘要。'
  }
  if (extracted?.includes('cat ') && extracted.includes('/summary.md')) {
    return '正在檢查這輪研究摘要內容。'
  }
  if (extracted?.includes('git show --stat --oneline -n 1 HEAD')) {
    return '正在檢查目前保留提交的實際變更。'
  }
  if (extracted?.includes('git branch --show-current') && extracted.includes('git rev-parse --short HEAD')) {
    return '正在確認目前分支、提交與工作目錄狀態。'
  }
  if (extracted) {
    return `正在執行終端指令：${extracted}`
  }

  return localizeArtifactContent(summary)
}

function summarizeOvernightLogTail(lines) {
  if (!Array.isArray(lines) || !lines.length) return '目前沒有新的執行紀錄。'

  const joined = lines.join('\n')
  const notes = []
  const stateDbWarnings = lines.filter((line) => line.includes('failed to open state db')).length

  if (stateDbWarnings > 0) {
    notes.push(`- 這輪出現 ${stateDbWarnings} 次狀態資料庫警告，但沒有阻止流程完成。`)
  }
  if (joined.includes('migration 19 was previously applied but is missing in the resolved migrations')) {
    notes.push('- Codex 本機狀態資料庫有 migration 版本不一致的警告，代表舊狀態紀錄需要後續整理。')
  }
  if (joined.includes('Failed to delete shell snapshot')) {
    notes.push('- 收尾時有暫存 shell snapshot 清理失敗的警告，屬於清理雜訊。')
  }
  if (joined.includes('Failed to kill MCP process group')) {
    notes.push('- 收尾時有 MCP 子程序清理警告，但不影響這輪主要研究結果。')
  }
  if (joined.includes('Codex loop complete.')) {
    notes.push('- Codex 實驗迴圈已正常跑完，摘要與事件檔都已寫入 artifacts。')
  }

  const exitCodeMatch = joined.match(/exit_code=(\d+)/)
  if (exitCodeMatch) {
    notes.push(
      exitCodeMatch[1] === '0'
        ? '- 結束碼是 0，代表這輪研究流程本身正常完成。'
        : `- 結束碼是 ${exitCodeMatch[1]}，代表這輪研究流程有異常需要追。`,
    )
  }

  return notes.length ? notes.join('\n') : lines.join('\n')
}

function buildRoundGoal(metrics = {}) {
  if (typeof metrics.bestKeepValBpb === 'number') {
    return `目標是把 val_bpb 壓低到比目前最佳 ${formatBpb(metrics.bestKeepValBpb)} 更好；這個指標越低越好。`
  }
  if (typeof metrics.baselineValBpb === 'number') {
    return `目標是把 val_bpb 壓低到比 baseline ${formatBpb(metrics.baselineValBpb)} 更好；這個指標越低越好。`
  }
  return '目標是先量出 baseline val_bpb，之後每個改動都拿這個指標比較；數值越低越好。'
}

function buildRoundFocus(snapshot) {
  const live = snapshot?.live || {}
  const control = snapshot?.control || {}
  const metrics = snapshot?.metrics || {}
  const history = Array.isArray(metrics.history) ? metrics.history : []
  const latestExperiment = [...history].reverse().find((row) => row?.description && row.description !== 'baseline') || null
  const combined = [live.currentTask, live.lastAction, live.nextStep].filter(Boolean).join(' ').toLowerCase()
  const logTail = Array.isArray(control.logTail) ? control.logTail : []
  const latestLogLine = [...logTail].reverse().find((line) => {
    if (!line) return false
    return !(
      line === '---'
      || line.startsWith('started_at=')
      || line.startsWith('source=')
      || line.startsWith('mode=')
      || line.startsWith('run_tag=')
      || line.startsWith('soft_minutes=')
      || line.startsWith('hard_minutes=')
      || line.startsWith('max_experiments=')
      || line.startsWith('cmd=')
      || line.startsWith('owner agent:')
      || line.startsWith('model:')
      || line.startsWith('breakthrough:')
      || line.startsWith('plateau n:')
      || line.startsWith('run tag:')
      || line.startsWith('run model:')
      || line.startsWith('role:')
      || line.startsWith('log file:')
      || line === 'AutoResearch MLX overnight run'
      || line === 'AutoResearch MLX fleet run'
    )
  }) || null

  let item = '正在整理這輪研究方向。'
  let goal = buildRoundGoal(metrics)
  let next = humanizeActionText(live.nextStep || live.lastAction, '等待下一個研究步驟。')
  let basis = '主要觀察指標是 val_bpb，數值越低代表這次優化越有效。'

  if (combined.includes('baseline')) {
    item = '先建立目前模型的基準成績'
    goal = typeof metrics.baselineValBpb === 'number'
      ? `先確認 baseline val_bpb 是否穩定在 ${formatBpb(metrics.baselineValBpb)} 左右，後面所有改動都拿它比較。`
      : '先量出 baseline val_bpb，讓後面的參數或結構調整都有比較基準。'
    next = '接下來會收集 baseline 指標，確認基準線後才開始試新的優化項目。'
    basis = '這一步還不是在改參數，而是在建立後續所有實驗的比較基準。'
  } else if (combined.includes('codex loop') || combined.includes('bounded codex experiment loop')) {
    item = '讓 Codex 產生並驗證新的優化方案'
    next = '這輪會持續修改候選做法、跑訓練並比較結果，最後只保留真的更好的版本。'
    basis = '目前會在同一個研究分支上反覆修改與驗證，主看 val_bpb 是否比現有最佳更低。'
  } else if (latestExperiment?.description) {
    item = humanizeExperimentDescription(latestExperiment.description)
  } else if (snapshot?.highlights?.bestIdea) {
    item = localizeSentence(String(snapshot.highlights.bestIdea).replace(/^\d+\.\s*/, ''))
  } else if (live.currentTask || live.lastAction) {
    item = humanizeActionText(live.currentTask || live.lastAction, '正在整理這輪研究方向。')
  }

  if (latestLogLine) {
    basis = localizeSentence(latestLogLine)
  }

  return { item, goal, next, basis }
}

function StatusPill({ active }) {
  const tone = active ? '#39ff14' : '#64748b'
  return (
    <div
      className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs uppercase tracking-[0.22em]"
      style={{
        borderColor: `${tone}55`,
        color: tone,
        background: `${tone}12`,
      }}
    >
      <span className="h-2 w-2 rounded-full" style={{ background: tone, boxShadow: `0 0 12px ${tone}` }} />
      {active ? '研究執行中' : '目前待命'}
    </div>
  )
}

function PrimaryButton({ icon: Icon, label, tone = '#00f5ff', disabled, busy, onClick }) {
  return (
    <button
      type="button"
      disabled={disabled || busy}
      onClick={onClick}
      className="inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold transition hover:translate-y-[-1px] disabled:cursor-not-allowed disabled:opacity-45"
      style={{
        borderColor: `${tone}55`,
        background: `${tone}18`,
        color: tone,
      }}
    >
      {busy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
      {label}
    </button>
  )
}

function NumberSettingField({ label, value, suffix, min, max, onChange }) {
  return (
    <label className="block">
      <div className="text-[11px] uppercase tracking-[0.18em] text-gray-500">{label}</div>
      <div className="mt-2 flex items-center gap-2 rounded-2xl border border-white/10 bg-black/25 px-3 py-2">
        <input
          type="number"
          min={min}
          max={max}
          step="1"
          value={value}
          onChange={onChange}
          className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-white outline-none"
        />
        <div className="text-xs text-gray-500">{suffix}</div>
      </div>
    </label>
  )
}

function ScheduleEditorCard({
  title,
  description,
  value,
  enabled,
  nextRunLabel,
  lastStatusLabel,
  accent = '#39ff14',
  onTimeChange,
  onToggle,
}) {
  const tone = enabled ? accent : '#64748b'

  return (
    <div className="rounded-[24px] border p-4" style={{ borderColor: `${tone}33`, background: `${tone}08` }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-white">{title}</div>
          <div className="mt-1 text-xs leading-6 text-gray-400">{description}</div>
        </div>
        <button
          type="button"
          onClick={() => onToggle(!enabled)}
          className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition hover:translate-y-[-1px]"
          style={{
            borderColor: `${tone}55`,
            color: tone,
            background: `${tone}18`,
          }}
        >
          <span className="h-2 w-2 rounded-full" style={{ background: tone, boxShadow: `0 0 10px ${tone}` }} />
          {enabled ? '排程已啟用' : '排程已停用'}
        </button>
      </div>

      <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <label className="block flex-1">
          <div className="text-[11px] uppercase tracking-[0.18em] text-gray-500">時間設定</div>
          <input
            type="time"
            value={value}
            onChange={onTimeChange}
            className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-base font-semibold text-white outline-none"
          />
          <div className="mt-2 text-[11px] leading-5 text-gray-500">直接改成你要的時間，儲存後就會寫回正式排程。</div>
        </label>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-[18px] border border-white/8 bg-black/20 px-4 py-3">
          <div className="text-[11px] uppercase tracking-[0.18em] text-gray-500">下次執行</div>
          <div className="mt-2 text-sm text-white">{nextRunLabel}</div>
        </div>
        <div className="rounded-[18px] border border-white/8 bg-black/20 px-4 py-3">
          <div className="text-[11px] uppercase tracking-[0.18em] text-gray-500">最近狀態</div>
          <div className="mt-2 text-sm text-white">{lastStatusLabel}</div>
        </div>
      </div>
    </div>
  )
}

function MetricCard({ icon: Icon, label, value, hint, accent }) {
  return (
    <div className="glass-card rounded-[28px] p-5" style={{ borderColor: `${accent}44` }}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.22em]" style={{ color: accent }}>
            {label}
          </div>
          <div className="mt-3 text-3xl font-bold text-white">{value}</div>
          <div className="mt-2 text-sm leading-6 text-gray-400">{hint}</div>
        </div>
        <div
          className="rounded-2xl p-3"
          style={{ background: `${accent}16`, color: accent, boxShadow: `0 0 24px ${accent}22` }}
        >
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  )
}

function AgentSignal({ title, agent, accent }) {
  const tone = healthTone(agent?.health)
  return (
    <div className="rounded-[24px] border p-4" style={{ borderColor: `${accent}44`, background: `${accent}08` }}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: tone, boxShadow: `0 0 14px ${tone}` }} />
          <div className="text-sm font-bold text-white">{title}</div>
        </div>
        <div
          className="rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-[0.2em]"
          style={{ borderColor: `${phaseTone(agent?.phase)}44`, color: phaseTone(agent?.phase) }}
        >
          {translatePhase(agent?.phase)}
        </div>
      </div>
      <div className="mt-3 text-sm leading-6 text-gray-300">
        {humanizeActionText(agent?.lastAction || agent?.currentTask)}
      </div>
      <div className="mt-2 text-xs leading-6 text-gray-500">
        下一步：{humanizeActionText(agent?.nextStep, '等待下一步')}
      </div>
      {agent?.blockers?.[0] ? (
        <div className="mt-2 text-xs leading-6 text-amber-200">
          目前卡點：{humanizeActionText(agent.blockers[0], agent.blockers[0])}
        </div>
      ) : null}
    </div>
  )
}

function TraceSparkline({ history }) {
  const points = history.filter((item) => typeof item.valBpb === 'number')
  if (!points.length) {
    return (
      <div className="flex h-[240px] items-center justify-center rounded-[24px] border border-dashed border-cyan-500/20 bg-black/20 text-sm text-gray-500">
        等待更多實驗結果進來
      </div>
    )
  }

  const width = 680
  const height = 240
  const padding = 22
  const min = Math.min(...points.map((item) => item.valBpb))
  const max = Math.max(...points.map((item) => item.valBpb))
  const range = Math.max(max - min, 0.0001)

  const coords = points.map((point, index) => {
    const x = padding + ((width - padding * 2) * index) / Math.max(points.length - 1, 1)
    const y = height - padding - ((point.valBpb - min) / range) * (height - padding * 2)
    return { ...point, x, y }
  })

  const path = coords.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
  const fillPath = `${path} L ${coords[coords.length - 1].x} ${height - padding} L ${coords[0].x} ${height - padding} Z`

  return (
    <div className="rounded-[24px] border border-cyan-500/20 bg-black/20 p-4">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-[240px] w-full overflow-visible">
        <defs>
          <linearGradient id="autoresearch-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#00f5ff" stopOpacity="0.36" />
            <stop offset="100%" stopColor="#00f5ff" stopOpacity="0.03" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((ratio) => (
          <line
            key={ratio}
            x1={padding}
            x2={width - padding}
            y1={padding + (height - padding * 2) * ratio}
            y2={padding + (height - padding * 2) * ratio}
            stroke="rgba(0,245,255,0.12)"
            strokeDasharray="4 8"
          />
        ))}
        <path d={fillPath} fill="url(#autoresearch-fill)" />
        <path d={path} fill="none" stroke="#00f5ff" strokeWidth="3" strokeLinecap="round" />
        {coords.map((point) => (
          <g key={`${point.commit}-${point.index}`}>
            <circle cx={point.x} cy={point.y} r="4" fill="#050508" stroke="#39ff14" strokeWidth="2" />
            <title>{`${humanizeExperimentDescription(point.description || point.commit)} · ${formatBpb(point.valBpb)}`}</title>
          </g>
        ))}
      </svg>
      <div className="mt-4 flex flex-wrap gap-3 text-xs text-gray-400">
        {points.map((point) => (
          <div key={point.commit} className="rounded-full border border-cyan-500/20 bg-cyan-500/5 px-3 py-1">
            {humanizeExperimentDescription(point.description || point.commit)}:{' '}
            <span className="text-cyan-200">{formatBpb(point.valBpb)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function ArtifactPanel({ title, accent, path, content }) {
  return (
    <div className="glass-card rounded-[28px] p-5" style={{ borderColor: `${accent}44` }}>
      <div className="text-xs uppercase tracking-[0.22em]" style={{ color: accent }}>
        {title}
      </div>
      <div className="mt-2 truncate text-[11px] text-gray-500">{path || '尚未產生檔案'}</div>
      <pre className="mt-4 max-h-[280px] overflow-auto rounded-[22px] border border-black/25 bg-black/35 px-4 py-4 text-xs leading-6 text-gray-200">
        {localizeArtifactContent(content)}
      </pre>
    </div>
  )
}

export default function AutoResearchControlRoom() {
  const [officeAccess, setOfficeAccess] = useState({ configured: false, authenticated: true, authSource: 'disabled' })
  const [tokenDraft, setTokenDraft] = useState('')
  const [accessBusy, setAccessBusy] = useState(false)
  const [snapshot, setSnapshot] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [controlBusy, setControlBusy] = useState('')
  const [scheduleBusy, setScheduleBusy] = useState(false)
  const [strategyBusy, setStrategyBusy] = useState(false)
  const [manualBusy, setManualBusy] = useState(false)
  const [scheduleDraft, setScheduleDraft] = useState({
    nightlyTime: '',
    watchTime: '',
    nightlyEnabled: true,
    watchEnabled: true,
  })
  const [manualDraft, setManualDraft] = useState({
    softMinutes: '',
    hardMinutes: '',
    maxExperiments: '',
  })
  const [strategyDraft, setStrategyDraft] = useState({
    primaryModel: '',
    breakthroughModel: '',
  })

  const refreshOfficeAccess = useCallback(async () => {
    try {
      const response = await fetch('/api/office/session', { cache: 'no-store' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data?.error || '無法讀取目前的辦公室權限')
      }
      setOfficeAccess({
        configured: Boolean(data.configured),
        authenticated: Boolean(data.authenticated),
        authSource: data.authSource || null,
      })
      return data
    } catch (loadError) {
      setOfficeAccess({ configured: false, authenticated: true, authSource: 'disabled' })
      setError(loadError.message || '無法讀取目前的辦公室權限')
      return null
    }
  }, [])

  const fetchSnapshot = useCallback(async () => {
    try {
      setRefreshing(true)
      setError('')
      const response = await fetch('/api/autoresearch', { cache: 'no-store' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        if (response.status === 401) {
          await refreshOfficeAccess()
          setSnapshot(null)
          setError('請先完成辦公室驗證，才能查看 AutoResearch 控制台。')
          return
        }
        throw new Error(data?.error || '目前暫時讀不到 AutoResearch 狀態')
      }
      setSnapshot(data)
      setLoading(false)
    } catch (loadError) {
      console.error('Failed to load autoresearch snapshot:', loadError)
      setError(loadError.message || '目前暫時讀不到 AutoResearch 狀態')
      setLoading(false)
    } finally {
      setRefreshing(false)
    }
  }, [refreshOfficeAccess])

  useEffect(() => {
    if (!snapshot?.schedule) return
    setScheduleDraft((current) => {
      if (current.nightlyTime || current.watchTime) return current
      return {
        nightlyTime: snapshot.schedule.nightly?.timeValue || '',
        watchTime: snapshot.schedule.watch?.timeValue || '',
        nightlyEnabled: snapshot.schedule.nightly?.enabled ?? true,
        watchEnabled: snapshot.schedule.watch?.enabled ?? true,
      }
    })
  }, [
    snapshot?.schedule?.nightly?.timeValue,
    snapshot?.schedule?.watch?.timeValue,
    snapshot?.schedule?.nightly?.enabled,
    snapshot?.schedule?.watch?.enabled,
  ])

  useEffect(() => {
    if (!snapshot?.manualControl) return
    setManualDraft((current) => {
      if (current.softMinutes || current.hardMinutes || current.maxExperiments) return current
      return {
        softMinutes: String(snapshot.manualControl.softMinutes || ''),
        hardMinutes: String(snapshot.manualControl.hardMinutes || ''),
        maxExperiments: String(snapshot.manualControl.maxExperiments || ''),
      }
    })
  }, [
    snapshot?.manualControl?.softMinutes,
    snapshot?.manualControl?.hardMinutes,
    snapshot?.manualControl?.maxExperiments,
  ])

  useEffect(() => {
    if (!snapshot?.strategy) return
    setStrategyDraft((current) => {
      if (current.primaryModel || current.breakthroughModel) return current
      return {
        primaryModel: snapshot.strategy.primaryModel || '',
        breakthroughModel: snapshot.strategy.breakthroughModel || '',
      }
    })
  }, [snapshot?.strategy?.primaryModel, snapshot?.strategy?.breakthroughModel])

  useEffect(() => {
    let interval = null
    let cancelled = false

    async function bootstrap() {
      const access = await refreshOfficeAccess()
      if (cancelled) return
      if (!access?.configured || access?.authenticated) {
        await fetchSnapshot()
        if (cancelled) return
        interval = window.setInterval(fetchSnapshot, 5000)
      } else {
        setSnapshot(null)
        setLoading(false)
      }
    }

    bootstrap()
    return () => {
      cancelled = true
      if (interval) window.clearInterval(interval)
    }
  }, [fetchSnapshot, refreshOfficeAccess])

  const submitOfficeAccess = useCallback(async (event) => {
    event.preventDefault()
    setAccessBusy(true)
    setError('')
    try {
      const response = await fetch('/api/office/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: tokenDraft.trim() }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data?.error || '驗證失敗，請再試一次')
      }
      setOfficeAccess({
        configured: Boolean(data.configured),
        authenticated: Boolean(data.authenticated),
        authSource: data.authSource || 'cookie',
      })
      setTokenDraft('')
      setLoading(true)
      await fetchSnapshot()
    } catch (submitError) {
      setError(submitError.message || '驗證失敗，請再試一次')
    } finally {
      setAccessBusy(false)
    }
  }, [fetchSnapshot, tokenDraft])

  const clearOfficeAccess = useCallback(async () => {
    setAccessBusy(true)
    setError('')
    try {
      const response = await fetch('/api/office/session', { method: 'DELETE' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data?.error || '無法清除這次驗證')
      }
      setOfficeAccess({
        configured: Boolean(data.configured),
        authenticated: Boolean(data.authenticated),
        authSource: data.authSource || null,
      })
      setSnapshot(null)
    } catch (clearError) {
      setError(clearError.message || '無法清除這次驗證')
    } finally {
      setAccessBusy(false)
    }
  }, [])

  const triggerControlAction = useCallback(async (action, extra = {}) => {
    try {
      setControlBusy(action)
      setError('')
      setNotice('')
      const response = await fetch('/api/autoresearch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data?.error || '控制 AutoResearch 失敗')
      }
      setNotice(
        action === 'start'
          ? `已送出開始優化指令，這輪執行標記是 ${data.runTag || '新的手動研究批次'}。`
          : `${data.signal === 'SIGKILL' ? '已強制停止' : '已送出停止指令'}，系統會在下一次輪詢更新狀態。`,
      )
      await new Promise((resolve) => window.setTimeout(resolve, 700))
      await fetchSnapshot()
    } catch (actionError) {
      setError(actionError.message || '控制 AutoResearch 失敗')
    } finally {
      setControlBusy('')
    }
  }, [fetchSnapshot])

  const saveSchedule = useCallback(async () => {
    try {
      setScheduleBusy(true)
      setError('')
      setNotice('')
      const response = await fetch('/api/autoresearch', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(scheduleDraft),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data?.error || '更新排程失敗')
      }
      setNotice('排程時間已更新，固定排程會依新的時間執行。')
      if (data?.schedule) {
        setScheduleDraft({
          nightlyTime: data.schedule.nightly?.timeValue || '',
          watchTime: data.schedule.watch?.timeValue || '',
          nightlyEnabled: data.schedule.nightly?.enabled ?? true,
          watchEnabled: data.schedule.watch?.enabled ?? true,
        })
      }
      await fetchSnapshot()
    } catch (saveError) {
      setError(saveError.message || '更新排程失敗')
    } finally {
      setScheduleBusy(false)
    }
  }, [fetchSnapshot, scheduleDraft])

  const saveManualConfig = useCallback(async () => {
    try {
      setManualBusy(true)
      setError('')
      setNotice('')
      const response = await fetch('/api/autoresearch', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          softMinutes: Number(manualDraft.softMinutes),
          hardMinutes: Number(manualDraft.hardMinutes),
          maxExperiments: Number(manualDraft.maxExperiments),
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data?.error || '更新手動啟動設定失敗')
      }
      if (data?.manualControl) {
        setManualDraft({
          softMinutes: String(data.manualControl.softMinutes || ''),
          hardMinutes: String(data.manualControl.hardMinutes || ''),
          maxExperiments: String(data.manualControl.maxExperiments || ''),
        })
      }
      setNotice('手動啟動設定已更新；之後新的手動研究會預設使用這組上限。')
      await fetchSnapshot()
    } catch (saveError) {
      setError(saveError.message || '更新手動啟動設定失敗')
    } finally {
      setManualBusy(false)
    }
  }, [fetchSnapshot, manualDraft])

  const saveStrategy = useCallback(async () => {
    try {
      setStrategyBusy(true)
      setError('')
      setNotice('')
      const response = await fetch('/api/autoresearch', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(strategyDraft),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data?.error || '更新模型策略失敗')
      }
      if (data?.strategy) {
        setStrategyDraft({
          primaryModel: data.strategy.primaryModel || '',
          breakthroughModel: data.strategy.breakthroughModel || '',
        })
      }
      setNotice('模型策略已更新；下一輪手動啟動和固定排程會使用新設定。')
      await fetchSnapshot()
    } catch (saveError) {
      setError(saveError.message || '更新模型策略失敗')
    } finally {
      setStrategyBusy(false)
    }
  }, [fetchSnapshot, strategyDraft])

  const metrics = useMemo(() => ([
    {
      label: '目前最佳成績',
      value: formatBpb(snapshot?.metrics?.bestKeepValBpb ?? snapshot?.metrics?.baselineValBpb),
      hint: '越低越好，這裡顯示目前保留下來最好的成績。',
      accent: '#00f5ff',
      icon: Gauge,
    },
    {
      label: '相對基準的進步',
      value: formatImprovement(snapshot?.metrics?.deltaFromBaseline),
      hint: '跟基準成績相比，這輪到底有沒有真的更好。',
      accent: '#39ff14',
      icon: Sparkles,
    },
    {
      label: '最近記憶體占用',
      value: typeof snapshot?.metrics?.latestMemoryGb === 'number' ? `${snapshot.metrics.latestMemoryGb.toFixed(1)} GB` : '待更新',
      hint: snapshot?.highlights?.peakMemory ? `目前看到的峰值是 ${snapshot.highlights.peakMemory}。` : '目前看到的記憶體峰值。',
      accent: '#ffb703',
      icon: Cpu,
    },
    {
      label: 'QA 檢查結果',
      value: translateVerdict(snapshot?.highlights?.qaVerdict),
      hint: snapshot?.highlights?.qaVerdictNote || 'QA 檢查完成後會顯示在這裡。',
      accent: '#ff6b35',
      icon: ShieldCheck,
    },
  ]), [snapshot])

  const codexTrace = useMemo(() => {
    return snapshot?.artifacts?.codexRun?.codexEvents || []
  }, [snapshot])

  const modelOptions = snapshot?.strategy?.availableModels || []
  const manualControl = snapshot?.manualControl || {}
  const runtime = snapshot?.control || {}
  const progressWidth = `${Math.min(Math.max(Number(runtime.progressPct || 0), 0), 100)}%`
  const softProgressWidth = `${Math.min(Math.max(Number(runtime.softProgressPct || 0), 0), 100)}%`
  const roundFocus = useMemo(() => buildRoundFocus(snapshot), [snapshot])
  const primaryModelMeta = useMemo(
    () => findModelOption(modelOptions, strategyDraft.primaryModel),
    [modelOptions, strategyDraft.primaryModel],
  )
  const breakthroughModelMeta = useMemo(
    () => findModelOption(modelOptions, strategyDraft.breakthroughModel),
    [modelOptions, strategyDraft.breakthroughModel],
  )
  const strategyUnchanged = (
    strategyDraft.primaryModel === (snapshot?.strategy?.primaryModel || '')
    && strategyDraft.breakthroughModel === (snapshot?.strategy?.breakthroughModel || '')
  )
  const manualSoftMinutes = Number(manualDraft.softMinutes || 0)
  const manualHardMinutes = Number(manualDraft.hardMinutes || 0)
  const manualMaxExperiments = Number(manualDraft.maxExperiments || 0)
  const manualConfigValid = (
    Number.isInteger(manualSoftMinutes)
    && Number.isInteger(manualHardMinutes)
    && Number.isInteger(manualMaxExperiments)
    && manualSoftMinutes >= 15
    && manualHardMinutes >= manualSoftMinutes
    && manualMaxExperiments >= 1
  )
  const manualUnchanged = (
    manualSoftMinutes === Number(manualControl.softMinutes || 0)
    && manualHardMinutes === Number(manualControl.hardMinutes || 0)
    && manualMaxExperiments === Number(manualControl.maxExperiments || 0)
  )
  const scheduleUnchanged = (
    scheduleDraft.nightlyTime === (snapshot?.schedule?.nightly?.timeValue || '')
    && scheduleDraft.watchTime === (snapshot?.schedule?.watch?.timeValue || '')
    && scheduleDraft.nightlyEnabled === (snapshot?.schedule?.nightly?.enabled ?? true)
    && scheduleDraft.watchEnabled === (snapshot?.schedule?.watch?.enabled ?? true)
  )

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-4 py-10">
      <div className="space-y-8">
        <motion.section
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card rounded-[32px] p-8 md:p-10"
        >
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-4xl">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/8 px-4 py-2 text-xs uppercase tracking-[0.22em] text-cyan-300">
                <FlaskConical className="h-3.5 w-3.5" />
                AutoResearch 控制台
              </div>
              <h1 className="font-display text-4xl leading-tight text-white md:text-5xl">
                直接看到現在在跑哪一輪、
                <span className="block text-cyan-300">有沒有真的變更好。</span>
              </h1>
              <p className="mt-5 max-w-3xl text-sm leading-8 text-gray-300 md:text-base">
                這裡把 AutoResearch 的研究分支、模型策略、最近實驗走勢、QA 檢查、記憶整理交接和執行紀錄
                放在同一個控制台。你不用再切去 artifact 目錄翻檔案，打開這頁就能直接看懂這輪研究在做什麼、做到哪裡。
              </p>
            </div>

            <div className="space-y-3 lg:w-[360px]">
              <div className="flex flex-wrap items-center gap-3">
                <StatusPill active={Boolean(snapshot?.live?.isRunning)} />
                <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.22em] text-gray-300">
                  <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                  每 5 秒更新
                </div>
              </div>
              <div className="rounded-[24px] border border-cyan-500/20 bg-black/20 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-cyan-300">目前這輪標記</div>
                <div className="mt-3 text-2xl font-display text-white">{snapshot?.live?.runTag || '等待新的一輪'}</div>
                <div className="mt-3 text-sm leading-7 text-gray-300">
                  {humanizeActionText(snapshot?.live?.currentTask || snapshot?.live?.lastAction)}
                </div>
                <div className="mt-3 text-xs text-gray-500">
                  更新時間: {formatTimestamp(snapshot?.updatedAt)}
                </div>
              </div>
            </div>
          </div>

          {error ? (
            <div className="mt-6 rounded-2xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-100">
              目前暫時讀不到 AutoResearch 狀態：{error}
            </div>
          ) : null}
          {notice ? (
            <div className="mt-4 rounded-2xl border border-cyan-500/30 bg-cyan-500/5 px-4 py-3 text-sm text-cyan-100">
              {notice}
            </div>
          ) : null}
        </motion.section>

        {officeAccess.configured && (
          <section className="glass-card rounded-[28px] p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="text-xs uppercase tracking-[0.18em] text-cyan-300">工具存取</div>
                <div className="mt-2 text-sm leading-7 text-gray-300">
                  {officeAccess.authenticated
                    ? '這個瀏覽器已取得研究控制台的存取權限。'
                    : '這頁也有保護機制，先驗證一次再查看本機研究資料與實驗細節。'}
                </div>
                <div className="mt-2 text-[11px] text-gray-500">
                  驗證欄位: <code>x-office-token</code>
                  {officeAccess.authSource ? ` / 目前: ${officeAccess.authSource}` : ''}
                </div>
              </div>
              {officeAccess.authenticated ? (
                <button
                  type="button"
                  disabled={accessBusy}
                  onClick={clearOfficeAccess}
                  className="rounded-lg border border-white/15 px-3 py-2 text-xs uppercase tracking-[0.18em] text-gray-200 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {accessBusy ? '清除中...' : '清除權限'}
                </button>
              ) : (
                <form className="flex w-full max-w-xl flex-col gap-3 lg:w-auto lg:flex-row" onSubmit={submitOfficeAccess}>
                  <input
                    type="password"
                    value={tokenDraft}
                    onChange={(event) => setTokenDraft(event.target.value)}
                    placeholder="貼上 Office 驗證碼"
                    className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-400/40 lg:min-w-[320px]"
                  />
                  <button
                    type="submit"
                    disabled={accessBusy || !tokenDraft.trim()}
                    className="rounded-lg border border-cyan-400/40 bg-cyan-500/10 px-3 py-2 text-xs uppercase tracking-[0.18em] text-cyan-200 transition hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {accessBusy ? '驗證中...' : '確認'}
                  </button>
                </form>
              )}
            </div>
          </section>
        )}

        {officeAccess.configured && !officeAccess.authenticated && !snapshot ? (
          <section className="glass-card rounded-[28px] p-6 text-sm leading-7 text-gray-300">
            先完成辦公室權限驗證，這裡才會顯示 AutoResearch 的研究分支、執行紀錄、結果曲線和 QA 交接內容。
          </section>
        ) : null}

        {loading && !snapshot ? (
          <section className="glass-card rounded-[28px] p-8 text-center text-sm text-gray-300">
            正在接上 AutoResearch 本地資料流...
          </section>
        ) : null}

        {(!officeAccess.configured || officeAccess.authenticated || snapshot) && snapshot ? (
          <>
            <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
              <div className="glass-card rounded-[28px] p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-sm uppercase tracking-[0.18em] text-cyan-300">
                    <Clock3 className="h-4 w-4" />
                    手動控制
                  </div>
                  <div
                    className="rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.2em]"
                    style={{ borderColor: `${controlTone(runtime.status)}44`, color: controlTone(runtime.status) }}
                  >
                    {humanizeControlStatus(runtime.status)}
                  </div>
                </div>

                <div className="mt-4 text-sm leading-7 text-gray-300">
                  {humanizeRuntimeNote(runtime.note) || '這裡可以手動啟動一輪 AutoResearch，或在跑到一半時要求停止。'}
                </div>

                <div className="mt-5 grid gap-3 lg:grid-cols-3">
                  <div className="rounded-[20px] border border-white/8 bg-black/25 px-4 py-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-cyan-300">這輪在試什麼</div>
                    <div className="mt-2 text-sm leading-7 text-white">{roundFocus.item}</div>
                  </div>
                  <div className="rounded-[20px] border border-white/8 bg-black/25 px-4 py-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-300">這輪目標</div>
                    <div className="mt-2 text-sm leading-7 text-white">{roundFocus.goal}</div>
                  </div>
                  <div className="rounded-[20px] border border-white/8 bg-black/25 px-4 py-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-amber-300">接下來</div>
                    <div className="mt-2 text-sm leading-7 text-white">{roundFocus.next}</div>
                    <div className="mt-3 text-xs leading-6 text-gray-400">{roundFocus.basis}</div>
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap gap-3">
                  <PrimaryButton
                    icon={Play}
                    label="開始優化"
                    busy={controlBusy === 'start'}
                    disabled={runtime.isActive || !manualConfigValid}
                    onClick={() => triggerControlAction('start', {
                      softMinutes: manualSoftMinutes,
                      hardMinutes: manualHardMinutes,
                      maxExperiments: manualMaxExperiments,
                    })}
                  />
                  <PrimaryButton
                    icon={Square}
                    label={runtime.status === 'stopping' ? '強制停止' : '停止優化'}
                    tone={runtime.status === 'stopping' ? '#ff0040' : '#ffb703'}
                    busy={controlBusy === 'stop'}
                    disabled={!runtime.isActive && runtime.status !== 'stopping'}
                    onClick={() => triggerControlAction('stop', { force: runtime.status === 'stopping' })}
                  />
                </div>

                <div className="mt-6 rounded-[24px] border border-white/10 bg-black/20 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-white">這次手動啟動設定</div>
                      <div className="mt-1 text-xs leading-6 text-gray-400">
                        手動啟動不再沿用夜跑 8 小時規格。這裡是手動研究自己的預設值。
                      </div>
                    </div>
                    <PrimaryButton
                      icon={Save}
                      label="儲存手動設定"
                      tone="#ffb703"
                      busy={manualBusy}
                      disabled={!manualConfigValid || manualUnchanged}
                      onClick={saveManualConfig}
                    />
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    <NumberSettingField
                      label="建議停止時限"
                      value={manualDraft.softMinutes}
                      suffix="分鐘"
                      min={15}
                      max={720}
                      onChange={(event) => setManualDraft((current) => ({ ...current, softMinutes: event.target.value }))}
                    />
                    <NumberSettingField
                      label="最晚強制停止"
                      value={manualDraft.hardMinutes}
                      suffix="分鐘"
                      min={15}
                      max={1440}
                      onChange={(event) => setManualDraft((current) => ({ ...current, hardMinutes: event.target.value }))}
                    />
                    <NumberSettingField
                      label="實驗上限"
                      value={manualDraft.maxExperiments}
                      suffix="次"
                      min={1}
                      max={48}
                      onChange={(event) => setManualDraft((current) => ({ ...current, maxExperiments: event.target.value }))}
                    />
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    <button
                      type="button"
                      onClick={() => setManualDraft({ softMinutes: '60', hardMinutes: '90', maxExperiments: '4' })}
                      className="rounded-2xl border border-cyan-500/20 bg-cyan-500/8 px-4 py-3 text-left transition hover:border-cyan-400/35 hover:bg-cyan-500/12"
                    >
                      <div className="text-sm font-semibold text-cyan-200">快速測一下</div>
                      <div className="mt-1 text-xs leading-6 text-gray-400">60 分鐘 / 最晚 90 分鐘 / 4 次實驗</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setManualDraft({ softMinutes: '90', hardMinutes: '120', maxExperiments: '6' })}
                      className="rounded-2xl border border-emerald-500/20 bg-emerald-500/8 px-4 py-3 text-left transition hover:border-emerald-400/35 hover:bg-emerald-500/12"
                    >
                      <div className="text-sm font-semibold text-emerald-200">平衡模式</div>
                      <div className="mt-1 text-xs leading-6 text-gray-400">90 分鐘 / 最晚 120 分鐘 / 6 次實驗</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setManualDraft({ softMinutes: '120', hardMinutes: '150', maxExperiments: '8' })}
                      className="rounded-2xl border border-amber-500/20 bg-amber-500/8 px-4 py-3 text-left transition hover:border-amber-400/35 hover:bg-amber-500/12"
                    >
                      <div className="text-sm font-semibold text-amber-200">多試幾輪</div>
                      <div className="mt-1 text-xs leading-6 text-gray-400">120 分鐘 / 最晚 150 分鐘 / 8 次實驗</div>
                    </button>
                  </div>

                  <div className="mt-4 text-xs leading-6 text-gray-500">
                    下一次手動啟動會使用：建議停止 {formatMinuteValue(manualSoftMinutes)} / 最晚強制停止 {formatMinuteValue(manualHardMinutes)} / 最多 {manualMaxExperiments || '待設定'} 次實驗。
                  </div>
                  {!manualConfigValid ? (
                    <div className="mt-2 text-xs leading-6 text-amber-200">
                      手動設定需要符合：建議停止至少 15 分鐘、最晚強制停止不能小於建議停止、實驗上限至少 1 次。
                    </div>
                  ) : null}
                </div>

                <div className="mt-6 rounded-[24px] border border-cyan-500/20 bg-black/20 p-4">
                  <div className="flex items-center justify-between gap-3 text-sm text-gray-300">
                    <div>這輪時間進度</div>
                    <div className="text-cyan-200">{runtime.isActive ? runtimeWindowStatus(runtime) : humanizeControlStatus(runtime.status)}</div>
                  </div>
                  <div className="mt-3 h-3 overflow-hidden rounded-full bg-white/5">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: softProgressWidth,
                        background: 'linear-gradient(90deg, rgba(57,255,20,0.95), rgba(0,245,255,0.92))',
                      }}
                    />
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/5">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: progressWidth,
                        background: 'linear-gradient(90deg, rgba(255,183,3,0.9), rgba(255,0,64,0.92))',
                      }}
                    />
                  </div>
                  <div className="mt-2 text-[11px] leading-6 text-gray-500">
                    上面第一條是建議收尾進度，第二條才是最晚強制停止的硬上限。
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                    <div className="rounded-[18px] border border-white/8 bg-black/25 px-4 py-3">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-gray-500">目前執行標記</div>
                      <div className="mt-2 text-sm text-white">{runtime.runTag || '尚未啟動手動研究批次'}</div>
                    </div>
                    <div className="rounded-[18px] border border-white/8 bg-black/25 px-4 py-3">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-gray-500">已跑時間</div>
                      <div className="mt-2 text-sm text-white">{formatDuration(runtime.elapsedMs)}</div>
                    </div>
                    <div className="rounded-[18px] border border-white/8 bg-black/25 px-4 py-3">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-gray-500">建議收尾</div>
                      <div className="mt-2 text-sm text-white">{runtime.recommendedStopAt ? formatShortTimestamp(runtime.recommendedStopAt) : '待下一輪開始'}</div>
                    </div>
                    <div className="rounded-[18px] border border-white/8 bg-black/25 px-4 py-3">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-gray-500">最晚截止</div>
                      <div className="mt-2 text-sm text-white">{runtime.estimatedFinishAt ? formatShortTimestamp(runtime.estimatedFinishAt) : '待下一輪開始'}</div>
                    </div>
                    <div className="rounded-[18px] border border-white/8 bg-black/25 px-4 py-3">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-gray-500">實驗上限</div>
                      <div className="mt-2 text-sm text-white">{runtime.maxExperiments ? `${runtime.maxExperiments} 次` : '待下一輪開始'}</div>
                    </div>
                  </div>
                  <div className="mt-4 text-xs leading-6 text-gray-500">
                    目前這輪實際使用的是：建議停止 {formatMinuteValue(runtime.softMinutes, '待更新')} / 最晚強制停止 {formatMinuteValue(runtime.hardMinutes, '待更新')} / 最多 {runtime.maxExperiments || '待更新'} 次實驗。
                  </div>
                  {runtime.isActive ? (
                    <div className="mt-2 text-[11px] leading-6 text-gray-500">
                      這輪啟動後就固定用當時的設定，不會中途改成你剛剛在上面調的新值。
                    </div>
                  ) : null}
                  <div className="mt-2 text-[11px] leading-6 text-gray-600">
                    控制紀錄檔：{runtime.outputLogPath || '會在下一輪啟動後產生'}
                  </div>
                </div>
              </div>

              <div className="glass-card rounded-[28px] p-6">
                <div className="flex items-center gap-2 text-sm uppercase tracking-[0.18em] text-green-300">
                  <CalendarClock className="h-4 w-4" />
                  正式排程
                </div>
                <div className="mt-4 space-y-4">
                  <div className="text-sm leading-7 text-gray-400">
                    這裡就是正式 cron 的控制區。你可以直接改夜間研究和早上檢查的時間，儲存後下一次排程就會照新的設定執行。
                  </div>

                  <ScheduleEditorCard
                    title="夜間研究開始時間"
                    description="每天固定啟動 AutoResearch 的時間。"
                    value={scheduleDraft.nightlyTime}
                    enabled={scheduleDraft.nightlyEnabled}
                    nextRunLabel={formatScheduleNextRun(snapshot.schedule?.nightly)}
                    lastStatusLabel={humanizeCronStatus(snapshot.schedule?.nightly?.lastStatus)}
                    accent="#39ff14"
                    onTimeChange={(event) => setScheduleDraft((current) => ({ ...current, nightlyTime: event.target.value }))}
                    onToggle={(enabled) => setScheduleDraft((current) => ({ ...current, nightlyEnabled: enabled }))}
                  />

                  <ScheduleEditorCard
                    title="早晨檢查時間"
                    description="每天自動檢查夜跑是否正常完成的時間。"
                    value={scheduleDraft.watchTime}
                    enabled={scheduleDraft.watchEnabled}
                    nextRunLabel={formatScheduleNextRun(snapshot.schedule?.watch)}
                    lastStatusLabel={humanizeCronStatus(snapshot.schedule?.watch?.lastStatus)}
                    accent="#00f5ff"
                    onTimeChange={(event) => setScheduleDraft((current) => ({ ...current, watchTime: event.target.value }))}
                    onToggle={(enabled) => setScheduleDraft((current) => ({ ...current, watchEnabled: enabled }))}
                  />

                  <PrimaryButton
                    icon={Save}
                    label="儲存排程變更"
                    tone="#39ff14"
                    busy={scheduleBusy}
                    disabled={!scheduleDraft.nightlyTime || !scheduleDraft.watchTime || scheduleUnchanged}
                    onClick={saveSchedule}
                  />
                  <div className="text-[11px] leading-6 text-gray-500">
                    正在跑的研究不會被中斷；新的排程時間會從下一次正式排程開始生效。
                  </div>
                </div>
              </div>
            </section>

            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {metrics.map((metric) => (
                <MetricCard key={metric.label} {...metric} />
              ))}
            </section>

            <section className="grid gap-4 xl:grid-cols-[1.4fr_0.6fr]">
              <div className="glass-card rounded-[28px] p-6">
                <div className="flex items-center gap-2 text-sm uppercase tracking-[0.18em] text-cyan-300">
                  <Activity className="h-4 w-4" />
                  實驗軌跡
                </div>
                <div className="mt-3 text-sm leading-7 text-gray-400">
                  `results.tsv` 裡的每一筆結果都會在這裡留下軌跡，能直接看出這輪到底是停滯，還是真的有進步。
                </div>
                <div className="mt-5">
                  <TraceSparkline history={snapshot.metrics.history} />
                </div>
              </div>

              <div className="space-y-4">
                <div className="glass-card rounded-[28px] p-6">
                <div className="flex items-center gap-2 text-sm uppercase tracking-[0.18em] text-green-300">
                  <BrainCircuit className="h-4 w-4" />
                  模型策略
                </div>
                <div className="mt-4 space-y-4 text-sm leading-7 text-gray-300">
                    <label className="block">
                      <div className="text-xs uppercase tracking-[0.18em] text-gray-500">主力模型</div>
                      <select
                        value={strategyDraft.primaryModel}
                        onChange={(event) => setStrategyDraft((current) => ({ ...current, primaryModel: event.target.value }))}
                        className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm text-white outline-none"
                      >
                        {modelOptions.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label} ({option.id})
                          </option>
                        ))}
                      </select>
                      <div className="mt-2 text-[11px] leading-5 text-gray-500">
                        {primaryModelMeta?.note || '這個模型會作為預設研究模型。'}
                      </div>
                    </label>
                    <label className="block">
                      <div className="text-xs uppercase tracking-[0.18em] text-gray-500">突破模型</div>
                      <select
                        value={strategyDraft.breakthroughModel}
                        onChange={(event) => setStrategyDraft((current) => ({ ...current, breakthroughModel: event.target.value }))}
                        className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm text-white outline-none"
                      >
                        {modelOptions.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label} ({option.id})
                          </option>
                        ))}
                      </select>
                      <div className="mt-2 text-[11px] leading-5 text-gray-500">
                        {breakthroughModelMeta?.note || '當主力模式連續停滯時，會切到這個模型。'}
                      </div>
                    </label>
                    <div className="rounded-[18px] border border-white/8 bg-black/25 px-4 py-3 text-[12px] leading-6 text-gray-400">
                      目前距離升級門檻：<span className="text-yellow-200">{snapshot.strategy.plateauCount}/{snapshot.strategy.escalateAfter}</span>
                      <br />
                      最近一次主力模式：<span className="text-white">{snapshot.strategy.lastPrimaryRunTag || '待更新'}</span>
                      <br />
                      最近一次判定：<span className="text-white">{translateVerdict(snapshot.strategy.lastPrimaryResult)}</span>
                    </div>
                    <div className="text-[11px] leading-6 text-gray-500">
                      這裡改的是之後要用的模型策略。正在跑的這一輪不會中途切換，會從下一輪手動啟動或固定排程開始生效。
                    </div>
                    <PrimaryButton
                      icon={Save}
                      label="儲存模型策略"
                      tone="#00f5ff"
                      busy={strategyBusy}
                      disabled={!strategyDraft.primaryModel || !strategyDraft.breakthroughModel || strategyUnchanged}
                      onClick={saveStrategy}
                    />
                  </div>
                </div>

                <div className="glass-card rounded-[28px] p-6">
                  <div className="flex items-center gap-2 text-sm uppercase tracking-[0.18em] text-purple-300">
                    <GitBranch className="h-4 w-4" />
                    研究工作區狀態
                  </div>
                  <div className="mt-4 space-y-3 text-sm leading-7 text-gray-300">
                    <div>目前分支：<span className="text-white">{snapshot.repo.branch || '待更新'}</span></div>
                    <div>目前提交：<span className="text-white">{snapshot.repo.head || '待更新'}</span></div>
                    <div>Codex 登入：<span className="text-white">{humanizeCodexLogin(snapshot.repo.codexLogin)}</span></div>
                    <div>proxy-chatgpt：<span className="text-white">{humanizeProxyStatus(snapshot.repo.proxyReady)}</span></div>
                  </div>
                </div>
              </div>
            </section>

            <section className="grid gap-4 xl:grid-cols-3">
              <AgentSignal title="開發魚" agent={snapshot.live} accent="#00f5ff" />
              <AgentSignal title="QA 檢查" agent={snapshot.live.qa} accent="#39ff14" />
              <AgentSignal title="記憶整理" agent={snapshot.live.memoryDistiller} accent="#ffb703" />
            </section>

            <section className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
              <div className="glass-card rounded-[28px] p-6">
                <div className="flex items-center gap-2 text-sm uppercase tracking-[0.18em] text-cyan-300">
                  <TerminalSquare className="h-4 w-4" />
                  執行過程
                </div>
                <div className="mt-4 space-y-3">
                  {codexTrace.length > 0 ? codexTrace.map((event) => (
                    <div key={event.id} className="rounded-[24px] border border-cyan-500/15 bg-black/25 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-xs uppercase tracking-[0.2em] text-cyan-300">{humanizeEventType(event.type)}</div>
                        <div className="text-[11px] text-gray-500">{humanizeEventStatus(event.status)}</div>
                      </div>
                      <div className="mt-2 text-sm leading-7 text-gray-200">{humanizeEventSummary(event)}</div>
                      {event.outputTail ? (
                        <pre className="mt-3 overflow-auto rounded-2xl border border-black/25 bg-black/40 px-3 py-3 text-[11px] leading-6 text-gray-300">
                          {localizeArtifactContent(event.outputTail)}
                        </pre>
                      ) : null}
                    </div>
                  )) : (
                    <div className="rounded-[24px] border border-dashed border-cyan-500/20 bg-black/20 p-4 text-sm text-gray-400">
                      目前還沒有可顯示的執行紀錄。
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-4">
                <ArtifactPanel
                  title="研究摘要"
                  accent="#00f5ff"
                  path={snapshot.artifacts.summary?.path}
                  content={snapshot.artifacts.summary?.content}
                />
                <ArtifactPanel
                  title="QA 報告"
                  accent="#39ff14"
                  path={snapshot.artifacts.qaReport?.path}
                  content={snapshot.artifacts.qaReport?.content}
                />
              </div>
            </section>

            <section className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
              <ArtifactPanel
                title="記憶整理交接"
                accent="#ffb703"
                path={snapshot.artifacts.memoryHandoff?.path}
                content={snapshot.artifacts.memoryHandoff?.content}
              />

              <div className="glass-card rounded-[28px] p-6">
                <div className="flex items-center gap-2 text-sm uppercase tracking-[0.18em] text-orange-300">
                  <CheckCircle2 className="h-4 w-4" />
                  執行紀錄尾端
                </div>
                <div className="mt-3 text-xs text-gray-500">
                  {snapshot.artifacts.overnightLog?.path || '尚未產生紀錄檔'}
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="rounded-[22px] border border-orange-500/15 bg-black/25 p-4">
                    <div className="text-xs uppercase tracking-[0.18em] text-orange-300">開始時間</div>
                    <div className="mt-2 text-sm text-white">
                      {formatTimestamp(snapshot.artifacts.overnightLog?.startedAt)}
                    </div>
                  </div>
                  <div className="rounded-[22px] border border-orange-500/15 bg-black/25 p-4">
                    <div className="text-xs uppercase tracking-[0.18em] text-orange-300">執行命令</div>
                    <div className="mt-2 truncate text-sm text-white">
                      {snapshot.artifacts.overnightLog?.command || '待更新'}
                    </div>
                  </div>
                </div>
                <pre className="mt-4 max-h-[320px] overflow-auto rounded-[24px] border border-black/25 bg-black/40 px-4 py-4 text-[11px] leading-6 text-gray-300">
                  {summarizeOvernightLogTail(snapshot.artifacts.overnightLog?.tail)}
                </pre>
              </div>
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
              <div className="glass-card rounded-[28px] p-6">
                <div className="text-sm uppercase tracking-[0.18em] text-cyan-300">這輪最值得看的內容</div>
                <div className="mt-4 space-y-3 text-sm leading-7 text-gray-300">
                  <p>保留下來的關鍵作法：{localizeSentence(snapshot.highlights.bestIdea) || '等這輪摘要寫完後會顯示在這裡。'}</p>
                  <p>最終保留 commit：<span className="text-white">{snapshot.highlights.finalCommit || '待更新'}</span></p>
                  <p>記憶體峰值：<span className="text-white">{snapshot.highlights.peakMemory || '待更新'}</span></p>
                  <p>{snapshot.highlights.memorySummary ? localizeArtifactContent(snapshot.highlights.memorySummary) : '記憶整理完成後，這裡會補上濃縮版學習。'}</p>
                </div>
              </div>

              <div className="glass-card rounded-[28px] p-6">
                <div className="text-sm uppercase tracking-[0.18em] text-green-300">本機資料來源</div>
                <div className="mt-4 space-y-3 text-[11px] leading-6 text-gray-400">
                  <div className="rounded-[22px] border border-green-500/15 bg-black/25 px-4 py-3">{snapshot.repo.projectDir}</div>
                  <div className="rounded-[22px] border border-green-500/15 bg-black/25 px-4 py-3">{snapshot.repo.resultsPath}</div>
                  <div className="rounded-[22px] border border-green-500/15 bg-black/25 px-4 py-3">{snapshot.strategy.latestStrategyReportPath || '尚未產生策略報告'}</div>
                </div>
              </div>
            </section>
          </>
        ) : null}
      </div>
    </main>
  )
}
