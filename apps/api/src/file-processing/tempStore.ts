// Temp file storage with automatic expiry (04-file-core.md; master plan §15).
//
// Design rules:
//   * Every stored file is named by a random id on disk. The user's (sanitised) filename is
//     metadata only, so a hostile name can never influence a path.
//   * Nothing is ever executed: files are written with mode 0o600 and only ever read back.
//   * Deletion is guaranteed three ways — the pipeline deletes inputs as soon as it is done,
//     a sweeper deletes anything past its expiry even if the job failed or the tab was closed,
//     and a store created on a fresh process purges anything actually expired.
//   * Each file's metadata is mirrored to a `<id>.meta.json` sidecar next to its bytes, so a
//     result that was still inside its retention window survives a process restart (a dev-server
//     reload, a redeploy, a crash) instead of turning into a silent 404 for a download link the
//     user already has open — a fresh process rehydrates its index from these sidecars rather than
//     discarding still-valid files it merely doesn't remember yet.
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { extensionOf } from "@onestop/tool-registry";
import { loadFileCoreConfig, type FileCoreConfig } from "./config.ts";
import { mimeTypeForExtension, sanitizeFileName } from "./validate.ts";

export interface TempFile {
  id: string;
  /** Sanitised display name. Never used to build a path. */
  name: string;
  mimeType: string;
  size: number;
  createdAt: number;
  expiresAt: number;
  /** What the file is for: an upload, or something a tool produced. */
  kind: "input" | "output";
  jobId?: string;
}

export interface PutTempFileInput {
  name: string;
  bytes: Uint8Array;
  mimeType?: string;
  kind?: "input" | "output";
  jobId?: string;
  /** Overrides the store's default retention for this file, in milliseconds. */
  ttlMs?: number;
}

export interface TempStore {
  readonly dir: string;
  readonly ttlMs: number;
  put(input: PutTempFileInput): Promise<TempFile>;
  get(id: string): Promise<TempFile | undefined>;
  read(id: string): Promise<Uint8Array>;
  delete(id: string): Promise<boolean>;
  /** Deletes everything expired at `now`; returns how many files went. */
  sweep(now?: number): Promise<number>;
  list(): TempFile[];
  /** Deletes every file this store knows about and stops the sweeper. */
  dispose(): Promise<void>;
}

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Only ids this store could have issued are ever turned into paths. */
export function isTempFileId(id: string): boolean {
  return ID_PATTERN.test(id);
}

export interface CreateTempStoreOptions extends Partial<FileCoreConfig> {
  /** Set false in tests that drive `sweep()` by hand. Default true. */
  autoSweep?: boolean;
  /** Injectable clock, for the retention test. */
  now?: () => number;
}

