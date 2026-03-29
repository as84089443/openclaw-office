'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Building2,
  FlaskConical,
  Home,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
} from 'lucide-react'
import { resolveCurrentSection } from '../lib/app-chrome-section'

const DESKTOP_NAV_ITEMS = [
  { href: '/', label: '首頁', shortLabel: '首頁', icon: Home, match: (pathname) => pathname === '/' },
  { href: '/ops', label: '營運總覽', shortLabel: '營運', icon: ShieldCheck },
  { href: '/office', label: '老闆收件匣', shortLabel: '老闆', icon: Building2 },
  { href: '/studio', label: '策劃工作台', shortLabel: '策劃', icon: Sparkles },
  { href: '/browser', label: '瀏覽器工具', shortLabel: '瀏覽器', icon: TerminalSquare },
  { href: '/research', label: '研究控制台', shortLabel: '研究', icon: FlaskConical },
]

const MOBILE_NAV_ITEMS = [
  { href: '/', label: '首頁', shortLabel: '首頁', icon: Home, match: (pathname) => pathname === '/' },
  { href: '/ops', label: '營運', shortLabel: '營運', icon: ShieldCheck },
  { href: '/office', label: '老闆', shortLabel: '老闆', icon: Building2 },
  { href: '/studio', label: '策劃', shortLabel: '策劃', icon: Sparkles },
  {
    href: '/browser',
    label: '工具',
    shortLabel: '工具',
    icon: TerminalSquare,
    match: (pathname) => pathname?.startsWith('/browser') || pathname?.startsWith('/research'),
  },
]

function isActive(item, pathname) {
  if (typeof item.match === 'function') return item.match(pathname)
  return pathname?.startsWith(item.href)
}

function DesktopNav({ pathname }) {
  const currentSection = resolveCurrentSection(pathname)

  return (
    <nav className="fixed left-0 right-0 top-0 z-50 hidden border-b border-white/8 bg-[#07090ecc]/90 backdrop-blur-xl md:block">
      <div className="mx-auto flex h-[72px] max-w-7xl items-center justify-between gap-6 px-4">
        <Link href="/" className="flex min-w-0 items-center gap-3 text-white transition hover:text-cyan-200">
          <div className="rounded-2xl border border-cyan-400/30 bg-cyan-500/10 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.26em] text-cyan-300">
            BW
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold">BW Copilot</div>
            <div className="text-xs text-gray-500">入口分流後台</div>
          </div>
        </Link>

        <div className="flex flex-1 justify-center gap-2">
          {DESKTOP_NAV_ITEMS.map((item) => {
            const active = isActive(item, pathname)
            const Icon = item.icon

            return (
              <Link
                key={item.href}
                href={item.href}
                className="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition"
                style={{
                  borderColor: active ? 'rgba(0, 245, 255, 0.3)' : 'rgba(255,255,255,0.08)',
                  background: active ? 'rgba(0, 245, 255, 0.12)' : 'rgba(255,255,255,0.03)',
                  color: active ? '#a5f3fc' : '#d1d5db',
                }}
              >
                <Icon className="h-4 w-4" />
                {item.shortLabel}
              </Link>
            )
          })}
        </div>

        <div className="rounded-full border border-white/8 bg-white/5 px-3 py-1.5 text-xs text-gray-400">
          目前：{currentSection}
        </div>
      </div>
    </nav>
  )
}

function MobileHeader({ pathname }) {
  return (
    <div className="fixed left-0 right-0 top-0 z-50 border-b border-white/8 bg-[#07090ecc]/90 backdrop-blur-xl md:hidden">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4">
        <Link href="/" className="text-sm font-semibold text-white transition hover:text-cyan-200">
          BW Copilot
        </Link>
        <div className="rounded-full border border-white/8 bg-white/5 px-3 py-1.5 text-[11px] text-gray-400">
          {resolveCurrentSection(pathname)}
        </div>
      </div>
    </div>
  )
}

function MobileDock({ pathname }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-50 px-3 pb-[max(env(safe-area-inset-bottom),12px)] md:hidden">
      <div className="mx-auto flex max-w-xl items-center justify-between gap-2 rounded-[28px] border border-white/10 bg-[#090c13]/92 px-3 py-2 backdrop-blur-xl">
        {MOBILE_NAV_ITEMS.map((item) => {
          const active = isActive(item, pathname)
          const Icon = item.icon

          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex min-w-0 flex-1 flex-col items-center gap-1 rounded-[20px] px-2 py-2 text-[11px] transition"
              style={{
                background: active ? 'rgba(0, 245, 255, 0.12)' : 'transparent',
                color: active ? '#a5f3fc' : '#9ca3af',
              }}
            >
              <Icon className="h-4 w-4" />
              <span className="truncate">{item.shortLabel}</span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

export default function AppChrome({ children }) {
  const pathname = usePathname()
  const isMerchantSurface = pathname?.startsWith('/merchant')

  if (isMerchantSurface) {
    return children
  }

  return (
    <>
      <DesktopNav pathname={pathname} />
      <MobileHeader pathname={pathname} />
      <MobileDock pathname={pathname} />
      <div className="pb-24 pt-20 md:pb-0 md:pt-[88px]">
        {children}
      </div>
    </>
  )
}
