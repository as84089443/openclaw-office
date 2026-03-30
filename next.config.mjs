/** @type {import('next').NextConfig} */
const nextConfig = {
  // Use 'standalone' for Docker: set BUILD_STANDALONE=1 or build with Dockerfile
  ...(process.env.BUILD_STANDALONE === '1' ? { output: 'standalone' } : {}),
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Allow WebSocket connections
  serverExternalPackages: ['ws', 'better-sqlite3'],
  headers: async () => [
    {
      // HTML & RSC — 不快取，確保 chunk hash 永遠是最新 build
      source: '/((?!_next/static|_next/image|favicon).*)',
      headers: [
        { key: 'Cache-Control', value: 'no-store, must-revalidate' },
      ],
    },
  ],
  rewrites: async () => {
    const contentforgeOrigin = process.env.CONTENTFORGE_ORIGIN || 'https://contentforge-weld.vercel.app'
    return [
      // Public entry points mounted on copilot.bw-space.com
      { source: '/chat', destination: `${contentforgeOrigin}/chat` },
      { source: '/chat/:path*', destination: `${contentforgeOrigin}/chat/:path*` },
      { source: '/article', destination: `${contentforgeOrigin}/article` },
      { source: '/article/:path*', destination: `${contentforgeOrigin}/article/:path*` },

      // Auth flow + protected follow-up routes used by ContentForge after redirects.
      // Without these, ContentForge redirects users to /login on the copilot domain,
      // which previously landed in openclaw-office and returned 404.
      { source: '/login', destination: `${contentforgeOrigin}/login` },
      { source: '/register', destination: `${contentforgeOrigin}/register` },
      { source: '/pending', destination: `${contentforgeOrigin}/pending` },
      { source: '/onboarding', destination: `${contentforgeOrigin}/onboarding` },
      { source: '/pricing', destination: `${contentforgeOrigin}/pricing` },
      { source: '/dashboard', destination: `${contentforgeOrigin}/dashboard` },
      { source: '/connections', destination: `${contentforgeOrigin}/connections` },
      { source: '/billing', destination: `${contentforgeOrigin}/billing` },
      { source: '/settings', destination: `${contentforgeOrigin}/settings` },
      { source: '/assets', destination: `${contentforgeOrigin}/assets` },
      { source: '/campaigns', destination: `${contentforgeOrigin}/campaigns` },
      { source: '/campaigns/:path*', destination: `${contentforgeOrigin}/campaigns/:path*` },
      { source: '/brand/:path*', destination: `${contentforgeOrigin}/brand/:path*` },
      { source: '/manual', destination: `${contentforgeOrigin}/manual` },
      { source: '/manual/:path*', destination: `${contentforgeOrigin}/manual/:path*` },
      { source: '/api/auth/:path*', destination: `${contentforgeOrigin}/api/auth/:path*` },
    ]
  },
}

export default nextConfig
