import { existsSync } from 'node:fs'
import { execFile, spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'

import { getTaskById } from './db.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OFFICE_ROOT = resolve(__dirname, '..')
const RUNNER_SCRIPT = join(OFFICE_ROOT, 'scripts', 'run-gstack-task.mjs')
const execFileAsync = promisify(execFile)

export const GSTACK_BROWSE_AGENT_ID = 'gstack-browse'
export const GSTACK_BROWSE_BIN = '/Users/brian/gstack/browse/dist/browse'
export const DEFAULT_OFFICE_INTERNAL_BASE_URL = process.env.OPENCLAW_OFFICE_INTERNAL_BASE_URL || 'http://127.0.0.1:4201'

function trimText(value, limit = 180) {
  const text = String(value || '').trim()
  if (!text) return ''
  return text.length > limit ? `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…` : text
}

export function isGstackBrowseAgent(agentId) {
  return String(agentId || '').trim() === GSTACK_BROWSE_AGENT_ID
}

export function hasGstackBrowseBinary() {
  return existsSync(GSTACK_BROWSE_BIN)
}

export function extractTaskVerificationUrl(task = {}) {
  const haystack = [
    task.title,
    task.detail,
    task.result,
    task.rootCause,
    task.brainState?.summary,
    task.brainState?.focus,
    ...(task.brainState?.evidence || []),
  ].filter(Boolean).join('\n')

  const explicitMatch = haystack.match(/https?:\/\/[^\s)]+/i)
  if (explicitMatch) return explicitMatch[0]
  if (/copilot|office|boss inbox|workflow/i.test(haystack)) {
    return 'https://copilot.bw-space.com/office'
  }
  return null
}

async function runGstackBrowseCommand(args = [], { timeout = 45000 } = {}) {
  const { stdout, stderr } = await execFileAsync(GSTACK_BROWSE_BIN, args, {
    cwd: '/Users/brian/gstack',
    timeout,
    maxBuffer: 1024 * 1024,
  })
  return String(stdout || stderr || '').trim()
}

async function submitTaskCompletion(payload, { officeBaseUrl = DEFAULT_OFFICE_INTERNAL_BASE_URL, attempts = 4 } = {}) {
  const url = new URL('/api/workflow', officeBaseUrl).toString()
  let lastError = null

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          action: 'agent_complete',
          ...payload,
        }),
      })

      if (response.ok) {
        try {
          return await response.json()
        } catch {
          return null
        }
      }

      const text = await response.text().catch(() => response.statusText)
      lastError = new Error(`workflow callback failed (${response.status}): ${trimText(text, 220)}`)
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
    }

    if (attempt < attempts) {
      await delay(750 * attempt)
    }
  }

  throw lastError || new Error('workflow callback failed')
}

