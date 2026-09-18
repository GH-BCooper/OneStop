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
    testTimeout: 30000,
  },
});
