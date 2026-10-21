import type { NextConfig } from "next";

const backendUrl = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  // Isolated browser tests use tmp/ output without interrupting the normal dev server.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  // Conversations and button-triggered generation may wait 2000s.
  // Leave 100s for completion/persistence; short endpoints keep their own limits.
  experimental: { proxyTimeout: 2_100_000 },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${backendUrl}/:path*` }];
  },
};

export default nextConfig;



