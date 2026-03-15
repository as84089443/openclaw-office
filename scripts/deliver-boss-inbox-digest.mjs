#!/usr/bin/env node

import { mkdirSync, appendFileSync } from 'fs'
import { join } from 'path'
import { ensureDailyDigest, maybeDeliverDailyDigest } from '../lib/boss-inbox.js'

const cwd = process.cwd()
const logDir = join(cwd, 'logs')
const logFile = join(logDir, `boss-inbox-digest-${new Date().toISOString().slice(0, 10)}.log`)

mkdirSync(logDir, { recursive: true })

function writeLog(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`
  appendFileSync(logFile, line)
  process.stdout.write(line)
}

try {
  const digest = ensureDailyDigest({ force: true })
  const delivered = await maybeDeliverDailyDigest(digest)
  writeLog(`boss inbox digest generated; deliveryStatus=${delivered?.deliveryStatus || 'pending'} target=${delivered?.target || 'none'}`)
} catch (error) {
  writeLog(`boss inbox digest failed: ${error.message}`)
  process.exitCode = 1
}
