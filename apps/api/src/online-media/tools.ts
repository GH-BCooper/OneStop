// The seven Online Media tools (17-online-media-network-tools.md, Features §9).
//
// Five of them are one shape — check the link, ask yt-dlp what is there, download one item, hand
// the bytes to the pipeline — so they are built from one function with different defaults. The
// two Quality Selectors stop after the "what is there" step and return the list. The Spotify tool
// shares none of this: it never touches yt-dlp (see `spotifyInfo.ts`).
import type { Executor } from "@onestop/tool-registry";
import type { ExecContext, ExecResult } from "@onestop/types";
import { rateLimit } from "../network/common.ts";
import {
  LEGAL_NOTICE,
  MIME,
  SPOTIFY_NOTICE,
  clock,
  jsonFile,
  mediaFile,
  megabytes,
  optEnum,
  optNumber,
  optString,
  plural,
  reportText,
  requireLink,
  runOnlineTool,
  safeStem,
  textFile,
  unsupported,
  youtubeId,
  type Platform,
} from "./common.ts";
import { lookupSpotify } from "./spotifyInfo.ts";
import { download, fetchInfo, type MediaInfo } from "./ytdlp.ts";

/** Downloads reach a platform that will throttle an instance that hammers it. */
const BUDGET = { limit: 8, windowMs: 60_000 };
const INFO_BUDGET = { limit: 20, windowMs: 60_000 };

function guard(toolId: string, ctx: ExecContext | undefined, budget = BUDGET): void {
  rateLimit(`${toolId}:${ctx?.clientIp ?? "local"}`, budget);
}

const AUDIO_FORMATS = ["mp3", "m4a", "opus", "wav", "flac"] as const;
const VIDEO_FORMATS = ["mp4", "webm", "mkv"] as const;
const HEIGHTS = ["best", "2160", "1440", "1080", "720", "480", "360"] as const;

function runOptions(ctx?: ExecContext): { signal?: AbortSignal } {
  return ctx?.signal ? { signal: ctx.signal } : {};
}

/** A download name built from the title, never from anything the platform controls verbatim. */
function stemFor(info: MediaInfo, platform: Platform): string {
  const id = platform === "youtube" ? youtubeId(info.webpageUrl) : info.id;
  return safeStem(info.title.slice(0, 60), id || platform);
}

function infoRows(info: MediaInfo): [string, unknown][] {
  return [
    ["Title", info.title],
    ["Channel", info.channel ?? info.uploader ?? ""],
    ["Length", clock(info.durationSeconds)],
    ["Uploaded", info.uploadDate ?? ""],
    ["Views", info.viewCount ?? ""],
    ["Link", info.webpageUrl],
  ];
}

// ---- downloads ---------------------------------------------------------------------------------

interface DownloadToolOptions {
  toolId: string;
  platform: Platform;
  kind: "video" | "audio";
}

function downloadTool({ toolId, platform, kind }: DownloadToolOptions): Executor {
  return (input, options, ctx) =>
    runOnlineTool(toolId, async () => {
      guard(toolId, ctx);
      const url = requireLink(input, platform);
      const info = await fetchInfo(url, { cwd: process.cwd(), ...runOptions(ctx) });

      if (info.isLive) {
        throw unsupported("This is a live stream. Wait until it has finished and try again.");
      }

      const container =
        kind === "audio"
          ? optEnum(options, "format", AUDIO_FORMATS, "mp3")
          : optEnum(options, "format", VIDEO_FORMATS, "mp4");
      const heightChoice = optEnum(options, "quality", HEIGHTS, kind === "audio" ? "best" : "1080");
      const formatId = optString(options, "formatId", "").trim();
      if (formatId !== "" && !/^[A-Za-z0-9_.+-]{1,40}$/.test(formatId)) {
        throw unsupported(
          "That format id is not one yt-dlp uses. Leave it blank, or copy one from the Quality Selector.",
        );
      }

      const file = await download(
        {
          url,
          kind,
          container,
          maxHeight: heightChoice === "best" ? "best" : Number(heightChoice),
          ...(kind === "audio"
            ? { audioBitrate: optNumber(options, "bitrate", 192, { min: 64, max: 320 }) }
            : {}),
          ...(formatId === "" ? {} : { formatId }),
        },
        runOptions(ctx),
      );

      const stem = stemFor(info, platform);
      const extension = file.name.split(".").pop() ?? container;
      const output = {
        title: info.title,
        channel: info.channel ?? info.uploader,
        durationSeconds: info.durationSeconds,
        url: info.webpageUrl,
        format: extension,
        sizeBytes: file.bytes.length,
        quality:
          kind === "audio"
            ? `${container} audio`
            : heightChoice === "best"
              ? "best available"
              : `${heightChoice}p or lower`,
        notice: LEGAL_NOTICE,
      };

      return {
        ok: true,
        output,
        summary: `Saved "${info.title}" (${clock(info.durationSeconds)}) as ${extension.toUpperCase()}, ${megabytes(file.bytes.length)}. ${LEGAL_NOTICE}`,
        files: [mediaFile(`${stem}.${extension}`, file.mimeType, file.bytes)],
      } satisfies ExecResult;
    });
}

export const youtubeToMp3Executor = downloadTool({
  toolId: "youtube-to-mp3",
  platform: "youtube",
  kind: "audio",
});
export const youtubeToMp4Executor = downloadTool({
  toolId: "youtube-to-mp4",
  platform: "youtube",
  kind: "video",
});
export const instagramReelToMp3Executor = downloadTool({
  toolId: "instagram-reel-to-mp3",
  platform: "instagram",
  kind: "audio",
});
export const instagramReelToMp4Executor = downloadTool({
  toolId: "instagram-reel-to-mp4",
  platform: "instagram",
  kind: "video",
});

