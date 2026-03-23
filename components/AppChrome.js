'use client'

import { usePathname } from 'next/navigation'

function NavBar() {
  return (
    <nav className="fixed left-0 right-0 top-0 z-50 border-b border-cyan-500/30 bg-black/80 backdrop-blur-sm">
      <div className="mx-auto flex h-12 max-w-7xl items-center justify-between px-4">
        <div className="flex items-center gap-6">
          <a href="/" className="text-lg font-bold text-cyan-400 transition-colors hover:text-white">
            BW Copilot
          </a>
          <a href="/merchant" className="text-sm text-gray-300 transition-colors hover:text-cyan-400">
            店家工作台
          </a>
          <a href="/ops" className="text-sm text-gray-300 transition-colors hover:text-cyan-400">
            營運總覽
          </a>
          <a href="/browser" className="text-sm text-gray-300 transition-colors hover:text-cyan-400">
            瀏覽器工具
          </a>
          <a href="/office" className="text-sm text-gray-300 transition-colors hover:text-cyan-400">
            老闆收件匣
          </a>
        </div>
        <div className="text-xs text-gray-500">
          老闆收件匣 / 營運總覽 / 瀏覽器工具
        </div>
      </div>
    </nav>
  )
}

export default function AppChrome({ children }) {
  const pathname = usePathname()
  const isMerchantSurface = pathname?.startsWith('/merchant')

  return (
    <>
      {isMerchantSurface ? null : <NavBar />}
      <div className={isMerchantSurface ? '' : 'pt-12'}>
        {children}
      </div>
    </>
  )
}