export function createTempStore(options: CreateTempStoreOptions = {}): TempStore {
  const base = loadFileCoreConfig();
  const dir = path.resolve(options.tempDir ?? base.tempDir);
  const ttlMs = options.ttlMs ?? base.ttlMs;
  const sweepIntervalMs = options.sweepIntervalMs ?? base.sweepIntervalMs;
  const now = options.now ?? Date.now;
  const files = new Map<string, TempFile>();
  let ready: Promise<void> | null = null;
  let disposed = false;

  const pathFor = (id: string): string => {
    if (!isTempFileId(id)) throw new Error("Invalid temp file id.");
    return path.join(dir, id);
  };

  const metaPathFor = (id: string): string => `${pathFor(id)}.meta.json`;

  /**
   * Creates the directory once and rebuilds the index from sidecars a previous process left
   * behind: anything still inside its retention window is adopted, anything expired (or whose
   * bytes/sidecar went missing) is swept away.
   */
  const ensureDir = (): Promise<void> => {
    ready ??= (async () => {
      await fs.mkdir(dir, { recursive: true, mode: 0o700 });
      const entries = await fs.readdir(dir).catch(() => [] as string[]);
      const ids = new Set(entries.filter((entry) => isTempFileId(entry)));
      const metaIds = new Set(
        entries
          .filter((entry) => entry.endsWith(".meta.json"))
          .map((entry) => entry.slice(0, -".meta.json".length)),
      );
      await Promise.all(
        [...ids, ...metaIds]
          .filter((id, index, all) => all.indexOf(id) === index)
          .map(async (id) => {
            if (!isTempFileId(id) || !ids.has(id) || !metaIds.has(id)) {
              // An orphaned byte file or a sidecar with nothing to describe: neither is usable.
              await fs.rm(pathFor(id), { force: true }).catch(() => undefined);
              await fs.rm(metaPathFor(id), { force: true }).catch(() => undefined);
              return;
            }
            try {
              const raw = await fs.readFile(metaPathFor(id), "utf8");
              const record = JSON.parse(raw) as TempFile;
              if (record.expiresAt <= now()) throw new Error("expired");
              files.set(id, record);
            } catch {
              await fs.rm(pathFor(id), { force: true }).catch(() => undefined);
              await fs.rm(metaPathFor(id), { force: true }).catch(() => undefined);
            }
          }),
      );
    })();
    return ready;
  };

  const removeFile = async (id: string): Promise<boolean> => {
    const existed = files.delete(id);
    await fs.rm(pathFor(id), { force: true }).catch((err: unknown) => {
      console.error(`[temp-store] could not delete ${id}`, err);
    });
    await fs.rm(metaPathFor(id), { force: true }).catch(() => undefined);
    return existed;
  };

  const store: TempStore = {
    dir,
    ttlMs,

    async put(input) {
      if (disposed) throw new Error("Temp store has been disposed.");
      await ensureDir();
      const id = randomUUID();
      const name = sanitizeFileName(input.name);
      const createdAt = now();
      const record: TempFile = {
        id,
        name,
        mimeType:
          input.mimeType && input.mimeType.trim() !== ""
            ? input.mimeType
            : mimeTypeForExtension(extensionOf(name)),
        size: input.bytes.length,
        createdAt,
        expiresAt: createdAt + (input.ttlMs ?? ttlMs),
        kind: input.kind ?? "input",
        ...(input.jobId === undefined ? {} : { jobId: input.jobId }),
      };
      await fs.writeFile(pathFor(id), input.bytes, { mode: 0o600, flag: "wx" });
      await fs.writeFile(metaPathFor(id), JSON.stringify(record), { mode: 0o600 });
      files.set(id, record);
      return record;
    },

    async get(id) {
      await ensureDir();
      let record = files.get(id);
      if (!record && isTempFileId(id)) {
        // Not in this instance's index — check disk before giving up, so a result that another
        // instance (or an earlier incarnation of this one) just wrote is still found.
        record = await fs
          .readFile(metaPathFor(id), "utf8")
          .then((raw) => JSON.parse(raw) as TempFile)
          .catch(() => undefined);
        if (record) files.set(id, record);
      }
      if (!record) return undefined;
      if (record.expiresAt <= now()) {
        await removeFile(id);
        return undefined;
      }
      return record;
    },

    async read(id) {
      const record = await store.get(id);
      if (!record) throw new Error(`Temp file ${id} is no longer available.`);
      return new Uint8Array(await fs.readFile(pathFor(id)));
    },

    async delete(id) {
      if (!isTempFileId(id)) return false;
      return removeFile(id);
    },

    async sweep(at = now()) {
      const expired = [...files.values()].filter((f) => f.expiresAt <= at);
      for (const file of expired) await removeFile(file.id);
      return expired.length;
    },

    list() {
      return [...files.values()];
    },

    async dispose() {
      disposed = true;
      if (timer) clearInterval(timer);
      for (const id of [...files.keys()]) await removeFile(id);
    },
  };

  const timer =
    options.autoSweep === false
      ? null
      : setInterval(() => {
          void store.sweep().catch((err: unknown) => {
            console.error("[temp-store] sweep failed", err);
          });
        }, sweepIntervalMs);
  // Never keep the process (or a test run) alive just for the sweeper.
  timer?.unref?.();

  return store;
}

let shared: TempStore | null = null;

/** The process-wide temp store used by the API routes. */
export function getTempStore(): TempStore {
  shared ??= createTempStore();
  return shared;
}

/** Test seam: replaces the shared store (pass null to reset to the default). */
export function setTempStore(store: TempStore | null): void {
  shared = store;
}
