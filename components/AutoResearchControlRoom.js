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

const MANUAL_PRESET_OPTIONS = [
  {
    key: 'quick-check',
    title: '超短驗證',
    description: '45 分鐘 / 最晚 60 分鐘 / 3 次實驗',
    accent: 'cyan',
    values: { softMinutes: '45', hardMinutes: '60', maxExperiments: '3' },
  },
  {
    key: 'quick',
    title: '快速測一下',
    description: '60 分鐘 / 最晚 90 分鐘 / 4 次實驗',
    accent: 'cyan',
    values: { softMinutes: '60', hardMinutes: '90', maxExperiments: '4' },
  },
  {
    key: 'balanced',
    title: '平衡模式',
    description: '90 分鐘 / 最晚 120 分鐘 / 6 次實驗',
    accent: 'emerald',
    values: { softMinutes: '90', hardMinutes: '120', maxExperiments: '6' },
  },
  {
    key: 'deeper',
    title: '深挖一輪',
    description: '120 分鐘 / 最晚 150 分鐘 / 8 次實驗',
    accent: 'amber',
    values: { softMinutes: '120', hardMinutes: '150', maxExperiments: '8' },
  },
  {
    key: 'longer',
    title: '半天研究',
    description: '180 分鐘 / 最晚 240 分鐘 / 12 次實驗',
    accent: 'fuchsia',
    values: { softMinutes: '180', hardMinutes: '240', maxExperiments: '12' },
  },
  {
    key: 'extended',
    title: '長時深挖',
    description: '240 分鐘 / 最晚 300 分鐘 / 16 次實驗',
    accent: 'fuchsia',
    values: { softMinutes: '240', hardMinutes: '300', maxExperiments: '16' },
  },
  {
    key: 'marathon',
    title: '馬拉松研究',
    description: '360 分鐘 / 最晚 420 分鐘 / 20 次實驗',
    accent: 'fuchsia',
    values: { softMinutes: '360', hardMinutes: '420', maxExperiments: '20' },
  },
  {
    key: 'overnight-spec',
    title: '夜跑規格',
    description: '480 分鐘 / 最晚 510 分鐘 / 24 次實驗',
    accent: 'fuchsia',
    values: { softMinutes: '480', hardMinutes: '510', maxExperiments: '24' },
  },
]

const RESEARCH_KIND_OPTIONS = [
  {
    id: 'mlx',
    title: '模型優化',
    description: '適合 train.py / val_bpb / 訓練參數這類型的研究。',
    accent: 'cyan',
  },
  {
    id: 'program',
    title: '程式研究',
    description: '先讀懂你指定的程式，整理它在做什麼、關鍵檔案、流程與下一步。',
    accent: 'emerald',
  },
  {
    id: 'improve',
    title: '程式改善',
    description: '直接找一個最值得先修的問題，改程式並跑驗證。',
    accent: 'amber',
  },
  {
    id: 'evolve',
    title: '程式進化',
    description: '直接推進一個最值得延續的進化瓶頸，改程式、驗證，並留下下一輪可複利延伸的方向。',
    accent: 'fuchsia',
  },
]

const PROGRAM_WORKSPACE_OPTIONS = [
  {
    id: 'openclaw',
    label: 'OpenClaw 整體系統',
    path: '/Users/brian/.openclaw',
  },
  {
    id: 'openclaw-agents',
    label: 'OpenClaw 魚群 Agents',
    path: '/Users/brian/.openclaw',
    defaultTopic: '請只研究 OpenClaw 魚群 Agents 的工作流，找出目前最卡的協作斷點、可主動改道的做法、怎麼讓 agents 更順暢地自己解決問題，以及最值得先做的自動進化方向。',
    defaultImproveTopic: '請只改善 OpenClaw 魚群 Agents 最卡的一個協作斷點，優先讓 handoff、重試或自動補救更順，並留下明確驗證結果。',
    defaultEvolveTopic: '請只推進 OpenClaw 魚群 Agents 最值得持續進化的一個 bottleneck，優先讓 handoff、重試、自動補救或可觀測性變成下一輪更容易延續的能力，並留下明確驗證結果。',
  },
  {
    id: 'autopen',
    label: 'AutoPen',
    path: '/Users/brian/.openclaw/openclaw-office',
    defaultTopic: '請只研究 AutoPen 相關頁面、API、資料流、目前卡點與最值得先強化的地方。',
    defaultImproveTopic: '請先找出 AutoPen 最影響 SEO 或內容工作流的一個問題，直接修改程式並驗證改善是否成立。',
    defaultEvolveTopic: '請先找出 AutoPen 最值得做成持續進化能力的一個 bottleneck，直接修改程式、驗證效果，並把下一輪可延續的進化方向整理清楚。',
  },
  {
    id: 'bw-copilot',
    label: 'BW Copilot',
    path: '/Users/brian/.openclaw/openclaw-office',
    defaultImproveTopic: '請先找出 BW Copilot 最影響使用流程的一個問題，直接修改程式並驗證這次改善是否真的有效。',
    defaultEvolveTopic: '請先找出 BW Copilot 最值得持續進化的一個 bottleneck，直接修改程式、驗證效果，並整理下一輪可延續的進化方向。',
  },
  {
    id: 'contentforge',
    label: 'ContentForge',
    path: '/Users/brian/.openclaw/Projects/BW_ContentStudio',
    defaultTopic: '請只研究 ContentForge 目前的主要流程、關鍵模組、瓶頸與最值得先強化的地方。',
    defaultImproveTopic: '請先找出 ContentForge 目前最阻礙主要流程的一個問題，直接修改程式並驗證改善成果。',
    defaultEvolveTopic: '請先找出 ContentForge 最值得持續進化的一個 bottleneck，直接修改程式、驗證效果，並整理下一輪可延續的進化方向。',
  },
  {
    id: 'autoresearch-mlx',
    label: 'AutoResearch MLX',
    path: '/Users/brian/.openclaw/Projects/autoresearch-mlx',
  },
  {
    id: 'custom',
    label: '自訂路徑',
    path: '',
  },
]

const PRESET_TONE = {
  cyan: 'border-cyan-500/20 bg-cyan-500/8 text-cyan-200 hover:border-cyan-400/35 hover:bg-cyan-500/12',
  emerald: 'border-emerald-500/20 bg-emerald-500/8 text-emerald-200 hover:border-emerald-400/35 hover:bg-emerald-500/12',
  amber: 'border-amber-500/20 bg-amber-500/8 text-amber-200 hover:border-amber-400/35 hover:bg-amber-500/12',
  fuchsia: 'border-fuchsia-500/20 bg-fuchsia-500/8 text-fuchsia-200 hover:border-fuchsia-400/35 hover:bg-fuchsia-500/12',
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

function formatPassRate(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '待更新'
  return `${Math.round(value * 100)}%`
}

function formatDeltaVsBaseline(value, baseline) {
  if (typeof value !== 'number' || typeof baseline !== 'number') return '待更新'
  const delta = baseline - value
  if (delta > 0) return `比基準好 ${delta.toFixed(6)}`
  if (delta < 0) return `比基準差 ${Math.abs(delta).toFixed(6)}`
  return '和基準持平'
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
  if (normalized === 'NEEDS WORK') return '待補證據'
  if (normalized === 'BLOCKED') return '卡住'
  return value
}

function translateRevalidationVerdict(value, fallback = '待更新') {
  if (!value) return fallback
  const normalized = String(value).replaceAll('`', '').trim().toLowerCase()
  if (normalized === 'stable') return '穩定重現'
  if (normalized === 'mixed') return '有改善但波動大'
  if (normalized === 'blocked') return '複驗失敗'
  if (normalized === 'skipped') return '未進複驗'
  return value
}

function translateImprovementStatus(value, fallback = '待更新') {
  if (!value) return fallback
  const normalized = String(value).replaceAll('`', '').trim().toLowerCase()
  if (normalized === 'pass') return '通過'
  if (normalized === 'needs-work') return '待補證據'
  if (normalized === 'blocked') return '卡住'
  if (normalized === 'fail') return '未通過'
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

function humanizeResearchKind(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'program') return '程式研究'
  if (normalized === 'improve') return '程式改善'
  if (normalized === 'evolve') return '程式進化'
  if (normalized === 'mlx') return '模型優化'
  return '研究流程'
}

function humanizeReadinessCandidateSource(value) {
  const normalized = String(value || '').trim()
  if (normalized === 'fleet-readiness-top-candidate') return '啟動時鎖定的魚群候選'
  if (normalized === 'persisted-runtime') return 'runtime 持久訊號'
  if (normalized === 'live-fallback') return 'live snapshot 即時回補'
  return normalized || '待確認'
}

function humanizeManualAction(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'program') return '研究'
  if (normalized === 'improve') return '改善'
  if (normalized === 'evolve') return '進化'
  return '優化'
}

function resolveDefaultResearchTopic(kind, preset) {
  if (!preset) return ''
  if (kind === 'improve') return preset.defaultImproveTopic || preset.defaultEvolveTopic || ''
  if (kind === 'evolve') return preset.defaultEvolveTopic || preset.defaultImproveTopic || ''
  return preset.defaultTopic || ''
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
    .replace('AutoResearch 程式研究進行中。', '正在研究你指定的程式。')
    .replace('AutoResearch 程式改善進行中。', '正在替你指定的程式找問題、改程式並驗證。')
    .replace('AutoResearch 程式進化進行中。', '正在替你指定的程式推進一個可持續延續的進化瓶頸。')
    .replace('AutoResearch 已完成這輪程式研究。', '這輪程式研究已完成。')
    .replace('AutoResearch 已完成這輪程式改善。', '這輪程式改善已完成。')
    .replace('AutoResearch 已完成這輪程式進化。', '這輪程式進化已完成。')
    .replace('程式研究執行異常，請查看 log 與 summary。', '程式研究執行異常，請查看紀錄與摘要。')
    .replace('程式改善執行異常，請查看 log 與 summary。', '程式改善執行異常，請查看紀錄與摘要。')
    .replace('程式進化執行異常，請查看 log 與 summary。', '程式進化執行異常，請查看紀錄與摘要。')
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

function findWorkspacePresetByPath(path) {
  if (!path) return PROGRAM_WORKSPACE_OPTIONS.find((option) => option.id === 'custom') || null
  return PROGRAM_WORKSPACE_OPTIONS.find((option) => option.path && option.path === path)
    || PROGRAM_WORKSPACE_OPTIONS.find((option) => option.id === 'custom')
    || null
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
    .replace(/^AutoResearch program research \((.+)\)$/i, '正在研究你指定的程式（$1）')
    .replace(/^AutoResearch program improve \((.+)\)$/i, '正在改善你指定的程式（$1）')
    .replace(/^AutoResearch program evolve \((.+)\)$/i, '正在推進你指定的程式進化（$1）')
    .replace(/^Researching (.+)$/i, '正在研究：$1')
    .replace(/^Improving (.+)$/i, '正在改善：$1')
    .replace(/^Evolving (.+)$/i, '正在進化：$1')
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
  if (/^cosine warmdown decay curve$/i.test(value)) {
    return '把收尾衰減曲線改成 Cosine 曲線'
  }
  if (/^earlier longer warmdown lower final lr \(([^)]+)\)$/i.test(value)) {
    return '提早進入收尾、拉長收尾，並把尾端學習率降得更低'
  }
  if (/^shorter warmdown \+ higher final lr \(([^)]+)\)$/i.test(value)) {
    return '縮短收尾時間，並把尾端學習率拉高'
  }
  if (/^lower final lr frac to ([0-9.]+) \(from ([0-9.]+)\)$/i.test(value)) {
    const match = value.match(/^lower final lr frac to ([0-9.]+) \(from ([0-9.]+)\)$/i)
    return `把尾端學習率從 ${match?.[2]} 降到 ${match?.[1]}`
  }
  if (/^shorten warmdown ratio to ([0-9.]+) \(warmup ([0-9.]+), final lr ([0-9.]+)\)$/i.test(value)) {
    const match = value.match(/^shorten warmdown ratio to ([0-9.]+) \(warmup ([0-9.]+), final lr ([0-9.]+)\)$/i)
    return `把收尾比例縮到 ${match?.[1]}，warmup 用 ${match?.[2]}、尾端學習率用 ${match?.[3]}`
  }
  if (/^shorten warmdown ratio to ([0-9.]+)$/i.test(value)) {
    const match = value.match(/^shorten warmdown ratio to ([0-9.]+)$/i)
    return `把收尾比例再縮到 ${match?.[1]}`
  }
  if (/^lower weight decay to ([0-9.]+)$/i.test(value)) {
    return `把權重衰減降到 ${value.match(/^lower weight decay to ([0-9.]+)$/i)?.[1]}`
  }
  return localizeSentence(value)
}

