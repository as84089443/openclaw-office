import FnbOpsConsole from '../../components/FnbOpsConsole'

export const metadata = {
  title: '營運總覽 | BW Copilot',
  description: '給客服、代操與營運團隊使用的工作台。',
}

export default function OpsPage() {
  return (
    <main className="min-h-screen p-4 lg:p-6">
      <FnbOpsConsole />
    </main>
  )
}
