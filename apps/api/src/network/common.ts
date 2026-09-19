// Shared plumbing for the Internet-dependent tools (17-online-media-network-tools.md).
//
// The build file's Isolation Requirement is the point of this file: every tool in phase 17 talks
// to something outside the machine, so every one of them must fail *inside its own boundary*.
// `runNetTool` is that boundary — a DNS failure, a timeout, a rate limit or a platform change
// becomes an `ExecResult` with one short message, never a throw that reaches the pipeline and
// never anything that touches another tool.
import type { ExecErrorCode, ExecResult, FileRef, OutputFile } from "@onestop/types";
import { ERROR_MESSAGES } from "@onestop/types";
import { PdfToolError } from "../pdf/errors.ts";

export { optBool, optEnum, optNumber, optString, plural } from "../documents/common.ts";
export { PdfToolError as NetToolError } from "../pdf/errors.ts";

export const MIME = {
  txt: "text/plain; charset=utf-8",
  json: "application/json; charset=utf-8",
  csv: "text/csv; charset=utf-8",
} as const;

/** The master plan §22 wording, used verbatim whenever the network itself is the problem. */
export const OFFLINE_MESSAGE = ERROR_MESSAGES.offline;

export function unsupported(message: string, detail?: unknown): PdfToolError {
  return new PdfToolError("UNSUPPORTED_INPUT", message, detail);
}

export function offline(detail?: unknown): PdfToolError {
  return new PdfToolError("OFFLINE", OFFLINE_MESSAGE, detail);
}

export function failed(message: string, detail?: unknown): PdfToolError {
  return new PdfToolError("FAILED", message, detail);
}

/** Node's own words for "there is no Internet", plus what `fetch` wraps them in. */
const OFFLINE_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ENETUNREACH",
  "ENETDOWN",
  "EHOSTUNREACH",
  "ECONNREFUSED",
  "EADDRNOTAVAIL",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);

function errorCode(err: unknown): string | null {
  for (let e: unknown = err, depth = 0; e && depth < 4; depth++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string") return code;
    e = (e as { cause?: unknown }).cause;
  }
  return null;
}

/** True when the failure means "this machine cannot reach the Internet right now". */
export function looksOffline(err: unknown): boolean {
  const code = errorCode(err);
  if (code && OFFLINE_CODES.has(code)) return true;
  if (err instanceof TypeError && /fetch failed|network/i.test(err.message)) return true;
  return false;
}

/**
 * The boundary every phase-17 executor runs inside. A `PdfToolError` carries its own message; a
 * connectivity failure becomes the standard offline message; anything else becomes one short,
 * actionable sentence, with the technical detail logged server-side and never shown.
 */
export async function runNetTool(
  toolId: string,
  body: () => Promise<ExecResult>,
): Promise<ExecResult> {
  try {
    return await body();
  } catch (err) {
    if (err instanceof PdfToolError) {
      if (err.detail !== undefined) console.error(`[network:${toolId}]`, err.message, err.detail);
      return { ok: false, code: err.code as ExecErrorCode, message: err.message };
    }
    if (looksOffline(err)) {
      console.error(`[network:${toolId}] no connectivity`, err);
      return { ok: false, code: "OFFLINE", message: OFFLINE_MESSAGE };
    }
    if (err instanceof Error && err.name === "AbortError") {
      return {
        ok: false,
        code: "FAILED",
        message: "That took too long to answer. Try again in a moment.",
      };
    }
    console.error(`[network:${toolId}] unexpected failure`, err);
    return {
      ok: false,
      code: "FAILED",
      message: "This lookup could not be completed. Please try again.",
    };
  }
}

// ---- input ------------------------------------------------------------------------------------

/** Phase-17 tools take typed text or a link; none of them takes a file. */
export function requireText(input: FileRef[] | string | null, what: string): string {
  if (typeof input === "string" && input.trim() !== "") return input.trim();
  throw unsupported(`Enter ${what} first.`);
}

// ---- output -----------------------------------------------------------------------------------

export function textFile(name: string, mimeType: string, text: string): OutputFile {
  return { name, mimeType, bytes: new TextEncoder().encode(text) };
}

export function jsonFile(name: string, value: unknown): OutputFile {
  return textFile(name, MIME.json, `${JSON.stringify(value, null, 2)}\n`);
}

/** "Key: value" lines for the downloadable .txt beside every lookup's JSON. */
export function reportText(title: string, rows: [string, unknown][]): string {
  const width = Math.max(...rows.map(([k]) => k.length));
  const lines = rows
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k.padEnd(width)} : ${Array.isArray(v) ? v.join(", ") : String(v)}`);
  return `${title}\n${"-".repeat(title.length)}\n${lines.join("\n")}\n`;
}

/** A safe download stem: never a path, never a surprise extension. */
export function safeStem(stem: string, fallback = "lookup"): string {
  const cleaned = stem
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 60);
  return cleaned === "" ? fallback : cleaned;
}

// ---- politeness -------------------------------------------------------------------------------

/**
 * The User-Agent every outbound request identifies itself with. Free services (Nominatim in
 * particular) require a real one, and it is simply good manners: the operator can see who is
 * calling and `APP_URL` tells them where to complain.
 */
export function outboundUserAgent(): string {
  const site = process.env.APP_URL ?? "https://github.com/GH-BCooper/onestop";
  return `OneStop/0.1 (self-hosted file toolbox; ${site})`;
}

/**
 * A tiny per-process, per-key rate limit. Phases 04, 12, 13 and 16 all asked for one; phase 17 is
 * where it stops being optional, because every run here reaches a third party that can (and will)
 * block an instance that hammers it. In-memory on purpose: no Redis, no extra infrastructure.
 */
const buckets = new Map<string, number[]>();

export interface RateLimit {
  /** Requests allowed inside the window. */
  limit: number;
  windowMs: number;
}

export function rateLimit(key: string, { limit, windowMs }: RateLimit): void {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    const waitMs = windowMs - (now - hits[0]!);
    throw failed(
      `Too many requests in a row. Wait ${Math.ceil(waitMs / 1000)} seconds and try again.`,
    );
  }
  hits.push(now);
  buckets.set(key, hits);
  // Keep the map from growing without bound on a long-lived server.
  if (buckets.size > 500) {
    for (const [k, v] of buckets) if (v.every((t) => now - t >= windowMs)) buckets.delete(k);
  }
}

/** Tests reset the buckets so one case cannot rate-limit the next. */
export function resetRateLimits(): void {
  buckets.clear();
}

/** One shared clock guard for services that ask for at most one request a second. */
const lastCall = new Map<string, number>();

export async function pace(key: string, minGapMs: number): Promise<void> {
  const previous = lastCall.get(key) ?? 0;
  const wait = previous + minGapMs - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastCall.set(key, Date.now());
}
