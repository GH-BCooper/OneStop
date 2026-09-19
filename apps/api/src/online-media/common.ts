// Shared plumbing for the online media tools (17-online-media-network-tools.md).
//
// Two things live here that the tools must not each reinvent: the link check (which platform is
// this, and is the link one OneStop will act on at all) and the error boundary that turns a
// yt-dlp failure — a removed video, a private account, a login wall, a platform change that
// breaks the extractor — into one short sentence.
import { DOWNLOAD_LEGAL_NOTICE, SPOTIFY_METADATA_NOTICE } from "@onestop/tool-registry";
import type { ExecErrorCode, ExecResult, FileRef, OutputFile } from "@onestop/types";
import { PdfToolError } from "../pdf/errors.ts";
import { looksOffline, OFFLINE_MESSAGE } from "../network/common.ts";
import { YtdlpMissingError, YtdlpRunError, YTDLP_MISSING_MESSAGE } from "./ytdlp.ts";

export { optBool, optEnum, optNumber, optString, plural } from "../documents/common.ts";
export { MIME, jsonFile, reportText, safeStem, textFile } from "../network/common.ts";

// The notices the build file requires to be visible on these pages live in the registry, so the
// tool page, the run summary and the downloaded report all quote exactly the same words.
export const LEGAL_NOTICE = DOWNLOAD_LEGAL_NOTICE;
export const SPOTIFY_NOTICE = SPOTIFY_METADATA_NOTICE;

export function unsupported(message: string, detail?: unknown): PdfToolError {
  return new PdfToolError("UNSUPPORTED_INPUT", message, detail);
}

// ---- links ---------------------------------------------------------------------------------

export type Platform = "youtube" | "instagram" | "spotify";

const HOSTS: Record<Platform, RegExp> = {
  youtube: /^(?:www\.|m\.|music\.)?(?:youtube\.com|youtube-nocookie\.com)$|^youtu\.be$/i,
  instagram: /^(?:www\.)?instagram\.com$|^(?:www\.)?instagr\.am$/i,
  spotify: /^(?:open\.|play\.)?spotify\.com$|^spotify\.link$/i,
};

const LABEL: Record<Platform, string> = {
  youtube: "YouTube",
  instagram: "Instagram",
  spotify: "Spotify",
};

/**
 * Checks the link is http(s), on the platform the tool is for, and free of anything that has no
 * business in a URL a subprocess will be handed. Returns the canonical link to pass on.
 */
export function checkLink(raw: string, platform: Platform): string {
  const text = raw.trim();
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw unsupported(`Enter a full ${LABEL[platform]} link starting with https://.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw unsupported(`Enter a full ${LABEL[platform]} link starting with https://.`);
  }
  if (url.username !== "" || url.password !== "") {
    throw unsupported("Remove the username and password from the link and try again.");
  }
  if (!HOSTS[platform].test(url.hostname)) {
    throw unsupported(
      `That is not a ${LABEL[platform]} link. This tool only works with ${LABEL[platform]} addresses.`,
    );
  }
  // yt-dlp takes the URL as one argv element with `shell: false`, but a link with whitespace or a
  // control character in it is never legitimate. `URL` has already normalised and percent-encoded
  // the address, so anything left outside printable ASCII means the input was not really a link.
  if (!/^[!-~]+$/.test(url.toString())) {
    throw unsupported("That link contains characters that are not allowed.");
  }
  url.hash = "";
  return url.toString();
}