export function spawnDetachedGstackTask(
  taskId,
  {
    reason = 'continuation-review',
    officeBaseUrl = DEFAULT_OFFICE_INTERNAL_BASE_URL,
  } = {},
) {
  if (!taskId) {
    throw new Error('taskId is required for gstack background dispatch')
  }
  if (!hasGstackBrowseBinary()) {
    throw new Error(`gstack browse binary not found: ${GSTACK_BROWSE_BIN}`)
  }

  const runId = `gstack_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const sessionKey = `gstack-task-${taskId}`
  const child = spawn(
    process.execPath,
    [
      RUNNER_SCRIPT,
      '--task',
      taskId,
      '--reason',
      reason,
      '--office-base-url',
      officeBaseUrl,
    ],
    {
      cwd: OFFICE_ROOT,
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        OPENCLAW_OFFICE_INTERNAL_BASE_URL: officeBaseUrl,
      },
    },
  )

  child.unref()

  return {
    runId,
    sessionKey,
    dispatchedAt: Date.now(),
    pid: child.pid,
  }
}

export async function runGstackTaskById(
  taskId,
  {
    reason = 'continuation-review',
    officeBaseUrl = DEFAULT_OFFICE_INTERNAL_BASE_URL,
  } = {},
) {
  const task = getTaskById(taskId)
  if (!task) {
    throw new Error(`Task not found: ${taskId}`)
  }

  const url = extractTaskVerificationUrl(task)
  if (!url) {
    await submitTaskCompletion({
      taskId,
      agent: task.assignedAgent || GSTACK_BROWSE_AGENT_ID,
      success: false,
      result: 'gstack verifier failed: no verification URL',
      summary: 'gstack verifier 找不到可巡檢的 URL。',
      nextStep: '請補可驗證網址或讓主線先建立明確驗證目標。',
      blockers: ['找不到 verification URL'],
      openLoops: ['等待 verification URL'],
      rootCause: 'no verification URL',
      reviewerResults: [{
        sourceTaskId: task.id,
        sourceTaskType: task.taskType,
        sourceAgent: task.assignedAgent || GSTACK_BROWSE_AGENT_ID,
        sourceKind: 'gstack',
        mergePolicy: task.mergePolicy || 'blocking_review',
        findingType: 'verification',
        severity: 'warning',
        confidence: 0.84,
        recommendedAction: 'provide_verification_url',
        requiresHumanApproval: false,
        supportsRootCause: false,
        summary: 'gstack verifier 缺少可驗證的 URL。',
        rootCause: 'no verification URL',
        blockers: ['找不到 verification URL'],
        evidence: [
          trimText(task.title, 140),
          trimText(task.detail, 180),
        ].filter(Boolean),
      }],
    }, { officeBaseUrl })

    return {
      taskId,
      url: null,
      status: 'failed',
      reason: 'no verification URL',
    }
  }

  let textPreview = ''
  let consoleErrors = ''
  let perfPreview = ''

  try {
    await runGstackBrowseCommand(['goto', url])
    await runGstackBrowseCommand(['wait', '--load'])
    textPreview = await runGstackBrowseCommand(['text'], { timeout: 20000 })
    consoleErrors = await runGstackBrowseCommand(['console', '--errors'], { timeout: 20000 })
    perfPreview = await runGstackBrowseCommand(['perf'], { timeout: 25000 })

    const hasErrors = Boolean(consoleErrors) && !/no console|no error|no errors|^$/i.test(consoleErrors)
    const summary = hasErrors
      ? `gstack verifier 在 ${url} 發現 console error。`
      : `gstack verifier 已巡過 ${url}，未發現明顯 console error。`

    await submitTaskCompletion({
      taskId,
      agent: task.assignedAgent || GSTACK_BROWSE_AGENT_ID,
      result: hasErrors ? `gstack verifier found console errors on ${url}` : `gstack verifier passed on ${url}`,
      success: !hasErrors,
      summary,
      nextStep: hasErrors ? '先處理 console error，再決定是否續跑主線。' : 'verifier 已補完，可依主任務狀態繼續推進。',
      blockers: hasErrors ? [trimText(consoleErrors, 180)] : [],
      openLoops: [],
      evidence: [
        `verification target: ${url}`,
        textPreview ? `page text preview: ${trimText(textPreview, 160)}` : null,
        perfPreview ? `perf: ${trimText(perfPreview, 160)}` : null,
      ].filter(Boolean),
      reviewerResults: [{
        sourceTaskId: task.id,
        sourceTaskType: task.taskType,
        sourceAgent: task.assignedAgent || GSTACK_BROWSE_AGENT_ID,
        sourceKind: 'gstack',
        mergePolicy: task.mergePolicy || 'blocking_review',
        findingType: 'verification',
        severity: hasErrors ? 'blocking' : 'info',
        confidence: hasErrors ? 0.88 : 0.74,
        recommendedAction: hasErrors ? 'fix_console_errors' : 'continue',
        requiresHumanApproval: false,
        supportsRootCause: false,
        summary,
        evidence: [
          `url: ${url}`,
          consoleErrors ? trimText(consoleErrors, 180) : 'console clean',
          perfPreview ? trimText(perfPreview, 160) : null,
        ].filter(Boolean),
      }],
    }, { officeBaseUrl })

    return {
      taskId,
      url,
      status: hasErrors ? 'blocking' : 'passed',
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await submitTaskCompletion({
      taskId,
      agent: task.assignedAgent || GSTACK_BROWSE_AGENT_ID,
      result: `gstack verifier failed: ${message}`,
      success: false,
      summary: `gstack verifier 沒能完成 ${reason} 驗證。`,
      nextStep: '先確認 gstack verifier 或目標 URL，再決定是否續跑主線。',
      blockers: [message],
      openLoops: ['等待 gstack verifier 可用或改由其他 reviewer 補位'],
      rootCause: message,
      evidence: [`verification target: ${url}`],
      reviewerResults: [{
        sourceTaskId: task.id,
        sourceTaskType: task.taskType,
        sourceAgent: task.assignedAgent || GSTACK_BROWSE_AGENT_ID,
        sourceKind: 'gstack',
        mergePolicy: task.mergePolicy || 'blocking_review',
        findingType: 'verification',
        severity: 'warning',
        confidence: 0.72,
        recommendedAction: 'repair_verifier_or_retry',
        requiresHumanApproval: false,
        supportsRootCause: false,
        summary: 'gstack verifier 無法完成驗證。',
        rootCause: message,
        blockers: [message],
        evidence: [`url: ${url}`],
      }],
    }, { officeBaseUrl })

    return {
      taskId,
      url,
      status: 'failed',
      reason: message,
    }
  }
}
