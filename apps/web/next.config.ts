import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Root CLAUDE.md is the single agent guide; stop Next from generating per-app copies.
  agentRules: false,
  transpilePackages: ["@onestop/ui", "@onestop/types", "@onestop/tool-registry", "@onestop/api"],
  // Native/worker-based PDF libraries must stay outside the bundle: @napi-rs/canvas loads a
  // platform .node binary and pdf.js resolves its fonts/CMaps relative to node_modules.
  serverExternalPackages: ["pdfjs-dist", "@napi-rs/canvas", "pdf-lib"],
};

export default nextConfig;
