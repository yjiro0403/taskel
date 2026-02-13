import createNextIntlPlugin from 'next-intl/plugin';
import type { NextConfig } from "next";

const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/chat',
        destination: '/api/ai/chat',
      },
    ];
  },
};

export default withNextIntl(nextConfig);
