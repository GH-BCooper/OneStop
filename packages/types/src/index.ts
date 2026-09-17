// Shared TypeScript types for OneStop.
// Later phases add their contracts here (e.g. Job in 04-file-core.md).

/**
 * A reference to a user-supplied file. Phase 03 only needs the metadata the browser exposes;
 * TODO(04-file-core.md): add the temp-file id / storage handle once uploads exist.
 */
export interface FileRef {
  name: string;
  size: number;
  /** MIME type as reported by the browser; may be empty. */
  type: string;
  lastModified?: number;
}

export type ExecErrorCode =
  "NOT_IMPLEMENTED" | "UNSUPPORTED_INPUT" | "OFFLINE" | "AUTH_REQUIRED" | "FAILED";

export type ExecResult =
  | { ok: true; output: unknown; summary?: string }
  | { ok: false; code: ExecErrorCode; message: string };
