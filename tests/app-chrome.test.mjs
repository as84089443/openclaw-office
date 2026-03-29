import test from 'node:test'
import assert from 'node:assert/strict'

import { resolveCurrentSection } from '../lib/app-chrome-section.js'

test('resolveCurrentSection marks /office/openclaw as lobster brain', () => {
  assert.equal(resolveCurrentSection('/office/openclaw'), '龍蝦大腦')
  assert.equal(resolveCurrentSection('/office/openclaw/details'), '龍蝦大腦')
})

test('resolveCurrentSection keeps regular office surface label', () => {
  assert.equal(resolveCurrentSection('/office'), '老闆收件匣')
})
