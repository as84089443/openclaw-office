'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'
import { ArrowRight, Inbox, ShieldCheck, TerminalSquare } from 'lucide-react'
import BossInboxDashboard from './BossInboxDashboard'

const supportLinks = [
  {
    href: '/ops',
    title: '營運總覽',
    description: '客服、代操、營運流程與商家協作都整理在這裡。',
    icon: ShieldCheck,
    accent: '#39ff14',
  },
  {
    href: '/browser',
    title: '瀏覽器工具',
    description: '常用的連線檢查和操作指令都收在這裡，需要時再進去就好。',
    icon: TerminalSquare,
    accent: '#9d4edd',
  },
]

export default function LegacyOfficeDashboard() {
  return (
    <main className="min-h-screen p-4 lg:p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <motion.section
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card rounded-[32px] p-6 md:p-8"
        >
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/8 px-4 py-2 text-xs uppercase tracking-[0.22em] text-cyan-300">
                <Inbox className="h-3.5 w-3.5" />
                老闆入口
              </div>
              <h1 className="mt-4 font-display text-3xl leading-tight text-white md:text-4xl">
                這裡現在只留下
                <span className="block text-cyan-300">老闆真的要看的事。</span>
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-gray-300 md:text-base">
                我們把這裡整理成比較像辦公入口的樣子，只留下待拍板、重要提醒、每日摘要和交辦，
                其他偏系統操作的內容都移到別的頁面，畫面會乾淨很多。
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:w-[420px]">
              {supportLinks.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-2xl border bg-black/20 p-4 transition hover:-translate-y-0.5"
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
        </motion.section>

        <BossInboxDashboard />
      </div>
    </main>
  )
}
