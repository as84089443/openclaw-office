import Link from 'next/link'
import SystemMonitor from '../components/SystemMonitor'
import {
  ArrowRight,
  Building2,
  ExternalLink,
  FlaskConical,
  MessageCircleMore,
  PenLine,
  ShieldCheck,
  Sparkles,
  Store,
  TerminalSquare,
} from 'lucide-react'

const primaryEntries = [
  {
    href: '/merchant',
    title: '店家工作台',
    hint: '待審核、顧客、摘要',
    accent: '#00f5ff',
    icon: MessageCircleMore,
    tag: '店家',
  },
  {
    href: '/ops',
    title: '營運總覽',
    hint: 'onboarding、例外、協作',
    accent: '#39ff14',
    icon: ShieldCheck,
    tag: '內部',
  },
  {
    href: '/office',
    title: '老闆收件匣',
    hint: '拍板、跟進、摘要',
    accent: '#ffb703',
    icon: Building2,
    tag: '決策',
  },
  {
    href: '/studio',
    title: '內容策劃中台',
    hint: '內容庫、腳本、Sora',
    accent: '#9d4edd',
    icon: Sparkles,
    tag: '內容',
  },
  {
    href: '/writer',
    title: 'AI 自動筆',
    hint: 'GPT-5.4 產文、佇列、發布',
    accent: '#ff6b35',
    icon: PenLine,
    tag: '產文',
  },
]


const utilityEntries = [
  {
    href: '/browser',
    title: '瀏覽器工具',
    accent: '#8b5cf6',
    icon: TerminalSquare,
  },
  {
    href: '/research',
    title: '研究控制台',
    accent: '#ff6b35',
    icon: FlaskConical,
  },
  {
    href: 'https://dialogueflow.bw-space.com',
    title: '對話助手',
    accent: '#00d1ff',
    icon: MessageCircleMore,
    external: true,
  },
]

const environmentEntries = [
  {
    label: '公開',
    value: 'copilot.bw-space.com',
    href: 'https://copilot.bw-space.com',
    accent: '#39ff14',
    external: true,
  },
  {
    label: '本機',
    value: '127.0.0.1:4201',
    accent: '#00f5ff',
  },
]

function PrimaryEntryCard({ entry }) {
  const Icon = entry.icon

  return (
    <Link
      href={entry.href}
      className="group relative overflow-hidden rounded-[28px] border px-4 py-5 transition hover:-translate-y-1"
      style={{
        borderColor: `${entry.accent}30`,
        background: `linear-gradient(180deg, ${entry.accent}10, rgba(8,12,18,0.32))`,
      }}
    >
      <div className="pointer-events-none absolute inset-0 opacity-70" style={{ background: `radial-gradient(circle at top right, ${entry.accent}22, transparent 55%)` }} />
      <div className="relative flex h-full flex-col">
        <div className="flex items-start justify-between gap-3">
          <div className="rounded-2xl p-3" style={{ background: `${entry.accent}16`, color: entry.accent }}>
            <Icon className="h-5 w-5" />
          </div>
          <div className="rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.18em]" style={{ borderColor: `${entry.accent}33`, color: entry.accent }}>
            {entry.tag}
          </div>
        </div>

        <div className="mt-8 text-lg font-display leading-tight text-white md:text-[1.65rem]">
          {entry.title}
        </div>
        <div className="mt-2 text-sm text-gray-400">{entry.hint}</div>

        <div className="mt-6 inline-flex items-center gap-2 text-sm font-medium" style={{ color: entry.accent }}>
          進入
          <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
        </div>
      </div>
    </Link>
  )
}

function UtilityLink({ entry }) {
  const Icon = entry.icon

  return (
    <Link
      href={entry.href}
      {...(entry.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm text-gray-200 transition hover:-translate-y-0.5 hover:text-white"
      style={{
        borderColor: `${entry.accent}30`,
        background: `${entry.accent}10`,
      }}
    >
      <Icon className="h-4 w-4" style={{ color: entry.accent }} />
      <span>{entry.title}</span>
      {entry.external ? <ExternalLink className="h-3.5 w-3.5 text-gray-500" /> : null}
    </Link>
  )
}

export default function HomePage() {
  return (
    <main className="mx-auto min-h-screen max-w-7xl px-4 py-6 md:py-8">
      <div className="space-y-6">
        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.08fr)_360px]">
          <div className="glass-card rounded-[34px] p-5 md:p-7">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/25 bg-cyan-500/8 px-3 py-1.5 text-[11px] uppercase tracking-[0.22em] text-cyan-300">
              <Store className="h-3.5 w-3.5" />
              BW Copilot
            </div>

            <div className="mt-5 max-w-2xl">
              <h1 className="font-display text-4xl leading-none text-white md:text-[3.6rem]">
                先選頁，
                <span className="block text-cyan-300">再做事。</span>
              </h1>
              <p className="mt-4 text-sm leading-7 text-gray-400 md:text-base">
                入口拆開後，每一頁只做一種事。店家、營運、老闆、內容策劃各走各的，不再互相干擾。
              </p>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {primaryEntries.map((entry) => (
                <PrimaryEntryCard key={entry.href} entry={entry} />
              ))}
            </div>
          </div>

          <section className="glass-card rounded-[34px] p-4 md:p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-[0.18em] text-green-300">效能概覽</div>
                <div className="mt-1 text-sm text-gray-400">先看狀態，再決定去哪裡。</div>
              </div>
            </div>
            <div className="mt-4">
              <SystemMonitor compact />
            </div>
          </section>
        </section>

        <section className="glass-card rounded-[30px] p-4 md:p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <div className="text-xs uppercase tracking-[0.18em] text-orange-300">工具與位址</div>
              <div className="mt-1 text-sm text-gray-400">工具留在第二層，需要時再打開。</div>
            </div>

            <div className="flex flex-wrap gap-2">
              {utilityEntries.map((entry) => (
                <UtilityLink key={entry.href} entry={entry} />
              ))}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {environmentEntries.map((entry) => (
              entry.external ? (
                <Link
                  key={entry.label}
                  href={entry.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm text-white transition hover:-translate-y-0.5"
                  style={{ borderColor: `${entry.accent}30`, background: `${entry.accent}10` }}
                >
                  <span className="text-[11px] uppercase tracking-[0.18em]" style={{ color: entry.accent }}>{entry.label}</span>
                  <span>{entry.value}</span>
                  <ExternalLink className="h-3.5 w-3.5 text-gray-500" />
                </Link>
              ) : (
                <div
                  key={entry.label}
                  className="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm text-white"
                  style={{ borderColor: `${entry.accent}30`, background: `${entry.accent}10` }}
                >
                  <span className="text-[11px] uppercase tracking-[0.18em]" style={{ color: entry.accent }}>{entry.label}</span>
                  <span>{entry.value}</span>
                </div>
              )
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}
