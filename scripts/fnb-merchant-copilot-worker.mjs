#!/usr/bin/env node

import process from 'node:process'
import { claimNextMerchantCopilotTask, completeMerchantCopilotTask } from '../lib/fnb-service.js'
import { readEnvMap } from './superfish-utils.mjs'

function parseArgNumber(name, fallback) {
  const prefix = `${name}=`
  const inline = process.argv.find((argument) => argument.startsWith(prefix))
  const raw = inline ? inline.slice(prefix.length) : null
  const value = raw === null ? fallback : Number(raw)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function parseEnvNumber(name, fallback) {
  const raw = process.env[name]
  if (raw === undefined || raw === null || raw === '') return fallback
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function hasFlag(flag) {
  return process.argv.includes(flag)
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function loadLocalEnv() {
  const envMap = await readEnvMap()
  for (const [key, value] of Object.entries(envMap)) {
    if (process.env[key] === undefined) {
      process.env[key] = value
    }
  }
}

function taskSummary(task) {
  if (!task) return null
  return {
    id: task.id,
    status: task.status,
    taskType: task.taskType,
    title: task.title,
    locationId: task.locationId,
    threadId: task.threadId,
  }
}

async function processNextTask() {
  const claimed = await claimNextMerchantCopilotTask()
  if (!claimed?.task) {
    return {
      ok: true,
      status: 'idle',
      message: 'No queued merchant copilot task',
    }
  }

  const completed = await completeMerchantCopilotTask(claimed.task.id)
  return {
    ok: Boolean(completed?.ok),
    status: completed?.task?.status || 'completed',
    task: taskSummary(completed?.task || claimed.task),
  }
}

async function runOnce() {
  const result = await processNextTask()
  console.log(JSON.stringify(result, null, 2))
  if (result.ok === false) {
    process.exitCode = 1
  }
}

async function runLoop(intervalSeconds) {
  let stopping = false
  process.on('SIGINT', () => {
    stopping = true
  })
  process.on('SIGTERM', () => {
    stopping = true
  })

  while (!stopping) {
    const result = await processNextTask()
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      ...result,
    }))
    await sleep(intervalSeconds * 1000)
  }
}

async function main() {
  await loadLocalEnv()
  const once = hasFlag('--once')
  const intervalSeconds = parseArgNumber(
    '--interval-seconds',
    parseEnvNumber('FNB_MERCHANT_COPILOT_WORKER_INTERVAL_SECONDS', 5),
  )

  if (once) {
    await runOnce()
    return
  }
  await runLoop(intervalSeconds)
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error?.message || String(error),
  }, null, 2))
  process.exit(1)
})
