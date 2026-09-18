// Guest history, kept in IndexedDB on this device (14-history-favorites.md).
//
// The build file is explicit: a guest's history must work with no account and no network call for
// the history feature itself. So nothing here talks to the server - entries are written straight
// after a run and read back by `/history`. Clearing site data clears the history, which the page
// says in as many words.
//
// IndexedDB can be missing or blocked (private mode, an embedded webview, a locked-down browser).
// Every function below degrades to "no history" instead of throwing, exactly like the phase-02
// localStorage helpers.
import type { HistoryEntry, HistoryFilter, HistoryPage, JobStatus } from "@onestop/types";

export const DB_NAME = "onestop";
export const DB_VERSION = 1;
export const STORE = "history";
/** Newest N runs kept on the device. Old ones fall off, so storage cannot grow without bound. */
export const MAX_LOCAL_ENTRIES = 200;

/** What a guest entry holds. Output files are not listed: they are gone from the server already. */
export interface LocalHistoryInput {
  toolId: string;
  status: JobStatus;
  summary?: string | null;
  inputs?: string[];
  error?: string | null;
  /** Injectable for tests; defaults to now. */
  createdAt?: string;
}

function available(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase | null> {
  if (!available()) return Promise.resolve(null);
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt");
        store.createIndex("toolId", "toolId");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

/**
 * Runs one request inside its own transaction and resolves when that transaction *commits*, not
 * when the request succeeds. The difference matters: a write's `onsuccess` fires before the
 * commit, so resolving there would let a caller navigate to `/history` and open a fresh
 * connection that cannot see what was just written.
 */
function run<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) {
          resolve(null);
          return;
        }
        const done = (value: T | null) => {
          resolve(value);
          db.close();
        };
        let transaction: IDBTransaction;
        let request: IDBRequest<T>;
        try {
          transaction = db.transaction(STORE, mode);
          request = fn(transaction.objectStore(STORE));
        } catch {
          done(null);
          return;
        }
        let result: T | null = null;
        request.onsuccess = () => {
          result = request.result;
        };
        transaction.oncomplete = () => done(result);
        transaction.onerror = () => done(null);
        transaction.onabort = () => done(null);
      }),
  );
}

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/** Records one run on this device. Returns the entry, or null when storage is unavailable. */
export async function recordLocalRun(input: LocalHistoryInput): Promise<HistoryEntry | null> {
  const entry: HistoryEntry = {
    id: newId(),
    toolId: input.toolId,
    status: input.status,
    createdAt: input.createdAt ?? new Date().toISOString(),
    summary: input.summary ?? null,
    inputs: input.inputs ?? [],
    outputs: [],
    error: input.error ?? null,
    scope: "device",
  };
  const written = await run("readwrite", (store) => store.put(entry) as IDBRequest<IDBValidKey>);
  if (written === null) return null;
  await trimLocalHistory();
  return entry;
}

/** Every entry on this device, newest first. */
export async function readLocalHistory(): Promise<HistoryEntry[]> {
  const rows = await run<HistoryEntry[]>("readonly", (store) => store.getAll());
  if (!rows) return [];
  return rows
    .filter((r): r is HistoryEntry => Boolean(r) && typeof r.toolId === "string")
    .map((r) => ({ ...r, scope: "device" as const, outputs: [] }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}

/** Drops the oldest entries past `MAX_LOCAL_ENTRIES`. */
export async function trimLocalHistory(): Promise<void> {
  const rows = await readLocalHistory();
  if (rows.length <= MAX_LOCAL_ENTRIES) return;
  for (const stale of rows.slice(MAX_LOCAL_ENTRIES)) {
    await run("readwrite", (store) => store.delete(stale.id) as IDBRequest<undefined>);
  }
}

export async function deleteLocalEntry(id: string): Promise<void> {
  await run("readwrite", (store) => store.delete(id) as IDBRequest<undefined>);
}

export async function clearLocalHistory(): Promise<void> {
  await run("readwrite", (store) => store.clear() as IDBRequest<undefined>);
}

/**
 * The same filtering and paging the server does, applied in the browser. Keeping one shape means
 * `/history` renders a guest and a signed-in user with one component.
 */
export function filterLocalHistory(
  entries: HistoryEntry[],
  filter: HistoryFilter = {},
): HistoryPage {
  const from = filter.from ? `${filter.from}T00:00:00.000Z` : "";
  const to = filter.to ? `${filter.to}T23:59:59.999Z` : "";
  const toolIds = filter.toolIds ? new Set(filter.toolIds) : null;
  const matched = entries.filter((e) => {
    if (filter.toolId) {
      if (e.toolId !== filter.toolId) return false;
    } else if (toolIds && !toolIds.has(e.toolId)) return false;
    if (filter.status && e.status !== filter.status) return false;
    if (from && e.createdAt < from) return false;
    if (to && e.createdAt > to) return false;
    return true;
  });
  const pageSize = Math.max(1, Math.min(100, Math.floor(filter.pageSize ?? 20)));
  const pageCount = Math.max(1, Math.ceil(matched.length / pageSize));
  const page = Math.min(pageCount, Math.max(1, Math.floor(filter.page ?? 1)));
  return {
    entries: matched.slice((page - 1) * pageSize, page * pageSize),
    total: matched.length,
    page,
    pageSize,
    pageCount,
  };
}

/** Tool ids run on this device, most recent first - the local answer to "recently used". */
export async function localRecentToolIds(limit = 12): Promise<string[]> {
  const seen: string[] = [];
  for (const entry of await readLocalHistory()) {
    if (!seen.includes(entry.toolId)) seen.push(entry.toolId);
    if (seen.length >= limit) break;
  }
  return seen;
}

/** How many times each tool was run on this device, for the registry's popularity sort. */
export async function localToolUsage(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const entry of await readLocalHistory()) {
    counts[entry.toolId] = (counts[entry.toolId] ?? 0) + 1;
  }
  return counts;
}
