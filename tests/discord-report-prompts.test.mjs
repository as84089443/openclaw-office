import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildPrompt,
  getTrackedJobNames,
  readJobsFile,
  syncDiscordReportPrompts,
  validateBuiltPrompt,
  validateJobsFile,
} from '../../scripts/discord-report-prompts.mjs'

const trackedJobs = getTrackedJobNames()

test('every tracked Discord report prompt includes the shared hard-format contract', () => {
  for (const jobName of trackedJobs) {
    const prompt = buildPrompt(jobName)
    const problems = validateBuiltPrompt(jobName, prompt)
    assert.deepEqual(problems, [], `prompt contract drift for ${jobName}`)
    assert.ok(prompt.includes('ChatGPT Atlas'), `${jobName} should prefer Atlas for persistent login web flows`)
  }
})

test('specialized jobs keep the required fish-specific focus', () => {
  const expectations = {
    'qa-healthcheck-daily': ['最先修的 1 件', '明天驗證點'],
    'marketing-inspiration-daily': ['1 個主題', '最小素材需求', '立即可發', 'generate-fish-input-snapshot.mjs --agent marketing'],
    'seo-gsc-daily': ['登入/API blocker', '替代 fallback'],
    'ai-biz-trends-daily': ['1 個 offer', '24 小時內'],
    'production-postshoot-daily': ['已拍數', '待交付數', '下一個交付節點', 'generate-fish-input-snapshot.mjs --agent production'],
    'analyst-growth-loop-weekly': ['本週最強訊號', '待驗證假設', 'memory-distiller'],
    'bizdev-replies-daily': ['generate-fish-input-snapshot.mjs --agent bizdev', 'replyLogExists'],
    'cs-quote-new-case-daily': ['generate-fish-input-snapshot.mjs --agent cs-quote', 'incompleteLeadCount'],
  }

  for (const [jobName, snippets] of Object.entries(expectations)) {
    const prompt = buildPrompt(jobName)
    for (const snippet of snippets) {
      assert.ok(prompt.includes(snippet), `${jobName} should include "${snippet}"`)
    }
  }
})

test('cron jobs file stays synced with the Discord report prompt source of truth', () => {
  const jobsFile = readJobsFile()
  const problems = validateJobsFile(jobsFile)

  assert.deepEqual(problems, [])
})

test('syncDiscordReportPrompts backfills a stable evolution baseline for tracked jobs', () => {
  const baselineAtMs = 1773490878916
  const jobsFile = {
    jobs: [
      {
        id: 'job-a',
        name: 'qa-healthcheck-daily',
        updatedAtMs: baselineAtMs,
        payload: { message: buildPrompt('qa-healthcheck-daily') },
      },
      {
        id: 'job-b',
        name: 'seo-article-daily',
        updatedAtMs: baselineAtMs,
        payload: { message: buildPrompt('seo-article-daily') },
      },
      {
        id: 'job-c',
        name: 'marketing-inspiration-daily',
        updatedAtMs: baselineAtMs + 5000,
        payload: { message: buildPrompt('marketing-inspiration-daily') },
      },
    ],
  }

  const result = syncDiscordReportPrompts(jobsFile, Date.now())
  assert.equal(result.changed, true)
  assert.equal(result.jobsFile.jobs[0].evolutionBaselineAtMs, baselineAtMs)
  assert.equal(result.jobsFile.jobs[1].evolutionBaselineAtMs, baselineAtMs)
})
