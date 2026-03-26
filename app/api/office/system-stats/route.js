import { execSync } from 'node:child_process'
import os from 'node:os'
import { NextResponse } from 'next/server'
import { assertOfficeApiRequest } from '../../../../lib/office-route-auth.js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ─── 核心服務定義（label → 顯示名稱 + 預期 port）─────────────────────────
const SERVICES = [
  { label: 'ai.openclaw.gateway',           name: 'Gateway',          port: 18789, core: true,  desc: 'OpenClaw 核心閘道' },
  { label: 'ai.openclaw.gpt-proxy',         name: 'GPT Proxy',        port: null,  core: true,  desc: 'LLM 代理轉發' },
  { label: 'ai.openclaw.copilot-tunnel',    name: 'Copilot Tunnel',   port: null,  core: true,  desc: 'Cloudflare Tunnel 對外' },
  { label: 'ai.openclaw.office',            name: 'Office UI',        port: 4300,  core: true,  desc: '老闆入口介面' },
  { label: 'homebrew.mxcl.cliproxyapi',     name: 'CLI Proxy API',    port: null,  core: true,  desc: 'GPT Proxy 上游 API' },
  { label: 'ai.openclaw.n8n',               name: 'n8n',              port: 5678,  core: false, desc: '自動化排程引擎' },
  { label: 'ai.openclaw.merchant-copilot-worker', name: 'Merchant Worker', port: null, core: false, desc: '商家 Copilot 背景' },
  { label: 'com.bw.openclaw-control-center', name: 'Control Center', port: null,  core: false, desc: 'OpenClaw 控制台' },
  { label: 'com.bw.opencli-daemon',         name: 'OpenCLI Daemon',   port: null,  core: false, desc: 'CLI 背景服務' },
  { label: 'com.bw.opencli-bridge-chrome',  name: 'Chrome Bridge',    port: null,  core: false, desc: '瀏覽器自動化橋接' },
  { label: 'com.bwstudio.studio-booking-form-pull', name: 'Studio Form Pull', port: null, core: false, desc: '攝影棚表單同步' },
  { label: 'homebrew.mxcl.colima',          name: 'Colima (Docker)',  port: null,  core: false, desc: '容器引擎' },
]

// ─── helpers ──────────────────────────────────────────────────────────────

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 4000 }).trim()
  } catch {
    return ''
  }
}

/** macOS CPU 用量（%) — 以 top 瞬間取樣 */
function getCpuPercent() {
  // top -l 1 -n 0 -s 0 → 取 CPU usage 行
  const out = run("top -l 1 -n 0 -s 0 | grep 'CPU usage'")
  // e.g. "CPU usage: 12.5% user, 8.3% sys, 79.1% idle"
  const idleMatch = out.match(/([\d.]+)%\s+idle/)
  if (idleMatch) return Math.round(100 - parseFloat(idleMatch[1]))
  return null
}

/** macOS 記憶體（bytes）via vm_stat */
function getMemory() {
  const totalBytes = os.totalmem()
  const freeBytes  = os.freemem()
  const usedBytes  = totalBytes - freeBytes

  // 嘗試從 vm_stat 讀取 wired + active（更精確的「真正在用」）
  const vmOut = run('vm_stat')
  let activeBytes = null
  const pageSize = 16384 // macOS Apple Silicon 通常是 16 KB
  const wired   = vmOut.match(/Pages wired down:\s+(\d+)/)
  const active  = vmOut.match(/Pages active:\s+(\d+)/)
  if (wired && active) {
    activeBytes = (parseInt(wired[1]) + parseInt(active[1])) * pageSize
  }

  return {
    total: totalBytes,
    used: usedBytes,
    active: activeBytes ?? usedBytes,
    free: freeBytes,
    percentUsed: Math.round((usedBytes / totalBytes) * 100),
    percentActive: activeBytes ? Math.round((activeBytes / totalBytes) * 100) : null,
  }
}

/** 磁碟使用（/) */
function getDisk() {
  const out = run("df -k / | tail -1")
  // Filesystem  1024-blocks   Used  Available Capacity
  const parts = out.split(/\s+/)
  if (parts.length < 5) return null
  const total = parseInt(parts[1]) * 1024
  const used  = parseInt(parts[2]) * 1024
  const avail = parseInt(parts[3]) * 1024
  const pct   = parseInt(parts[4])
  return { total, used, available: avail, percentUsed: isNaN(pct) ? null : pct }
}

/** launchctl 是否在 gui domain 中已載入 */
function serviceIsLoaded(label) {
  const uid = run('id -u')
  const out = run(`launchctl list ${label} 2>/dev/null`)
  return out.length > 0 && !out.includes('Could not find service')
}

/** lsof 抓 TCP LISTEN port → pid */
function getListeningPorts() {
  const out = run("lsof -nP -iTCP -sTCP:LISTEN")
  const map = {} // port → { pid, name }
  for (const line of out.split('\n').slice(1)) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 9) continue
    const name = parts[0]
    const pid  = parts[1]
    const addr = parts[8] // e.g. *:18789
    const portMatch = addr.match(/:(\d+)$/)
    if (portMatch) map[parseInt(portMatch[1])] = { pid, name }
  }
  return map
}

/** 系統負載 */
function getLoadAvg() {
  const [one, five, fifteen] = os.loadavg()
  return { one: +one.toFixed(2), five: +five.toFixed(2), fifteen: +fifteen.toFixed(2) }
}

// ─── 主要 GET handler ──────────────────────────────────────────────────────

export async function GET(request) {
  try {
    assertOfficeApiRequest(request)

    const [cpuPercent, memory, disk, listeningPorts] = await Promise.all([
      Promise.resolve(getCpuPercent()),
      Promise.resolve(getMemory()),
      Promise.resolve(getDisk()),
      Promise.resolve(getListeningPorts()),
    ])

    const cpuCount  = os.cpus().length
    const loadAvg   = getLoadAvg()
    const uptimeSec = os.uptime()

    // 組服務狀態
    const services = SERVICES.map((svc) => {
      const running = serviceIsLoaded(svc.label)
      const portInfo = svc.port ? listeningPorts[svc.port] : null
      return {
        label:   svc.label,
        name:    svc.name,
        desc:    svc.desc,
        port:    svc.port,
        core:    svc.core,
        running,
        portOpen: svc.port ? Boolean(portInfo) : null,
        pid:     portInfo?.pid ?? null,
      }
    })

    // 額外抓所有 BW 相關的監聽 port（超出 SERVICES 定義的）
    const knownPorts = new Set(SERVICES.map(s => s.port).filter(Boolean))
    const extraPorts = Object.entries(listeningPorts)
      .filter(([port]) => !knownPorts.has(parseInt(port)))
      .filter(([, info]) => {
        // 只留 openclaw / bw 相關
        const n = (info.name || '').toLowerCase()
        return n.includes('node') || n.includes('openclaw') || n.includes('python') || n.includes('ruby')
      })
      .slice(0, 20)
      .map(([port, info]) => ({ port: parseInt(port), pid: info.pid, process: info.name }))

    return NextResponse.json({
      ok: true,
      ts: new Date().toISOString(),
      cpu: { percent: cpuPercent, count: cpuCount, loadAvg },
      memory,
      disk,
      uptimeSec,
      services,
      extraPorts,
    })
  } catch (error) {
    const status = error?.name === 'OfficeRequestAuthError' ? 401 : 500
    return NextResponse.json({ ok: false, error: error.message }, { status })
  }
}
