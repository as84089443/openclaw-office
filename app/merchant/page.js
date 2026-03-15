import { Suspense } from 'react'
import FnbMerchantSurface from '../../components/FnbMerchantSurface'

export const metadata = {
  title: 'F&B Merchant Copilot',
  description: 'Merchant-facing low-touch restaurant growth copilot.',
}

export default function MerchantPage() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-md px-4 py-8"><div className="glass-card rounded-[28px] p-6 text-sm text-gray-300">載入商家工作台…</div></main>}>
      <FnbMerchantSurface />
    </Suspense>
  )
}
