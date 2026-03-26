import StudioContentDetail from '../../../../components/StudioContentDetail'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }) {
  const resolvedParams = await params
  const contentItemId = decodeURIComponent(resolvedParams?.contentItemId || '')
  return {
    title: `內容詳情 | ${contentItemId || 'Studio'} | BW Copilot`,
    description: '查看單支內容的腳本版本、工作包與 Sora 手動操作資訊。',
  }
}

export default async function StudioContentDetailPage({ params }) {
  const resolvedParams = await params
  const contentItemId = decodeURIComponent(resolvedParams?.contentItemId || '')
  return <StudioContentDetail contentItemId={contentItemId} />
}
