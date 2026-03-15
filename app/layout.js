import './globals.css'
import AppChrome from '../components/AppChrome'

export const metadata = {
  title: 'OpenClaw F&B Copilot',
  description: 'Merchant-facing and ops-facing surfaces for the OpenClaw restaurant growth copilot.',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="min-h-screen cyber-grid relative">
        <div className="cyber-rain" />
        <AppChrome>{children}</AppChrome>
      </body>
    </html>
  )
}