function describeExperimentChange(value) {
  if (!value || value === 'baseline') {
    return '這是還沒改任何參數前的原始成績，用來當後面每次實驗的比較起點。'
  }

  if (/^cosine warmdown decay curve$/i.test(value)) {
    return '這次改的是收尾衰減曲線，把原本的線性收尾換成 Cosine，想看固定時間內收尾能不能更平順。'
  }

  const earlierLongerMatch = value.match(/^earlier longer warmdown lower final lr \(([^/]+)\/([^/]+)\/([^)]+)\)$/i)
  if (earlierLongerMatch) {
    const [, warmup, warmdown, finalLr] = earlierLongerMatch
    return `這次把 warmup 設成 ${warmup}、warmdown 拉長到 ${warmdown}，並把尾端學習率降到 ${finalLr}，想測試更早、更多的收尾會不會更穩。`
  }

  const shorterHigherMatch = value.match(/^shorter warmdown \+ higher final lr \(([^/]+)\/([^/]+)\/([^)]+)\)$/i)
  if (shorterHigherMatch) {
    const [, warmup, warmdown, finalLr] = shorterHigherMatch
    return `這次把 warmup 設成 ${warmup}、warmdown 縮短到 ${warmdown}，同時把尾端學習率拉高到 ${finalLr}，想讓模型在最後階段保留更多更新力道。`
  }

  const lowerFinalMatch = value.match(/^lower final lr frac to ([0-9.]+) \(from ([0-9.]+)\)$/i)
  if (lowerFinalMatch) {
    const [, to, from] = lowerFinalMatch
    return `這次只動尾端學習率，把 final lr 從 ${from} 降到 ${to}，觀察收尾更保守時成績會不會更穩。`
  }

  const shortenWarmdownMatch = value.match(/^shorten warmdown ratio to ([0-9.]+) \(warmup ([0-9.]+), final lr ([0-9.]+)\)$/i)
  if (shortenWarmdownMatch) {
    const [, warmdown, warmup, finalLr] = shortenWarmdownMatch
    return `這次把 warmdown 縮到 ${warmdown}，並固定 warmup ${warmup}、尾端學習率 ${finalLr}，重點是測試更短的收尾視窗會不會更有效。`
  }

  const shortenWarmdownOnlyMatch = value.match(/^shorten warmdown ratio to ([0-9.]+)$/i)
  if (shortenWarmdownOnlyMatch) {
    const [, warmdown] = shortenWarmdownOnlyMatch
    return `這次把收尾比例再縮到 ${warmdown}，想確認收尾再更短時，模型會不會開始明顯退步。`
  }

  const lowerWeightDecayMatch = value.match(/^lower weight decay to ([0-9.]+)$/i)
  if (lowerWeightDecayMatch) {
    return `這次只動權重衰減，把 weight decay 降到 ${lowerWeightDecayMatch[1]}，測試正則化放鬆一點會不會更好。`
  }

  return `這次改的是：${localizeSentence(value)}。`
}

function explainExperimentOutcome(row, baseline) {
  if (row?.description === 'baseline') {
    return '這是基準線；後面每一筆成績都會拿它來比較，所以這個數字本身不是好壞，而是起跑點。'
  }

  const deltaText = formatDeltaVsBaseline(row?.valBpb, baseline)
  const verdict = humanizeResultStatus(row?.status)
  const verdictText = verdict === '保留'
    ? '這次有帶來目前可接受的改善，所以先保留下來。'
    : verdict === '淘汰'
      ? '這次沒有贏過目前較好的方案，所以不保留。'
      : '這次結果先記錄下來，供後續比較。'

  return `${describeExperimentChange(row?.description)} 結果是：${deltaText}，所以判定為「${verdict}」。${verdictText}`
}

function humanizeResultStatus(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'keep') return '保留'
  if (normalized === 'discard') return '淘汰'
  if (normalized === 'baseline') return '基準'
  return value || '待更新'
}

function joinHumanList(items) {
  if (!Array.isArray(items) || !items.length) return '待補'
  return items.filter(Boolean).join('、')
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
        '## Key idea that won': '## 這輪保留下來的關鍵作法',
        '## Outcome': '## 這輪結果',
        '## Evidence': '## 判定依據',
        '## Retest': '## 下一步複驗',
        '## Candidate Learnings': '## 候選學習',
        '## Samples': '## 複驗樣本',
        '## Interpretation': '## 這份複驗怎麼看',
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
      if (line.startsWith('# AutoResearch MLX Revalidation')) {
        return line.replace('# AutoResearch MLX Revalidation', '# AutoResearch 自動複驗')
      }
      if (headingMap[line.trim()]) return headingMap[line.trim()]

      let localized = line
      localized = replaceLabeledMarkdownLine(localized, 'Run tag', '這輪標記')
      localized = replaceLabeledMarkdownLine(localized, 'Owner agent', '負責魚')
      localized = replaceLabeledMarkdownLine(localized, 'Model', '使用模型')
      localized = replaceLabeledMarkdownLine(localized, 'Strategy role', '策略角色', (value) => translateStrategyRole(value, value))
      localized = replaceLabeledMarkdownLine(localized, 'Lane', '研究線')
      localized = replaceLabeledMarkdownLine(localized, 'Lane goal', '研究線目標')
      localized = replaceLabeledMarkdownLine(localized, 'Branch', '研究分支')
      localized = replaceLabeledMarkdownLine(localized, 'Final kept commit', '最終保留 commit')
      localized = replaceLabeledMarkdownLine(localized, 'Final commit', '最終保留 commit')
      localized = replaceLabeledMarkdownLine(localized, 'Best kept commit (train config)', '最佳保留 train 設定 commit')
      localized = replaceLabeledMarkdownLine(localized, 'Best `val_bpb`', '目前最佳 val_bpb')
      localized = replaceLabeledMarkdownLine(localized, 'Best peak memory', '最佳保留版本記憶體峰值')
      localized = replaceLabeledMarkdownLine(localized, 'Baseline `val_bpb`', '基準 val_bpb')
      localized = replaceLabeledMarkdownLine(localized, 'QA verdict', 'QA 判定', (value) => translateVerdict(value, value))
      localized = replaceLabeledMarkdownLine(localized, 'Verdict note', 'QA 補充說明')
      localized = replaceLabeledMarkdownLine(localized, 'Baseline val_bpb', '基準 val_bpb')
      localized = replaceLabeledMarkdownLine(localized, 'Best keep val_bpb', '最佳保留 val_bpb')
      localized = replaceLabeledMarkdownLine(localized, 'Improvement delta', '改善幅度')
      localized = replaceLabeledMarkdownLine(localized, 'Peak memory', '記憶體峰值')
      localized = replaceLabeledMarkdownLine(localized, 'Underlying run exit code', '執行結束碼')
      localized = replaceLabeledMarkdownLine(localized, 'Best val_bpb', '最佳 val_bpb')
      localized = replaceLabeledMarkdownLine(localized, 'Planned reruns', '預定複驗次數')
      localized = replaceLabeledMarkdownLine(localized, 'Completed reruns', '實際完成複驗次數')
      localized = replaceLabeledMarkdownLine(localized, 'Revalidation verdict', '複驗判定', (value) => translateRevalidationVerdict(value, value))
      localized = replaceLabeledMarkdownLine(localized, 'Better than baseline', '比 baseline 更好的次數')
      localized = replaceLabeledMarkdownLine(localized, 'Mean val_bpb', '複驗平均 val_bpb')
      localized = replaceLabeledMarkdownLine(localized, 'Mean delta vs baseline', '複驗平均改善')
      localized = replaceLabeledMarkdownLine(localized, 'Gap from kept run', '和保留版本的平均差距')
      localized = replaceLabeledMarkdownLine(localized, 'val_bpb spread', '複驗波動幅度')
      localized = replaceLabeledMarkdownLine(localized, 'Mean peak memory', '複驗平均記憶體')
      localized = replaceLabeledMarkdownLine(localized, 'Mean throughput', '複驗平均吞吐量')
      localized = replaceLabeledMarkdownLine(localized, 'Mean steps/sec', '複驗平均 steps/sec')
      localized = replaceLabeledMarkdownLine(localized, 'Promotion ready', '是否可升格')
      localized = replaceLabeledMarkdownLine(localized, 'Skip reason', '跳過原因')

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

function cleanResearchFocusText(value) {
  if (!value) return ''
  return localizeSentence(
    String(value)
      .replace(/\r?\n+/g, ' ')
      .replace(/\*\*/g, '')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/^[\-\d.、\s]+/, '')
      .replace(/^這次會只碰/, '')
      .replace(/^目前先聚焦(?:在)?/, '')
      .replace(/^先把/, '')
      .replace(/這條線$/, '')
      .replace(/\s+/g, ' ')
      .trim(),
  )
}

function isGenericResearchTopic(value) {
  if (!value) return true
  const normalized = String(value).replace(/\s+/g, '')
  return (
    normalized.includes('最值得做成可持續進化能力的一個bottleneck')
    || normalized.includes('最值得持續進化的一個bottleneck')
    || normalized.includes('先找出一個最值得持續進化的瓶頸')
    || normalized.includes('先找出一個最值得先改善的問題')
    || normalized.includes('先讀懂這個程式')
  )
}

function defaultResearchPurpose(researchKind, targetLabel) {
  if (researchKind === 'program') {
    return `目的是先把「${targetLabel}」的用途、流程與風險讀清楚，讓後面改動有共同理解。`
  }
  if (researchKind === 'improve') {
    return `目的是先解掉「${targetLabel}」最影響流程的一個真問題，並驗證這次修改真的有效。`
  }
  if (researchKind === 'evolve') {
    return `目的是先把「${targetLabel}」最有複利的一個卡點修成下一輪更容易延續的能力。`
  }
  return '目的是先把這輪最值得處理的卡點說清楚，再持續往下推進。'
}

function extractResearchFocusFromSummary(summary) {
  if (!summary) return null
  const text = String(summary).replace(/\r?\n+/g, ' ').trim()
  const colonMatch = text.match(/^這次會只碰(.+?)(?:：|:)(.+)$/)
  if (colonMatch) {
    return {
      title: cleanResearchFocusText(colonMatch[1]),
      purpose: cleanResearchFocusText(colonMatch[2]),
    }
  }

  const lineMatch = text.match(/^這次會只碰(.+?)(?:，|。|$)/)
  if (lineMatch) {
    return {
      title: cleanResearchFocusText(lineMatch[1]),
      purpose: null,
    }
  }

  const focusMatch = text.match(/^我準備把這輪收斂成(?:一個)?(.+?)(?:：|:)(.+)$/)
  if (focusMatch) {
    return {
      title: cleanResearchFocusText(focusMatch[1]),
      purpose: cleanResearchFocusText(focusMatch[2]),
    }
  }

  return null
}

