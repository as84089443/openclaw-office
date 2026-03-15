import FnbOpsConsole from '../../components/FnbOpsConsole'

export const metadata = {
  title: 'F&B Copilot Ops',
  description: 'Internal operations console for the OpenClaw F&B Copilot.',
}

export default function OpsPage() {
  return (
    <main className="min-h-screen p-4 lg:p-6">
      <FnbOpsConsole />
    </main>
  )
}
