import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  applyClawxDiscordOperatorIngressPatch,
  applyPatchToClawxDiscordBundle,
  PATCH_CHAT_ESCAPE_BYPASS_SENTINEL,
  PATCH_CHAT_ESCAPE_SENTINEL,
  PATCH_CONTENT_OVERRIDE_SENTINEL,
  PATCH_DIAGNOSTIC_SENTINEL,
  PATCH_MENTION_OVERRIDE_SENTINEL,
  isClawxDiscordOperatorIngressPatched,
  isClawxDiscordOperatorIngressPatchCandidate,
  PATCH_SENTINEL,
  verifyClawxDiscordOperatorIngressPatch,
} from '../../scripts/lib/clawx-discord-operator-ingress-patch.mjs'

const fixtureSource = `const DISCORD_BOUND_THREAD_SYSTEM_PREFIXES = [
\t"⚙️",
\t"🤖",
\t"🧰"
];
function isPreflightAborted(abortSignal) {
\treturn Boolean(abortSignal?.aborted);
}
async function preflightDiscordMessage(params) {
\tconst logger = getChildLogger({ module: "discord-auto-reply" });
\tconst message = params.data.message;
\tconst author = params.data.author;
\tif (!author) return null;
\tconst messageChannelId = resolveDiscordMessageChannelId({
\t\tmessage,
\t\teventChannelId: params.data.channel_id
\t});
\tif (!messageChannelId) return null;
\tif (params.botUserId && author.id === params.botUserId) return null;
\tconst botId = params.botUserId;
\tconst mentionGate = { shouldSkip: true };
\tconst isGuildMessage = true;
\tconst shouldRequireMention = true;
\tif (isGuildMessage && shouldRequireMention) {
\t\tif (botId && mentionGate.shouldSkip) {
\t\t\treturn null;
\t\t}
\t}
\treturn { ok: true };
}
`

