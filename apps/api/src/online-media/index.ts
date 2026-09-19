// Online Media tools (17-online-media-network-tools.md, Features §9).
//
// Importing this module registers every executor with the tool registry.
//
// Two things about this module are deliberate and permanent:
//   * yt-dlp is the only downloader, it runs locally, and nothing here circumvents DRM. The legal
//     notice (`LEGAL_NOTICE`) is exported so the tool page shows exactly the same words.
//   * Spotify is metadata only. `spotifyInfo.ts` does not import yt-dlp and there is no code path
//     from a Spotify link to an audio file.
import { registerExecutor } from "@onestop/tool-registry";
import { ONLINE_MEDIA_EXECUTORS } from "./tools.ts";

export * from "./tools.ts";
export {
  LEGAL_NOTICE,
  SPOTIFY_NOTICE,
  checkLink,
  clock as mediaClock,
  megabytes,
  runOnlineTool,
  youtubeId,
  ytdlpFailure,
  type Platform,
} from "./common.ts";
export {
  MAX_DOWNLOAD_BYTES,
  YTDLP_MISSING_MESSAGE,
  YtdlpMissingError,
  YtdlpRunError,
  baseArgs as ytdlpBaseArgs,
  download,
  downloadArgs,
  fetchInfo,
  findYtdlp,
  formatSelector,
  mimeFor,
  parseInfo,
  setYtdlpLocator,
  setYtdlpRunner,
  ytdlpStatus,
  ytdlpVersion,
  type DownloadRequest,
  type DownloadedFile,
  type MediaFormat,
  type MediaInfo,
  type YtdlpRunner,
} from "./ytdlp.ts";
export {
  lookupSpotify,
  parseSpotifyLink,
  type SpotifyInfo,
  type SpotifyKind,
  type SpotifyLink,
} from "./spotifyInfo.ts";

for (const [id, executor] of ONLINE_MEDIA_EXECUTORS) registerExecutor(id, executor);