// ---- quality selectors ---------------------------------------------------------------------------

function qualitySelector(toolId: string, platform: Platform): Executor {
  return (input, _options, ctx) =>
    runOnlineTool(toolId, async () => {
      guard(toolId, ctx, INFO_BUDGET);
      const url = requireLink(input, platform);
      const info = await fetchInfo(url, { cwd: process.cwd(), ...runOptions(ctx) });

      const video = info.formats
        .filter((f) => f.hasVideo)
        .sort(
          (a, b) =>
            (b.height ?? 0) - (a.height ?? 0) || (b.bitrateKbps ?? 0) - (a.bitrateKbps ?? 0),
        );
      const audio = info.formats
        .filter((f) => !f.hasVideo && f.hasAudio)
        .sort((a, b) => (b.bitrateKbps ?? 0) - (a.bitrateKbps ?? 0));

      if (video.length === 0 && audio.length === 0) {
        throw unsupported("No downloadable formats were offered for this link.");
      }

      const line = (f: (typeof video)[number]) =>
        [
          f.id.padEnd(8),
          f.ext.padEnd(5),
          f.label.padEnd(11),
          f.fps ? `${f.fps}fps`.padEnd(7) : "".padEnd(7),
          f.bitrateKbps ? `${Math.round(f.bitrateKbps)}k`.padEnd(8) : "".padEnd(8),
          f.filesizeBytes ? megabytes(f.filesizeBytes) : "",
        ]
          .join(" ")
          .trimEnd();

      const report = [
        reportText(`Formats for "${info.title}"`, infoRows(info)),
        "",
        "Video",
        "id       ext   quality     fps     bitrate  size",
        ...video.map(line),
        "",
        "Audio only",
        "id       ext   quality     fps     bitrate  size",
        ...audio.map(line),
        "",
        `Pick an id and paste it into the "Exact format id" option of ${platform === "youtube" ? "YouTube → MP4 / MP3" : "Instagram Reel → MP4 / MP3"}.`,
        "",
        LEGAL_NOTICE,
      ].join("\n");

      const output = {
        title: info.title,
        channel: info.channel ?? info.uploader,
        durationSeconds: info.durationSeconds,
        url: info.webpageUrl,
        heights: info.heights,
        video,
        audio,
        notice: LEGAL_NOTICE,
      };

      return {
        ok: true,
        output,
        summary: `"${info.title}" offers ${plural(info.heights.length, "picture quality")}${
          info.heights.length > 0 ? ` (up to ${info.heights[0]}p)` : ""
        } and ${plural(audio.length, "audio-only format")}.`,
        files: [
          textFile(`${stemFor(info, platform)}-formats.txt`, MIME.txt, `${report}\n`),
          jsonFile(`${stemFor(info, platform)}-formats.json`, output),
        ],
      } satisfies ExecResult;
    });
}

export const youtubeQualitySelectorExecutor = qualitySelector(
  "youtube-quality-selector",
  "youtube",
);
export const instagramQualitySelectorExecutor = qualitySelector(
  "instagram-quality-selector",
  "instagram",
);

// ---- §9.7 Spotify Link Info (metadata only, permanently) -----------------------------------------

export const spotifyLinkInfoExecutor: Executor = (input, _options, ctx) =>
  runOnlineTool("spotify-link-info", async () => {
    guard("spotify-link-info", ctx, INFO_BUDGET);
    if (typeof input !== "string" || input.trim() === "") {
      throw unsupported("Paste a Spotify link first.");
    }
    const info = await lookupSpotify(input, runOptions(ctx));
    const report = reportText(`Spotify ${info.kind} — ${info.title ?? info.id}`, [
      ["Type", info.kind],
      ["Title", info.title ?? ""],
      ["By", info.by ?? ""],
      ["Description", info.description ?? ""],
      ["Released", info.releaseDate ?? ""],
      ["Length", info.durationMs ? clock(Math.round(info.durationMs / 1000)) : ""],
      ["Link", info.url],
      ["URI", info.uri],
      ["Artwork", info.thumbnail ?? ""],
      ["Note", SPOTIFY_NOTICE],
    ]);
    return {
      ok: true,
      output: { ...info, note: SPOTIFY_NOTICE },
      summary: `${info.title ?? "This item"}${info.by ? ` by ${info.by}` : ""} — a Spotify ${info.kind}. ${SPOTIFY_NOTICE}`,
      files: [
        textFile(`${safeStem(info.title ?? info.id, "spotify")}.txt`, MIME.txt, report),
        jsonFile(`${safeStem(info.title ?? info.id, "spotify")}.json`, info),
      ],
    } satisfies ExecResult;
  });

/** Every executor this file owns, in the order Features §9 lists them. */
export const ONLINE_MEDIA_EXECUTORS = [
  ["youtube-to-mp3", youtubeToMp3Executor],
  ["youtube-to-mp4", youtubeToMp4Executor],
  ["youtube-quality-selector", youtubeQualitySelectorExecutor],
  ["instagram-reel-to-mp3", instagramReelToMp3Executor],
  ["instagram-reel-to-mp4", instagramReelToMp4Executor],
  ["instagram-quality-selector", instagramQualitySelectorExecutor],
  ["spotify-link-info", spotifyLinkInfoExecutor],
] as const;
