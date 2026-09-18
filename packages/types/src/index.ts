// Shared TypeScript types for OneStop.
// Phase 03 added FileRef/ExecResult; phase 04 (04-file-core.md) adds the file-processing
// pipeline contracts: temp-file handles, the Job model and the executor context.

/**
 * A reference to a user-supplied file.
 *
 * Phase 03 only needed the metadata the browser exposes. Phase 04 adds `tempId`: the handle of
 * the validated copy in the server-side temp store. It is present for every file that reached an
 * executor through the pipeline, and absent for browser-only metadata (e.g. a client preview).
 */
export interface FileRef {
  name: string;
  size: number;
  /** MIME type as reported by the browser or sniffed server-side; may be empty. */
  type: string;
  lastModified?: number;
  /** Temp-store handle, set by the pipeline once the file is validated and stored. */
  tempId?: string;
}

/** A file produced by an executor. Bytes are handed to the pipeline, never written by the tool. */
export interface OutputFile {
  name: string;
  mimeType: string;
  bytes: Uint8Array;
}

/** A stored output file, as returned to the browser. `url` is the download endpoint. */
export interface OutputFileRef {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  url: string;
  expiresAt: string;
}

export type ExecErrorCode =
  "NOT_IMPLEMENTED" | "UNSUPPORTED_INPUT" | "OFFLINE" | "AUTH_REQUIRED" | "FAILED";

export type ExecResult =
  | { ok: true; output: unknown; summary?: string; files?: OutputFile[] }
  | { ok: false; code: ExecErrorCode; message: string };

/**
 * What an executor is given beyond its input metadata. The pipeline owns the filesystem: tools
 * read bytes through `readFile` and return bytes in `ExecResult.files`; they never touch a path
 * (master plan §15 — sanitized paths, and nothing uploaded is ever executed).
 */
export interface ExecContext {
  jobId: string;
  /**
   * The signed-in user, or null for a guest (13-auth-database.md). A tool must keep working for
   * a guest: this is for attributing what a tool *stores* (a dynamic QR code's owner), never for
   * deciding whether the tool may run - the pipeline does that from the registry's requiresAuth.
   */
  userId?: string | null;
  /** Reads the validated bytes of an input file. Throws if the ref has no temp handle. */
  readFile(file: FileRef): Promise<Uint8Array>;
  /** Cancellation signal for long-running work. */
  signal?: AbortSignal;
}

export type JobStatus = "pending" | "validating" | "processing" | "success" | "failed";

/** master plan §16. Never holds file binaries — only metadata. */
export interface Job {
  id: string;
  userId: string | null; // null = guest/local job
  toolId: string;
  status: JobStatus;
  inputMetadata: Record<string, unknown>;
  outputMetadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface FileValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Default upload ceiling, mirrored on the client for a friendly pre-check. The server is
 * authoritative and reads MAX_UPLOAD_MB from the environment.
 */
export const DEFAULT_MAX_UPLOAD_MB = 100;
export const DEFAULT_MAX_UPLOAD_BYTES = DEFAULT_MAX_UPLOAD_MB * 1024 * 1024;

/** User-facing messages fixed by master plan §22. Keep the wording identical everywhere. */
export const ERROR_MESSAGES = {
  unsupportedType: "This file type is not supported.",
  tooLarge: "The file is too large for local processing. Try a smaller file.",
  offline: "This tool needs an Internet connection. Connect and try again.",
} as const;

/** One stored output file as history shows it. Mirrors `OutputFileRef` minus the live URL. */
export interface HistoryFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  expiresAt: string;
}

/**
 * One row of `/history` (14-history-favorites.md). The same shape is used for a signed-in user's
 * Postgres jobs and for a guest's IndexedDB entries, so the page renders both with one component.
 */
export interface HistoryEntry {
  id: string;
  toolId: string;
  status: JobStatus;
  createdAt: string;
  summary: string | null;
  /** Names of the input files (or "text" for a typed input), for the list row. */
  inputs: string[];
  /** Files the run produced. They may already have expired - the page says so. */
  outputs: HistoryFile[];
  /** Short, user-facing reason the run failed. */
  error: string | null;
  /** Where this entry is stored: the account (synced) or this device only. */
  scope: "account" | "device";
}

/** Filters `/history` understands. Everything is optional; omitted means "no filter". */
export interface HistoryFilter {
  toolId?: string;
  /** Restricts to a category/group: the registry resolves it to these tool ids. */
  toolIds?: string[];
  status?: JobStatus;
  /** Inclusive ISO date bounds (a plain `YYYY-MM-DD` is accepted too). */
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export interface HistoryPage {
  entries: HistoryEntry[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export * from "./db";
