import { access } from 'node:fs/promises'

const OPENCLI_STATUS_URL = 'http://127.0.0.1:19825/status'
const CDP_JSON_URL = 'http://127.0.0.1:19999/json/list'

const SCRIPT_PATHS = {
  browser: '/Users/brian/.local/bin/browser',
  browserCli: '/Users/brian/.openclaw/scripts/browser-cli.sh',
  chromeLauncher: '/Users/brian/.openclaw/scripts/open-in-google-chrome-mcp.sh',
  bbBrowser: '/Users/brian/.openclaw/scripts/bb-browser-real-chrome.sh',
  agentBrowser: '/Users/brian/.openclaw/scripts/agent-browser-real-chrome.sh',
  opencli: '/Users/brian/.openclaw/scripts/opencli-real-chrome.sh',
}

const COMMAND_PRESETS = [
  {
    id: 'doctor',
    label: 'Doctor',
    description: '確認 daemon、Chrome bridge 與 CDP 一次到位。',
    command: 'browser doctor',
    tone: '#00f5ff',
  },
  {
    id: 'chrome-mcp',
    label: 'Chrome + MCP',
    description: '先開真實 Chrome，再接同一個 tab 的 MCP。',
    command: '/Users/brian/.openclaw/scripts/open-in-google-chrome-mcp.sh https://gumroad.com',
    tone: '#39ff14',
  },
  {
    id: 'bb-open',
    label: 'bb-browser',
    description: '快速打開頁面並沿用 real-Chrome bridge。',
    command: 'browser bb open https://example.com',
    tone: '#ffb703',
  },
  {
    id: 'agent-open',
    label: 'agent-browser',
    description: '適合需要 snapshot / click / fill 的細部操作。',
    command: 'browser agent open https://example.com',
    tone: '#9d4edd',
  },
  {
    id: 'opencli-hot',
    label: 'opencli',
    description: '直接用已登入 Chrome 狀態抓站內資料。',
    command: 'browser opencli bilibili hot -f json',
    tone: '#ff006e',
  },
]

async function pathExists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function fetchJson(url) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 1500)
  try {
    const response = await fetch(url, { cache: 'no-store', signal: controller.signal })
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`)
    }
    return await response.json()
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

export async function getBrowserStackSnapshot() {
  const [opencliStatus, cdpTargetsRaw, scriptEntries] = await Promise.all([
    fetchJson(OPENCLI_STATUS_URL),
    fetchJson(CDP_JSON_URL),
    Promise.all(
      Object.entries(SCRIPT_PATHS).map(async ([id, path]) => ({
        id,
        path,
        exists: await pathExists(path),
      })),
    ),
  ])

  const cdpTargets = Array.isArray(cdpTargetsRaw) ? cdpTargetsRaw : []
  const pageTargets = cdpTargets.filter((target) => target?.type === 'page')

  return {
    ready: Boolean(opencliStatus?.extensionConnected) && cdpTargets.length > 0,
    opencliStatus: {
      ok: Boolean(opencliStatus?.ok),
      extensionConnected: Boolean(opencliStatus?.extensionConnected),
      pending: opencliStatus?.pending ?? null,
    },
    cdpTargetCount: cdpTargets.length,
    pageTargetCount: pageTargets.length,
    cdpTargets,
    pageTargets,
    scripts: scriptEntries,
    commandPresets: COMMAND_PRESETS,
    updatedAt: new Date().toISOString(),
  }
}
