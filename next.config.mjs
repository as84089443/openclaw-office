/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Allow WebSocket connections
  serverExternalPackages: ['ws', 'better-sqlite3'],
}

export default nextConfig
