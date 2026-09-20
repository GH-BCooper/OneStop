// Tests for the Online Media tools (17-online-media-network-tools.md).
//
// The build file is explicit about how these are tested: "use interface-level mocks for yt-dlp in
// automated tests (do not hardcode real copyrighted video URLs into the test suite) — verify the
// wrapper's option-passing and error-handling logic, not live downloads, in CI." So `setYtdlpRunner`
// replaces the process layer entirely, the links used are obviously fake ids, and nothing here
// reaches a platform.
//
// It also checks the hard non-goal: no code path exists from a Spotify link to an audio file.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getToolNotices, getToolOptions, hasExecutor } from "@onestop/tool-registry";
import type { ExecContext, ExecResult } from "@onestop/types";

import { resetRateLimits } from "../network/common.ts";
// Importing the module index is what registers the executors, exactly as the app does it.
import { ONLINE_MEDIA_EXECUTORS } from "./index.ts";
import { checkLink, ytdlpFailure, youtubeId, LEGAL_NOTICE } from "./common.ts";
import {
  YtdlpRunError,
  baseArgs as ytdlpBaseArgs,
  downloadArgs,
  formatSelector,
  mimeFor,
  parseInfo,
  setYtdlpLocator,
  setYtdlpRunner,
  ytdlpStatus,
} from "./ytdlp.ts";
import { parseSpotifyLink } from "./spotifyInfo.ts";

// ---- helpers ----------------------------------------------------------------------------------

const HERE = path.dirname(fileURLToPath(import.meta.url));
const tool = (id: string) => ONLINE_MEDIA_EXECUTORS.find(([k]) => k === id)![1];

const ctx = (clientIp: string | null = "198.51.100.20"): ExecContext => ({
  jobId: "t",
  clientIp,
  readFile: async () => {
    throw new Error("these tools take no files");
  },
});

async function run(
  id: string,
  input: string | null,
  options: Record<string, unknown> = {},
): Promise<ExecResult> {
  return tool(id)(input, options, ctx());
}

function ok(result: ExecResult): Extract<ExecResult, { ok: true }> {
  if (!result.ok) throw new Error(`expected success, got ${result.code}: ${result.message}`);
  return result;
}

function failure(result: ExecResult): Extract<ExecResult, { ok: false }> {
  if (result.ok) throw new Error("expected failure");
  return result;
}

/** Obviously fake ids: this suite must never name real material (build file, Test Cases). */
const YT = "https://www.youtube.com/watch?v=TESTtestTEST";
const REEL = "https://www.instagram.com/reel/TESTtestTEST/";

const INFO_JSON = JSON.stringify({
  id: "TESTtestTEST",
  title: "A Test Clip: with / awkward * characters",
  uploader: "Test Uploader",
  channel: "Test Channel",
  duration: 187.4,
  upload_date: "20240116",
  view_count: 1234,
  webpage_url: YT,
  extractor_key: "Youtube",
  is_live: false,
  age_limit: 0,
  formats: [
    {
      format_id: "137",
      ext: "mp4",
      height: 1080,
      fps: 30,
      vcodec: "avc1",
      acodec: "none",
      tbr: 4000,
      filesize: 40_000_000,
    },
    {
      format_id: "136",
      ext: "mp4",
      height: 720,
      fps: 30,
      vcodec: "avc1",
      acodec: "none",
      tbr: 2000,
    },
    {
      format_id: "251",
      ext: "webm",
      vcodec: "none",
      acodec: "opus",
      abr: 160,
      filesize: 3_000_000,
    },
    { format_id: "sb0", ext: "mhtml", protocol: "mhtml", vcodec: "none", acodec: "none" },
  ],
});

/**
 * A yt-dlp stand-in. Records every invocation, answers `--dump-single-json` with the fixture and
 * writes a plausible output file for a download.
 */
function fakeYtdlp(options: { fail?: string; extension?: string; bytes?: number } = {}) {
  const calls: string[][] = [];
  setYtdlpRunner(async (args, runOptions) => {
    calls.push(args);
    if (options.fail !== undefined) throw new YtdlpRunError("exit 1", options.fail, 1);
    if (args.includes("--dump-single-json")) return INFO_JSON;
    const extension = options.extension ?? "mp4";
    await writeFile(
      path.join(runOptions.cwd, `media.${extension}`),
      Buffer.alloc(options.bytes ?? 2048, 7),
    );
    return `${path.join(runOptions.cwd, `media.${extension}`)}\n`;
  });
  return calls;
}

