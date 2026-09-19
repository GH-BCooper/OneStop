// Server-side "what is installed here?" for /status (18-pwa-offline.md).
//
// Phase 17 exported `ffmpegStatus()`, `ytdlpStatus()` and `mmdbStatus()` for exactly this page, and
// phase 16's `getAiStatus()` answers the AI half. None of them runs a conversion; the AI probe is
// the only one that touches the network, and it is capped so a dead Ollama cannot hang the page.
import {
  ffmpegStatus,
  getAiStatus,
  isDatabaseConfigured,
  mmdbStatus,
  ytdlpStatus,
} from "@onestop/api";

/** One row of the dependency table. */
export interface PlatformRow {
  name: string;
  /** ok: fully usable. degraded: usable with less. missing: the tools that need it are blocked. */
  state: "ok" | "degraded" | "missing";
  value: string;
  detail: string;
  /** Which tools are affected, in plain words. */
  affects: string;
}

const AI_PROBE_MS = 2500;

export async function platformRows(): Promise<PlatformRow[]> {
  const ffmpeg = ffmpegStatus();
  const ytdlp = ytdlpStatus();
  const mmdb = mmdbStatus();

  let ai: Awaited<ReturnType<typeof getAiStatus>> | null = null;
  try {
    ai = await getAiStatus({}, AbortSignal.timeout(AI_PROBE_MS));
  } catch (err) {
    // A runtime that is slow or absent is a normal state, not a page failure.
    console.error("[status] AI status probe failed", err);
  }

  return [
    {
      name: "FFmpeg",
      state: ffmpeg.available ? "ok" : "missing",
      value: ffmpeg.available ? (ffmpeg.version ?? "installed") : "not found",
      detail: ffmpeg.available
        ? `Local binary at ${ffmpeg.path ?? "the system path"}.`
        : "Install FFmpeg and restart OneStop, or set FFMPEG_PATH.",
      affects: "Audio and video tools (they work fully offline once FFmpeg is installed).",
    },
    {
      name: "yt-dlp",
      state: ytdlp.available ? "ok" : "missing",
      value: ytdlp.available ? (ytdlp.version ?? "installed") : "not found",
      detail: ytdlp.available
        ? `Local binary at ${ytdlp.path ?? "the system path"}.`
        : "Install yt-dlp and restart OneStop, or set YTDLP_PATH.",
      affects: "Online media downloads — these also need the Internet.",
    },
    {
      name: "IP geolocation data",
      state: mmdb.usable ? "ok" : "degraded",
      value: mmdb.usable ? (mmdb.type ?? "MMDB database") : "built-in tables",
      detail: mmdb.usable
        ? "A MaxMind-format database is configured, so city-level answers are available."
        : "Using the bundled registry tables: country and registry only, no city. Set GEOIP_MMDB for more.",
      affects: "IP Geolocation — works offline either way.",
    },
    {
      name: "Database",
      state: isDatabaseConfigured() ? "ok" : "degraded",
      value: isDatabaseConfigured() ? "configured" : "not configured",
      detail: isDatabaseConfigured()
        ? "Accounts, saved history and dynamic QR codes are available."
        : "Every tool still works. Accounts, synced history and dynamic QR codes are not.",
      affects: "Accounts, history sync, favourites, dynamic QR codes.",
    },
    {
      name: "AI runtime",
      state: ai?.available ? "ok" : "degraded",
      value: ai?.available
        ? `${ai.providerLabel ?? ai.provider} (${ai.model ?? "default"})`
        : "none",
      detail:
        ai?.message ?? "No AI runtime answered. The AI tools fall back to their local methods.",
      affects:
        ai?.local === false ? "AI tools — this provider sends data off this device." : "AI tools.",
    },
  ];
}
