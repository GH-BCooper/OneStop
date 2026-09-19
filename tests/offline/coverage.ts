// Offline-flag enforcement, part one: the ledger the per-phase offline suites write to
// (19-testing.md).
//
// CLAUDE.md §8 says a tool is not marked `offline: true` until an actual offline test for it
// passes. Phases 05-17 each wrote such a suite - every tool of the phase, run with `fetch` and
// `http/https.get/request` replaced by traps that throw - but nothing *checked* that the union of
// those suites still covers the registry's `VERIFIED_OFFLINE` list. A tool could be added to the
// list and never tested, and the build would stay green.
//
// So each offline suite ends by recording the ids it just proved, and `scripts/check-offline-
// coverage.mjs` reconciles those records against the list after the test run. The record is
// written *after* the assertions, so a suite that fails - or is skipped, as the media suite is on
// a machine with no FFmpeg - records nothing and the check fails loudly.
//
// Vitest runs test files in separate workers, which is why this is a directory of files on disk
// rather than a shared module variable.
import fs from "node:fs";
import path from "node:path";

/** Where the ledger lives. Git-ignored; `npm run verify` clears it before the test run. */
export const COVERAGE_DIR = path.resolve(import.meta.dirname, "../../.offline-coverage");

export interface OfflineCoverageRecord {
  /** The suite that proved these ids, e.g. "pdf-core". One file per suite. */
  suite: string;
  ids: string[];
  recordedAt: string;
}

/** Call at the end of an offline suite, after every tool of it has passed with the network cut. */
export function recordOfflineCoverage(suite: string, ids: readonly string[]): void {
  if (!/^[a-z][a-z0-9-]*$/.test(suite)) throw new Error(`"${suite}" is not a usable suite name.`);
  const record: OfflineCoverageRecord = {
    suite,
    ids: [...new Set(ids)].sort(),
    recordedAt: new Date().toISOString(),
  };
  fs.mkdirSync(COVERAGE_DIR, { recursive: true });
  fs.writeFileSync(path.join(COVERAGE_DIR, `${suite}.json`), `${JSON.stringify(record, null, 2)}\n`);
}

/** Every record on disk. Unreadable or malformed files are ignored, and so count as missing. */
export function readOfflineCoverage(): OfflineCoverageRecord[] {
  let names: string[];
  try {
    names = fs.readdirSync(COVERAGE_DIR).filter((n) => n.endsWith(".json"));
  } catch {
    return [];
  }
  const records: OfflineCoverageRecord[] = [];
  for (const name of names) {
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(path.join(COVERAGE_DIR, name), "utf8"));
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        Array.isArray((parsed as OfflineCoverageRecord).ids)
      ) {
        records.push(parsed as OfflineCoverageRecord);
      }
    } catch {
      // A half-written or hand-edited file proves nothing; leave it out.
    }
  }
  return records;
}

/** Clears the ledger, so a run can never be judged on a previous run's records. */
export function clearOfflineCoverage(): void {
  fs.rmSync(COVERAGE_DIR, { recursive: true, force: true });
}