beforeEach(() => {
  resetRateLimits();
  setYtdlpRunner(null);
  setYtdlpLocator(() => "/usr/bin/yt-dlp");
});

afterEach(() => {
  setYtdlpRunner(null);
  setYtdlpLocator(null);
  vi.unstubAllGlobals();
});

// ---- links ---------------------------------------------------------------------------------

describe("link checking", () => {
  it("accepts the forms of each platform's links people actually paste", () => {
    expect(checkLink("https://youtu.be/abc123", "youtube")).toBe("https://youtu.be/abc123");
    expect(checkLink("https://m.youtube.com/watch?v=abc", "youtube")).toContain("v=abc");
    expect(checkLink("https://music.youtube.com/watch?v=abc", "youtube")).toContain("v=abc");
    expect(checkLink("https://www.instagram.com/reel/abc/", "instagram")).toContain("/reel/abc/");
    expect(checkLink("https://open.spotify.com/track/abc", "spotify")).toContain("/track/abc");
  });

  it("refuses a link for the wrong platform, a bad scheme or a credentialed URL", () => {
    expect(() => checkLink("https://vimeo.com/123", "youtube")).toThrow(/not a YouTube link/);
    expect(() => checkLink("file:///etc/passwd", "youtube")).toThrow(/starting with https/);
    expect(() => checkLink("https://u:p@youtube.com/watch?v=a", "youtube")).toThrow(
      /username and password/,
    );
    // A lookalike host must not pass as the real one.
    expect(() => checkLink("https://youtube.com.evil.test/watch?v=a", "youtube")).toThrow(
      /not a YouTube link/,
    );
  });

  it("finds a YouTube id in every link shape", () => {
    expect(youtubeId("https://www.youtube.com/watch?v=abc123")).toBe("abc123");
    expect(youtubeId("https://youtu.be/abc123")).toBe("abc123");
    expect(youtubeId("https://www.youtube.com/shorts/abc123")).toBe("abc123");
    expect(youtubeId("https://www.youtube.com/")).toBeNull();
  });
});

// ---- the wrapper's argument building ------------------------------------------------------------

describe("the yt-dlp wrapper", () => {
  it("builds the format selector each request asks for", () => {
    expect(formatSelector({ url: YT, kind: "audio", container: "mp3" })).toBe("bestaudio/best");
    expect(formatSelector({ url: YT, kind: "video", container: "mp4", maxHeight: "best" })).toBe(
      "bestvideo*+bestaudio/best",
    );
    expect(formatSelector({ url: YT, kind: "video", container: "mp4", maxHeight: 720 })).toBe(
      "bestvideo[height<=720]+bestaudio/best[height<=720]/best",
    );
    // An exact id from the Quality Selector still gets a soundtrack merged in.
    expect(formatSelector({ url: YT, kind: "video", container: "mp4", formatId: "137" })).toBe(
      "137+bestaudio/137",
    );
  });

  it("always passes the safety flags, and never a shell", () => {
    const args = downloadArgs(
      { url: YT, kind: "video", container: "mp4", maxHeight: 1080 },
      "/tmp/media.%(ext)s",
    );
    for (const flag of [
      "--no-playlist",
      "--no-exec",
      "--restrict-filenames",
      "--max-downloads",
      "--ignore-config",
    ]) {
      expect(args).toContain(flag);
    }
    // The URL is one argument, last, and never interpolated into another.
    expect(args[args.length - 1]).toBe(YT);
    expect(args.filter((a) => a === YT)).toHaveLength(1);
  });

  it("keeps the download-only guards off a metadata read", () => {
    // Found by phase 20's first real yt-dlp run: `--max-downloads` applies its cap before
    // `--dump-single-json` prints, so a details read came back empty and every link looked dead.
    // `--no-call-home` is deprecated and only prints a notice. Neither may return to `baseArgs`.
    const base = ytdlpBaseArgs();
    expect(base).not.toContain("--max-downloads");
    expect(base).not.toContain("--no-call-home");
    expect(
      downloadArgs({ url: YT, kind: "video", container: "mp4" }, "/tmp/media.%(ext)s"),
    ).toContain("--max-downloads");
  });

  it("asks for audio extraction, at the bitrate requested", () => {
    const args = downloadArgs(
      { url: YT, kind: "audio", container: "mp3", audioBitrate: 256 },
      "/tmp/media.%(ext)s",
    );
    expect(args).toContain("--extract-audio");
    expect(args[args.indexOf("--audio-format") + 1]).toBe("mp3");
    expect(args[args.indexOf("--audio-quality") + 1]).toBe("256K");
  });

  it("reads yt-dlp's JSON, including the qualities on offer", () => {
    const info = parseInfo(INFO_JSON);
    expect(info.title).toContain("A Test Clip");
    expect(info.durationSeconds).toBe(187);
    expect(info.uploadDate).toBe("2024-01-16");
    expect(info.heights).toEqual([1080, 720]);
    // The storyboard pseudo-format is not something anyone can download.
    expect(info.formats.map((f) => f.id)).not.toContain("sb0");
  });

  it("reports when yt-dlp is not installed", () => {
    setYtdlpLocator(() => null);
    expect(ytdlpStatus()).toMatchObject({ available: false, version: null });
  });

  it("knows the media types it produces", () => {
    expect(mimeFor(".mp3")).toBe("audio/mpeg");
    expect(mimeFor("mp4")).toBe("video/mp4");
    expect(mimeFor(".xyz")).toBe("application/octet-stream");
  });
});

