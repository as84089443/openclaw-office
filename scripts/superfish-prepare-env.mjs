import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { generateSuperfishRichMenu } from './superfish-rich-menu.mjs'
import {
  DEFAULT_PUBLIC_BASE_URL,
  generateInternalToken,
  hasFlag,
  readEnvMap,
  resolveEnvValue,
  upsertEnvFile,
} from './superfish-utils.mjs'

async function main() {
  const existing = await readEnvMap()
  const skipRichMenu = hasFlag('--skip-rich-menu')
  let richMenuBase64Path = resolveEnvValue('FNB_LINE_RICH_MENU_IMAGE_BASE64_PATH', existing)
  let richMenuBase64 = resolveEnvValue('LINE_RICH_MENU_IMAGE_BASE64', existing) || resolveEnvValue('FNB_LINE_RICH_MENU_IMAGE_BASE64', existing)
  const lineChannelId = resolveEnvValue('LINE_CHANNEL_ID', existing) || resolveEnvValue('FNB_LINE_CHANNEL_ID', existing)
  const lineAccessToken = resolveEnvValue('LINE_CHANNEL_ACCESS_TOKEN', existing) || resolveEnvValue('FNB_LINE_CHANNEL_ACCESS_TOKEN', existing)
  const lineSecret = resolveEnvValue('LINE_CHANNEL_SECRET', existing) || resolveEnvValue('FNB_LINE_CHANNEL_SECRET', existing)
  const lineLoginChannelId = resolveEnvValue('LINE_LOGIN_CHANNEL_ID', existing) || resolveEnvValue('FNB_LINE_LOGIN_CHANNEL_ID', existing)
  const lineLoginSecret = resolveEnvValue('LINE_LOGIN_CHANNEL_SECRET', existing) || resolveEnvValue('FNB_LINE_LOGIN_CHANNEL_SECRET', existing)
  const liffId = resolveEnvValue('NEXT_PUBLIC_LINE_LIFF_ID', existing) || resolveEnvValue('NEXT_PUBLIC_FNB_LINE_LIFF_ID', existing)

  if (!skipRichMenu && !richMenuBase64Path && !richMenuBase64) {
    const richMenu = await generateSuperfishRichMenu({ writeEnv: false })
    richMenuBase64Path = richMenu?.base64Path || ''
  }

  if (richMenuBase64Path) {
    richMenuBase64 = ''
  } else if (richMenuBase64) {
    const richMenu = await generateSuperfishRichMenu({ writeEnv: false })
    richMenuBase64Path = richMenu ? richMenu.base64Path : ''
    richMenuBase64 = ''
  }

  const adminToken = resolveEnvValue('FNB_INTERNAL_API_TOKEN', existing) || generateInternalToken()

  await upsertEnvFile({
    FNB_APP_ENV: 'staging',
    FNB_DEMO_MODE: '0',
    OPENCLAW_OFFICE_DISABLE_GATEWAY: '1',
    FNB_PUBLIC_BASE_URL: resolveEnvValue('FNB_PUBLIC_BASE_URL', existing) || DEFAULT_PUBLIC_BASE_URL,
    FNB_INTERNAL_API_TOKEN: adminToken,
    FNB_LINE_BRAND_NAME: resolveEnvValue('FNB_LINE_BRAND_NAME', existing) || 'BW-Copilot Merchant',
    LINE_CHANNEL_ID: lineChannelId,
    LINE_CHANNEL_ACCESS_TOKEN: lineAccessToken,
    LINE_CHANNEL_SECRET: lineSecret,
    LINE_LOGIN_CHANNEL_ID: lineLoginChannelId,
    LINE_LOGIN_CHANNEL_SECRET: lineLoginSecret,
    NEXT_PUBLIC_LINE_LIFF_ID: liffId,
    FNB_LINE_CHANNEL_ID: lineChannelId,
    FNB_LINE_CHANNEL_ACCESS_TOKEN: lineAccessToken,
    FNB_LINE_CHANNEL_SECRET: lineSecret,
    FNB_LINE_LOGIN_CHANNEL_ID: lineLoginChannelId,
    FNB_LINE_LOGIN_CHANNEL_SECRET: lineLoginSecret,
    NEXT_PUBLIC_FNB_LINE_LIFF_ID: liffId,
    FNB_LINE_RICH_MENU_IMAGE_BASE64_PATH: richMenuBase64Path,
    LINE_RICH_MENU_IMAGE_BASE64: richMenuBase64,
    FNB_LINE_RICH_MENU_IMAGE_BASE64: richMenuBase64,
  })

  console.log(JSON.stringify({
    ok: true,
    envFile: '.env.local',
    baseUrl: resolveEnvValue('FNB_PUBLIC_BASE_URL', existing) || DEFAULT_PUBLIC_BASE_URL,
    lineLoginConfigured: Boolean(lineLoginChannelId && lineLoginSecret),
    liffConfigured: Boolean(liffId),
    richMenuImageConfigured: Boolean(richMenuBase64Path || richMenuBase64),
  }, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
