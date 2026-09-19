import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/e2e/**/*.e2e.test.ts"],
    setupFiles: ["tests/setup/env.ts"],
    environment: "node",
    testTimeout: 60000,
    hookTimeout: 90000,
    fileParallelism: false,
  },
});
