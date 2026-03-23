import BrowserRuntimeDashboard from '../../components/BrowserRuntimeDashboard'

export const metadata = {
  title: '瀏覽器工具 | BW Copilot',
  description: '查看瀏覽器連線狀態與常用操作指令。',
}

export const dynamic = 'force-dynamic'

export default function BrowserPage() {
  return <BrowserRuntimeDashboard />
}
