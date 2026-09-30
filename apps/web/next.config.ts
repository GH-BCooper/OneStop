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

/**
 * Headers every response carries. Deliberately the set that cannot break a working feature:
 *  - nosniff stops a browser reinterpreting a download as something executable;
 *  - frame-ancestors / X-Frame-Options stop another site framing OneStop (clickjacking) while the
 *    app's own previews, which frame same-origin content, keep working;
 *  - base-uri, form-action and object-src close the injection routes a strict script policy would
 *    otherwise be needed for. A full script-src is not set: the theme bootstrap and Next's own
 *    inline scripts would need per-request nonces, and a policy full of 'unsafe-inline' protects
 *    nothing.
 *  - the camera and microphone stay available to OneStop itself (QR scanner, recorders) and to no
 *    embedded page; geolocation, payment and USB are switched off because nothing here uses them.
 *  - HSTS is sent everywhere and simply ignored by browsers over plain http, so it only takes
 *    effect on the HTTPS deployment.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value:
      "camera=(self), microphone=(self), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'",
  },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  reactStrictMode: true,
  poweredByHeader: false,
  // Root CLAUDE.md is the single agent guide; stop Next from generating per-app copies.
  agentRules: false,
  // Next defaults this worker pool to (host CPUs - 1). Render's build host reports far more
  // CPUs than the container actually has RAM for, so with ~230 tool pages each pulling in
  // NextAuth/Prisma plus heavy libs (sharp, pdfjs, tesseract, canvas), the default pool size
  // OOM-kills the build. Cap it so static generation runs a few pages at a time instead.
  experimental: { cpus: 2 },
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
