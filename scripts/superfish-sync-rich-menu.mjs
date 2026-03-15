import { pathToFileURL } from 'node:url'
import {
  fetchJson,
  hasFlag,
  readEnvMap,
  requireEnvValue,
  resolveBaseUrl,
  resolveEnvValue,
} from './superfish-utils.mjs'

async function main() {
  const envMap = await readEnvMap()
  const baseUrl = resolveBaseUrl(envMap)
  const adminToken = requireEnvValue('FNB_INTERNAL_API_TOKEN', envMap)
  const liffId = resolveEnvValue('NEXT_PUBLIC_LINE_LIFF_ID', envMap) || resolveEnvValue('NEXT_PUBLIC_FNB_LINE_LIFF_ID', envMap)

  if (!liffId && !hasFlag('--allow-browser-fallback')) {
    throw new Error('NEXT_PUBLIC_LINE_LIFF_ID is missing. Refusing rich menu sync because links would not open LIFF.')
  }

  const result = await fetchJson(`${baseUrl}/api/line/rich-menu/sync`, {
    method: 'POST',
    headers: {
      'x-fnb-admin-token': adminToken,
    },
  })

  console.log(JSON.stringify(result, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