/** A YouTube video id, when the link carries one. Used for a stable download name. */
export function youtubeId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (/youtu\.be$/i.test(parsed.hostname)) return parsed.pathname.slice(1).split("/")[0] || null;
    const v = parsed.searchParams.get("v");
    if (v) return v;
    const m = /^\/(?:shorts|embed|live|v)\/([^/?#]+)/.exec(parsed.pathname);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

// ---- the error boundary ----------------------------------------------------------------------

/** yt-dlp's stderr, mapped onto something a person can act on. */
export function ytdlpFailure(err: YtdlpRunError): { code: ExecErrorCode; message: string } {
  const text = err.stderr;
  if (/yt-dlp is out of date|Please report this issue|extractor.*broken/i.test(text)) {
    return {
      code: "FAILED",
      message:
        "The platform changed and this instance's yt-dlp no longer understands it. Update yt-dlp (pip install -U yt-dlp) and try again.",
    };
  }
  if (/Requested format is not available/i.test(text)) {
    return {
      code: "UNSUPPORTED_INPUT",
      message:
        "That quality is not offered for this video. Run the Quality Selector and pick one of the listed options.",
    };
  }
  if (
    /Private video|This video is private|login required|Sign in to confirm|requires authentication|rate-limit reached|Restricted Video/i.test(
      text,
    )
  ) {
    return {
      code: "UNSUPPORTED_INPUT",
      message:
        "This video is private, age-restricted or needs a sign-in, so it cannot be downloaded.",
    };
  }
  if (
    /Video unavailable|has been removed|no longer available|not available in your country|is not available|account.*(private|does not exist)|Page not found|HTTP Error 404/i.test(
      text,
    )
  ) {
    return { code: "UNSUPPORTED_INPUT", message: "This video is unavailable or restricted." };
  }
  if (/Unsupported URL|is not a valid URL|Unable to extract|no video could be found/i.test(text)) {
    return {
      code: "UNSUPPORTED_INPUT",
      message: "Nothing downloadable was found at that link. Check it points at a single video.",
    };
  }
  if (/DRM|protected by DRM|fragment.*decrypt/i.test(text)) {
    return {
      code: "UNSUPPORTED_INPUT",
      message: "This video is DRM-protected. OneStop does not remove copy protection.",
    };
  }
  if (/HTTP Error 429|Too Many Requests|has blocked/i.test(text)) {
    return {
      code: "FAILED",
      message: "The platform is rate-limiting this machine. Wait a few minutes and try again.",
    };
  }
  if (/is not live|live event will begin|premieres in/i.test(text)) {
    return {
      code: "UNSUPPORTED_INPUT",
      message: "This is a live or upcoming stream, so there is nothing to download yet.",
    };
  }
  if (/ffmpeg|ffprobe.*not (installed|found)/i.test(text)) {
    return {
      code: "FAILED",
      message:
        "FFmpeg is required to convert this download — install it free (see setup instructions) and try again.",
    };
  }
  if (
    /urlopen error|Temporary failure in name resolution|getaddrinfo|Network is unreachable/i.test(
      text,
    )
  ) {
    return { code: "OFFLINE", message: OFFLINE_MESSAGE };
  }
  return {
    code: "FAILED",
    message:
      "This link could not be downloaded. The platform may have changed — updating yt-dlp often fixes it.",
  };
}

/**
 * The boundary every online-media executor runs inside. Nothing thrown here escapes into the
 * pipeline, which is the build file's Isolation Requirement: the rest of the app keeps working
 * however badly a platform behaves.
 */
export async function runOnlineTool(
  toolId: string,
  body: () => Promise<ExecResult>,
): Promise<ExecResult> {
  try {
    return await body();
  } catch (err) {
    if (err instanceof YtdlpMissingError) {
      return { ok: false, code: "FAILED", message: YTDLP_MISSING_MESSAGE };
    }
    if (err instanceof PdfToolError) {
      if (err.detail !== undefined)
        console.error(`[online-media:${toolId}]`, err.message, err.detail);
      return { ok: false, code: err.code as ExecErrorCode, message: err.message };
    }
    if (err instanceof YtdlpRunError) {
      console.error(`[online-media:${toolId}] yt-dlp failed`, err.stderr.slice(-2000));
      return { ok: false, ...ytdlpFailure(err) };
    }
    if (looksOffline(err)) {
      console.error(`[online-media:${toolId}] no connectivity`, err);
      return { ok: false, code: "OFFLINE", message: OFFLINE_MESSAGE };
    }
    console.error(`[online-media:${toolId}] unexpected failure`, err);
    return {
      ok: false,
      code: "FAILED",
      message: "This link could not be processed. Please try again.",
    };
  }
}

// ---- output ------------------------------------------------------------------------------------

export function requireLink(input: FileRef[] | string | null, platform: Platform): string {
  if (typeof input !== "string" || input.trim() === "") {
    throw unsupported(`Paste a ${LABEL[platform]} link first.`);
  }
  return checkLink(input, platform);
}

export function mediaFile(name: string, mimeType: string, bytes: Uint8Array): OutputFile {
  return { name, mimeType, bytes };
}

/** "3:07", "1:02:11" — the way a duration is written under a video. */
export function clock(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "unknown length";
  const s = Math.max(0, Math.round(seconds));
  const parts = [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60];
  return parts[0]! > 0
    ? `${parts[0]}:${String(parts[1]).padStart(2, "0")}:${String(parts[2]).padStart(2, "0")}`
    : `${parts[1]}:${String(parts[2]).padStart(2, "0")}`;
}

export function megabytes(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
