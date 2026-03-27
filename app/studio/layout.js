'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BookOpen, ClipboardList, Building2 } from 'lucide-react'

const tabs = [
  { href: '/studio', label: '內容看板', icon: BookOpen, exact: true },
  { href: '/studio/plan', label: '新建工作包', icon: ClipboardList, exact: false },
  { href: '/studio/businesses', label: '商家管理', icon: Building2, exact: false },
]

export default function StudioLayout({ children }) {
  const pathname = usePathname()

  function isActive(tab) {
    if (tab.exact) return pathname === tab.href
    return pathname.startsWith(tab.href)
  }

  return (
    <div className="min-h-screen">
      {/* Studio sub-nav */}
      <div className="sticky top-[72px] z-40 border-b border-white/8 bg-[#07090e]/80 backdrop-blur-xl md:top-[72px]">
        <div className="mx-auto max-w-7xl px-4">
          <nav className="flex gap-1 overflow-x-auto py-2 scrollbar-none">
            {tabs.map((tab) => {
              const active = isActive(tab)
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className="inline-flex shrink-0 items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition"
                  style={
                    active
                      ? { background: 'rgba(0,245,255,0.12)', color: '#a5f3fc', borderBottom: '2px solid #00f5ff' }
                      : { color: '#6b7280' }
                  }
                >
                  <tab.icon className="h-4 w-4" />
                  {tab.label}
                </Link>
              )
            })}
          </nav>
        </div>
      </div>

      {children}
    </div>
  )
}
