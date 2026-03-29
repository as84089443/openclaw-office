export function resolveCurrentSection(pathname) {
  if (pathname?.startsWith('/office/openclaw')) return '龍蝦大腦'
  if (pathname === '/') return '首頁'
  if (pathname?.startsWith('/ops')) return '營運總覽'
  if (pathname?.startsWith('/office')) return '老闆收件匣'
  if (pathname?.startsWith('/studio')) return '策劃工作台'
  if (pathname?.startsWith('/browser')) return '瀏覽器工具'
  if (pathname?.startsWith('/research')) return '研究控制台'
  if (pathname?.startsWith('/merchant')) return '店家工作台'
  if (!pathname) return '首頁'
  return '控制台'
}
