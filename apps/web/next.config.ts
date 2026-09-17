import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Root CLAUDE.md is the single agent guide; stop Next from generating per-app copies.
  agentRules: false,
  transpilePackages: ["@onestop/ui", "@onestop/types", "@onestop/tool-registry"],
};

export default nextConfig;