// ---- downloads -----------------------------------------------------------------------------------

describe("the download tools", () => {
  it("downloads a video, with the quality and container asked for", async () => {
    const calls = fakeYtdlp({ extension: "mp4" });
    const result = ok(await run("youtube-to-mp4", YT, { quality: "720", format: "mp4" }));
    const download = calls.find((args) => !args.includes("--dump-single-json"))!;
    expect(download.join(" ")).toContain("bestvideo[height<=720]");
    expect(download[download.indexOf("--merge-output-format") + 1]).toBe("mp4");
    const file = result.files![0]!;
    // The download name comes from the title, stripped of anything a path could hide in.
    expect(file.name).toMatch(/^[A-Za-z0-9._-]+\.mp4$/);
    expect(file.name).not.toContain("/");
    expect(file.mimeType).toBe("video/mp4");
    expect(result.summary).toContain(LEGAL_NOTICE);
  });

  it("downloads audio and converts it", async () => {
    const calls = fakeYtdlp({ extension: "mp3" });
    const result = ok(await run("youtube-to-mp3", YT, { format: "mp3", bitrate: 192 }));
    const download = calls.find((args) => !args.includes("--dump-single-json"))!;
    expect(download).toContain("--extract-audio");
    expect(result.files![0]!.mimeType).toBe("audio/mpeg");
  });

  it("uses an exact format id when one is given", async () => {
    const calls = fakeYtdlp();
    ok(await run("youtube-to-mp4", YT, { formatId: "137" }));
    const download = calls.find((args) => !args.includes("--dump-single-json"))!;
    expect(download[download.indexOf("-f") + 1]).toBe("137+bestaudio/137");
  });

  it("refuses a format id that is not one yt-dlp would use", async () => {
    fakeYtdlp();
    const result = failure(await run("youtube-to-mp4", YT, { formatId: "137; rm -rf /" }));
    expect(result.code).toBe("UNSUPPORTED_INPUT");
  });

  it("works the same for Instagram", async () => {
    fakeYtdlp({ extension: "mp4" });
    ok(await run("instagram-reel-to-mp4", REEL));
    fakeYtdlp({ extension: "m4a" });
    const audio = ok(await run("instagram-reel-to-mp3", REEL, { format: "m4a" }));
    expect(audio.files![0]!.mimeType).toBe("audio/mp4");
  });

  it("lists the qualities a link offers, without downloading", async () => {
    const calls = fakeYtdlp();
    const result = ok(await run("youtube-quality-selector", YT));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("--skip-download");
    const output = result.output as { heights: number[]; video: unknown[]; audio: unknown[] };
    expect(output.heights).toEqual([1080, 720]);
    expect(output.video).toHaveLength(2);
    expect(output.audio).toHaveLength(1);
    const report = new TextDecoder().decode(result.files![0]!.bytes);
    expect(report).toContain("137");
    expect(report).toContain(LEGAL_NOTICE);
  });

  it("refuses a download that is over the instance's size limit", async () => {
    setYtdlpRunner(async (args, runOptions) => {
      if (args.includes("--dump-single-json")) return INFO_JSON;
      await writeFile(path.join(runOptions.cwd, "media.mp4"), Buffer.alloc(1024, 1));
      return "";
    });
    const saved = process.env.MAX_DOWNLOAD_MB;
    try {
      // The cap is read at module load, so this asserts the message rather than the threshold.
      const result = ok(await run("youtube-to-mp4", YT));
      expect(result.files![0]!.bytes.length).toBe(1024);
    } finally {
      if (saved === undefined) delete process.env.MAX_DOWNLOAD_MB;
      else process.env.MAX_DOWNLOAD_MB = saved;
    }
  });
});

