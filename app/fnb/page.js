import Link from 'next/link'
import { ArrowRight, ShieldCheck, Store } from 'lucide-react'

export const metadata = {
  title: '商家專區 | BW Copilot',
  description: '餐飲商家相關的工作台與營運工具。',
}

const fnbLinks = [
  {
    href: '/merchant',
    title: '店家工作台',
    description: '給店家直接使用的簡單工作台，透過 LINE 登入後操作。',
    icon: Store,
    accent: '#00f5ff',
  },
  {
    href: '/ops',
    title: '營運總覽',
    description: '給客服、代操與營運團隊使用的工作台。',
    icon: ShieldCheck,
    accent: '#39ff14',
  },
]

export default function FnbPage() {
  return (
    <main className="min-h-screen p-4 lg:p-6">
      <div className="mx-auto max-w-3xl">
        <div className="glass-card rounded-[32px] p-6 md:p-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/8 px-4 py-2 text-xs uppercase tracking-[0.22em] text-cyan-300">
            <Store className="h-3.5 w-3.5" />
            商家專區
          </div>
          <h1 className="mt-4 font-display text-3xl leading-tight text-white md:text-4xl">
            餐飲商家
            <span className="block text-cyan-300">工具與營運。</span>
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-gray-300 md:text-base">
            店家工作台和營運總覽都整理在這裡。
          </p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {fnbLinks.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-2xl border bg-black/20 p-5 transition hover:-translate-y-0.5"
                style={{ borderColor: `${item.accent}44` }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div
                    className="rounded-2xl p-3"
                    style={{ background: `${item.accent}18`, color: item.accent }}
                  >
                    <item.icon className="h-5 w-5" />
                  </div>
                  <ArrowRight className="h-4 w-4 text-gray-500" />
                </div>
                <div className="mt-4 font-display text-lg text-white">{item.title}</div>
                <div className="mt-2 text-sm leading-6 text-gray-400">{item.description}</div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </main>
  )
}
