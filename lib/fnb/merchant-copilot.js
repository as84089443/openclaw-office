function compactWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function trimText(value, maxLength) {
  const text = compactWhitespace(value)
  if (!text || text.length <= maxLength) return text
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`
}

function detectChannel(instruction, fallback = 'line') {
  const text = compactWhitespace(instruction)
  if (/google|商家|地圖/i.test(text)) return 'google-business-profile'
  if (/line|推播|官方\s*line|訊息/i.test(text)) return 'line'
  return fallback
}

function buildSummaryText(instruction, context = {}) {
  const locationName = context.location?.name || '這間店'
  const voice = context.promptProfile?.toneSummary || context.brandPack?.voice || '直接、溫暖、不硬銷'
  return [
    `我理解你的需求是：${instruction}`,
    `${locationName} 目前建議延續「${voice}」的口吻，先做一版可直接核准的草稿。`,
  ].join('\n')
}

export function buildMerchantCopilotHelpText() {
  return [
    '你可以直接跟我說想要的文案方向。',
    '例如：幫我寫這週平日下午茶促銷文案',
    '或：把剛剛那篇縮短到適合 LINE 推播',
  ].join('\n')
}

export function inferMerchantCopilotRequest(text, thread = null) {
  const instruction = compactWhitespace(text)
  if (!instruction) {
    return { mode: 'help', helpText: buildMerchantCopilotHelpText() }
  }

  const pendingRewriteDraftId = thread?.metadata?.pendingRewriteDraftId || null
  if (pendingRewriteDraftId) {
    return {
      mode: 'task',
      taskType: 'rewrite-copy',
      title: '依照商家回覆再改一版',
      sourceDraftId: pendingRewriteDraftId,
      instruction,
      channel: detectChannel(instruction, 'line'),
    }
  }

  if (/(縮短|改短|重寫|再改|調整|換個語氣|口吻|更像|優化|潤稿|修改)/.test(instruction)) {
    return {
      mode: 'task',
      taskType: 'rewrite-copy',
      title: '修改既有文案',
      sourceDraftId: null,
      instruction,
      channel: detectChannel(instruction, 'line'),
    }
  }

  if (/(整理|摘要|重點|先幫我整理)/.test(instruction)) {
    return {
      mode: 'task',
      taskType: 'summarize-merchant-request',
      title: '整理商家需求',
      instruction,
      channel: 'line',
    }
  }

  if (/(文案|貼文|推播|內容|促銷|活動|公告|發文|google|line|幫我寫|寫一篇|寫個)/i.test(instruction)) {
    return {
      mode: 'task',
      taskType: 'generate-copy',
      title: '生成新文案',
      instruction,
      channel: detectChannel(instruction, 'line'),
    }
  }

  return { mode: 'help', helpText: buildMerchantCopilotHelpText() }
}

function buildCallToAction(context = {}, channel = 'line') {
  const fromProfile = context.promptProfile?.preferredCtas?.find(Boolean)
  if (fromProfile) return fromProfile
  return channel === 'google-business-profile' ? '歡迎直接導航過來' : '想吃的話直接回我或點一下就好'
}

function buildGeneratedCopy(instruction, context = {}, channel = 'line') {
  const locationName = context.location?.name || '這間店'
  const signatureItems = context.brandPack?.signatureItems || []
  const firstItem = signatureItems[0] || context.menuHighlights?.[0]?.name || '招牌餐點'
  const secondItem = signatureItems[1] || context.menuHighlights?.[1]?.name || null
  const voice = context.promptProfile?.toneSummary || context.brandPack?.voice || '直接、溫暖、不硬銷'
  const cta = buildCallToAction(context, channel)
  const body = channel === 'google-business-profile'
    ? [
        `${locationName} 這週想先把 ${firstItem}${secondItem ? `、${secondItem}` : ''} 推出來。`,
        `口吻維持 ${voice}，讓路過或正在找餐的人一眼就知道這週主打是什麼。`,
        cta,
      ].join('\n')
    : [
        `${locationName} 這週想先照顧平日下午的熟客。`,
        `主推 ${firstItem}${secondItem ? `、${secondItem}` : ''}，用 ${voice} 的方式提醒大家回來吃。`,
        cta,
      ].join('\n')

  return {
    title: trimText(`依需求生成：${instruction}`, 28),
    body: trimText(body, channel === 'line' ? 130 : 220),
    channel,
    draftType: channel === 'google-business-profile' ? 'google-update' : 'merchant-generated-copy',
    route: 'merchant-approve',
    summaryText: buildSummaryText(instruction, context),
  }
}

function buildRewrittenCopy(instruction, context = {}, channel = 'line') {
  const sourceDraft = context.sourceDraft || null
  const baseTitle = sourceDraft?.title || '既有文案'
  let baseBody = compactWhitespace(sourceDraft?.body || '')
  if (!baseBody) {
    return buildGeneratedCopy(instruction, context, channel)
  }

  const cta = buildCallToAction(context, channel)
  if (/(縮短|精簡|推播)/.test(instruction)) {
    baseBody = trimText(baseBody, 65)
  }

  if (/(熟客|溫暖|口吻|更像)/.test(instruction)) {
    baseBody = `老朋友，${baseBody.replace(/^[，。\s]+/, '')}`
  }

  if (!baseBody.includes(cta)) {
    baseBody = `${baseBody}\n${cta}`
  }

  return {
    title: trimText(`改寫：${baseTitle}`, 28),
    body: trimText(baseBody, channel === 'line' ? 130 : 220),
    channel: sourceDraft?.channel || channel,
    draftType: sourceDraft?.draftType || (channel === 'google-business-profile' ? 'google-update' : 'copy-revision'),
    route: 'merchant-approve',
    summaryText: buildSummaryText(instruction, context),
  }
}

export function buildFallbackMerchantCopilotResult(task) {
  const context = task?.context || {}
  const instruction = compactWhitespace(task?.instructionText || '')
  const channel = detectChannel(instruction, context.sourceDraft?.channel || 'line')

  if (task?.taskType === 'summarize-merchant-request') {
    return {
      kind: 'summary',
      summaryText: buildSummaryText(instruction, context),
    }
  }

  if (task?.taskType === 'rewrite-copy') {
    return {
      kind: 'draft',
      draft: buildRewrittenCopy(instruction, context, channel),
    }
  }

  return {
    kind: 'draft',
    draft: buildGeneratedCopy(instruction, context, channel),
  }
}

export function buildPromptProfileDefaults({ merchantProfile = null, brandPack = null } = {}) {
  return {
    preferredLanguage: 'zh-TW',
    toneSummary: merchantProfile?.toneSummary || brandPack?.voice || '直接、溫暖、不硬銷',
    forbiddenPhrases: Array.isArray(brandPack?.guardrails) ? brandPack.guardrails : [],
    preferredCtas: ['想吃直接私訊我', '現在導航過來', '有問題直接回覆'],
    promoPreferences: {
      lowTouch: merchantProfile?.lowTouchMode !== false,
      weeklyTimeBudgetMinutes: merchantProfile?.weeklyTimeBudgetMinutes || 15,
    },
  }
}
