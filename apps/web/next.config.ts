import fs from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

// The repository keeps one `.env` at its root (see `.env.example`), but Next only reads the one
// beside the app it is running. Load the root file here - without overriding anything the shell
// or the host already set, so a deployed instance always wins (13-auth-database.md).
function loadRootEnv(): void {
  const file = path.resolve(import.meta.dirname, "../../.env");
  let contents: string;
  try {
    contents = fs.readFileSync(file, "utf8");
  } catch {
    return; // No root .env: the app runs on defaults, as it always could.
  }
  for (const line of contents.split(/\r?\n/)) {
    if (line.trimStart().startsWith("#")) continue;
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (!key || process.env[key] !== undefined) continue;
    const value = (rawValue ?? "").trim().replace(/^(['"])(.*)\1$/, "$2");
    if (value !== "") process.env[key] = value;
  }
}

loadRootEnv();

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
    // 07-word-ppt-tools.md: loaded with createRequire at run time (grammar checker).
    "nspell",
    "write-good",
    "dictionary-en",
    // 09-image-tools.md: native libvips binding, and the HEIC decoder's WebAssembly bundle.
    "sharp",
    "heic-decode",
    "libheif-js",
    "exif-reader",
    // 13-auth-database.md: Prisma loads its query compiler and driver outside the bundle.
    "@prisma/client",
    "@prisma/adapter-pg",
    "pg",
  ],
};

export default nextConfig;
