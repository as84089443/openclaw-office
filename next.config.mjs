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
}

export default nextConfig
