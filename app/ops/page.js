import FnbOpsConsole from '../../components/FnbOpsConsole'

export const metadata = {
  title: 'BW Copilot Ops',
  description: 'Internal operations console for the OpenClaw BW Copilot.',
}

export default function OpsPage() {
  return (
    <main className="min-h-screen p-4 lg:p-6">
      <FnbOpsConsole />
    </main>
  )
}
