import { pathToFileURL } from 'node:url'
import {
  fetchJson,
  readEnvMap,
  requireEnvValue,
  resolveMerchantBrandName,
  resolveBaseUrl,
  upsertEnvFile,
  isHttpsUrl,
} from './superfish-utils.mjs'

async function issueLoginChannelAccessToken(channelId, channelSecret) {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: channelId,
    client_secret: channelSecret,
  })

  return fetchJson('https://api.line.me/v2/oauth/accessToken', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  })
}

async function main() {
  const envMap = await readEnvMap()
  const existingLiffId = process.env.NEXT_PUBLIC_LINE_LIFF_ID
    || envMap.NEXT_PUBLIC_LINE_LIFF_ID
    || process.env.NEXT_PUBLIC_FNB_LINE_LIFF_ID
    || envMap.NEXT_PUBLIC_FNB_LINE_LIFF_ID
    || ''
  if (existingLiffId) {
    console.log(JSON.stringify({
      ok: true,
      skipped: true,
      reason: 'NEXT_PUBLIC_LINE_LIFF_ID already configured',
      liffId: existingLiffId,
    }, null, 2))
    return
  }

  const channelId = process.env.LINE_LOGIN_CHANNEL_ID
    || envMap.LINE_LOGIN_CHANNEL_ID
    || requireEnvValue('FNB_LINE_LOGIN_CHANNEL_ID', envMap)
  const channelSecret = process.env.LINE_LOGIN_CHANNEL_SECRET
    || envMap.LINE_LOGIN_CHANNEL_SECRET
    || requireEnvValue('FNB_LINE_LOGIN_CHANNEL_SECRET', envMap)
  const baseUrl = resolveBaseUrl(envMap)
  const brandName = resolveMerchantBrandName(envMap)

  if (!isHttpsUrl(baseUrl)) {
    throw new Error(`FNB_PUBLIC_BASE_URL must be HTTPS before creating LIFF. Received: ${baseUrl}`)
  }

  const loginToken = await issueLoginChannelAccessToken(channelId, channelSecret)
  const liff = await fetchJson('https://api.line.me/liff/v1/apps', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${loginToken.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      view: {
        type: 'full',
        url: `${baseUrl}/merchant`,
      },
      description: brandName,
      features: {
        qrCode: false,
      },
      permanentLinkPattern: 'concat',
      scope: ['openid', 'profile'],
      botPrompt: 'normal',
    }),
  })

  const liffId = liff?.liffId || liff?.view?.liffId
  if (!liffId) {
    throw new Error('LINE LIFF creation succeeded but no LIFF ID was returned')
  }

  await upsertEnvFile({
    NEXT_PUBLIC_LINE_LIFF_ID: liffId,
    NEXT_PUBLIC_FNB_LINE_LIFF_ID: liffId,
  })

  console.log(JSON.stringify({
    ok: true,
    liffId,
    endpointUrl: `${baseUrl}/merchant`,
  }, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
