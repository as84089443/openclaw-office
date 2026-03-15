import { pathToFileURL } from 'node:url'
import { readFile } from 'node:fs/promises'
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
  const richMenuImageBase64 = resolveEnvValue('LINE_RICH_MENU_IMAGE_BASE64', envMap)
    || resolveEnvValue('FNB_LINE_RICH_MENU_IMAGE_BASE64', envMap)
  const richMenuImageBase64Path = resolveEnvValue('FNB_LINE_RICH_MENU_IMAGE_BASE64_PATH', envMap)
    || resolveEnvValue('LINE_RICH_MENU_IMAGE_BASE64_PATH', envMap)

  if (!liffId && !hasFlag('--allow-browser-fallback')) {
    throw new Error('NEXT_PUBLIC_LINE_LIFF_ID is missing. Refusing rich menu sync because links would not open LIFF.')
  }

  let imageBase64 = richMenuImageBase64 || null
  if (!imageBase64 && richMenuImageBase64Path) {
    imageBase64 = (await readFile(richMenuImageBase64Path, 'utf8')).trim()
  }

  const result = await fetchJson(`${baseUrl}/api/line/rich-menu/sync`, {
    method: 'POST',
    headers: {
      'x-fnb-admin-token': adminToken,
      'content-type': 'application/json',
    },
    body: JSON.stringify(imageBase64 ? { imageBase64 } : {}),
  })

  console.log(JSON.stringify(result, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
