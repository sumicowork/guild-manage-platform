import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pg", "node-cron"],
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  // 容器内存有限，跳过 TypeScript 类型检查避免 OOM
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
