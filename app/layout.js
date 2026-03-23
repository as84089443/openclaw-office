import './globals.css'
import AppChrome from '../components/AppChrome'

export const metadata = {
  title: 'BW Copilot 工作入口',
  description: '把店家、營運、老闆與工具入口分開整理的工作台。',
}

export default function RootLayout({ children }) {
  return (
    <html lang="zh-Hant">
      <body className="min-h-screen cyber-grid relative">
        <div className="cyber-rain" />
        <AppChrome>{children}</AppChrome>
      </body>
    </html>
  )
}
