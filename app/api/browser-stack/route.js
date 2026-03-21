import { getBrowserStackSnapshot } from '../../../lib/browser-stack.js'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return Response.json(await getBrowserStackSnapshot())
  } catch (error) {
    return Response.json({ error: error.message || 'Browser stack API unavailable' }, { status: 500 })
  }
}
