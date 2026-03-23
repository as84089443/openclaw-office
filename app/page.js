import Link from 'next/link'
import { ArrowRight, Building2, MessageCircleMore, Store, TerminalSquare } from 'lucide-react'

const entryPoints = [
  {
    href: '/merchant',
    title: '店家工作台',
    subtitle: '給店家看的',
    description: '給店家直接使用的簡單入口，只看待確認事項、本週重點與少量營業提醒。',
    accent: '#00f5ff',
    icon: MessageCircleMore,
  },
  {
    href: '/ops',
    title: '營運總覽',
    subtitle: '內部協作',
    description: '給客服、代操與營運團隊看的工作台，把例外狀況、追蹤進度和商家協作整理在一起。',
    accent: '#39ff14',
    icon: Store,
  },
  {
    href: '/office',
    title: '老闆收件匣',
    subtitle: '拍板入口',
    description: '給老闆看的重點入口，只留下待拍板、待跟進、每日摘要和重要提醒。',
    accent: '#ffb703',
    icon: Building2,
  },
  {
    href: '/browser',
    title: '瀏覽器工具',
    subtitle: '連線與指令',
    description: '把常用的瀏覽器連線狀態和操作指令整理在一起，要檢查時一頁就夠。',
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
              把店家、營運、老闆入口
              <span className="block text-cyan-300">分開整理。</span>
            </h1>
            <p className="mt-5 max-w-3xl text-sm leading-8 text-gray-300 md:text-base">
              這個版本的目標很簡單：店家看到的是容易上手的工作台，營運團隊有自己的協作頁，
              老闆只看需要拍板與跟進的事，其他工具另外收好，不再全部混在同一個入口。
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
              <p>1. 先看 `/merchant`，確認店家真正看到的操作夠直覺、夠省力。</p>
              <p>2. 再看 `/ops`，確認內部團隊有把例外、進度和協作接住。</p>
              <p>3. `/office` 只留給老闆看重點，不再混進其他操作頁。</p>
              <p>4. `/browser` 則是在要檢查連線或複製常用指令時再打開。</p>
            </div>
          </div>

          <div className="glass-card rounded-[28px] p-6">
            <div className="text-sm uppercase tracking-[0.18em] text-green-300">上線提醒</div>
            <div className="mt-4 space-y-3 text-sm leading-7 text-gray-300">
              <p>本地環境適合 demo 和調整；真的要給店家或內部團隊使用時，走公開 HTTPS 入口會比較順。</p>
              <p>現在入口已經分清楚，後續不管接測試站或正式站，維護起來都會單純很多。</p>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
