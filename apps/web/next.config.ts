import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Root CLAUDE.md is the single agent guide; stop Next from generating per-app copies.
  agentRules: false,
  transpilePackages: ["@onestop/ui", "@onestop/types", "@onestop/tool-registry", "@onestop/api"],
  // Native/worker-based PDF libraries must stay outside the bundle: @napi-rs/canvas loads a
  // platform .node binary and pdf.js resolves its fonts/CMaps relative to node_modules.
  // Phase 06 adds tesseract.js (spawns a worker thread from its own files), its language data,
  // and the Office/signing libraries, which are plain Node packages with no reason to bundle.
  serverExternalPackages: [
    "pdfjs-dist",
    "@napi-rs/canvas",
    "@cantoo/pdf-lib",
    "fontkit",
    "tesseract.js",
    "tesseract.js-core",
    "@tesseract.js-data/eng",
    "docx",
    "exceljs",
    "mammoth",
    "pptxgenjs",
    "jszip",
    "node-forge",
    "@signpdf/signpdf",
    "@signpdf/signer-p12",
    "@signpdf/utils",
  ],
};

export default nextConfig;