test('clawx patch applies once and injects the operator ingress shim', () => {
  const result = applyClawxDiscordOperatorIngressPatch(fixtureSource)

  assert.equal(result.changed, true)
  assert.equal(isClawxDiscordOperatorIngressPatched(result.source), true)
  assert.match(result.source, new RegExp(PATCH_SENTINEL))
  assert.match(result.source, new RegExp(PATCH_DIAGNOSTIC_SENTINEL))
  assert.match(result.source, new RegExp(PATCH_CONTENT_OVERRIDE_SENTINEL))
  assert.match(result.source, new RegExp(PATCH_MENTION_OVERRIDE_SENTINEL))
  assert.match(result.source, /maybeRunOpenclawDiscordOperatorIngress/)
  assert.match(result.source, /openclawOperatorIngressDecision/)
  assert.match(result.source, /Object\.defineProperty\(message, "content"/)
  assert.match(result.source, /Object\.defineProperty\(message, "mentionedUsers"/)
  assert.match(result.source, /applyOpenclawDiscordMessageTextOverride\(message, openclawOperatorIngressDecision\.text\)/)
  assert.match(result.source, /applyOpenclawDiscordMentionedUsersOverride\(message, \[\.\.\.existingMentionedUsers, \{ id: params\.botUserId \}\]\)/)
  assert.match(result.source, new RegExp(PATCH_CHAT_ESCAPE_BYPASS_SENTINEL))
})

test('clawx patch upgrades legacy chat-escape blocks to bypass mention gating', () => {
  const first = applyClawxDiscordOperatorIngressPatch(fixtureSource)
  const legacyWithoutBypass = first.source.replace(
    /\t\tmessage\.__openclawChatEscape = true;\n\t\tif \(message\.rawData && typeof message\.rawData === "object"\) \{\n\t\t\tmessage\.rawData\.content = openclawOperatorIngressDecision\.text;\n\t\t\tmessage\.rawData\.__openclawChatEscape = true;\n\t\t\}(\n\t\tif \(params\.botUserId\) \{\n\t\t\tconst existingMentionedUsers = Array\.isArray\(message\.mentionedUsers\) \? message\.mentionedUsers\.filter\(\(user\) => user && typeof user === "object"\) : \[\];\n\t\t\tif \(!existingMentionedUsers\.some\(\(user\) => user\.id === params\.botUserId\)\) message\.mentionedUsers = \[\.\.\.existingMentionedUsers, \{ id: params\.botUserId \}\];\n\t\t\})/,
    '$1',
  ).replace(
    /\tconst openclawChatEscapeBypassesMentionGate = message\.__openclawChatEscape === true \|\| \(message\.rawData && typeof message\.rawData === "object" && message\.rawData\.__openclawChatEscape === true\);\n\tif \(isGuildMessage && shouldRequireMention && !openclawChatEscapeBypassesMentionGate\) \{\n\t\tif \(botId && mentionGate\.shouldSkip\) \{\n/,
    '\tif (isGuildMessage && shouldRequireMention) {\n\t\tif (botId && mentionGate.shouldSkip) {\n',
  )

  const upgraded = applyClawxDiscordOperatorIngressPatch(legacyWithoutBypass)
  assert.equal(upgraded.changed, true)
  assert.equal(isClawxDiscordOperatorIngressPatched(upgraded.source), true)
  assert.match(upgraded.source, new RegExp(PATCH_CHAT_ESCAPE_SENTINEL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.match(upgraded.source, new RegExp(PATCH_CHAT_ESCAPE_BYPASS_SENTINEL))
})

test('clawx patch upgrades patched bundles to safe content override support', () => {
  const first = applyClawxDiscordOperatorIngressPatch(fixtureSource)
  const withoutSafeOverride = first.source
    .replace(
      /function applyOpenclawDiscordMessageTextOverride\(message, nextText\) \{[\s\S]*?\n\}\n/,
      '',
    )
    .replace(
      /\t\tapplyOpenclawDiscordMessageTextOverride\(message, openclawOperatorIngressDecision\.text\);\n/g,
      '\t\tmessage.content = openclawOperatorIngressDecision.text;\n',
    )

  const upgraded = applyClawxDiscordOperatorIngressPatch(withoutSafeOverride)

  assert.equal(upgraded.changed, true)
  assert.equal(isClawxDiscordOperatorIngressPatched(upgraded.source), true)
  assert.match(upgraded.source, new RegExp(PATCH_CONTENT_OVERRIDE_SENTINEL))
  assert.match(upgraded.source, /Object\.defineProperty\(message, "content"/)
  assert.match(upgraded.source, /applyOpenclawDiscordMessageTextOverride\(message, openclawOperatorIngressDecision\.text\)/)
})

test('clawx patch upgrades patched bundles to safe mentionedUsers override support', () => {
  const first = applyClawxDiscordOperatorIngressPatch(fixtureSource)
  const withoutSafeMentionOverride = first.source
    .replace(
      /function applyOpenclawDiscordMentionedUsersOverride\(message, mentionedUsers\) \{[\s\S]*?\n\}\n/,
      '',
    )
    .replace(
      /\t\t\tif \(!existingMentionedUsers\.some\(\(user\) => user\.id === params\.botUserId\)\) applyOpenclawDiscordMentionedUsersOverride\(message, \[\.\.\.existingMentionedUsers, \{ id: params\.botUserId \}\]\);\n/g,
      '\t\t\tif (!existingMentionedUsers.some((user) => user.id === params.botUserId)) message.mentionedUsers = [...existingMentionedUsers, { id: params.botUserId }];\n',
    )

  const upgraded = applyClawxDiscordOperatorIngressPatch(withoutSafeMentionOverride)

  assert.equal(upgraded.changed, true)
  assert.equal(isClawxDiscordOperatorIngressPatched(upgraded.source), true)
  assert.match(upgraded.source, new RegExp(PATCH_MENTION_OVERRIDE_SENTINEL))
  assert.match(upgraded.source, /Object\.defineProperty\(message, "mentionedUsers"/)
  assert.match(upgraded.source, /applyOpenclawDiscordMentionedUsersOverride\(message, \[\.\.\.existingMentionedUsers, \{ id: params\.botUserId \}\]\)/)
})

test('clawx patch is idempotent when the shim is already present', () => {
  const first = applyClawxDiscordOperatorIngressPatch(fixtureSource)
  const second = applyClawxDiscordOperatorIngressPatch(first.source)

  assert.equal(second.changed, false)
  assert.equal(second.source, first.source)
})

test('clawx patch scans and patches every Discord preflight bundle copy', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'clawx-operator-ingress-'))
  const distDir = path.join(root, 'dist')
  const nestedDistDir = path.join(distDir, 'plugin-sdk')
  await mkdir(distDir, { recursive: true })
  await mkdir(nestedDistDir, { recursive: true })

  const bundleA = path.join(distDir, 'discord-demo.js')
  const bundleB = path.join(nestedDistDir, 'reply-demo.js')
  const untouched = path.join(distDir, 'other.js')

  await writeFile(bundleA, fixtureSource, 'utf8')
  await writeFile(bundleB, fixtureSource.replace('return { ok: true };', 'return { ok: "reply" };'), 'utf8')
  await writeFile(untouched, 'export const ok = true;\n', 'utf8')

  const result = await applyPatchToClawxDiscordBundle(root)

  assert.equal(result.bundlePaths.length, 2)
  assert.equal(result.changed, true)
  assert.equal(result.changedCount, 2)

  const sourceA = await readFile(bundleA, 'utf8')
  const sourceB = await readFile(bundleB, 'utf8')
  const sourceUntouched = await readFile(untouched, 'utf8')

  assert.equal(isClawxDiscordOperatorIngressPatched(sourceA), true)
  assert.equal(isClawxDiscordOperatorIngressPatched(sourceB), true)
  assert.equal(sourceUntouched.includes(PATCH_SENTINEL), false)

  const verify = await verifyClawxDiscordOperatorIngressPatch(root)
  assert.equal(verify.bundlePaths.length, 2)
})
