#!/usr/bin/env node

import { mkdirSync, appendFileSync } from 'fs'
import { join } from 'path'
import { runBossInboxNightlyEvolution } from '../lib/boss-inbox.js'

const cwd = process.cwd()
const logDir = join(cwd, 'logs')
const logFile = join(logDir, `memory-distiller-promoter-${new Date().toISOString().slice(0, 10)}.log`)

mkdirSync(logDir, { recursive: true })

function writeLog(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`
  appendFileSync(logFile, line)
  process.stdout.write(line)
}

try {
  const result = runBossInboxNightlyEvolution()
  const candidateCount = result.candidatePatches?.length || 0
  const promotedCount = result.promotedPatterns?.length || 0
  const processedRuns = result.sync?.processedRuns || 0
  const headline = candidateCount > 0
    ? `topCandidate=${result.candidatePatches[0].agentName || result.candidatePatches[0].agentId}/${result.candidatePatches[0].category}`
    : 'topCandidate=none'

  writeLog(`memory distiller promoter syncedRuns=${processedRuns} candidates=${candidateCount} promoted=${promotedCount} ${headline}`)

  if (candidateCount === 0 && promotedCount === 0) {
    process.stdout.write('no-op\n')
  }
} catch (error) {
  writeLog(`memory distiller promoter failed: ${error.message}`)
  process.exitCode = 1
}