function buildResearchFocusCard({
  codexTrace,
  currentAction,
  improvementHeadline,
  researchKind,
  resolvedTopic,
  targetLabel,
}) {
  const fallbackPurpose = defaultResearchPurpose(researchKind, targetLabel)
  const summaries = Array.isArray(codexTrace)
    ? [...codexTrace].reverse().map((event) => event?.summary).filter(Boolean)
    : []

  for (const summary of summaries) {
    const extracted = extractResearchFocusFromSummary(summary)
    if (extracted?.title) {
      return {
        title: extracted.title,
        purpose: extracted.purpose || fallbackPurpose,
        action: currentAction,
      }
    }
  }

  if (improvementHeadline) {
    return {
      title: cleanResearchFocusText(improvementHeadline),
      purpose: fallbackPurpose,
      action: currentAction,
    }
  }

  if (resolvedTopic && !isGenericResearchTopic(resolvedTopic)) {
    return {
      title: cleanResearchFocusText(resolvedTopic),
      purpose: fallbackPurpose,
      action: currentAction,
    }
  }

  return {
    title: researchKind === 'evolve'
      ? '正在判斷這輪最值得延續的 bottleneck'
      : researchKind === 'improve'
        ? '正在判斷這輪最值得先修的問題'
        : '正在釐清這輪最值得先研究的主題',
    purpose: fallbackPurpose,
    action: currentAction,
  }
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
  const strategy = snapshot?.strategy || {}
  const repo = snapshot?.repo || {}
  const researchKind = strategy?.researchKind || control?.researchKind || repo?.researchKind || 'mlx'
  const currentLane = strategy?.currentLane || {}
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

  if (researchKind === 'program') {
    const targetLabel = repo?.activeWorkspaceLabel || control?.targetLabel || '未指定工作區'
    const topic = strategy?.userResearchTopic || control?.researchTopic || ''
    item = `正在研究「${targetLabel}」`
    goal = topic
      ? `這輪會圍繞「${topic}」讀懂系統在做什麼、主要流程怎麼走，以及接下來先做什麼。`
      : `這輪會先幫你讀懂「${targetLabel}」在做什麼、關鍵檔案在哪裡，以及接下來先做什麼。`
    next = '完成後會交出一份看得懂的摘要，包含系統用途、關鍵檔案、風險與建議下一步。'
    basis = control?.targetPath
      ? `目前研究目標是 ${control.targetPath}`
      : '這輪不是在跑模型分數，而是在讀程式、整理理解與建議。'
    return { item, goal, next, basis }
  }

  if (researchKind === 'improve') {
    const targetLabel = repo?.activeWorkspaceLabel || control?.targetLabel || '未指定工作區'
    const topic = strategy?.userResearchTopic || control?.researchTopic || ''
    item = `正在改善「${targetLabel}」`
    goal = topic
      ? `這輪會圍繞「${topic}」先找一個最值得先修的問題，實際改碼並跑驗證。`
      : `這輪會先替「${targetLabel}」找出一個最值得先修的問題，實際改碼並跑驗證。`
    next = '完成後會交出：鎖定的問題、實際改動、驗證結果，以及下一輪最值得接著做的 3 件事。'
    basis = control?.targetPath
      ? `目前改善目標是 ${control.targetPath}`
      : '這輪不是在跑模型分數，而是在指定工作區裡找問題、改碼並驗證。'
    return { item, goal, next, basis }
  }

  if (researchKind === 'evolve') {
    const targetLabel = repo?.activeWorkspaceLabel || control?.targetLabel || '未指定工作區'
    const topic = strategy?.userResearchTopic || control?.researchTopic || ''
    item = `正在進化「${targetLabel}」`
    goal = topic
      ? `這輪會圍繞「${topic}」先找一個最值得延續的進化瓶頸，實際改碼並跑驗證。`
      : `這輪會先替「${targetLabel}」找出一個最值得持續進化的瓶頸，實際改碼並跑驗證。`
    next = '完成後會交出：鎖定的進化瓶頸、實際改動、驗證結果，以及下一輪最值得延續的 3 條進化方向。'
    basis = control?.targetPath
      ? `目前進化目標是 ${control.targetPath}`
      : '這輪不是在跑模型分數，而是在指定工作區裡推進可持續延續的程式進化。'
    return { item, goal, next, basis }
  }

  if (currentLane?.label && (control?.isActive || live?.currentTask || live?.lastAction)) {
    item = `目前主跑「${currentLane.label}」`
    goal = currentLane.goal || goal
    next = strategy?.nextLane?.label
      ? `如果這條線停滯，下一步會切到「${strategy.nextLane.label}」再找新角度。`
      : next
    basis = currentLane.whyNow
      || strategy?.stableMemoryCallout
      || strategy?.cautionMemoryCallout
      || basis
  }

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

function buildLiveAction(snapshot, codexTrace = []) {
  const currentLane = snapshot?.strategy?.currentLane || {}
  const metrics = snapshot?.metrics || {}
  const repo = snapshot?.repo || {}
  const strategy = snapshot?.strategy || {}
  const control = snapshot?.control || {}
  const researchKind = strategy?.researchKind || control?.researchKind || repo?.researchKind || 'mlx'
  const latestRow = Array.isArray(metrics.history) && metrics.history.length ? metrics.history[metrics.history.length - 1] : null
  const activeEvent = [...codexTrace].reverse().find((event) => event?.status === 'in_progress')
  const latestEvent = activeEvent || [...codexTrace].reverse().find((event) => event?.summary)

  if (researchKind === 'program') {
    const targetLabel = repo?.activeWorkspaceLabel || control?.targetLabel || '未指定工作區'
    const topic = strategy?.userResearchTopic || control?.researchTopic || '先讀懂這個程式'
    return {
      lane: `程式研究：${targetLabel}`,
      goal: topic,
      currentAction: latestEvent ? humanizeEventSummary(latestEvent) : humanizeActionText(snapshot?.live?.currentTask || snapshot?.live?.lastAction),
      latestExperiment: '這輪不是在跑分數，而是在整理系統理解',
      latestDelta: '完成後會輸出：系統在做什麼、關鍵檔案、風險與下一步。',
    }
  }

  if (researchKind === 'improve') {
    const targetLabel = repo?.activeWorkspaceLabel || control?.targetLabel || '未指定工作區'
    const topic = strategy?.userResearchTopic || control?.researchTopic || '先找出一個最值得先改善的問題'
    return {
      lane: `程式改善：${targetLabel}`,
      goal: topic,
      currentAction: latestEvent ? humanizeEventSummary(latestEvent) : humanizeActionText(snapshot?.live?.currentTask || snapshot?.live?.lastAction),
      latestExperiment: snapshot?.highlights?.improvementHeadline || '這輪會先鎖定一個問題，再小範圍改碼',
      latestDelta: snapshot?.highlights?.verificationStatus
        ? `驗證狀態：${translateImprovementStatus(snapshot.highlights.verificationStatus)}`
        : '完成後會輸出：改到哪些檔案、怎麼驗證、哪些地方還需要再補。',
    }
  }

  if (researchKind === 'evolve') {
    const targetLabel = repo?.activeWorkspaceLabel || control?.targetLabel || '未指定工作區'
    const topic = strategy?.userResearchTopic || control?.researchTopic || '先找出一個最值得持續進化的瓶頸'
    return {
      lane: `程式進化：${targetLabel}`,
      goal: topic,
      currentAction: latestEvent ? humanizeEventSummary(latestEvent) : humanizeActionText(snapshot?.live?.currentTask || snapshot?.live?.lastAction),
      latestExperiment: snapshot?.highlights?.improvementHeadline || '這輪會先鎖定一個最值得延續的進化瓶頸，再小範圍改碼',
      latestDelta: snapshot?.highlights?.verificationStatus
        ? `驗證狀態：${translateImprovementStatus(snapshot.highlights.verificationStatus)}`
        : '完成後會輸出：改到哪些檔案、怎麼驗證，以及下一輪最值得延續的方向。',
    }
  }

  return {
    lane: currentLane.label || '待規劃',
    goal: currentLane.goal || '等待研究線目標寫入。',
    currentAction: latestEvent ? humanizeEventSummary(latestEvent) : humanizeActionText(snapshot?.live?.currentTask || snapshot?.live?.lastAction),
    latestExperiment: latestRow ? humanizeExperimentDescription(latestRow.description) : '尚未寫入新的實驗結果',
    latestDelta: formatDeltaVsBaseline(latestRow?.valBpb, metrics?.baselineValBpb),
  }
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
        {[max, min + range / 2, min].map((value, index) => {
          const y = index === 0 ? padding : index === 1 ? padding + (height - padding * 2) / 2 : height - padding
          return (
            <text
              key={`${value}-${index}`}
              x={padding}
              y={Math.max(y - 8, 12)}
              fill="rgba(148,163,184,0.75)"
              fontSize="11"
            >
              {value.toFixed(6)}
            </text>
          )
        })}
        <path d={fillPath} fill="url(#autoresearch-fill)" />
        <path d={path} fill="none" stroke="#00f5ff" strokeWidth="3" strokeLinecap="round" />
        {coords.map((point) => (
          <g key={`${point.commit}-${point.index}`}>
            <circle
              cx={point.x}
              cy={point.y}
              r="4"
              fill="#050508"
              stroke={point.description === 'baseline' ? '#00f5ff' : point.status === 'keep' ? '#39ff14' : '#ffb703'}
              strokeWidth="2"
            />
            <title>{`${humanizeExperimentDescription(point.description || point.commit)} · ${formatBpb(point.valBpb)}`}</title>
          </g>
        ))}
      </svg>
      <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-gray-400">
        <div className="rounded-full border border-cyan-500/20 bg-cyan-500/6 px-3 py-1 text-cyan-200">青色點：基準</div>
        <div className="rounded-full border border-emerald-500/20 bg-emerald-500/6 px-3 py-1 text-emerald-200">綠色點：目前保留</div>
        <div className="rounded-full border border-amber-500/20 bg-amber-500/6 px-3 py-1 text-amber-200">黃色點：試過但淘汰</div>
      </div>
      <div className="mt-3 flex flex-wrap gap-3 text-xs text-gray-400">
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

function ResultExplainTable({ history }) {
  const rows = history.filter((item) => typeof item.valBpb === 'number')
  const baseline = rows.find((item) => item.description === 'baseline')?.valBpb

  if (!rows.length) {
    return (
      <div className="rounded-[24px] border border-dashed border-cyan-500/20 bg-black/20 p-4 text-sm text-gray-400">
        還沒有足夠的結果可解釋。
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-[24px] border border-white/8 bg-black/20">
      <div className="grid grid-cols-[84px_1.6fr_110px_120px_90px] gap-3 border-b border-white/8 px-4 py-3 text-[11px] uppercase tracking-[0.18em] text-gray-500">
        <div>階段</div>
        <div>這次改了什麼</div>
        <div>成績</div>
        <div>和基準比</div>
        <div>判定</div>
      </div>
      {rows.map((row) => (
        <div
          key={`${row.commit}-${row.index}`}
          className="grid grid-cols-[84px_1.6fr_110px_120px_90px] gap-3 border-b border-white/6 px-4 py-3 text-sm last:border-b-0"
        >
          <div className="text-gray-400">{row.description === 'baseline' ? '基準' : `第 ${row.index - 1} 次`}</div>
          <div className="text-white">
            <div>{humanizeExperimentDescription(row.description || row.commit)}</div>
            <div className="mt-1 text-[12px] leading-6 text-gray-500">
              {explainExperimentOutcome(row, baseline)}
            </div>
          </div>
          <div className="font-semibold text-cyan-200">{formatBpb(row.valBpb)}</div>
          <div className="text-gray-200">{formatDeltaVsBaseline(row.valBpb, baseline)}</div>
          <div className={row.status === 'keep' ? 'text-emerald-300' : row.description === 'baseline' ? 'text-cyan-300' : 'text-amber-300'}>
            {row.description === 'baseline' ? '基準' : humanizeResultStatus(row.status)}
          </div>
        </div>
      ))}
    </div>
  )
}

function ArtifactPanel({ title, accent, path, content, sourceLabel, statusNote }) {
  return (
    <div className="glass-card rounded-[28px] p-5" style={{ borderColor: `${accent}44` }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs uppercase tracking-[0.22em]" style={{ color: accent }}>
          {title}
        </div>
        {sourceLabel ? (
          <div
            className="rounded-full border px-2.5 py-1 text-[11px]"
            style={{ borderColor: `${accent}30`, color: accent, background: `${accent}12` }}
          >
            {sourceLabel}
          </div>
        ) : null}
      </div>
      <div className="mt-2 truncate text-[11px] text-gray-500">{path || '尚未產生檔案'}</div>
      <div className="mt-3 rounded-[18px] border border-white/8 bg-black/20 px-4 py-3 text-xs leading-6 text-gray-400">
        {statusNote || '這一區會顯示完整檔案內容，方便直接看研究結論。'}
      </div>
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
  const [manualResearchKind, setManualResearchKind] = useState('mlx')
  const [manualWorkspacePreset, setManualWorkspacePreset] = useState('bw-copilot')
  const [manualTargetPath, setManualTargetPath] = useState('/Users/brian/.openclaw/openclaw-office')
  const [manualResearchTopic, setManualResearchTopic] = useState('')
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
    if (typeof window === 'undefined') return
    const saved = window.localStorage.getItem('autoresearch-manual-topic') || ''
    if (saved) setManualResearchTopic(saved)
    const savedKind = window.localStorage.getItem('autoresearch-manual-kind') || ''
    if (savedKind) setManualResearchKind(savedKind)
    const savedPreset = window.localStorage.getItem('autoresearch-manual-workspace-preset') || ''
    if (savedPreset) setManualWorkspacePreset(savedPreset)
    const savedTargetPath = window.localStorage.getItem('autoresearch-manual-target-path') || ''
    if (savedTargetPath) setManualTargetPath(savedTargetPath)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('autoresearch-manual-topic', manualResearchTopic)
  }, [manualResearchTopic])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('autoresearch-manual-kind', manualResearchKind)
  }, [manualResearchKind])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('autoresearch-manual-workspace-preset', manualWorkspacePreset)
  }, [manualWorkspacePreset])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('autoresearch-manual-target-path', manualTargetPath)
  }, [manualTargetPath])

  useEffect(() => {
    if (!snapshot?.control?.researchTopic) return
    setManualResearchTopic((current) => current || snapshot.control.researchTopic)
  }, [snapshot?.control?.researchTopic])

  useEffect(() => {
    if (!snapshot?.control?.researchKind) return
    if (snapshot?.control?.isActive) {
      setManualResearchKind(snapshot.control.researchKind)
      return
    }
    setManualResearchKind((current) => current || snapshot.control.researchKind)
  }, [snapshot?.control?.researchKind, snapshot?.control?.isActive])

  useEffect(() => {
    const targetPath = snapshot?.control?.targetPath || snapshot?.repo?.activeWorkspacePath
    if (!targetPath) return
    const preset = findWorkspacePresetByPath(targetPath)
    if (snapshot?.control?.isActive) {
      setManualWorkspacePreset(preset?.id || 'custom')
      setManualTargetPath(targetPath)
      return
    }
    setManualWorkspacePreset((current) => current || preset?.id || 'custom')
    setManualTargetPath((current) => current || targetPath)
  }, [snapshot?.control?.targetPath, snapshot?.repo?.activeWorkspacePath, snapshot?.control?.isActive])

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
          ? [
              `已送出${humanizeResearchKind(data.researchKind || extra.researchKind)}指令，這輪執行標記是 ${data.runTag || '新的手動研究批次'}。`,
              data.autoRoutedReason || null,
              data.continuationReason || null,
              data.continuationPreview ? `延續重點：${data.continuationPreview}` : null,
              data.codeMemoryReason || null,
              data.codeMemoryPreview ? `交付記憶：${data.codeMemoryPreview}` : null,
              data.readinessCandidateReason || null,
              data.readinessCandidateAgentId
                ? `readiness 候選：${[
                    data.readinessCandidateAgentId,
                    data.readinessCandidateBlockerLabel || data.readinessCandidateBlockerCode || data.readinessCandidateSummary,
                  ].filter(Boolean).join(' / ')}`
                : (data.readinessCandidatePreview ? `readiness 候選：${data.readinessCandidatePreview}` : null),
              data.readinessCandidateSource
                ? `訊號來源：${humanizeReadinessCandidateSource(data.readinessCandidateSource)} (${data.readinessCandidateSource})`
                : null,
              data.readinessCandidateNextStep ? `下一步：${data.readinessCandidateNextStep}` : null,
            ].filter(Boolean).join(' ')
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
    {
      label: '自動複驗',
      value: translateRevalidationVerdict(snapshot?.metrics?.revalidationVerdict),
      hint: typeof snapshot?.metrics?.revalidationMeanValBpb === 'number'
        ? `平均 val_bpb ${formatBpb(snapshot.metrics.revalidationMeanValBpb)}，波動 ${formatBpb(snapshot.metrics.revalidationSpread ?? 0)}。`
        : '有進入自動複驗時，這裡會顯示穩定度。',
      accent: '#c77dff',
      icon: CheckCircle2,
    },
  ]), [snapshot])

  const modelOptions = snapshot?.strategy?.availableModels || []
  const manualControl = snapshot?.manualControl || {}
  const runtime = snapshot?.control || {}
  const runtimeResearchKind = snapshot?.strategy?.researchKind || runtime?.researchKind || snapshot?.repo?.researchKind || 'mlx'
  const isProgramResearch = runtimeResearchKind === 'program'
  const isImproveResearch = runtimeResearchKind === 'improve'
  const isEvolveResearch = runtimeResearchKind === 'evolve'
  const isMutableCodeResearch = isImproveResearch || isEvolveResearch
  const isCodeResearch = isProgramResearch || isMutableCodeResearch
  const isManualCodeMode = manualResearchKind === 'program' || manualResearchKind === 'improve' || manualResearchKind === 'evolve'
  const codexTrace = useMemo(() => {
    if (runtimeResearchKind === 'program') {
      return snapshot?.artifacts?.programRun?.codexEvents || snapshot?.artifacts?.latestCompletedProgramRun?.codexEvents || []
    }
    if (runtimeResearchKind === 'improve') {
      return snapshot?.artifacts?.improveRun?.codexEvents || snapshot?.artifacts?.latestCompletedImproveRun?.codexEvents || []
    }
    if (runtimeResearchKind === 'evolve') {
      return snapshot?.artifacts?.evolveRun?.codexEvents || snapshot?.artifacts?.latestCompletedEvolveRun?.codexEvents || []
    }
    return snapshot?.artifacts?.codexRun?.codexEvents || snapshot?.artifacts?.latestCompletedCodexRun?.codexEvents || []
  }, [runtimeResearchKind, snapshot])
  const progressWidth = `${Math.min(Math.max(Number(runtime.progressPct || 0), 0), 100)}%`
  const softProgressWidth = `${Math.min(Math.max(Number(runtime.softProgressPct || 0), 0), 100)}%`
  const roundFocus = useMemo(() => buildRoundFocus(snapshot), [snapshot])
  const liveAction = useMemo(() => buildLiveAction(snapshot, codexTrace), [snapshot, codexTrace])
  const currentLane = snapshot?.strategy?.currentLane || {}
  const nextLane = snapshot?.strategy?.nextLane || {}
  const activeResearchTopic = snapshot?.strategy?.userResearchTopic || snapshot?.control?.researchTopic || ''
  const activeWorkspaceLabel = snapshot?.repo?.activeWorkspaceLabel || snapshot?.control?.targetLabel || 'AutoResearch MLX'
  const activeWorkspacePath = snapshot?.repo?.activeWorkspacePath || snapshot?.control?.targetPath || snapshot?.repo?.projectDir || ''
  const activeCodeRunArtifact = useMemo(() => {
    if (runtimeResearchKind === 'program') {
      return snapshot?.artifacts?.programRun || snapshot?.artifacts?.latestCompletedProgramRun || null
    }
    if (runtimeResearchKind === 'improve') {
      return snapshot?.artifacts?.improveRun || snapshot?.artifacts?.latestCompletedImproveRun || null
    }
    if (runtimeResearchKind === 'evolve') {
      return snapshot?.artifacts?.evolveRun || snapshot?.artifacts?.latestCompletedEvolveRun || null
    }
    return null
  }, [runtimeResearchKind, snapshot])
  const evolveStartupContext = activeCodeRunArtifact?.startupContext || null
  const evolveLoop = activeCodeRunArtifact?.manifest?.loop || evolveStartupContext?.loop || {}
  const effectiveRequestedResearchTopic = snapshot?.control?.requestedResearchTopic
    || evolveStartupContext?.requestedResearchTopic
    || activeResearchTopic
  const effectiveResolvedResearchTopic = snapshot?.control?.researchTopic
    || evolveStartupContext?.resolvedResearchTopic
    || activeResearchTopic
  const evolveReadinessCandidate = useMemo(() => ({
    agentId: snapshot?.control?.readinessCandidateAgentId || evolveStartupContext?.readinessCandidateAgentId || null,
    severity: snapshot?.control?.readinessCandidateSeverity || evolveStartupContext?.readinessCandidateSeverity || null,
    summary: snapshot?.control?.readinessCandidateSummary || evolveStartupContext?.readinessCandidateSummary || null,
    blockerCode: snapshot?.control?.readinessCandidateBlockerCode || evolveStartupContext?.readinessCandidateBlockerCode || null,
    blockerLabel: snapshot?.control?.readinessCandidateBlockerLabel || evolveStartupContext?.readinessCandidateBlockerLabel || null,
    nextStep: snapshot?.control?.readinessCandidateNextStep || evolveStartupContext?.readinessCandidateNextStep || null,
    preview: snapshot?.control?.readinessCandidatePreview || evolveStartupContext?.readinessCandidatePreview || null,
    source: snapshot?.control?.readinessCandidateSource || evolveStartupContext?.readinessCandidateSource || null,
    reason: snapshot?.control?.readinessCandidateReason || evolveStartupContext?.readinessCandidateReason || null,
  }), [evolveStartupContext, snapshot?.control])
  const hasSpecificResearchTopic = Boolean(activeResearchTopic) && !isGenericResearchTopic(activeResearchTopic)
  const researchFocusCard = useMemo(() => buildResearchFocusCard({
    codexTrace,
    currentAction: liveAction.currentAction,
    improvementHeadline: snapshot?.highlights?.improvementHeadline,
    researchKind: runtimeResearchKind,
    resolvedTopic: effectiveResolvedResearchTopic,
    targetLabel: activeWorkspaceLabel,
  }), [
    activeWorkspaceLabel,
    codexTrace,
    effectiveResolvedResearchTopic,
    liveAction.currentAction,
    runtimeResearchKind,
    snapshot?.highlights?.improvementHeadline,
  ])
  const searchSpace = snapshot?.strategy?.searchSpace || { lanes: [], allowedFiles: [], orchestration: {} }
  const researchMemory = snapshot?.strategy?.researchMemory || { recommendedPatterns: [], avoidPatterns: [], entryCount: 0 }
  const codeDeliveryMemory = snapshot?.strategy?.codeDeliveryMemory || {
    verifiedPatterns: [],
    avoidPatterns: [],
    recentNextSteps: [],
    entryCount: 0,
    passCount: 0,
    passRate: null,
    updatedAt: null,
  }
  const fleetReadinessCandidates = snapshot?.strategy?.fleetReadinessCandidates || {
    entryCount: 0,
    candidates: [],
    topCandidate: null,
    updatedAt: null,
  }
  const selectedWorkspacePreset = useMemo(
    () => PROGRAM_WORKSPACE_OPTIONS.find((option) => option.id === manualWorkspacePreset) || PROGRAM_WORKSPACE_OPTIONS[1],
    [manualWorkspacePreset],
  )
  const manualTargetPathResolved = isManualCodeMode
    ? (manualWorkspacePreset === 'custom' ? manualTargetPath.trim() : (selectedWorkspacePreset?.path || ''))
    : ''
  const manualTargetLabelResolved = isManualCodeMode
    ? (manualWorkspacePreset === 'custom'
        ? (manualTargetPath.trim() || '自訂工作區路徑')
        : (selectedWorkspacePreset?.label || '指定工作區'))
    : null
  const effectiveResearchTopic = isManualCodeMode
    ? (
      manualResearchTopic.trim()
      || resolveDefaultResearchTopic(manualResearchKind, selectedWorkspacePreset)
      || ''
    )
    : manualResearchTopic
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
  const manualTargetValid = !isManualCodeMode || Boolean(manualTargetPathResolved)
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
  const improveChangedFiles = Array.isArray(snapshot?.highlights?.changedFiles) ? snapshot.highlights.changedFiles : []
  const improveVerificationItems = Array.isArray(snapshot?.highlights?.verificationItems) ? snapshot.highlights.verificationItems : []
  const improveNextSteps = Array.isArray(snapshot?.highlights?.improvementNextSteps) ? snapshot.highlights.improvementNextSteps : []
  const manualTopicPlaceholder = (() => {
    if (manualResearchKind === 'program') {
      return '例如：請幫我研究 BW Copilot 的 /research 頁面架構、資料流和目前最值得先改的地方。'
    }
    if (manualResearchKind === 'improve') {
      return '例如：請先修 AutoPen 最影響 SEO 的一個問題，直接改碼並驗證結果。'
    }
    if (manualResearchKind === 'evolve') {
      return '例如：請先找出 AutoPen 最值得做成持續進化能力的一個 bottleneck，直接改碼、驗證效果，並整理下一輪延續方向。'
    }
    return '例如：我想優先研究 warmdown / final lr 的搭配，看看固定 5 分鐘預算下能不能再把 val_bpb 壓低。'
  })()
  const manualTopicHint = (() => {
    if (manualResearchKind === 'program') {
      return `你填的主題會直接告訴研究代理人「這輪最想先看懂什麼」；留白時會自動帶入目前對象的預設方向${selectedWorkspacePreset?.defaultTopic ? `：「${selectedWorkspacePreset.defaultTopic}」` : '，沒有預設時就先從整體架構開始整理'}。`
    }
    if (manualResearchKind === 'improve') {
      return `你填的主題會直接變成這輪想先修的問題；留白時會自動帶入目前對象的預設改善方向${selectedWorkspacePreset?.defaultImproveTopic ? `：「${selectedWorkspacePreset.defaultImproveTopic}」` : '，沒有預設時就先從最卡的一個問題開始找'}。`
    }
    if (manualResearchKind === 'evolve') {
      return `你填的主題會直接變成這輪想先推進的進化瓶頸；留白時會自動帶入目前對象的預設進化方向${selectedWorkspacePreset?.defaultEvolveTopic ? `：「${selectedWorkspacePreset.defaultEvolveTopic}」` : '，沒有預設時就先從最有複利效果的一個 bottleneck 開始找'}。`
    }
    return '你填的主題會直接送進 strategy planner 和 Codex prompt，讓這輪更偏向你指定的方向；留白則照系統自己的研究線安排。'
  })()
  const manualRuntimeHint = (() => {
    if (manualResearchKind === 'program') {
      return `下一次手動研究會使用：建議停止 ${formatMinuteValue(manualSoftMinutes)} / 最晚強制停止 ${formatMinuteValue(manualHardMinutes)} / 最多整理 ${manualMaxExperiments || '待設定'} 個重點方向。`
    }
    if (manualResearchKind === 'improve') {
      return `下一次手動改善會使用：建議停止 ${formatMinuteValue(manualSoftMinutes)} / 最晚強制停止 ${formatMinuteValue(manualHardMinutes)} / 最多嘗試 ${manualMaxExperiments || '待設定'} 個改善步驟。`
    }
    if (manualResearchKind === 'evolve') {
      return `下一次手動進化會使用：建議停止 ${formatMinuteValue(manualSoftMinutes)} / 最晚強制停止 ${formatMinuteValue(manualHardMinutes)} / 最多嘗試 ${manualMaxExperiments || '待設定'} 個進化步驟。`
    }
    return `下一次手動啟動會使用：建議停止 ${formatMinuteValue(manualSoftMinutes)} / 最晚強制停止 ${formatMinuteValue(manualHardMinutes)} / 最多 ${manualMaxExperiments || '待設定'} 次實驗。`
  })()
  const manualTargetWarning = manualResearchKind === 'evolve'
    ? '程式進化模式需要先指定一個存在的工作區路徑。'
    : (manualResearchKind === 'improve'
        ? '程式改善模式需要先指定一個存在的工作區路徑。'
        : '程式研究模式需要先指定一個存在的工作區路徑。')
  const runtimeExecutionHint = (() => {
    if (isProgramResearch) {
      return `目前這輪實際使用的是：建議停止 ${formatMinuteValue(runtime.softMinutes, '待更新')} / 最晚強制停止 ${formatMinuteValue(runtime.hardMinutes, '待更新')} / 最多整理 ${runtime.maxExperiments || '待更新'} 個重點方向。`
    }
    if (isImproveResearch) {
      return `目前這輪實際使用的是：建議停止 ${formatMinuteValue(runtime.softMinutes, '待更新')} / 最晚強制停止 ${formatMinuteValue(runtime.hardMinutes, '待更新')} / 最多嘗試 ${runtime.maxExperiments || '待更新'} 個改善步驟。`
    }
    if (isEvolveResearch) {
      return `目前這輪實際使用的是：建議停止 ${formatMinuteValue(runtime.softMinutes, '待更新')} / 最晚強制停止 ${formatMinuteValue(runtime.hardMinutes, '待更新')} / 最多嘗試 ${runtime.maxExperiments || '待更新'} 個進化步驟。`
    }
    return `目前這輪實際使用的是：建議停止 ${formatMinuteValue(runtime.softMinutes, '待更新')} / 最晚強制停止 ${formatMinuteValue(runtime.hardMinutes, '待更新')} / 最多 ${runtime.maxExperiments || '待更新'} 次實驗。`
  })()
  const currentLaneTitle = isProgramResearch
    ? '現在這輪在研究什麼'
    : (isImproveResearch
        ? '現在這輪在改善什麼'
        : (isEvolveResearch ? '現在這輪在進化什麼' : '現在這輪在優化什麼'))
  const outputSectionTitle = isProgramResearch
    ? '程式研究輸出'
    : (isImproveResearch
        ? '程式改善紀錄'
        : (isEvolveResearch ? '程式進化紀錄' : '實驗軌跡'))
  const outputSectionDescription = (() => {
    if (isProgramResearch) {
      return '這輪不是在跑實驗曲線，而是會整理成一份看得懂的程式研究輸出：它在做什麼、關鍵檔案在哪裡、流程怎麼走，以及接下來先做什麼。'
    }
    if (isImproveResearch) {
      return '這裡會直接告訴你：這輪先修哪個問題、實際改了哪些檔案、做了哪些驗證，以及接下來還要再補什麼。'
    }
    if (isEvolveResearch) {
      return '這裡會直接告訴你：這輪先推進哪個進化瓶頸、實際改了哪些檔案、做了哪些驗證，以及下一輪還能怎麼沿著這個方向繼續演化。'
    }
    return '這裡把每一次實驗都翻成看得懂的說明。圖上每一個點都是一輪實驗成績，下面表格則直接告訴你「改了什麼」、「分數變多少」以及「這個數字代表什麼」。'
  })()
  const summaryPanelTitle = isImproveResearch ? '改善摘要' : (isEvolveResearch ? '進化摘要' : '研究摘要')
  const knowledgeSourceHint = isImproveResearch
    ? '這輪會把改善結果寫進摘要、QA、後續確認與記憶交接，讓下一輪能接著往前推。'
    : (isEvolveResearch
        ? '這輪會把進化結果寫進摘要、QA、後續確認與記憶交接，讓下一輪可以沿著同一條高槓桿方向持續延續。'
        : '這輪會把研究理解整理成摘要、閱讀重點與後續確認，讓下一輪不必從頭摸索。')

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-4 py-6 md:py-8">
      <div className="space-y-8">
        <motion.section
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card rounded-[32px] p-5 md:p-7"
        >
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-4xl">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-cyan-500/25 bg-cyan-500/8 px-4 py-2 text-xs uppercase tracking-[0.22em] text-cyan-300">
                <FlaskConical className="h-3.5 w-3.5" />
                AutoResearch 控制台
              </div>
              <h1 className="font-display text-4xl leading-tight text-white md:text-5xl">
                看懂這輪正在改什麼，
                <span className="block text-cyan-300">以及數字到底代表什麼。</span>
              </h1>
              <p className="mt-5 max-w-3xl text-sm leading-7 text-gray-400 md:text-base">
                這頁不是只把檔案搬上來，而是把研究狀態翻成一般人看得懂的語言。你可以直接看到目前在優化哪一塊、最新試了什麼、分數變好還是變差，以及這些數字對你代表什麼。
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

        {snapshot ? (
          <section className="sticky top-[76px] z-20">
            <div className="grid gap-3 rounded-[26px] border border-cyan-500/20 bg-black/75 p-4 shadow-[0_20px_80px_rgba(0,245,255,0.08)] backdrop-blur-xl lg:grid-cols-[1.1fr_1.3fr_0.9fr_0.9fr]">
              <div className="rounded-[20px] border border-cyan-500/15 bg-cyan-500/6 px-4 py-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-cyan-300">現在主跑</div>
                <div className="mt-2 text-lg font-semibold text-white">{liveAction.lane}</div>
                <div className="mt-2 text-xs leading-6 text-gray-400">{liveAction.goal}</div>
                {hasSpecificResearchTopic ? (
                  <div className="mt-2 text-xs leading-6 text-cyan-100/90">你指定的研究主題：{activeResearchTopic}</div>
                ) : null}
              </div>
              <div className="rounded-[20px] border border-emerald-500/15 bg-emerald-500/6 px-4 py-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-300">目前鎖定 bottleneck</div>
                <div className="mt-2 text-lg font-semibold leading-8 text-white">{researchFocusCard.title}</div>
                <div className="mt-2 text-xs leading-6 text-emerald-100/90">{researchFocusCard.purpose}</div>
                <div className="mt-2 text-xs leading-6 text-gray-400">目前動作：{researchFocusCard.action}</div>
              </div>
              <div className="rounded-[20px] border border-amber-500/15 bg-amber-500/6 px-4 py-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-amber-300">
                  {isCodeResearch ? '研究目標工作區' : '目前最佳成績'}
                </div>
                <div className="mt-2 text-xl font-semibold text-white">
                  {isCodeResearch ? activeWorkspaceLabel : formatBpb(snapshot?.metrics?.bestKeepValBpb ?? snapshot?.metrics?.baselineValBpb)}
                </div>
                <div className="mt-2 text-xs leading-6 text-gray-400">
                  {isCodeResearch
                    ? activeWorkspacePath
                    : '`val_bpb` 越低越好，代表模型預測更準。'}
                </div>
              </div>
                <div className="rounded-[20px] border border-white/10 bg-white/5 px-4 py-3">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-gray-400">
                  {isProgramResearch ? '這輪會交付什麼' : (isMutableCodeResearch ? `這輪最新${isEvolveResearch ? '進化' : '改善'}` : '最新一筆結果')}
                  </div>
                  <div className="mt-2 text-sm font-semibold text-white">{liveAction.latestExperiment}</div>
                  <div className="mt-2 text-xs leading-6 text-gray-400">{liveAction.latestDelta}</div>
                </div>
            </div>
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

                <div className="mt-5 rounded-[24px] border border-cyan-500/18 bg-black/20 p-4">
                  <div className="text-sm font-semibold text-white">這輪要怎麼研究</div>
                  <div className="mt-1 text-xs leading-6 text-gray-400">
                    想看懂程式就用「程式研究」；想真的改碼、驗證，就用「程式改善」；想留下可持續延續的高槓桿變化，就用「程式進化」。
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    {RESEARCH_KIND_OPTIONS.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => setManualResearchKind(option.id)}
                        className={`rounded-2xl border px-4 py-4 text-left transition ${
                          manualResearchKind === option.id ? (PRESET_TONE[option.accent] || PRESET_TONE.cyan) : 'border-white/10 bg-black/20 text-gray-300 hover:border-white/20'
                        }`}
                      >
                        <div className="text-sm font-semibold">{option.title}</div>
                        <div className="mt-1 text-xs leading-6 text-gray-400">{option.description}</div>
                      </button>
                    ))}
                  </div>

                  {isManualCodeMode ? (
                    <div className="mt-4 grid gap-3">
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.18em] text-gray-500">
                          {manualResearchKind === 'program' ? '快速鎖定研究對象' : `快速鎖定${humanizeManualAction(manualResearchKind)}對象`}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {PROGRAM_WORKSPACE_OPTIONS.filter((option) =>
                            option.id === 'openclaw-agents'
                            || option.id === 'autopen'
                            || option.id === 'contentforge'
                            || option.id === 'bw-copilot'
                          ).map((option) => (
                            <button
                              key={option.id}
                              type="button"
                              onClick={() => {
                                setManualWorkspacePreset(option.id)
                                if (option.path) setManualTargetPath(option.path)
                              }}
                              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                                manualWorkspacePreset === option.id
                                  ? 'border-cyan-400/40 bg-cyan-500/12 text-cyan-200'
                                  : 'border-white/10 bg-black/20 text-gray-300 hover:border-white/20'
                              }`}
                            >
                              只看 {option.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <label className="block">
                        <div className="text-[11px] uppercase tracking-[0.18em] text-gray-500">
                          {manualResearchKind === 'program' ? '研究哪個程式' : `${humanizeManualAction(manualResearchKind)}哪個程式`}
                        </div>
                        <select
                          value={manualWorkspacePreset}
                          onChange={(event) => {
                            const nextPreset = event.target.value
                            setManualWorkspacePreset(nextPreset)
                            const preset = PROGRAM_WORKSPACE_OPTIONS.find((option) => option.id === nextPreset)
                            if (preset?.path) {
                              setManualTargetPath(preset.path)
                            }
                          }}
                          className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none"
                        >
                          {PROGRAM_WORKSPACE_OPTIONS.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>

                      {manualWorkspacePreset === 'custom' ? (
                        <label className="block">
                          <div className="text-[11px] uppercase tracking-[0.18em] text-gray-500">自訂工作區路徑</div>
                          <input
                            type="text"
                            value={manualTargetPath}
                            onChange={(event) => setManualTargetPath(event.target.value)}
                            placeholder="/Users/brian/你的專案"
                            className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none"
                          />
                        </label>
                      ) : null}

                      <div className="rounded-[18px] border border-emerald-500/15 bg-emerald-500/6 px-4 py-3 text-xs leading-6 text-gray-300">
                        目前會{humanizeManualAction(manualResearchKind)}：<span className="text-white">{manualTargetLabelResolved || '待指定'}</span>
                        <br />
                        路徑：<span className="text-white break-all">{manualTargetPathResolved || '待指定'}</span>
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="mt-5 flex flex-wrap gap-3">
                  <PrimaryButton
                    icon={Play}
                    label={manualResearchKind === 'program' ? '開始研究' : `開始${humanizeManualAction(manualResearchKind)}`}
                    busy={controlBusy === 'start'}
                    disabled={runtime.isActive || !manualConfigValid || !manualTargetValid}
                    onClick={() => triggerControlAction('start', {
                      softMinutes: manualSoftMinutes,
                      hardMinutes: manualHardMinutes,
                      maxExperiments: manualMaxExperiments,
                      researchKind: manualResearchKind,
                      researchTopic: effectiveResearchTopic,
                      targetPath: isManualCodeMode ? manualTargetPathResolved : undefined,
                      targetLabel: isManualCodeMode ? manualTargetLabelResolved : undefined,
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
                        手動研究現在也可以直接選到夜跑 8 小時規格。這裡是你這輪要採用的預設值。
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

                  <label className="mt-4 block">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-gray-500">這輪想研究什麼</div>
                    <textarea
                      value={manualResearchTopic}
                      onChange={(event) => setManualResearchTopic(event.target.value)}
                      rows={3}
                      placeholder={manualTopicPlaceholder}
                      className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm leading-7 text-white outline-none"
                    />
                    <div className="mt-2 text-xs leading-6 text-gray-500">{manualTopicHint}</div>
                  </label>

                  <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {MANUAL_PRESET_OPTIONS.map((preset) => (
                      <button
                        key={preset.key}
                        type="button"
                        onClick={() => setManualDraft(preset.values)}
                        className={`rounded-2xl border px-4 py-3 text-left transition ${PRESET_TONE[preset.accent] || PRESET_TONE.cyan}`}
                      >
                        <div className="text-sm font-semibold">{preset.title}</div>
                        <div className="mt-1 text-xs leading-6 text-gray-400">{preset.description}</div>
                      </button>
                    ))}
                  </div>

                  <div className="mt-4 text-xs leading-6 text-gray-500">{manualRuntimeHint}</div>
                  {manualControl.autoAdjustedReason ? (
                    <div className="mt-2 rounded-2xl border border-cyan-500/20 bg-cyan-500/8 px-4 py-3 text-xs leading-6 text-cyan-100">
                      自動上調提示：{manualControl.autoAdjustedReason}
                    </div>
                  ) : null}
                  {!manualConfigValid ? (
                    <div className="mt-2 text-xs leading-6 text-amber-200">
                      手動設定需要符合：建議停止至少 15 分鐘、最晚強制停止不能小於建議停止、實驗上限至少 1 次。
                    </div>
                  ) : null}
                  {!manualTargetValid ? (
                    <div className="mt-2 text-xs leading-6 text-amber-200">
                      {manualTargetWarning}
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
                      <div className="text-[11px] uppercase tracking-[0.18em] text-gray-500">
                        {isCodeResearch ? '研究 / 改善 / 進化上限' : '實驗上限'}
                      </div>
                      <div className="mt-2 text-sm text-white">{runtime.maxExperiments ? `${runtime.maxExperiments} ${isCodeResearch ? '項' : '次'}` : '待下一輪開始'}</div>
                    </div>
                  </div>
                  <div className="mt-4 text-xs leading-6 text-gray-500">{runtimeExecutionHint}</div>
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
                  <BrainCircuit className="h-4 w-4" />
                  研究看板
                </div>
                <div className="mt-4 space-y-4">
                  <div className="rounded-[22px] border border-cyan-500/15 bg-black/25 px-4 py-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-cyan-300">你指定的研究主題</div>
                    <div className="mt-2 text-sm leading-7 text-white">
                      {activeResearchTopic || '這輪沒有額外指定主題，系統會照目前研究線與研究記憶自動安排。'}
                    </div>
                  </div>
                  <div className="rounded-[22px] border border-green-500/15 bg-black/25 px-4 py-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-green-300">
                      {currentLaneTitle}
                    </div>
                    <div className="mt-2 text-sm leading-7 text-white">{currentLane.goal || '這輪還沒寫入研究線目標。'}</div>
                    <div className="mt-2 text-xs leading-6 text-gray-400">{currentLane.whyNow || snapshot.strategy.planSummary || '等待策略器補上這輪的說明。'}</div>
                  </div>
                  <div className="rounded-[22px] border border-cyan-500/15 bg-black/25 px-4 py-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-cyan-300">
                      {isProgramResearch ? '這輪會交付什麼' : (isMutableCodeResearch ? '這輪會留下什麼' : '目前重點觀察')}
                    </div>
                    <div className="mt-2 space-y-2 text-sm leading-7 text-gray-300">
                      {isProgramResearch ? (
                        <>
                          <div>研究對象：<span className="text-white">{activeWorkspaceLabel}</span></div>
                          <div>會交付：<span className="text-white">系統用途、關鍵檔案、主要流程、風險與下一步</span></div>
                          <div>下一輪建議：<span className="text-white">{nextLane.label || '待規劃'}</span></div>
                        </>
                      ) : isImproveResearch ? (
                        <>
                          <div>改善對象：<span className="text-white">{activeWorkspaceLabel}</span></div>
                          <div>會留下：<span className="text-white">鎖定問題、改動檔案、驗證結果、下一步</span></div>
                          <div>下一輪建議：<span className="text-white">{nextLane.label || '待規劃'}</span></div>
                        </>
                      ) : isEvolveResearch ? (
                        <>
                          <div>進化對象：<span className="text-white">{activeWorkspaceLabel}</span></div>
                          <div>會留下：<span className="text-white">進化瓶頸、改動檔案、驗證結果、下一輪可延續方向</span></div>
                          <div>下一輪建議：<span className="text-white">{nextLane.label || '待規劃'}</span></div>
                        </>
                      ) : (
                        <>
                          <div>先看：<span className="text-white">{joinHumanList(currentLane.focus)}</span></div>
                          <div>先避開：<span className="text-white">{joinHumanList(currentLane.avoid)}</span></div>
                          <div>下一條備選：<span className="text-white">{nextLane.label || '待規劃'}</span></div>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="rounded-[22px] border border-white/8 bg-black/25 px-4 py-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-gray-400">數字怎麼看</div>
                    <div className="mt-2 space-y-2 text-sm leading-7 text-gray-300">
                      {isProgramResearch ? (
                        <>
                          <div><span className="text-white">這輪沒有 val_bpb</span>：因為它不是在跑模型分數，而是在讀程式。</div>
                          <div><span className="text-white">研究摘要</span>：是這輪最重要的輸出，會告訴你系統在做什麼。</div>
                          <div><span className="text-white">閱讀重點</span>：會補充這份摘要要怎麼看、先從哪裡開始理解。</div>
                          <div><span className="text-white">後續確認</span>：會告訴你下一輪應該把問題縮到哪個流程或模組。</div>
                        </>
                      ) : isImproveResearch ? (
                        <>
                          <div><span className="text-white">改動檔案數</span>：這輪真的動到幾個檔案，不是只講建議。</div>
                          <div><span className="text-white">驗證狀態</span>：代表 build / test / 操作驗證到底有沒有過。</div>
                          <div><span className="text-white">鎖定問題</span>：這輪先修哪個痛點，避免一次改太散。</div>
                          <div><span className="text-white">下一步</span>：代表這次修完後，最值得延伸的下一個改善方向。</div>
                        </>
                      ) : isEvolveResearch ? (
                        <>
                          <div><span className="text-white">進化瓶頸</span>：這輪先挑哪個最值得持續延續的 bottleneck。</div>
                          <div><span className="text-white">改動檔案數</span>：這輪真的動到幾個檔案，不是只講願景。</div>
                          <div><span className="text-white">驗證狀態</span>：代表 build / test / 操作驗證到底有沒有過。</div>
                          <div><span className="text-white">下一輪可延續方向</span>：代表這次進化後，最值得沿著哪條線繼續推進。</div>
                        </>
                      ) : (
                        <>
                          <div><span className="text-white">val_bpb</span>：這是主要成績，越低越好。</div>
                          <div><span className="text-white">改善幅度</span>：目前最佳版本比基準好多少。</div>
                          <div><span className="text-white">記憶體 GB</span>：這輪最高吃掉多少記憶體。</div>
                          <div><span className="text-white">保留 / 淘汰</span>：代表這次改法有沒有真的留下來。</div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              {isProgramResearch ? (
                <>
                  <MetricCard
                    label="研究模式"
                    value={humanizeResearchKind(runtimeResearchKind)}
                    hint="這輪不是跑模型分數，而是在讀程式、整理理解與建議。"
                    accent="#00f5ff"
                    icon={BrainCircuit}
                  />
                  <MetricCard
                    label="研究目標"
                    value={activeWorkspaceLabel}
                    hint={activeWorkspacePath || '待指定工作區'}
                    accent="#39ff14"
                    icon={GitBranch}
                  />
                  <MetricCard
                    label="這輪主題"
                    value={activeResearchTopic || '先從整體架構開始'}
                    hint="你可以直接指定：要研究哪個流程、頁面、模組或問題。"
                    accent="#ffb703"
                    icon={FlaskConical}
                  />
                  <MetricCard
                    label="目前狀態"
                    value={humanizeControlStatus(runtime.status)}
                    hint={humanizeRuntimeNote(runtime.note) || '等待這輪研究進一步更新。'}
                    accent="#ff6b35"
                    icon={ShieldCheck}
                  />
                  <MetricCard
                    label="下一步"
                    value={nextLane.label || '待規劃'}
                    hint={nextLane.goal || '下一輪可以把問題縮小到單一流程或單一模組。'}
                    accent="#c77dff"
                    icon={CheckCircle2}
                  />
                </>
              ) : isImproveResearch ? (
                <>
                  <MetricCard
                    label="改善模式"
                    value={humanizeResearchKind(runtimeResearchKind)}
                    hint="這輪會先鎖定一個問題，實際改程式並跑驗證。"
                    accent="#00f5ff"
                    icon={BrainCircuit}
                  />
                  <MetricCard
                    label="改善目標"
                    value={activeWorkspaceLabel}
                    hint={activeWorkspacePath || '待指定工作區'}
                    accent="#39ff14"
                    icon={GitBranch}
                  />
                  <MetricCard
                    label="改動檔案數"
                    value={String(snapshot?.metrics?.changedFilesCount || 0)}
                    hint={snapshot?.highlights?.improvementProblem || '這輪會把改動集中在少數高槓桿檔案。'}
                    accent="#ffb703"
                    icon={FlaskConical}
                  />
                  <MetricCard
                    label="驗證狀態"
                    value={translateImprovementStatus(snapshot?.metrics?.verificationStatus)}
                    hint={improveVerificationItems[0]?.summary || '完成後會顯示這輪驗證是否通過。'}
                    accent="#ff6b35"
                    icon={ShieldCheck}
                  />
                  <MetricCard
                    label="下一步"
                    value={improveNextSteps[0] || nextLane.label || '待規劃'}
                    hint={nextLane.goal || '會沿著這次改善結果，挑下一個最值得先修的點。'}
                    accent="#c77dff"
                    icon={CheckCircle2}
                  />
                </>
              ) : isEvolveResearch ? (
                <>
                  <MetricCard
                    label="進化模式"
                    value={humanizeResearchKind(runtimeResearchKind)}
                    hint="這輪會先鎖定一個最值得持續進化的 bottleneck，實際改程式並跑驗證。"
                    accent="#00f5ff"
                    icon={BrainCircuit}
                  />
                  <MetricCard
                    label="進化目標"
                    value={activeWorkspaceLabel}
                    hint={activeWorkspacePath || '待指定工作區'}
                    accent="#39ff14"
                    icon={GitBranch}
                  />
                  <MetricCard
                    label="改動檔案數"
                    value={String(snapshot?.metrics?.changedFilesCount || 0)}
                    hint={snapshot?.highlights?.improvementProblem || '這輪會把進化改動集中在少數高槓桿檔案。'}
                    accent="#ffb703"
                    icon={FlaskConical}
                  />
                  <MetricCard
                    label="驗證狀態"
                    value={translateImprovementStatus(snapshot?.metrics?.verificationStatus)}
                    hint={improveVerificationItems[0]?.summary || '完成後會顯示這輪驗證是否通過。'}
                    accent="#ff6b35"
                    icon={ShieldCheck}
                  />
                  <MetricCard
                    label="下一輪"
                    value={improveNextSteps[0] || nextLane.label || '待規劃'}
                    hint={nextLane.goal || '會沿著這次進化結果，挑下一個最值得延續的高槓桿瓶頸。'}
                    accent="#c77dff"
                    icon={CheckCircle2}
                  />
                </>
              ) : (
                metrics.map((metric) => (
                  <MetricCard key={metric.label} {...metric} />
                ))
              )}
            </section>

            <section className="grid gap-4 xl:grid-cols-[1.4fr_0.6fr]">
              <div className="glass-card rounded-[28px] p-6">
                <div className="flex items-center gap-2 text-sm uppercase tracking-[0.18em] text-cyan-300">
                  <Activity className="h-4 w-4" />
                  {outputSectionTitle}
                </div>
                <div className="mt-3 text-sm leading-7 text-gray-400">{outputSectionDescription}</div>
                {isProgramResearch ? (
                  <div className="mt-5 grid gap-3 md:grid-cols-2">
                    <div className="rounded-[22px] border border-cyan-500/15 bg-cyan-500/6 px-4 py-4">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-cyan-300">這輪會回答你什麼</div>
                      <div className="mt-2 text-sm leading-7 text-white">系統在做什麼、你指定主題相關的流程、哪些檔案最重要。</div>
                    </div>
                    <div className="rounded-[22px] border border-emerald-500/15 bg-emerald-500/6 px-4 py-4">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-300">你最後會拿到什麼</div>
                      <div className="mt-2 text-sm leading-7 text-white">一份摘要、一份閱讀重點，以及下一輪更值得追的問題。</div>
                    </div>
                    <div className="rounded-[22px] border border-amber-500/15 bg-amber-500/6 px-4 py-4 md:col-span-2">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-amber-300">這輪不是在做什麼</div>
                      <div className="mt-2 text-sm leading-7 text-white">不會直接改你的原始碼，也不會用 val_bpb 這種模型分數來假裝有在研究你的程式。</div>
                    </div>
                  </div>
                ) : isImproveResearch ? (
                  <div className="mt-5 grid gap-3">
                    <div className="rounded-[22px] border border-amber-500/15 bg-amber-500/6 px-4 py-4">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-amber-300">這輪鎖定的問題</div>
                      <div className="mt-2 text-sm leading-7 text-white">
                        {snapshot?.highlights?.improvementProblem || '這輪還沒把問題摘要寫出來，等摘要收尾後會顯示在這裡。'}
                      </div>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-[22px] border border-cyan-500/15 bg-cyan-500/6 px-4 py-4">
                        <div className="text-[11px] uppercase tracking-[0.18em] text-cyan-300">這次實際改了哪些檔案</div>
                        <div className="mt-2 space-y-2 text-sm leading-7 text-gray-200">
                          {improveChangedFiles.length ? improveChangedFiles.map((item) => (
                            <div key={`${item.path}-${item.summary || 'change'}`} className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3">
                              <div className="font-semibold text-white">{item.path || '未提供路徑'}</div>
                              <div className="mt-1 text-xs leading-6 text-gray-400">{item.summary || '這個檔案有修改，但摘要尚未補上。'}</div>
                            </div>
                          )) : (
                            <div>這輪還沒寫出改動清單，完成後會把實際動到的檔案列在這裡。</div>
                          )}
                        </div>
                      </div>
                      <div className="rounded-[22px] border border-emerald-500/15 bg-emerald-500/6 px-4 py-4">
                        <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-300">這次怎麼驗證</div>
                        <div className="mt-2 space-y-2 text-sm leading-7 text-gray-200">
                          {improveVerificationItems.length ? improveVerificationItems.map((item, index) => (
                            <div key={`${item.command || 'verification'}-${index}`} className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3">
                              <div className="font-semibold text-white">{item.command || '未提供驗證指令'}</div>
                              <div className="mt-1 text-xs leading-6 text-gray-400">
                                狀態：{translateImprovementStatus(item.status, item.status || '待更新')}
                                {item.summary ? ` / ${item.summary}` : ''}
                              </div>
                            </div>
                          )) : (
                            <div>這輪還沒寫出驗證內容，完成後會列出實際跑過的驗證指令與結果。</div>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="rounded-[22px] border border-fuchsia-500/15 bg-fuchsia-500/6 px-4 py-4">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-fuchsia-300">修完後下一步最值得做什麼</div>
                      <div className="mt-2 space-y-2 text-sm leading-7 text-gray-200">
                        {improveNextSteps.length ? improveNextSteps.map((step, index) => (
                          <div key={`${step}-${index}`} className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3">{step}</div>
                        )) : (
                          <div>這輪還沒整理出下一步建議，收尾後會顯示在這裡。</div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : isEvolveResearch ? (
                  <div className="mt-5 grid gap-3">
                    <div className="rounded-[22px] border border-fuchsia-500/15 bg-fuchsia-500/6 px-4 py-4">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-fuchsia-300">這輪鎖定的進化瓶頸</div>
                      <div className="mt-2 text-sm leading-7 text-white">
                        {snapshot?.highlights?.improvementProblem || '這輪還沒把進化瓶頸摘要寫出來，等摘要收尾後會顯示在這裡。'}
                      </div>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-[22px] border border-cyan-500/15 bg-cyan-500/6 px-4 py-4">
                        <div className="text-[11px] uppercase tracking-[0.18em] text-cyan-300">這次實際進化了哪些檔案</div>
                        <div className="mt-2 space-y-2 text-sm leading-7 text-gray-200">
                          {improveChangedFiles.length ? improveChangedFiles.map((item) => (
                            <div key={`${item.path}-${item.summary || 'change'}`} className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3">
                              <div className="font-semibold text-white">{item.path || '未提供路徑'}</div>
                              <div className="mt-1 text-xs leading-6 text-gray-400">{item.summary || '這個檔案有修改，但摘要尚未補上。'}</div>
                            </div>
                          )) : (
                            <div>這輪還沒寫出改動清單，完成後會把實際動到的檔案列在這裡。</div>
                          )}
                        </div>
                      </div>
                      <div className="rounded-[22px] border border-emerald-500/15 bg-emerald-500/6 px-4 py-4">
                        <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-300">這次怎麼驗證</div>
                        <div className="mt-2 space-y-2 text-sm leading-7 text-gray-200">
                          {improveVerificationItems.length ? improveVerificationItems.map((item, index) => (
                            <div key={`${item.command || 'verification'}-${index}`} className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3">
                              <div className="font-semibold text-white">{item.command || '未提供驗證指令'}</div>
                              <div className="mt-1 text-xs leading-6 text-gray-400">
                                狀態：{translateImprovementStatus(item.status, item.status || '待更新')}
                                {item.summary ? ` / ${item.summary}` : ''}
                              </div>
                            </div>
                          )) : (
                            <div>這輪還沒寫出驗證內容，完成後會列出實際跑過的驗證指令與結果。</div>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="rounded-[22px] border border-fuchsia-500/15 bg-fuchsia-500/6 px-4 py-4">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-fuchsia-300">進化後下一輪最值得延續什麼</div>
                      <div className="mt-2 space-y-2 text-sm leading-7 text-gray-200">
                        {improveNextSteps.length ? improveNextSteps.map((step, index) => (
                          <div key={`${step}-${index}`} className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3">{step}</div>
                        )) : (
                          <div>這輪還沒整理出下一輪進化建議，收尾後會顯示在這裡。</div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="mt-5">
                      <TraceSparkline history={snapshot.metrics.history} />
                    </div>
                    <div className="mt-4 grid gap-3 md:grid-cols-3">
                      <div className="rounded-[20px] border border-cyan-500/15 bg-cyan-500/6 px-4 py-4">
                        <div className="text-[11px] uppercase tracking-[0.18em] text-cyan-300">基準成績</div>
                        <div className="mt-2 text-xl font-semibold text-white">{formatBpb(snapshot.metrics.baselineValBpb)}</div>
                        <div className="mt-2 text-xs leading-6 text-gray-400">這是還沒優化前的原始表現，後面每一筆都拿它比較。</div>
                      </div>
                      <div className="rounded-[20px] border border-emerald-500/15 bg-emerald-500/6 px-4 py-4">
                        <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-300">目前最佳</div>
                        <div className="mt-2 text-xl font-semibold text-white">{formatBpb(snapshot.metrics.bestKeepValBpb)}</div>
                        <div className="mt-2 text-xs leading-6 text-gray-400">{formatImprovement(snapshot.metrics.deltaFromBaseline)}，代表目前保留下來最好的版本。</div>
                      </div>
                      <div className="rounded-[20px] border border-amber-500/15 bg-amber-500/6 px-4 py-4">
                        <div className="text-[11px] uppercase tracking-[0.18em] text-amber-300">最新記憶體峰值</div>
                        <div className="mt-2 text-xl font-semibold text-white">{typeof snapshot.metrics.latestMemoryGb === 'number' ? `${snapshot.metrics.latestMemoryGb.toFixed(1)} GB` : '待更新'}</div>
                        <div className="mt-2 text-xs leading-6 text-gray-400">這能幫你判斷目前的改法有沒有越跑越重。</div>
                      </div>
                    </div>
                    <div className="mt-4">
                      <ResultExplainTable history={snapshot.metrics.history} />
                    </div>
                  </>
                )}
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
                      {isCodeResearch ? (
                        <>
                          這輪是程式類模式，主力模型會負責看懂系統或提出改動；突破模型主要保留給模型優化夜跑與較難的卡關局。
                        </>
                      ) : (
                        <>
                          目前距離升級門檻：<span className="text-yellow-200">{snapshot.strategy.plateauCount}/{snapshot.strategy.escalateAfter}</span>
                          <br />
                          最近一次主力模式：<span className="text-white">{snapshot.strategy.lastPrimaryRunTag || '待更新'}</span>
                          <br />
                          最近一次判定：<span className="text-white">{translateVerdict(snapshot.strategy.lastPrimaryResult)}</span>
                          <br />
                          最近一次複驗：<span className="text-white">{translateRevalidationVerdict(snapshot.strategy.lastRevalidationStatus)}</span>
                        </>
                      )}
                    </div>
                    <div className="rounded-[18px] border border-cyan-500/15 bg-black/25 px-4 py-3 text-[12px] leading-6 text-gray-300">
                      <div>目前研究線：<span className="text-white">{currentLane.label || '待規劃'}</span></div>
                      <div className="mt-1">{currentLane.goal || '這輪還沒寫入研究線目標。'}</div>
                      <div className="mt-2 text-gray-500">{currentLane.whyNow || snapshot.strategy.planSummary || '下一輪開始前，策略器會依研究記憶與停滯次數重新挑選。'}</div>
                      <div className="mt-2 text-cyan-200">先看：{joinHumanList(currentLane.focus)}</div>
                      <div className="text-amber-200">先避開：{joinHumanList(currentLane.avoid)}</div>
                      <div className="mt-2">若停滯就切到：<span className="text-white">{nextLane.label || '待規劃'}</span></div>
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
                    研究邊界與工作區
                  </div>
                  <div className="mt-4 space-y-3 text-sm leading-7 text-gray-300">
                    <div>目前分支：<span className="text-white">{snapshot.repo.branch || '待更新'}</span></div>
                    <div>目前提交：<span className="text-white">{snapshot.repo.head || '待更新'}</span></div>
                    <div>目前模式：<span className="text-white">{humanizeResearchKind(runtimeResearchKind)}</span></div>
                    <div>目前研究工作區：<span className="text-white">{activeWorkspaceLabel}</span></div>
                    <div className="break-all">工作區路徑：<span className="text-white">{activeWorkspacePath || '待更新'}</span></div>
                    <div>Codex 登入：<span className="text-white">{humanizeCodexLogin(snapshot.repo.codexLogin)}</span></div>
                    <div>proxy-chatgpt：<span className="text-white">{humanizeProxyStatus(snapshot.repo.proxyReady)}</span></div>
                    {isProgramResearch ? (
                      <div className="rounded-[18px] border border-white/8 bg-black/25 px-4 py-3 text-[12px] leading-6 text-gray-400">
                        這輪是唯讀程式研究，不會直接改你的原始碼；重點是幫你看懂系統、指出關鍵檔案與下一步。
                      </div>
                    ) : isImproveResearch ? (
                      <>
                        <div>這輪做法：<span className="text-white">先鎖定單一問題，再小範圍改碼與驗證</span></div>
                        <div>改動檔案數：<span className="text-white">{snapshot?.metrics?.changedFilesCount || 0}</span></div>
                        <div>驗證項目數：<span className="text-white">{snapshot?.metrics?.verificationCount || 0}</span></div>
                        <div className="rounded-[18px] border border-white/8 bg-black/25 px-4 py-3 text-[12px] leading-6 text-gray-400">
                          這輪不是唯讀分析，而是會在指定工作區內實際修改程式、驗證結果，再把有效做法留下來。
                        </div>
                      </>
                    ) : isEvolveResearch ? (
                      <>
                        <div>這輪做法：<span className="text-white">先鎖定單一進化瓶頸，再小範圍改碼與驗證</span></div>
                        <div>改動檔案數：<span className="text-white">{snapshot?.metrics?.changedFilesCount || 0}</span></div>
                        <div>驗證項目數：<span className="text-white">{snapshot?.metrics?.verificationCount || 0}</span></div>
                        <div className="rounded-[18px] border border-white/8 bg-black/25 px-4 py-3 text-[12px] leading-6 text-gray-400">
                          這輪不是唯讀分析，而是會在指定工作區內實際修改程式、驗證結果，並把下一輪可持續延續的做法一起留下來。
                        </div>
                      </>
                    ) : (
                      <>
                        <div>允許修改檔案：<span className="text-white">{joinHumanList(searchSpace.allowedFiles)}</span></div>
                        <div>固定訓練預算：<span className="text-white">{searchSpace.fixedBudgetMinutes || 5} 分鐘</span></div>
                        <div>協作分工：<span className="text-white">{joinHumanList(Object.values(searchSpace.orchestration || {}))}</span></div>
                        <div className="rounded-[18px] border border-white/8 bg-black/25 px-4 py-3 text-[12px] leading-6 text-gray-400">
                          可用研究線：{Array.isArray(searchSpace.lanes) && searchSpace.lanes.length
                            ? searchSpace.lanes.map((lane) => lane.label || lane.id).join('、')
                            : '待更新'}
                        </div>
                      </>
                    )}
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
                  title={summaryPanelTitle}
                  accent="#00f5ff"
                  path={snapshot.artifacts.summary?.path}
                  content={snapshot.artifacts.summary?.content}
                  sourceLabel={snapshot.artifacts.summary?.sourceLabel}
                  statusNote={snapshot.artifacts.summary?.statusNote}
                />
                <ArtifactPanel
                  title={isCodeResearch ? '後續確認' : '自動複驗'}
                  accent="#c77dff"
                  path={snapshot.artifacts.revalidationReport?.path}
                  content={snapshot.artifacts.revalidationReport?.content}
                  sourceLabel={snapshot.artifacts.revalidationReport?.sourceLabel}
                  statusNote={snapshot.artifacts.revalidationReport?.statusNote}
                />
                <ArtifactPanel
                  title="QA 報告"
                  accent="#39ff14"
                  path={snapshot.artifacts.qaReport?.path}
                  content={snapshot.artifacts.qaReport?.content}
                  sourceLabel={snapshot.artifacts.qaReport?.sourceLabel}
                  statusNote={snapshot.artifacts.qaReport?.statusNote}
                />
              </div>
            </section>

            <section className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
              <ArtifactPanel
                title="記憶整理交接"
                accent="#ffb703"
                path={snapshot.artifacts.memoryHandoff?.path}
                content={snapshot.artifacts.memoryHandoff?.content}
                sourceLabel={snapshot.artifacts.memoryHandoff?.sourceLabel}
                statusNote={snapshot.artifacts.memoryHandoff?.statusNote}
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
                  {isProgramResearch ? (
                    <>
                      <p>這輪研究對象：<span className="text-white">{activeWorkspaceLabel}</span></p>
                      <p>研究主題：<span className="text-white">{activeResearchTopic || '先從整體架構開始'}</span></p>
                      <p>建議先看：<span className="text-white">{snapshot.artifacts.summary?.path || '等摘要產生後會顯示在這裡。'}</span></p>
                      <p>{snapshot.artifacts.qaReport?.statusNote || '閱讀重點與後續確認會在收尾後補上。'}</p>
                    </>
                  ) : isImproveResearch ? (
                    <>
                      <p>這輪鎖定的問題：<span className="text-white">{snapshot.highlights.improvementProblem || '等摘要寫完後會顯示在這裡。'}</span></p>
                      <p>一句話摘要：<span className="text-white">{snapshot.highlights.improvementHeadline || '待更新'}</span></p>
                      <p>驗證狀態：<span className="text-white">{translateImprovementStatus(snapshot.metrics.verificationStatus)}</span></p>
                      <p>改動檔案數：<span className="text-white">{snapshot.metrics.changedFilesCount || 0}</span></p>
                      <p>{improveNextSteps[0] || '下一輪建議會在收尾後整理到這裡。'}</p>
                    </>
                  ) : isEvolveResearch ? (
                    <>
                      <p>這輪鎖定的進化瓶頸：<span className="text-white">{snapshot.highlights.improvementProblem || '等摘要寫完後會顯示在這裡。'}</span></p>
                      <p>一句話摘要：<span className="text-white">{snapshot.highlights.improvementHeadline || '待更新'}</span></p>
                      <p>驗證狀態：<span className="text-white">{translateImprovementStatus(snapshot.metrics.verificationStatus)}</span></p>
                      <p>改動檔案數：<span className="text-white">{snapshot.metrics.changedFilesCount || 0}</span></p>
                      <p>{improveNextSteps[0] || '下一輪進化建議會在收尾後整理到這裡。'}</p>
                    </>
                  ) : (
                    <>
                      <p>保留下來的關鍵作法：{localizeSentence(snapshot.highlights.bestIdea) || '等這輪摘要寫完後會顯示在這裡。'}</p>
                      <p>最終保留 commit：<span className="text-white">{snapshot.highlights.finalCommit || '待更新'}</span></p>
                      <p>記憶體峰值：<span className="text-white">{snapshot.highlights.peakMemory || '待更新'}</span></p>
                      <p>複驗判定：<span className="text-white">{translateRevalidationVerdict(snapshot.metrics.revalidationVerdict)}</span></p>
                      <p>{snapshot.highlights.memorySummary ? localizeArtifactContent(snapshot.highlights.memorySummary) : '記憶整理完成後，這裡會補上濃縮版學習。'}</p>
                    </>
                  )}
                </div>
              </div>

              <div className="glass-card rounded-[28px] p-6">
                <div className="text-sm uppercase tracking-[0.18em] text-green-300">研究記憶與資料來源</div>
                <div className="mt-4 space-y-4">
                  {isCodeResearch ? (
                    <>
                      <div className="rounded-[22px] border border-green-500/15 bg-black/25 px-4 py-3 text-sm leading-7 text-gray-300">
                        <div>目前工作區：<span className="text-white">{activeWorkspaceLabel}</span></div>
                        <div className="break-all">工作區路徑：<span className="text-white">{activeWorkspacePath || '待更新'}</span></div>
                        <div className="mt-2 text-gray-400">
                          {knowledgeSourceHint}
                        </div>
                      </div>
                      <div className="rounded-[22px] border border-cyan-500/15 bg-black/25 px-4 py-3 text-sm leading-7 text-gray-300">
                        <div className="text-[11px] uppercase tracking-[0.18em] text-cyan-300">最近交付記憶</div>
                        <div className="mt-2">最近交付輪數：<span className="text-white">{codeDeliveryMemory.entryCount || 0}</span></div>
                        <div>驗證通過率：<span className="text-white">{formatPassRate(codeDeliveryMemory.passRate)}</span></div>
                        <div>最近更新：<span className="text-white">{formatShortTimestamp(codeDeliveryMemory.updatedAt)}</span></div>
                        <div className="mt-2 text-gray-400">
                          {codeDeliveryMemory.entryCount
                            ? '這裡會把最近的程式改善 / 進化結果濃縮成下一輪可直接接續的記憶。'
                            : '等第一輪程式改善或進化完成後，這裡會開始累積可延續的交付記憶。'}
                        </div>
                      </div>
                      <div className="rounded-[22px] border border-cyan-500/15 bg-black/25 px-4 py-3 text-sm leading-7 text-gray-300">
                        <div className="text-[11px] uppercase tracking-[0.18em] text-cyan-300">目前建議延續的方向</div>
                        <div className="mt-2 space-y-2">
                          {codeDeliveryMemory.verifiedPatterns?.length ? codeDeliveryMemory.verifiedPatterns.map((pattern) => (
                            <div key={`${pattern.label}-${pattern.lastRunTag}`} className="rounded-2xl border border-white/8 bg-black/20 px-3 py-3 text-gray-300">
                              <div className="font-semibold text-white">{pattern.label || '未命名方向'}</div>
                              <div className="mt-1 text-xs leading-6 text-gray-400">{pattern.summary}</div>
                            </div>
                          )) : (
                            <div className="text-xs leading-6 text-gray-500">還沒有累積到足夠穩定的通過方向。</div>
                          )}
                        </div>
                      </div>
                      <div className="rounded-[22px] border border-amber-500/15 bg-black/25 px-4 py-3 text-sm leading-7 text-gray-300">
                        <div className="text-[11px] uppercase tracking-[0.18em] text-amber-300">目前先避開的方向</div>
                        <div className="mt-2 space-y-2">
                          {codeDeliveryMemory.avoidPatterns?.length ? codeDeliveryMemory.avoidPatterns.map((pattern) => (
                            <div key={`${pattern.label}-${pattern.lastRunTag}`} className="rounded-2xl border border-white/8 bg-black/20 px-3 py-3 text-gray-300">
                              <div className="font-semibold text-white">{pattern.label || '未命名方向'}</div>
                              <div className="mt-1 text-xs leading-6 text-gray-400">{pattern.summary}</div>
                            </div>
                          )) : (
                            <div className="text-xs leading-6 text-gray-500">目前沒有累積到明確要先避開的重複卡點。</div>
                          )}
                        </div>
                        <div className="mt-3 text-xs leading-6 text-gray-500">
                          下一輪候選：<span className="text-gray-300">{joinHumanList(codeDeliveryMemory.recentNextSteps)}</span>
                        </div>
                      </div>
                      {fleetReadinessCandidates.entryCount ? (
                        <div className="rounded-[22px] border border-rose-500/15 bg-black/25 px-4 py-3 text-sm leading-7 text-gray-300">
                          <div className="text-[11px] uppercase tracking-[0.18em] text-rose-300">魚群 readiness 候選</div>
                          <div className="mt-2 text-xs leading-6 text-gray-400">
                            這裡會把目前共享 status 裡最值得優先處理的 blocked / yellow 魚整理成下一輪候選，避免每次都要手動翻 status.json。
                          </div>
                          <div className="mt-3 space-y-2">
                            {fleetReadinessCandidates.candidates.map((candidate) => (
                              <div key={`${candidate.agentId}-${candidate.rank}`} className="rounded-2xl border border-white/8 bg-black/20 px-3 py-3 text-gray-300">
                                <div className="font-semibold text-white">{candidate.rank}. {candidate.agentId}</div>
                                <div className="mt-1 text-xs leading-6 text-gray-400">{candidate.summary}</div>
                                <div className="mt-2 flex flex-wrap gap-2 text-[11px] leading-5">
                                  <span className={`rounded-full border px-2 py-0.5 ${
                                    candidate.severity === 'blocked'
                                      ? 'border-rose-400/20 bg-rose-500/10 text-rose-200'
                                      : 'border-amber-400/20 bg-amber-500/10 text-amber-200'
                                  }`}>
                                    {candidate.severity === 'blocked' ? 'blocked' : 'monitor'}
                                  </span>
                                  {candidate.blockerLabel ? (
                                    <span className="rounded-full border border-cyan-400/20 bg-cyan-500/10 px-2 py-0.5 text-cyan-100">
                                      {candidate.blockerLabel}
                                    </span>
                                  ) : null}
                                  {candidate.blockerCode ? (
                                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-gray-400">
                                      {candidate.blockerCode}
                                    </span>
                                  ) : null}
                                </div>
                                <div className="mt-1 text-[11px] leading-5 text-gray-500">
                                  {candidate.nextStep || '目前還沒有具體 next step'}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      {isEvolveResearch ? (
                        <div className="rounded-[22px] border border-violet-500/15 bg-black/25 px-4 py-3 text-sm leading-7 text-gray-300">
                          <div className="text-[11px] uppercase tracking-[0.18em] text-violet-300">自動迭代證據</div>
                          <div className="mt-2">原始主題：<span className="text-white">{effectiveRequestedResearchTopic || '待更新'}</span></div>
                          <div>實際執行主題：<span className="text-white">{effectiveResolvedResearchTopic || '待更新'}</span></div>
                          <div>接續來源 run：<span className="text-white">{snapshot?.control?.continuationSourceRunTag || evolveStartupContext?.continuationSourceRunTag || '尚未載入'}</span></div>
                          <div>Codex thread：<span className="text-white break-all">{evolveLoop.threadId || evolveStartupContext?.threadId || '待建立'}</span></div>
                          <div>目前輪次：<span className="text-white">{evolveLoop.currentIteration || evolveStartupContext?.iteration || 1}</span></div>
                          <div>已完成輪數：<span className="text-white">{evolveLoop.completedIterations || 0}</span></div>
                          <div>本輪上限：<span className="text-white">{evolveLoop.maxIterations || manualMaxExperiments || runtime.maxExperiments || 0}</span></div>
                          <div className="mt-2 text-gray-400">
                            {snapshot?.control?.continuationReason
                              || evolveStartupContext?.continuationReason
                              || '等啟動證據寫進 artifact 後，這裡會顯示上一輪記憶是否真的有被帶進這輪。'}
                          </div>
                          <div className="mt-2 text-xs leading-6 text-gray-500">
                            {snapshot?.control?.codeMemoryReason
                              || evolveStartupContext?.codeMemoryReason
                              || '目前還沒有顯示這輪啟動時載入了多少交付記憶。'}
                          </div>
                          <div className="mt-2 text-xs leading-6 text-gray-500">
                            {evolveReadinessCandidate.reason
                              || '目前還沒有把這輪鎖定的 readiness blocker 寫進啟動證據。'}
                          </div>
                          {evolveReadinessCandidate.agentId ? (
                            <div className="mt-2 rounded-2xl border border-white/8 bg-black/20 px-3 py-3 text-xs leading-6 text-gray-300">
                              <div>
                                本輪鎖定卡點：<span className="text-white">{evolveReadinessCandidate.agentId}</span>
                                {evolveReadinessCandidate.blockerLabel ? <span className="text-cyan-200"> / {evolveReadinessCandidate.blockerLabel}</span> : null}
                                {evolveReadinessCandidate.blockerCode ? <span className="text-gray-500"> ({evolveReadinessCandidate.blockerCode})</span> : null}
                              </div>
                              <div className="text-gray-500">
                                訊號來源：{humanizeReadinessCandidateSource(evolveReadinessCandidate.source)}
                                {evolveReadinessCandidate.source ? <span className="text-gray-600"> ({evolveReadinessCandidate.source})</span> : null}
                              </div>
                              <div className="text-gray-400">{evolveReadinessCandidate.summary || evolveReadinessCandidate.preview || '待補充 summary'}</div>
                              <div className="text-gray-500">{evolveReadinessCandidate.nextStep || '目前還沒有具體 next step'}</div>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      <div className="rounded-[22px] border border-green-500/15 bg-black/25 px-4 py-3 text-sm leading-7 text-gray-300">
                        <div className="text-[11px] uppercase tracking-[0.18em] text-green-300">主要資料來源</div>
                        <div className="mt-2 space-y-2 text-xs leading-6 text-gray-400">
                          <div className="rounded-2xl border border-white/8 bg-black/20 px-3 py-3">{snapshot.artifacts.summary?.path || '摘要尚未產生'}</div>
                          <div className="rounded-2xl border border-white/8 bg-black/20 px-3 py-3">{snapshot.artifacts.qaReport?.path || 'QA 尚未產生'}</div>
                          <div className="rounded-2xl border border-white/8 bg-black/20 px-3 py-3">{snapshot.artifacts.revalidationReport?.path || '後續確認尚未產生'}</div>
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="rounded-[22px] border border-green-500/15 bg-black/25 px-4 py-3 text-sm leading-7 text-gray-300">
                        <div>研究記憶條目：<span className="text-white">{researchMemory.entryCount || 0}</span></div>
                        <div>最近更新：<span className="text-white">{formatShortTimestamp(researchMemory.updatedAt)}</span></div>
                        <div className="mt-2 text-gray-400">{snapshot.strategy.stableMemoryCallout || snapshot.strategy.cautionMemoryCallout || '這裡會逐漸累積哪條研究線最穩、哪條線容易波動。'}</div>
                      </div>
                      <div className="rounded-[22px] border border-green-500/15 bg-black/25 px-4 py-3 text-sm leading-7 text-gray-300">
                        <div className="text-[11px] uppercase tracking-[0.18em] text-green-300">目前建議放大的模式</div>
                        <div className="mt-2 space-y-2">
                          {researchMemory.recommendedPatterns?.length ? researchMemory.recommendedPatterns.map((pattern) => (
                            <div key={`${pattern.laneId}-${pattern.summary}`} className="rounded-2xl border border-white/8 bg-black/20 px-3 py-3 text-gray-300">
                              <div className="font-semibold text-white">{pattern.label || '未命名研究線'}</div>
                              <div className="mt-1 text-xs leading-6 text-gray-400">{pattern.summary}</div>
                            </div>
                          )) : (
                            <div className="text-xs leading-6 text-gray-500">還沒有足夠穩定的重複證據。</div>
                          )}
                        </div>
                      </div>
                      <div className="rounded-[22px] border border-amber-500/15 bg-black/25 px-4 py-3 text-sm leading-7 text-gray-300">
                        <div className="text-[11px] uppercase tracking-[0.18em] text-amber-300">目前先別重押的模式</div>
                        <div className="mt-2 space-y-2">
                          {researchMemory.avoidPatterns?.length ? researchMemory.avoidPatterns.map((pattern) => (
                            <div key={`${pattern.laneId}-${pattern.summary}`} className="rounded-2xl border border-white/8 bg-black/20 px-3 py-3 text-gray-300">
                              <div className="font-semibold text-white">{pattern.label || '未命名研究線'}</div>
                              <div className="mt-1 text-xs leading-6 text-gray-400">{pattern.summary}</div>
                            </div>
                          )) : (
                            <div className="text-xs leading-6 text-gray-500">目前還沒有明顯需要避開的研究線。</div>
                          )}
                        </div>
                      </div>
                    </>
                  )}
                  <div className="space-y-3 text-[11px] leading-6 text-gray-400">
                    <div className="rounded-[22px] border border-green-500/15 bg-black/25 px-4 py-3">{snapshot.repo.projectDir}</div>
                    <div className="rounded-[22px] border border-green-500/15 bg-black/25 px-4 py-3">{snapshot.repo.resultsPath}</div>
                    <div className="rounded-[22px] border border-green-500/15 bg-black/25 px-4 py-3">{snapshot.strategy.latestStrategyReportPath || '尚未產生策略報告'}</div>
                    <div className="rounded-[22px] border border-green-500/15 bg-black/25 px-4 py-3">{researchMemory.path || '尚未產生研究記憶索引'}</div>
                  </div>
                </div>
              </div>
            </section>

            <section className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
              <div className="glass-card rounded-[28px] p-6">
                <div className="flex items-center gap-2 text-sm uppercase tracking-[0.18em] text-green-300">
                  <CalendarClock className="h-4 w-4" />
                  正式排程
                </div>
                <div className="mt-3 text-sm leading-7 text-gray-400">
                  這一區放到底部，因為它是「之後怎麼跑」的設定，不是你打開頁面最先需要看的資訊。改完後會從下一次正式排程開始生效；目前正式排程仍以模型優化夜跑為主。
                </div>
                <div className="mt-4 space-y-4">
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
                </div>
              </div>

              <div className="glass-card rounded-[28px] p-6">
                <div className="text-sm uppercase tracking-[0.18em] text-cyan-300">排程解讀</div>
                <div className="mt-4 space-y-3 text-sm leading-7 text-gray-300">
                  <p><span className="text-white">夜間研究</span>：正式啟動一整輪 AutoResearch，會跑研究、複驗、QA 與記憶整理。</p>
                  <p><span className="text-white">早晨檢查</span>：不是再跑研究，而是確認昨晚那輪有沒有正常完成，必要時留告警。</p>
                  <p><span className="text-white">正在跑的研究</span> 不會因為你改時間而中斷；新的設定只影響下一次排程。</p>
                  <div className="rounded-[20px] border border-white/8 bg-black/25 px-4 py-4 text-xs leading-6 text-gray-400">
                    下次夜間研究：{formatScheduleNextRun(snapshot.schedule?.nightly)}<br />
                    下次早晨檢查：{formatScheduleNextRun(snapshot.schedule?.watch)}
                  </div>
                </div>
              </div>
            </section>
          </>
        ) : null}
      </div>
    </main>
  )
}