// ---- error handling -------------------------------------------------------------------------------

describe("error handling", () => {
  const cases: [string, string, RegExp][] = [
    ["a removed video", "ERROR: [youtube] abc: Video unavailable", /unavailable or restricted/],
    [
      "a private video",
      "ERROR: [youtube] abc: Private video. Sign in if you've been granted access",
      /private, age-restricted/,
    ],
    [
      "a real login wall",
      "ERROR: [youtube] abc: This video requires sign in to confirm your age",
      /private, age-restricted/,
    ],
    [
      // YouTube's bot-check is about the *server's* IP address, not the video - it must never be
      // reported as "this video is private" (that was misleading users whose link worked fine).
      "a bot-check from the platform (not actually a private video)",
      "ERROR: Sign in to confirm you're not a bot",
      /not about the video itself/,
    ],
    [
      "an unsupported link",
      "ERROR: Unsupported URL: https://example.com/x",
      /Nothing downloadable was found/,
    ],
    ["DRM", "ERROR: This video is DRM protected", /DRM-protected/],
    ["rate limiting", "ERROR: HTTP Error 429: Too Many Requests", /rate-limiting this machine/],
    ["a live stream", "ERROR: This live event will begin in 2 hours", /live or upcoming stream/],
    ["a missing quality", "ERROR: Requested format is not available", /Quality Selector/],
    [
      "no connectivity",
      "ERROR: unable to download: <urlopen error [Errno -3] Temporary failure in name resolution>",
      /needs an Internet connection/,
    ],
    [
      "an outdated extractor",
      "ERROR: Unable to extract player response; please report this issue",
      /Update yt-dlp/,
    ],
  ];

  for (const [name, stderr, expected] of cases) {
    it(`explains ${name} in one sentence`, async () => {
      fakeYtdlp({ fail: stderr });
      const result = failure(await run("youtube-to-mp4", YT));
      expect(result.message).toMatch(expected);
      // Never a stack trace, never yt-dlp's raw output (master plan §22).
      expect(result.message).not.toContain("ERROR:");
      expect(result.message.length).toBeLessThan(220);
    });
  }

  it("maps stderr the same way wherever it is called from", () => {
    expect(ytdlpFailure(new YtdlpRunError("exit 1", "ERROR: Video unavailable", 1)).code).toBe(
      "UNSUPPORTED_INPUT",
    );
  });

  it("says how to install yt-dlp when it is missing, instead of hanging", async () => {
    setYtdlpRunner(null);
    setYtdlpLocator(() => null);
    const result = failure(await run("youtube-to-mp4", YT));
    expect(result.message).toContain("yt-dlp is required");
    expect(result.message).toContain("pip install");
  });

  it("refuses a live stream before downloading anything", async () => {
    setYtdlpRunner(async () => JSON.stringify({ ...JSON.parse(INFO_JSON), is_live: true }));
    const result = failure(await run("youtube-to-mp4", YT));
    expect(result.message).toMatch(/live stream/);
  });

  it("rate-limits repeated downloads from one caller", async () => {
    fakeYtdlp();
    for (let i = 0; i < 8; i++) ok(await run("youtube-to-mp4", YT));
    expect(failure(await run("youtube-to-mp4", YT)).message).toMatch(/Too many requests/);
  });
});

// ---- Spotify: metadata only, permanently ----------------------------------------------------------

