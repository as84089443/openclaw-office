import { createHmac, timingSafeEqual } from 'crypto'

function toBase64Url(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function fromBase64Url(value) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
}

function sanitizeFetchError(error) {
  return error instanceof Error ? error.message : 'Unexpected channel error'
}

function readMerchantLineEnv(name, fallbackNames = []) {
  if (process.env[name]) return process.env[name]
  for (const fallback of fallbackNames) {
    if (process.env[fallback]) return process.env[fallback]
  }
  return ''
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options)
  const text = await response.text()
  const data = text ? JSON.parse(text) : {}
  if (!response.ok) {
    throw new Error(data.error_description || data.error?.message || data.error || `${response.status} ${response.statusText}`)
  }
  return data
}

function truncateText(text, maxLength) {
  const value = String(text || '')
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value
}

export function getLineMessagingAdapter() {
  const channelId = readMerchantLineEnv('LINE_CHANNEL_ID', ['FNB_LINE_CHANNEL_ID'])
  const channelAccessToken = readMerchantLineEnv('LINE_CHANNEL_ACCESS_TOKEN', ['FNB_LINE_CHANNEL_ACCESS_TOKEN'])
  const channelSecret = readMerchantLineEnv('LINE_CHANNEL_SECRET', ['FNB_LINE_CHANNEL_SECRET'])
  const loginChannelId = readMerchantLineEnv('LINE_LOGIN_CHANNEL_ID', ['FNB_LINE_LOGIN_CHANNEL_ID'])
  const loginChannelSecret = readMerchantLineEnv('LINE_LOGIN_CHANNEL_SECRET', ['FNB_LINE_LOGIN_CHANNEL_SECRET'])

  return {
    isConfigured() {
      return Boolean(channelId && channelAccessToken && channelSecret)
    },

    isLoginConfigured() {
      return Boolean(loginChannelId && loginChannelSecret)
    },

    buildAuthUrl({ redirectUri, state, nonce = null, scope = ['profile', 'openid'], botPrompt = 'normal' }) {
      if (!loginChannelId) throw new Error('LINE Login is not configured')
      const url = new URL('https://access.line.me/oauth2/v2.1/authorize')
      url.searchParams.set('response_type', 'code')
      url.searchParams.set('client_id', loginChannelId)
      url.searchParams.set('redirect_uri', redirectUri)
      url.searchParams.set('state', state)
      url.searchParams.set('scope', scope.join(' '))
      url.searchParams.set('bot_prompt', botPrompt)
      if (nonce) url.searchParams.set('nonce', nonce)
      return url.toString()
    },

    async exchangeCode({ code, redirectUri }) {
      if (!loginChannelId || !loginChannelSecret) throw new Error('LINE Login is not configured')
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: loginChannelId,
        client_secret: loginChannelSecret,
      })
      const token = await fetchJson('https://api.line.me/oauth2/v2.1/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      })
      const profile = await fetchJson('https://api.line.me/v2/profile', {
        headers: {
          Authorization: `Bearer ${token.access_token}`,
        },
      })

      return {
        accessToken: token.access_token,
        refreshToken: token.refresh_token || null,
        expiresIn: token.expires_in || null,
        scope: token.scope || null,
        idToken: token.id_token || null,
        profile,
      }
    },

    verifyWebhookSignature(rawBody, signature) {
      if (!channelSecret || !signature) return false
      const digest = createHmac('sha256', channelSecret).update(rawBody, 'utf8').digest('base64')
      const left = Buffer.from(digest)
      const right = Buffer.from(signature)
      if (left.length !== right.length) return false
      return timingSafeEqual(left, right)
    },

    parseEventIntent(event) {
      if (event.type === 'postback' && event.postback?.data) {
        return parseLineMerchantCommand(event.postback.data)
      }

      if (event.type === 'message' && event.message?.type === 'text') {
        return parseLineMerchantCommand(event.message.text)
      }

      return null
    },

    async pushMessages(to, messages) {
      if (!channelAccessToken) {
        return { ok: true, mode: 'simulated', reason: 'LINE channel access token missing' }
      }

      try {
        await fetchJson('https://api.line.me/v2/bot/message/push', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${channelAccessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ to, messages }),
        })
        return { ok: true, mode: 'live' }
      } catch (error) {
        return { ok: false, mode: 'live', error: sanitizeFetchError(error) }
      }
    },

    async replyMessages(replyToken, messages) {
      if (!channelAccessToken) {
        return { ok: true, mode: 'simulated', reason: 'LINE channel access token missing' }
      }

      try {
        await fetchJson('https://api.line.me/v2/bot/message/reply', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${channelAccessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ replyToken, messages }),
        })
        return { ok: true, mode: 'live' }
      } catch (error) {
        return { ok: false, mode: 'live', error: sanitizeFetchError(error) }
      }
    },

    async pushText(to, message) {
      return this.pushMessages(to, [{ type: 'text', text: message }])
    },

    async replyText(replyToken, message) {
      return this.replyMessages(replyToken, [{ type: 'text', text: message }])
    },

    async pushApprovalRequest(to, approval) {
      const title = truncateText(approval.title, 40)
      const body = truncateText(approval.body, 90)
      const riskPercent = Math.round(Number(approval.riskScore || 0) * 100)
      const scheduledText = approval.scheduledFor
        ? new Intl.DateTimeFormat('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(approval.scheduledFor))
        : '待排程'

      const buttons = {
        type: 'template',
        altText: `待審核：${title}`,
        template: {
          type: 'buttons',
          title,
          text: truncateText(`${body}\n預計 ${scheduledText} 發送，風險 ${riskPercent}%`, 160),
          actions: [
            { type: 'postback', label: '同意', data: `fnb:approve:${approval.draftId}` },
            { type: 'postback', label: '延後', data: `fnb:reschedule:${approval.draftId}` },
            { type: 'postback', label: '跳過', data: `fnb:skip:${approval.draftId}` },
            approval.liffUrl ? { type: 'uri', label: '查看詳情', uri: approval.liffUrl } : null,
          ].filter(Boolean),
        },
      }

      return this.pushMessages(to, [
        { type: 'text', text: `你有 1 件待審核項目：${title}` },
        buttons,
      ])
    },

    async syncRichMenu({ name, chatBarText, selected = true, size, areas, imageBase64 }) {
      if (!channelAccessToken) {
        return { ok: true, mode: 'simulated', reason: 'LINE channel access token missing' }
      }

      if (!imageBase64) {
        return { ok: false, mode: 'dry-run', error: 'Rich menu image payload missing' }
      }

      try {
        const richMenu = await fetchJson('https://api.line.me/v2/bot/richmenu', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${channelAccessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            size,
            selected,
            name,
            chatBarText,
            areas,
          }),
        })

        await fetch(`https://api-data.line.me/v2/bot/richmenu/${richMenu.richMenuId}/content`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${channelAccessToken}`,
            'Content-Type': 'image/png',
          },
          body: Buffer.from(imageBase64, 'base64'),
        }).then(async (response) => {
          if (!response.ok) {
            throw new Error(await response.text() || `Failed to upload rich menu image (${response.status})`)
          }
        })

        await fetchJson(`https://api.line.me/v2/bot/user/all/richmenu/${richMenu.richMenuId}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${channelAccessToken}`,
          },
        })

        return {
          ok: true,
          mode: 'live',
          richMenuId: richMenu.richMenuId,
        }
      } catch (error) {
        return { ok: false, mode: 'live', error: sanitizeFetchError(error) }
      }
    },
  }
}

