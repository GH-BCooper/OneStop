#!/usr/bin/env node
// Offline-flag enforcement, part three: the CI-style check (19-testing.md).
//
// CLAUDE.md §8: "a tool is not marked `offline: true` until an actual offline test for it
// passes". The registry enforces half of that already - `loadRegistry` refuses an entry that
// claims `offline: true` without being on the `VERIFIED_OFFLINE` list - but nothing stopped an id
// being added to that list without a test behind it. This closes the loop:
//
//   1. `npm run verify` clears the ledger (`--clean`).
//   2. The contract suite writes `_expected.json`: every id the loaded registry marks offline.
//   3. Each phase's offline suite writes `<suite>.json` *after* its assertions pass: the ids it
//      just ran with `fetch` and `http/https.get/request` trapped.
//   4. This script reconciles the two and exits non-zero on any difference.
//
// A suite that fails, or skips itself because a prerequisite is missing (FFmpeg, say), records
// nothing - so its tools show up here as unproven and the build fails, which is the honest
// outcome: on that machine the claim was not demonstrated.
//
// Usage:  node scripts/check-offline-coverage.mjs [--clean]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, ".offline-coverage");
const expectedFile = path.join(dir, "_expected.json");

if (process.argv.includes("--clean")) {
  fs.rmSync(dir, { recursive: true, force: true });
  console.log("offline coverage: ledger cleared.");
  process.exit(0);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

const expected = readJson(expectedFile);
if (!expected || !Array.isArray(expected.ids)) {
  console.error(
    "offline coverage: no expectation was recorded.\n" +
      "  tests/contract/tool-registry.test.ts writes it, so this means the test suite did not run\n" +
      "  (or did not reach that test). Run `npm test` first, or use `npm run verify`.",
  );
  process.exit(1);
}

const records = fs
  .readdirSync(dir)
  .filter((name) => name.endsWith(".json") && name !== "_expected.json")
  .map((name) => ({ name, data: readJson(path.join(dir, name)) }))
  .filter((r) => r.data && Array.isArray(r.data.ids));

/** id -> the suites that proved it. */
const provenBy = new Map();
for (const { data } of records) {
  for (const id of data.ids) {
    if (!provenBy.has(id)) provenBy.set(id, []);
    provenBy.get(id).push(data.suite ?? "?");
  }
}

const claimed = [...new Set(expected.ids)].sort();
const unproven = claimed.filter((id) => !provenBy.has(id));
const extra = [...provenBy.keys()].filter((id) => !claimed.includes(id)).sort();

const proved = claimed.length - unproven.length;
console.log(
  `offline coverage: ${proved}/${claimed.length} tools flagged offline were proved offline ` +
    `by ${records.length} suite${records.length === 1 ? "" : "s"} ` +
    `(${records.map((r) => r.data.suite ?? r.name).join(", ")}).`,
);

if (extra.length > 0) {
  // Not a failure: a suite may legitimately prove more than the registry claims (a tool whose
  // flag is deliberately conservative). Worth saying out loud, though.
  console.log(
    `offline coverage: ${extra.length} tool(s) proved offline but not flagged offline in the ` +
      `registry - consider adding them to VERIFIED_OFFLINE: ${extra.join(", ")}`,
  );
}

if (unproven.length > 0) {
  console.error(
    `\noffline coverage: FAILED - ${unproven.length} tool(s) are flagged offline: true with no ` +
      `passing offline test in this run:\n` +
      unproven.map((id) => `  - ${id}`).join("\n") +
      `\n\nEither add the tool to an offline suite (and make it pass), or take it off\n` +
      `VERIFIED_OFFLINE in packages/tool-registry/src/loader.ts so the catalogue stops claiming it.\n` +
      `If a suite was skipped for a missing prerequisite, install it and re-run: the claim is only\n` +
      `true on a machine where it was actually demonstrated.`,
  );
  process.exit(1);
}

console.log("offline coverage: OK - every offline: true tool was demonstrated offline.");
