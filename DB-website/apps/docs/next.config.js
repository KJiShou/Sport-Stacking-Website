/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    typedRoutes: true,
  },
  async rewrites() {
    return [];
  },
  // Add port configuration
  serverOptions: {
    port: 5000
  }
};

module.exports = nextConfig; 