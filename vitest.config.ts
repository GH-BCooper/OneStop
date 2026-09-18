import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "apps/web/src"),
      // next-auth imports "next/server", which Node cannot resolve on its own outside the Next
      // bundler (13-auth-database.md). Point it at the real file.
      "next/server": path.resolve(import.meta.dirname, "node_modules/next/server.js"),
    },
  },
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/.next/**", "**/*.e2e.test.ts"],
    environment: "node",
    // next-auth resolves "next/server" (extensionless) at import time, which plain Node cannot do.
    // Inlining it makes Vite apply the alias above (13-auth-database.md).
    server: { deps: { inline: ["next-auth", "@auth/core"] } },
    setupFiles: ["apps/web/src/test/setup.tsx"],
    // The heaviest cases are a jsdom render that first imports the whole `@onestop/api` barrel
    // (sharp, pdfjs, tesseract…) and the Postgres suites' per-test reset. Both are seconds when a
    // file runs alone and can be several times that on a machine running every file at once, so
    // the budgets are generous on purpose - they are there to catch a hang, not to measure speed
    // (see PROGRESS.md, phases 08/10 and 14).
    testTimeout: 60000,
    hookTimeout: 30000,
  },
});
