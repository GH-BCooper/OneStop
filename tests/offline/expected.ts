// Offline-flag enforcement, part two: the other half of the ledger (19-testing.md).
//
// `coverage.ts` records what the per-phase offline suites *proved*. This records what the
// registry *claims*, straight from the loaded registry rather than from a copy in the script, so
// the two can never drift. `scripts/check-offline-coverage.mjs` compares them.
import fs from "node:fs";
import path from "node:path";
import { COVERAGE_DIR } from "./coverage.ts";

export const EXPECTED_FILE = path.join(COVERAGE_DIR, "_expected.json");

export function recordExpectedOffline(ids: readonly string[]): void {
  fs.mkdirSync(COVERAGE_DIR, { recursive: true });
  const payload = { ids: [...new Set(ids)].sort(), recordedAt: new Date().toISOString() };
  fs.writeFileSync(EXPECTED_FILE, `${JSON.stringify(payload, null, 2)}\n`);
}
