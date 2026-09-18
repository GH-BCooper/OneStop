import path from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");

describe("lint wiring", () => {
  it("reports errors for a file that breaks lint rules", async () => {
    const eslint = new ESLint({ cwd: root, ignore: false });
    const [result] = await eslint.lintFiles(["tests/fixtures/lint/broken.ts"]);
    const rules = result?.messages.map((m) => m.ruleId) ?? [];
    expect(result?.errorCount).toBeGreaterThan(0);
    expect(rules).toContain("no-var");
    expect(rules).toContain("eqeqeq");
  });

  it("passes on the real scaffold", async () => {
    const eslint = new ESLint({ cwd: root });
    const results = await eslint.lintFiles(["apps", "packages"]);
    const errors = results.reduce((n, r) => n + r.errorCount + r.warningCount, 0);
    expect(errors).toBe(0);
    // Linting every workspace with type-aware rules grows with the codebase; 30 s is no longer enough.
  }, 120_000);
});
