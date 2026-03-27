import { Suspense } from 'react'
import StudioPlanPage from '../../../components/StudioPlanPage'

export const metadata = {
  title: '新建工作包 | BW Copilot Studio',
  description: '輸入主題與角度，產出 storyboard、scene pack 和 Sora 手動操作指南。',
}

export default function PlanPage() {
  return (
    <Suspense>
      <StudioPlanPage />
    </Suspense>
  )
}
