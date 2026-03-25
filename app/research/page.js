import AutoResearchControlRoom from '../../components/AutoResearchControlRoom'

export const metadata = {
  title: 'AutoResearch 控制台 | BW Copilot',
  description: '查看 AutoResearch 的實驗進度、模型策略、QA 檢查與記憶整理交接。',
}

export const dynamic = 'force-dynamic'

export default function ResearchPage() {
  return <AutoResearchControlRoom />
}
