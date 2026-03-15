import { pathToFileURL } from 'node:url'
import {
  fetchJson,
  hasFlag,
  readEnvMap,
  requireEnvValue,
  resolveBaseUrl,
  isHttpsUrl,
} from './superfish-utils.mjs'

async function lineApi(path, accessToken, options = {}) {
  return fetchJson(`https://api.line.me${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
}

async function main() {
  const envMap = await readEnvMap()
  const baseUrl = resolveBaseUrl(envMap)
  if (!isHttpsUrl(baseUrl)) {
    throw new Error(`FNB_PUBLIC_BASE_URL must be HTTPS before configuring webhook. Received: ${baseUrl}`)
  }

  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN
    || envMap.LINE_CHANNEL_ACCESS_TOKEN
    || requireEnvValue('FNB_LINE_CHANNEL_ACCESS_TOKEN', envMap)
  const endpoint = `${baseUrl}/api/line/webhook`

  await lineApi('/v2/bot/channel/webhook/endpoint', accessToken, {
    method: 'PUT',
    body: JSON.stringify({ endpoint }),
  })

  const status = await lineApi('/v2/bot/channel/webhook/endpoint', accessToken, {
    method: 'GET',
  })

  let test = null
  if (!hasFlag('--skip-test')) {
    test = await lineApi('/v2/bot/channel/webhook/test', accessToken, {
      method: 'POST',
      body: JSON.stringify({ endpoint }),
    })
  }

  console.log(JSON.stringify({
    ok: true,
    endpoint,
    status,
    test,
  }, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
