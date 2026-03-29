#!/usr/bin/env node

import { runGstackTaskById } from '../lib/gstack-task-runner.js'

function getArg(flag) {
  const index = process.argv.indexOf(flag)
  if (index === -1) return null
  return process.argv[index + 1] || null
}

const taskId = getArg('--task') || process.argv[2] || null
const reason = getArg('--reason') || 'continuation-review'
const officeBaseUrl = getArg('--office-base-url') || process.env.OPENCLAW_OFFICE_INTERNAL_BASE_URL || 'http://127.0.0.1:4201'

if (!taskId) {
  console.error('[gstack-task-runner] missing --task <taskId>')
  process.exit(1)
}

try {
  await runGstackTaskById(taskId, {
    reason,
    officeBaseUrl,
  })
  process.exit(0)
} catch (error) {
  console.error('[gstack-task-runner] failed:', error?.message || error)
  process.exit(1)
}