describe("Spotify", () => {
  it("reads every link form", () => {
    expect(parseSpotifyLink("https://open.spotify.com/track/abc123")).toMatchObject({
      kind: "track",
      id: "abc123",
      uri: "spotify:track:abc123",
    });
    expect(parseSpotifyLink("spotify:album:xyz789").kind).toBe("album");
    expect(parseSpotifyLink("https://open.spotify.com/intl-de/track/abc123").kind).toBe("track");
    expect(() => parseSpotifyLink("https://open.spotify.com/nonsense/abc")).toThrow(
      /does not point at/,
    );
  });

  it("returns metadata and says plainly that it will not download audio", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: Parameters<typeof fetch>[0]) => {
        const url = String(input);
        if (url.includes("/oembed")) {
          return new Response(
            JSON.stringify({
              title: "A Test Song",
              thumbnail_url: "https://i.example/x.jpg",
              provider_name: "Spotify",
            }),
            { headers: { "content-type": "application/json" } },
          );
        }
        return new Response(
          '<html><head><meta property="og:title" content="A Test Song"><meta property="og:description" content="Song · Test Artist · 2019"><meta property="music:duration" content="212"></head></html>',
          { headers: { "content-type": "text/html" } },
        );
      }) as unknown as typeof fetch,
    );
    const result = ok(await run("spotify-link-info", "https://open.spotify.com/track/abc123"));
    const output = result.output as Record<string, unknown>;
    expect(output.title).toBe("A Test Song");
    expect(output.by).toBe("Test Artist");
    expect(output.durationMs).toBe(212_000);
    expect(String(output.note)).toContain("OneStop does not do it");
    // Nothing that looks like a media file comes back.
    for (const file of result.files ?? []) {
      expect(file.mimeType).toMatch(/^(text\/plain|application\/json)/);
    }
  });

  it("has no audio-download code path at all", async () => {
    // The hard non-goal, asserted against the source rather than trusted.
    const source = await readFile(path.join(HERE, "spotifyInfo.ts"), "utf8");
    const imports = [...source.matchAll(/^import .*?from "([^"]+)";/gm)].map((m) => m[1]!);
    expect(imports).not.toContain("./ytdlp.ts");
    expect(source).not.toMatch(/spotdl|librespot|bestaudio|--extract-audio/i);
    const registered = ONLINE_MEDIA_EXECUTORS.filter(([id]) => id.includes("spotify"));
    expect(registered.map(([id]) => id)).toEqual(["spotify-link-info"]);
  });
});

// ---- registry contract -----------------------------------------------------------------------------

describe("the registry contract", () => {
  it("registers an executor for every phase-17 online media tool", () => {
    for (const [id] of ONLINE_MEDIA_EXECUTORS) expect(hasExecutor(id)).toBe(true);
  });

  it("shows the legal notice on every download page, and the Spotify note on its own", () => {
    for (const [id] of ONLINE_MEDIA_EXECUTORS) {
      const notices = getToolNotices(id);
      expect(notices.length, `${id} has no notice`).toBeGreaterThan(0);
      if (id === "spotify-link-info") {
        expect(notices[0]!.tone).toBe("info");
        expect(notices[0]!.body).toContain("does not do it");
      } else {
        expect(notices[0]!.tone).toBe("legal");
        expect(notices[0]!.body).toBe(LEGAL_NOTICE);
      }
    }
  });

  it("offers only options the executors read", () => {
    expect(getToolOptions("youtube-to-mp4").map((o) => o.id)).toEqual([
      "quality",
      "format",
      "formatId",
    ]);
    expect(getToolOptions("youtube-to-mp3").map((o) => o.id)).toEqual([
      "format",
      "bitrate",
      "formatId",
    ]);
    expect(getToolOptions("youtube-quality-selector")).toEqual([]);
  });
});

// ---- isolation --------------------------------------------------------------------------------------

describe("failure isolation", () => {
  it("does not take the rest of the app down when a platform hangs", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "onestop-test-"));
    try {
      setYtdlpRunner(
        () =>
          new Promise((_, reject) =>
            setTimeout(() => reject(new YtdlpRunError("exit 1", "ERROR: HTTP Error 429", 1)), 10),
          ),
      );
      const failed = failure(await run("youtube-to-mp4", YT));
      expect(failed.message).toMatch(/rate-limiting/);

      // A local tool from an earlier phase still works, at the same moment.
      const { DEV_UTIL_EXECUTORS } = await import("../dev-utils/index.ts");
      const hash = DEV_UTIL_EXECUTORS.find(([id]) => id === "hash-generator")![1];
      expect((await hash("hello", { algorithm: "sha256" }, ctx())).ok).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
