import BossInboxDashboard from '../../../components/BossInboxDashboard'

export const metadata = {
  title: '龍蝦大腦 | BW Copilot',
  description: '查看 OpenClaw 龍蝦大腦的主任務、子任務、reviewer、verifier 與進度收斂狀態。',
}

export default function OpenClawLobsterBrainPage() {
  return <BossInboxDashboard mode="lobster-only" />
}
