import BrowserRuntimeDashboard from '../../components/BrowserRuntimeDashboard'
import { getBrowserStackSnapshot } from '../../lib/browser-stack.js'

export const metadata = {
  title: 'BW Browser Runtime',
  description: 'Browser runtime dashboard for real Chrome, MCP, and browser CLI operations.',
}

export const dynamic = 'force-dynamic'

export default async function BrowserPage() {
  const initialSnapshot = await getBrowserStackSnapshot()
  return <BrowserRuntimeDashboard initialSnapshot={initialSnapshot} />
}
