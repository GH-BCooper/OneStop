// Shared plumbing for the five new toolkit categories (21-roadmap-expansion.md): Security &
// Privacy, Finance & Math, Education & Reference, Calendar & Time, and Fun & Personal.
//
// These tools are small and almost all pure computation, so the shared part is only the error
// contract (identical to every phase before it) and a couple of output helpers. Nothing here
// reaches the network, and nothing here needs a dependency that was not already installed.
import type { ExecErrorCode, ExecResult, OutputFile } from "@onestop/types";
import { PdfToolError } from "../pdf/errors.ts";

export { optBool, optEnum, optNumber, optString, plural } from "../documents/common.ts";
export { PdfToolError as ToolkitError } from "../pdf/errors.ts";

export const MIME = {
  txt: "text/plain; charset=utf-8",
  json: "application/json; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  html: "text/html; charset=utf-8",
  ics: "text/calendar; charset=utf-8",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  bin: "application/octet-stream",
} as const;

export function unsupported(message: string, detail?: unknown): PdfToolError {
  return new PdfToolError("UNSUPPORTED_INPUT", message, detail);
}

export function failed(message: string, detail?: unknown): PdfToolError {
  return new PdfToolError("FAILED", message, detail);
}

export async function runToolkitTool(
  toolId: string,
  body: () => Promise<ExecResult>,
): Promise<ExecResult> {
  try {
    return await body();
  } catch (err) {
    if (err instanceof PdfToolError) {
      if (err.detail !== undefined) console.error(`[toolkit:${toolId}]`, err.message, err.detail);
      return { ok: false, code: err.code as ExecErrorCode, message: err.message };
    }
    console.error(`[toolkit:${toolId}] unexpected failure`, err);
    return { ok: false, code: "FAILED", message: "This could not be processed. Please try again." };
  }
}

export function textFile(name: string, mimeType: string, text: string): OutputFile {
  return { name, mimeType, bytes: new TextEncoder().encode(text) };
}

export function jsonFile(name: string, value: unknown): OutputFile {
  return textFile(name, MIME.json, JSON.stringify(value, null, 2) + "\n");
}

export function csvFile(name: string, rows: (string | number)[][]): OutputFile {
  const cell = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return textFile(name, MIME.csv, rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n");
}

/** Typed text only — these tools have no file input. */
export function requireText(input: unknown, what: string): string {
  if (typeof input === "string" && input.trim() !== "") return input;
  throw unsupported(`Enter ${what} first.`);
}

/** Text from a typed value *or* an uploaded text file. */
export async function readTextish(
  input: unknown,
  ctx: { readFile: (ref: never) => Promise<Uint8Array> } | undefined,
  what: string,
): Promise<string> {
  if (typeof input === "string" && input.trim() !== "") return input;
  if (Array.isArray(input) && input.length > 0 && ctx) {
    const bytes = await ctx.readFile(input[0] as never);
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    if (text.trim() !== "") return text;
  }
  throw unsupported(`Enter ${what} first.`);
}

export function round(n: number, places = 2): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/** A download name with nothing a path could hide in. */
export function safeStem(stem: string, fallback = "file"): string {
  const cleaned = stem
    .replace(/\\/g, "/")
    .split("/")
    .pop()!
    .replace(/[^A-Za-z0-9._ -]+/g, "-")
    .replace(/^[-.\s]+|[-\s]+$/g, "");
  return cleaned === "" ? fallback : cleaned.slice(0, 80);
}
