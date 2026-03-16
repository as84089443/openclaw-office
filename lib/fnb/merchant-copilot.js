function compactWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

const GENERATE_INTENT_PATTERN = /(幫我寫|寫一篇|寫個|寫一則|寫篇|寫則|做一版|出一版|給我一版|產生|生成|推薦文案|促銷文案|推播文案|貼文文案|晚餐推薦|午餐推薦|下午茶)/i
const REWRITE_INTENT_PATTERN = /(縮短|改短|重寫|再改|調整|換個語氣|換個口吻|更像|優化|潤稿|修改|改成)/i
const EXISTING_DRAFT_REFERENCE_PATTERN = /(剛剛|上一版|上次|這篇|那篇|原本|前一版|剛才)/i
const AFTERNOON_PATTERN = /(下午茶|午茶|甜點|點心|茶|咖啡)/i

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

function hasGenerateIntent(instruction) {
  return GENERATE_INTENT_PATTERN.test(instruction)
}

function hasStrongGenerateIntent(instruction) {
  return /(幫我寫|寫一篇|寫個|寫一則|寫篇|寫則|做一版|出一版|給我一版|產生|生成)/i.test(instruction)
}

function hasRewriteIntent(instruction) {
  return REWRITE_INTENT_PATTERN.test(instruction)
}

function shouldFallbackToExistingDraft(instruction) {
  return EXISTING_DRAFT_REFERENCE_PATTERN.test(instruction) && /(改|縮|重寫|口吻|語氣|調整|優化)/i.test(instruction)
}

export function inferMerchantCopilotRequest(text, thread = null) {
  const instruction = compactWhitespace(text)
  if (!instruction) {
    return { mode: 'help', helpText: buildMerchantCopilotHelpText() }
  }

  const pendingRewriteDraftId = thread?.metadata?.pendingRewriteDraftId || null
  const explicitGenerate = hasGenerateIntent(instruction)
  if (pendingRewriteDraftId && !hasStrongGenerateIntent(instruction)) {
    return {
      mode: 'task',
      taskType: 'rewrite-copy',
      title: '依照商家回覆再改一版',
      sourceDraftId: pendingRewriteDraftId,
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

  if (hasGenerateIntent(instruction)) {
    return {
      mode: 'task',
      taskType: 'generate-copy',
      title: '生成新文案',
      instruction,
      channel: detectChannel(instruction, 'line'),
    }
  }

  if (hasRewriteIntent(instruction)) {
    return {
      mode: 'task',
      taskType: 'rewrite-copy',
      title: '修改既有文案',
      sourceDraftId: null,
      instruction,
      allowSourceDraftFallback: shouldFallbackToExistingDraft(instruction),
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

function normalizeGeneratedDraftTitle(instruction, fallbackTitle = '本週推薦文案') {
  let title = compactWhitespace(instruction)
  title = title.replace(/^(幫我|請|麻煩|可以)?\s*(寫一篇|寫個|寫一則|寫篇|寫則|寫|做一版|出一版|給我一版|產生|生成)\s*/i, '')
  title = title.replace(/[，。！？]+$/g, '')
  if (!title) return fallbackTitle
  return trimText(title, 24)
}

function inferPromotionFrame(instruction) {
  const text = compactWhitespace(instruction)
  if (/晚餐|晚間|晚飯/i.test(text)) {
    return {
      title: '晚餐推薦',
      opening: '這週晚餐時段，如果想吃得舒服一點，可以回來坐一下。',
      googleOpening: '這週晚餐時段，想好好吃一餐的人可以直接記住我們。',
      emphasis: '晚餐主打',
    }
  }
  if (/午餐|中午/i.test(text)) {
    return {
      title: '午餐推薦',
      opening: '這週中午如果想吃得剛剛好，可以回來坐一下。',
      googleOpening: '這週午餐時段，想快速吃好一餐的人可以直接導航過來。',
      emphasis: '午餐主打',
    }
  }
  if (/下午茶|午茶/i.test(text)) {
    return {
      title: '下午茶促銷文案',
      opening: '這週平日下午如果剛好想找個地方坐一下，可以回來吃點喜歡的。',
      googleOpening: '這週平日下午茶時段，想休息一下的人會很適合順路過來。',
      emphasis: '下午茶主打',
    }
  }
  if (/週末|假日/i.test(text)) {
    return {
      title: '週末推薦',
      opening: '這個週末如果想找個熟悉的地方吃飯，可以回來坐一下。',
      googleOpening: '這個週末想聚一下的人，可以先把這家放進清單。',
      emphasis: '週末主打',
    }
  }
  return {
    title: '本週推薦文案',
    opening: '這週如果想吃點熟悉又安心的，可以回來坐一下。',
    googleOpening: '這週如果正在找一間吃得舒服的店，可以先把我們記起來。',
    emphasis: '這週主打',
  }
}

function selectFeaturedItems(context = {}, instruction = '') {
  const rawItems = [
    ...(Array.isArray(context.brandPack?.signatureItems) ? context.brandPack.signatureItems : []),
    ...((context.menuHighlights || []).map((item) => item?.name).filter(Boolean)),
  ]
  const uniqueItems = Array.from(new Set(rawItems.filter(Boolean)))
  if (!uniqueItems.length) return ['招牌餐點']

  const text = compactWhitespace(instruction)
  if (/晚餐|晚間|晚飯/i.test(text)) {
    const dinnerItems = uniqueItems.filter((item) => !AFTERNOON_PATTERN.test(item))
    return (dinnerItems.length ? dinnerItems : uniqueItems).slice(0, 2)
  }
  if (/下午茶|午茶/i.test(text)) {
    const afternoonItems = uniqueItems.filter((item) => AFTERNOON_PATTERN.test(item))
    const fallbackItems = uniqueItems.filter((item) => !afternoonItems.includes(item))
    return [...afternoonItems, ...fallbackItems].slice(0, 2)
  }
  return uniqueItems.slice(0, 2)
}

function buildGeneratedCopy(instruction, context = {}, channel = 'line') {
  const locationName = context.location?.name || '這間店'
  const frame = inferPromotionFrame(instruction)
  const [firstItem, secondItem] = selectFeaturedItems(context, instruction)
  const voice = context.promptProfile?.toneSummary || context.brandPack?.voice || '直接、溫暖、不硬銷'
  const cta = buildCallToAction(context, channel)
  const body = channel === 'google-business-profile'
    ? [
        frame.googleOpening,
        `${locationName} 這次主推 ${firstItem}${secondItem ? `、${secondItem}` : ''}，口吻維持 ${voice}，讓路過的人一眼就知道 ${frame.emphasis} 是什麼。`,
        cta,
      ].join('\n')
    : [
        frame.opening,
        `${locationName} 這次主推 ${firstItem}${secondItem ? `、${secondItem}` : ''}，用 ${voice} 的方式提醒熟客回來吃。`,
        cta,
      ].join('\n')

  return {
    title: normalizeGeneratedDraftTitle(instruction, frame.title),
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

export function shouldUseExistingDraftFallbackForInstruction(instruction) {
  return shouldFallbackToExistingDraft(instruction)
}
