'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'
import { ArrowRight, FlaskConical, Inbox, Sparkles, TerminalSquare } from 'lucide-react'
import BossInboxDashboard from './BossInboxDashboard'
import WorkModeToggle from './WorkModeToggle'

const supportLinks = [
  {
    href: '/browser',
    title: '瀏覽器工具',
    description: '檢查連線、複製指令。',
    icon: TerminalSquare,
    accent: '#9d4edd',
  },
  {
    href: '/research',
    title: '研究控制台',
    description: '看實驗、QA、最近變更。',
    icon: FlaskConical,
    accent: '#ff6b35',
  },
  {
    href: '/studio',
    title: '內容策劃中台',
    description: '繼續做短影音企劃與工作包。',
    icon: Sparkles,
    accent: '#22d3ee',
  },
]

export default function LegacyOfficeDashboard() {
  return (
    <main className="min-h-screen px-4 py-6 lg:px-6 lg:py-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <motion.section
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card rounded-[34px] p-5 md:p-7"
        >
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/25 bg-cyan-500/8 px-4 py-2 text-xs uppercase tracking-[0.22em] text-cyan-300">
                <Inbox className="h-3.5 w-3.5" />
                老闆入口
              </div>
              <h1 className="mt-4 font-display text-3xl leading-tight text-white md:text-4xl">
                只看要拍板的事。
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-gray-400 md:text-base">
                這頁只留決策面。待拍板、風險、機會放中間，其他工具退到右側。
              </p>
            </div>

            <div className="space-y-4">
              <div className="rounded-[28px] border border-white/10 bg-black/20 p-4">
                <div className="mb-3 text-xs uppercase tracking-[0.18em] text-cyan-300">工作模式</div>
                <WorkModeToggle />
              </div>

              <div className="rounded-[28px] border border-white/10 bg-black/20 p-4">
                <div className="mb-3 text-xs uppercase tracking-[0.18em] text-cyan-300">旁路入口</div>
                <div className="space-y-3">
                  {supportLinks.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      {...(item.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                      className="flex items-center justify-between gap-3 rounded-2xl border bg-black/20 px-4 py-3 transition hover:-translate-y-0.5"
                      style={{ borderColor: `${item.accent}30` }}
                    >
                      <div className="flex items-center gap-3">
                        <div className="rounded-2xl p-2.5" style={{ background: `${item.accent}16`, color: item.accent }}>
                          <item.icon className="h-4 w-4" />
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-white">{item.title}</div>
                          <div className="text-xs text-gray-500">{item.description}</div>
                        </div>
                      </div>
                      <ArrowRight className="h-4 w-4 text-gray-500" />
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </motion.section>

        <section className="glass-card overflow-hidden rounded-[32px] p-1">
          <BossInboxDashboard />
        </section>
      </div>
    </main>
  )
}
