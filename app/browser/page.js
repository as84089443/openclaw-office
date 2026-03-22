import BrowserRuntimeDashboard from '../../components/BrowserRuntimeDashboard'

export const metadata = {
  title: 'BW Browser Runtime',
  description: 'Browser runtime dashboard for real Chrome, MCP, and browser CLI operations.',
}

export const dynamic = 'force-dynamic'

export default function BrowserPage() {
  return <BrowserRuntimeDashboard />
}
