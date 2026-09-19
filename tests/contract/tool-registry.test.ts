// The Tool-Contract suite (master plan §23.3, 19-testing.md).
//
// One rule, checked from the outside: *every* entry in the registry maps to a real, working
// executor. Through phases 03-17 this suite was meant to fail for the tools that were not built
// yet; phase 17 was the last phase that adds tools, so from here on it must be 100% green, and it
// is what stops a future phase from shipping a catalogue entry with nothing behind it.
//
// It lives at the repo root rather than inside a workspace on purpose: the registry package knows
// nothing about `apps/api` (that is the whole point of `registerExecutor`), so only a test that
// imports both can see whether the two halves actually meet.
//
// Importing `@onestop/api` is what registers every phase's executors - the same import the web
// app's route handlers do.
import "@onestop/api";
import {
  PHASE_FILES,
  VERIFIED_OFFLINE,
  getExecutor,
  getTool,
  getToolByRoute,
  hasExecutor,
  toolHref,
  tools,
  type ToolMeta,
} from "@onestop/tool-registry";
import { describe, expect, it } from "vitest";
import { recordExpectedOffline } from "../offline/expected.ts";

/** Tools the catalogue shows as usable. Everything in the registry is one of these now. */
const built = tools.filter((t) => t.status !== "stub");

describe("tool contract: every registry entry has a real executor", () => {
  it("has the whole catalogue registered (no tool left on the stub)", () => {
    const missing = tools.filter((t) => !hasExecutor(t.id));
    expect(
      missing.map((t) => `${t.id} (${PHASE_FILES[t.phase]})`),
      "every tool in the Feature & Tool List must have a working implementation, not a stub",
    ).toEqual([]);
  });

  it("marks every entry available or demo, never stub", () => {
    expect(tools.filter((t) => t.status === "stub").map((t) => t.id)).toEqual([]);
    expect(built.length).toBe(tools.length);
  });

  it("covers the whole Feature & Tool List", () => {
    // A lower bound, not an exact count. `registry.test.ts` already checks the real invariant -
    // every numbered item in docs/OneStop_Features.md is claimed exactly once, by a tool or by a
    // workflow platform feature. The catalogue settles at fewer entries than the build file's
    // "~230" because several Features items describe one tool from two angles (and §15's eight
    // workflow items are platform features, not tools). This guard is only here so the catalogue
    // can never quietly shrink.
    expect(tools.length).toBeGreaterThanOrEqual(200);
  });

  it("never answers NOT_IMPLEMENTED, even when called with nothing to work on", async () => {
    // The strongest form of the contract that can be checked generically: a stub reports
    // NOT_IMPLEMENTED for any input, a real executor reports what is actually wrong ("Choose at
    // least one file.") or succeeds. The network is trapped so this sweep cannot reach outside.
    const http = await import("node:http");
    const https = await import("node:https");
    const trap = (() => {
      throw new Error("the contract sweep must not touch the network");
    }) as never;
    const real = {
      fetch: globalThis.fetch,
      hg: http.default.get,
      hr: http.default.request,
      sg: https.default.get,
      sr: https.default.request,
    };
    globalThis.fetch = trap;
    http.default.get = trap;
    http.default.request = trap;
    https.default.get = trap;
    https.default.request = trap;

    const notImplemented: string[] = [];
    try {
      for (const tool of tools) {
        const executor = getExecutor(tool);
        try {
          const result = await Promise.race([
            executor(null, {}, undefined),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 20_000)),
          ]);
          // A timeout or a throw is not what this test is about - a stub does neither, and every
          // other failure mode has its own suite in the owning phase.
          if (result && !result.ok && result.code === "NOT_IMPLEMENTED") {
            notImplemented.push(`${tool.id}: ${result.message}`);
          }
        } catch {
          // Throwing is a bug the phase's own tests cover; it is proof this is not a stub.
        }
      }
    } finally {
      globalThis.fetch = real.fetch;
      http.default.get = real.hg;
      http.default.request = real.hr;
      https.default.get = real.sg;
      https.default.request = real.sr;
    }
    expect(notImplemented).toEqual([]);
  }, 300_000);
});

describe("tool contract: the metadata shape the UI and the AI both read", () => {
  const fields: (keyof ToolMeta)[] = [
    "id",
    "category",
    "inputTypes",
    "outputTypes",
    "execution",
    "offline",
    "supportsBatch",
    "requiresAuth",
    "description",
  ];

  it("gives every tool the CLAUDE.md §7 contract fields", () => {
    for (const tool of tools) {
      for (const field of fields) {
        expect(tool[field], `${tool.id}.${String(field)}`).toBeDefined();
      }
      expect(tool.outputTypes.length, `${tool.id} must declare an output`).toBeGreaterThan(0);
      expect(tool.description.length, `${tool.id} needs a description`).toBeGreaterThan(10);
    }
  });

  it("gives every tool exactly one canonical route, resolvable both ways", () => {
    const routes = new Set<string>();
    for (const tool of tools) {
      const href = toolHref(tool);
      expect(routes.has(href), `${tool.id} duplicates the route ${href}`).toBe(false);
      routes.add(href);
      expect(getTool(tool.id)).toBe(tool);
      expect(getToolByRoute(tool.category, tool.slug)).toBe(tool);
    }
    expect(routes.size).toBe(tools.length);
  });

  it("keeps the offline/network/execution flags consistent with each other", () => {
    for (const tool of tools) {
      if (tool.network === "required") {
        expect(tool.offline, `${tool.id} needs the network, so it cannot be offline`).toBe(false);
        expect(tool.execution, `${tool.id} needs the network`).toBe("remote");
      }
      if (tool.offline) {
        expect(VERIFIED_OFFLINE, `${tool.id} claims offline without a proof`).toContain(tool.id);
        expect(tool.network, `${tool.id} is offline, so it cannot require the network`).not.toBe(
          "required",
        );
      }
    }
  });

  it("records what the offline-coverage check has to reconcile", () => {
    // The check runs after the whole test suite; this is the half of the ledger that says what
    // *should* have been proved. See scripts/check-offline-coverage.mjs.
    const expected = tools.filter((t) => t.offline).map((t) => t.id);
    expect([...expected].sort()).toEqual([...VERIFIED_OFFLINE].sort());
    recordExpectedOffline(expected);
  });
});
