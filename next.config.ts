import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true, // TS check is too memory-heavy for 2GB server
  },
  // Standalone output: single-process server (no fork/worker orphan issues with PM2)
  output: "standalone",
  serverExternalPackages: ["pg", "node-cron"],
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
