// @vitest-environment jsdom
//
// Guest history and favourites (14-history-favorites.md).
//
// The whole point of the guest path is that it needs no account and no network call, so these
// tests run against a real IndexedDB implementation (fake-indexeddb) with `fetch` stubbed to
// throw: anything that reached the network would fail loudly here.
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearLocalHistory,
  filterLocalHistory,
  localRecentToolIds,
  localToolUsage,
  readLocalHistory,
  recordLocalRun,
  trimLocalHistory,
  MAX_LOCAL_ENTRIES,
  DB_NAME,
} from "@/lib/localHistory";
import {
  readLocalFavorites,
  toggleLocalFavorite,
  writeLocalFavorites,
  FAVORITES_CHANGED,
} from "@/lib/favorites";
import {
  applyThemePreference,
  readLocalPreferences,
  readThemePreference,
  writeLocalPreferences,
  DEFAULT_PREFERENCES,
} from "@/lib/preferences";
import { filterLocalHistory as filterAgain } from "@/lib/localHistory";
import { parseHistoryParams, historyQueryString, toolIdsInCategory } from "@/lib/history-params";

function wipeDatabase(): Promise<void> {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

beforeEach(async () => {
  await wipeDatabase();
  localStorage.clear();
  // No history feature may touch the network for a guest.
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("the guest history path must not make a network call");
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("guest history (IndexedDB)", () => {
  it("records a run and reads it back, newest first", async () => {
    await recordLocalRun({
      toolId: "merge-pdf",
      status: "success",
      summary: "Merged 2 files",
      inputs: ["a.pdf", "b.pdf"],
      createdAt: "2026-09-18T10:00:00.000Z",
    });
    await recordLocalRun({
      toolId: "compress-image",
      status: "failed",
      error: "This file type is not supported.",
      createdAt: "2026-09-19T10:00:00.000Z",
    });

    const entries = await readLocalHistory();
    expect(entries.map((e) => e.toolId)).toEqual(["compress-image", "merge-pdf"]);
    expect(entries[0]).toMatchObject({ status: "failed", scope: "device", outputs: [] });
    expect(entries[1]).toMatchObject({ summary: "Merged 2 files", inputs: ["a.pdf", "b.pdf"] });
  });

  it("disappears when the browser's storage is cleared — the documented guest trade-off", async () => {
    await recordLocalRun({ toolId: "merge-pdf", status: "success" });
    expect(await readLocalHistory()).toHaveLength(1);

    await clearLocalHistory();
    expect(await readLocalHistory()).toEqual([]);

    // And the same when the whole database goes, as "clear site data" would do.
    await recordLocalRun({ toolId: "merge-pdf", status: "success" });
    await wipeDatabase();
    expect(await readLocalHistory()).toEqual([]);
  });

  it("keeps only the newest entries", async () => {
    for (let i = 0; i < MAX_LOCAL_ENTRIES + 5; i += 1) {
      await recordLocalRun({
        toolId: `tool-${i}`,
        status: "success",
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
      });
    }
    await trimLocalHistory();
    const entries = await readLocalHistory();
    expect(entries).toHaveLength(MAX_LOCAL_ENTRIES);
    // The oldest five are the ones that went.
    expect(entries.at(-1)?.toolId).toBe("tool-5");
  });

  it("derives recents and usage counts from real runs", async () => {
    await recordLocalRun({
      toolId: "merge-pdf",
      status: "success",
      createdAt: "2026-09-18T10:00:00.000Z",
    });
    await recordLocalRun({
      toolId: "merge-pdf",
      status: "success",
      createdAt: "2026-09-18T11:00:00.000Z",
    });
    await recordLocalRun({
      toolId: "split-pdf",
      status: "success",
      createdAt: "2026-09-19T10:00:00.000Z",
    });

    expect(await localToolUsage()).toEqual({ "merge-pdf": 2, "split-pdf": 1 });
    expect(await localRecentToolIds()).toEqual(["split-pdf", "merge-pdf"]);
  });

  it("falls back to an empty history when IndexedDB is missing entirely", async () => {
    const real = globalThis.indexedDB;
    // @ts-expect-error - deliberately removing the API the way a locked-down browser would
    delete globalThis.indexedDB;
    try {
      expect(await readLocalHistory()).toEqual([]);
      expect(await recordLocalRun({ toolId: "merge-pdf", status: "success" })).toBeNull();
    } finally {
      globalThis.indexedDB = real;
    }
  });
});

describe("guest history filtering (the same shape the server returns)", () => {
  const entries = [
    { toolId: "merge-pdf", status: "success", createdAt: "2026-09-10T10:00:00.000Z" },
    { toolId: "split-pdf", status: "failed", createdAt: "2026-09-15T10:00:00.000Z" },
    { toolId: "compress-image", status: "success", createdAt: "2026-09-19T10:00:00.000Z" },
  ].map((e, i) => ({
    ...e,
    id: `e${i}`,
    summary: null,
    inputs: [],
    outputs: [],
    error: null,
    scope: "device" as const,
    workflow: null,
    status: e.status as "success" | "failed",
  }));

  it("filters by tool, status and date, and pages", () => {
    expect(filterLocalHistory(entries, { toolId: "split-pdf" }).total).toBe(1);
    expect(filterLocalHistory(entries, { status: "success" }).total).toBe(2);
    expect(filterLocalHistory(entries, { from: "2026-09-15" }).total).toBe(2);
    expect(filterLocalHistory(entries, { to: "2026-09-15" }).total).toBe(2);
    expect(filterAgain(entries, { from: "2026-09-15", to: "2026-09-15" }).total).toBe(1);

    const page = filterLocalHistory(entries, { pageSize: 2, page: 2 });
    expect(page).toMatchObject({ total: 3, page: 2, pageCount: 2 });
    expect(page.entries).toHaveLength(1);
  });

  it("filters by category through the registry", () => {
    const pdfIds = toolIdsInCategory("pdf");
    expect(pdfIds).toContain("merge-pdf");
    expect(pdfIds).not.toContain("compress-image");
    expect(filterLocalHistory(entries, { toolIds: pdfIds }).total).toBe(2);
  });
});

describe("history query params", () => {
  it("keeps the values it recognises and drops the rest", () => {
    const parsed = parseHistoryParams({
      category: "pdf",
      tool: "merge-pdf",
      status: "success",
      from: "2026-09-01",
      to: "not-a-date",
      page: "3",
    });
    expect(parsed).toMatchObject({
      category: "pdf",
      toolId: "merge-pdf",
      status: "success",
      from: "2026-09-01",
      page: 3,
    });
    expect(parsed.to).toBeUndefined();

    expect(parseHistoryParams({ category: "nope", tool: "nope", status: "nope" })).toEqual({
      category: "",
      page: 1,
    });
  });

  it("round-trips through the query string", () => {
    const params = parseHistoryParams({ category: "pdf", status: "failed", page: "2" });
    expect(historyQueryString(params)).toBe("?category=pdf&status=failed&page=2");
    expect(parseHistoryParams(new URLSearchParams(historyQueryString(params).slice(1)))).toEqual(
      params,
    );
  });
});

describe("guest favourites and preferences (localStorage)", () => {
  it("toggles a favourite on and off and tells the rest of the page", () => {
    const listener = vi.fn();
    window.addEventListener(FAVORITES_CHANGED, listener);

    expect(readLocalFavorites()).toEqual([]);
    expect(toggleLocalFavorite("merge-pdf")).toEqual(["merge-pdf"]);
    expect(readLocalFavorites()).toEqual(["merge-pdf"]);
    expect(toggleLocalFavorite("merge-pdf")).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(2);

    writeLocalFavorites(["a", "a", "b"]);
    expect(readLocalFavorites()).toEqual(["a", "b"]);
    window.removeEventListener(FAVORITES_CHANGED, listener);
  });

  it("stores a theme preference and resolves 'system' without persisting a mode", () => {
    applyThemePreference("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(readThemePreference()).toBe("dark");
    expect(localStorage.getItem("onestop-theme")).toBe("dark");

    applyThemePreference("system");
    expect(readThemePreference()).toBe("system");
    // "system" leaves nothing behind, so the pre-paint script falls back to the OS setting.
    expect(localStorage.getItem("onestop-theme")).toBeNull();
  });

  it("merges preference patches and survives unreadable storage", () => {
    expect(readLocalPreferences()).toEqual(DEFAULT_PREFERENCES);
    writeLocalPreferences({ saveHistory: false });
    expect(readLocalPreferences()).toMatchObject({
      saveHistory: false,
      confirmBeforeDelete: true,
    });

    localStorage.setItem("onestop-preferences", "{not json");
    expect(readLocalPreferences()).toEqual(DEFAULT_PREFERENCES);
  });
});
