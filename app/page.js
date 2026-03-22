import Link from 'next/link'
import { ArrowRight, Building2, MessageCircleMore, Store, TerminalSquare } from 'lucide-react'

const entryPoints = [
  {
    href: '/merchant',
    title: 'Merchant Copilot',
    subtitle: '店家面',
    description: '給店家直接用的低負擔介面。只看待核准卡、週摘要與少量營業更新。',
    accent: '#00f5ff',
    icon: MessageCircleMore,
  },
  {
    href: '/ops',
    title: 'Ops Console',
    subtitle: '內部營運面',
    description: '給客服、代操、營運看的主控台。看 autopilot 分流、例外、成效與渠道健康。',
    accent: '#39ff14',
    icon: Store,
  },
  {
    href: '/office',
    title: 'BW Office',
    subtitle: 'Boss Inbox',
    description: '給老闆與內部治理的決策入口。只留 attention、digest 與進化治理，不再混 legacy realtime 面板。',
    accent: '#ffb703',
    icon: Building2,
  },
  {
    href: '/browser',
    title: 'Browser Runtime',
    subtitle: 'Chrome / MCP / CLI',
    description: '檢查 real Chrome bridge、CDP targets 與常用 browser 指令，不用回頭翻文件。',
    accent: '#9d4edd',
    icon: TerminalSquare,
  },
]

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-6xl items-center px-4 py-10">
      <div className="w-full space-y-8">
        <section className="glass-card rounded-[32px] p-8 md:p-10">
          <div className="max-w-4xl">
            <div className="mb-4 inline-flex rounded-full border border-cyan-500/30 bg-cyan-500/8 px-4 py-2 text-xs uppercase tracking-[0.22em] text-cyan-300">
              OpenClaw BW Copilot
            </div>
            <h1 className="font-display text-4xl leading-tight text-white md:text-5xl">
              把店家面、營運面、Boss Inbox
              <span className="block text-cyan-300">正式拆開。</span>
            </h1>
            <p className="mt-5 max-w-3xl text-sm leading-8 text-gray-300 md:text-base">
              這個版本的目標很直接：店家不需要學會使用後台，營運團隊有自己的 console，老闆只看 Boss Inbox，
              不再把 legacy realtime debug 面板混在同一個入口。
            </p>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {entryPoints.map((entry) => (
            <Link
              key={entry.href}
              href={entry.href}
              className="glass-card group rounded-[28px] p-6 transition hover:-translate-y-1"
              style={{ borderColor: `${entry.accent}44` }}
            >
              <div className="flex items-start justify-between gap-4">
                <div
                  className="rounded-2xl p-3"
                  style={{ background: `${entry.accent}18`, color: entry.accent }}
                >
                  <entry.icon className="h-6 w-6" />
                </div>
                <ArrowRight className="h-5 w-5 text-gray-500 transition group-hover:translate-x-1 group-hover:text-white" />
              </div>
              <div className="mt-6 text-xs uppercase tracking-[0.22em]" style={{ color: entry.accent }}>
                {entry.subtitle}
              </div>
              <div className="mt-2 text-2xl font-display text-white">{entry.title}</div>
              <div className="mt-3 text-sm leading-7 text-gray-400">{entry.description}</div>
            </Link>
          ))}
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="glass-card rounded-[28px] p-6">
            <div className="text-sm uppercase tracking-[0.18em] text-cyan-300">建議使用順序</div>
            <div className="mt-4 space-y-3 text-sm leading-7 text-gray-300">
              <p>1. 先看 `/merchant`，確認店家真正看到的操作負擔夠低。</p>
              <p>2. 再看 `/ops`，確認 autopilot、例外與成效能被內部接住。</p>
              <p>3. `/browser` 用來檢查 Chrome bridge 與複製正確 browser 指令。</p>
              <p>4. `/office` 只留給 Boss Inbox 與治理操作，不再承擔 legacy realtime runtime 面板。</p>
            </div>
          </div>

          <div className="glass-card rounded-[28px] p-6">
            <div className="text-sm uppercase tracking-[0.18em] text-green-300">部署建議</div>
            <div className="mt-4 space-y-3 text-sm leading-7 text-gray-300">
              <p>本地只留給 demo 與開發；真正給店家用時，請走公開 HTTPS 的 staging / production。</p>
              <p>這個 repo 已補 `render.yaml` 與 cloud-ready 的入口拆分，下一步直接可以推 Render pilot。</p>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
