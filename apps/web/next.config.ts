import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@slopshield/shared'],
  experimental: {},
};

export default nextConfig;
