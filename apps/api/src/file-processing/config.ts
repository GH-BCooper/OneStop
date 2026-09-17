// Configuration for the file-processing pipeline (04-file-core.md).
// Everything is read from env vars with safe defaults, so the app runs with no .env at all.
import os from "node:os";
import path from "node:path";
import { DEFAULT_MAX_UPLOAD_MB } from "@onestop/types";

export interface FileCoreConfig {
  /** Directory holding the temp store. Never user-controlled. */
  tempDir: string;
  /** How long a temp file lives before it is deleted, in milliseconds. */
  ttlMs: number;
  /** How often the sweeper runs, in milliseconds. */
  sweepIntervalMs: number;
  /** Hard ceiling for a single uploaded file, in bytes. */
  maxUploadBytes: number;
  /** Hard ceiling for one request (all files together), in bytes. */
  maxRequestBytes: number;
  /** Maximum number of files accepted in one request. */
  maxFilesPerRequest: number;
}

const DEFAULT_TTL_MINUTES = 60;
const MAX_FILES_PER_REQUEST = 50;

function numberFromEnv(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function loadFileCoreConfig(env: NodeJS.ProcessEnv = process.env): FileCoreConfig {
  const ttlMinutes = numberFromEnv(env.TEMP_FILE_TTL_MINUTES, DEFAULT_TTL_MINUTES);
  const maxUploadMb = numberFromEnv(env.MAX_UPLOAD_MB, DEFAULT_MAX_UPLOAD_MB);
  const baseDir = env.TEMP_DIR && env.TEMP_DIR.trim() !== "" ? env.TEMP_DIR : os.tmpdir();
  const ttlMs = Math.round(ttlMinutes * 60_000);
  const maxUploadBytes = Math.round(maxUploadMb * 1024 * 1024);
  return {
    tempDir: path.resolve(baseDir, "onestop-temp"),
    ttlMs,
    // Sweep often enough that a file never outlives its window by much, but never faster than 1s.
    sweepIntervalMs: Math.max(1_000, Math.min(ttlMs, 60_000)),
    maxUploadBytes,
    maxRequestBytes: maxUploadBytes * 4,
    maxFilesPerRequest: MAX_FILES_PER_REQUEST,
  };
}