export function parseLineMerchantCommand(input) {
  if (!input) return null
  const text = String(input).trim()

  if (text.startsWith('fnb:')) {
    const parts = text.split(':')
    const action = parts[1]
    const draftId = parts[2]
    if (!action) return null
    if (action === 'open') {
      return {
        messageIntent: 'open-liff',
        payload: {
          tab: parts[2] || 'approvals',
          locationId: parts[3] || null,
        },
      }
    }
    if (!draftId) return null
    return {
      messageIntent: action === 'approve' ? 'approve-draft'
        : action === 'reschedule' ? 'reschedule-draft'
          : action === 'skip' ? 'skip-draft'
            : null,
      payload: { draftId },
    }
  }

  const match = text.match(/^(同意|延後|跳過|approve|reschedule|skip)\s+([A-Za-z0-9_-]+)/i)
  if (!match) return null

  const action = match[1].toLowerCase()
  const draftId = match[2]

  if (action === '同意' || action === 'approve') return { messageIntent: 'approve-draft', payload: { draftId } }
  if (action === '延後' || action === 'reschedule') return { messageIntent: 'reschedule-draft', payload: { draftId } }
  if (action === '跳過' || action === 'skip') return { messageIntent: 'skip-draft', payload: { draftId } }
  return null
}

export function getGoogleBusinessAdapter() {
  const clientId = process.env.GOOGLE_CLIENT_ID || ''
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || ''

  return {
    isConfigured() {
      return Boolean(clientId && clientSecret)
    },

    buildAuthUrl({ redirectUri, state, scope = ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/business.manage'] }) {
      if (!clientId) throw new Error('Google OAuth is not configured')
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
      url.searchParams.set('client_id', clientId)
      url.searchParams.set('redirect_uri', redirectUri)
      url.searchParams.set('response_type', 'code')
      url.searchParams.set('access_type', 'offline')
      url.searchParams.set('prompt', 'consent')
      url.searchParams.set('scope', scope.join(' '))
      url.searchParams.set('state', state)
      return url.toString()
    },

    async exchangeCode({ code, redirectUri }) {
      if (!clientId || !clientSecret) throw new Error('Google OAuth is not configured')
      const body = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      })
      return fetchJson('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      })
    },

    async publishDraft(connection, draft, payload = {}) {
      const accessToken = connection?.metadata?.accessToken
      const locationName = connection?.metadata?.locationName
      if (!accessToken || !locationName) {
        return {
          ok: true,
          mode: 'simulated',
          reason: 'Google location auth incomplete',
        }
      }

      try {
        if (draft.draftType === 'review-reply') {
          const reviewId = payload.reviewId || draft.payload?.reviewId
          if (!reviewId) throw new Error('Missing Google reviewId for review reply')
          await fetchJson(`https://mybusiness.googleapis.com/v4/${locationName}/reviews/${reviewId}/reply`, {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ comment: draft.body }),
          })
          return { ok: true, mode: 'live', kind: 'review-reply' }
        }

        await fetchJson(`https://mybusiness.googleapis.com/v4/${locationName}/localPosts`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            languageCode: 'zh-TW',
            summary: draft.body,
            topicType: draft.draftType === 'offpeak-coupon' ? 'OFFER' : 'STANDARD',
            callToAction: payload.ctaUrl ? {
              actionType: 'LEARN_MORE',
              url: payload.ctaUrl,
            } : undefined,
          }),
        })
        return { ok: true, mode: 'live', kind: 'local-post' }
      } catch (error) {
        return {
          ok: false,
          mode: 'live',
          error: sanitizeFetchError(error),
        }
      }
    },
  }
}

export function encodeOAuthState(payload) {
  return toBase64Url(payload)
}

export function decodeOAuthState(payload) {
  return fromBase64Url(payload)
}

export function getOAuthCookieName(provider) {
  return `fnb_oauth_${provider}`
}
