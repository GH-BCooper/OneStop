// Audio & video tools (10-audio-video-tools.md).
//
// Importing this module registers every executor with the tool registry, following the phase-04
// pattern: the registry never imports these files, they register themselves. FFmpeg is detected
// once here so a missing install shows up in the server log at startup rather than only when
// somebody uploads a file.
import { registerExecutor } from "@onestop/tool-registry";

import {
  audioCompressorExecutor,
  audioConverterExecutor,
  audioToAacExecutor,
  audioToFlacExecutor,
  audioToMp3Executor,
  audioToWavExecutor,
  videoToMp3Executor,
} from "./convertAudio.ts";
import {
  changeQualityExecutor,
  changeResolutionExecutor,
  rotateVideoExecutor,
  videoCompressorExecutor,
  videoConverterExecutor,
  videoResizerExecutor,
  videoToGifExecutor,
  videoToMp4Executor,
  videoToWebmExecutor,
} from "./convertVideo.ts";
import { extractAudioExecutor } from "./extractAudio.ts";
import { extractFramesExecutor } from "./extractFrames.ts";
import { audioMergerExecutor, videoMergerExecutor } from "./merge.ts";
import { audioMetadataExecutor } from "./metadata.ts";
import { volumeNormalizerExecutor } from "./normalize.ts";
import { subtitleConversionExecutor, subtitleExtractionExecutor } from "./subtitles.ts";
import { audioTrimmerExecutor, videoTrimmerExecutor } from "./trim.ts";
import { ffmpegStatus } from "./ffmpegCheck.ts";

export {
  FFMPEG_MISSING_MESSAGE,
  ffmpegStatus,
  ffmpegVersion,
  findFfmpeg,
  setFfmpegLocator,
  type FfmpegBinaries,
} from "./ffmpegCheck.ts";
export { encodeAudio } from "./convertAudio.ts";
export { encodeVideo, canRemux } from "./convertVideo.ts";
export { trimRange } from "./trim.ts";
export { decodePcm, peaksFromPcm, waveformSvg } from "./waveform.ts";
export {
  convertSubtitles,
  parseSubtitles,
  writeSubtitles,
  detectSubtitleFormat,
  decodeSubtitleBytes,
  parseTimestamp,
  formatTimestamp,
  type Cue,
  type SubtitleFormat,
} from "./subtitles.ts";
export { describeAudio, readTags } from "./metadata.ts";
export { parseTime, clock, probe, readMedia, withWorkdir, type MediaInput, type Probe } from "./common.ts";

import { waveformExecutor } from "./waveform.ts";

/** Every tool this phase owns, in the order the Features list gives them. */
export const MEDIA_EXECUTORS = [
  // Features §7 — Audio
  ["video-to-mp3", videoToMp3Executor],
  ["audio-converter", audioConverterExecutor],
  ["audio-compressor", audioCompressorExecutor],
  ["audio-trimmer", audioTrimmerExecutor],
  ["audio-merger", audioMergerExecutor],
  ["audio-to-wav", audioToWavExecutor],
  ["audio-to-mp3", audioToMp3Executor],
  ["audio-to-aac", audioToAacExecutor],
  ["audio-to-flac", audioToFlacExecutor],
  ["extract-audio", extractAudioExecutor],
  ["audio-metadata-editor", audioMetadataExecutor],
  ["volume-normalizer", volumeNormalizerExecutor],
  ["audio-waveform-generator", waveformExecutor],
  // Features §8 — Video
  ["video-converter", videoConverterExecutor],
  ["video-compressor", videoCompressorExecutor],
  ["video-to-mp4", videoToMp4Executor],
  ["video-to-webm", videoToWebmExecutor],
  ["video-to-gif", videoToGifExecutor],
  ["video-trimmer", videoTrimmerExecutor],
  ["video-merger", videoMergerExecutor],
  ["video-resizer", videoResizerExecutor],
  ["rotate-video", rotateVideoExecutor],
  ["extract-frames", extractFramesExecutor],
  ["subtitle-extraction", subtitleExtractionExecutor],
  ["subtitle-conversion", subtitleConversionExecutor],
  ["change-video-resolution", changeResolutionExecutor],
  ["change-video-quality", changeQualityExecutor],
] as const;

for (const [id, executor] of MEDIA_EXECUTORS) registerExecutor(id, executor);

// Startup detection (10-audio-video-tools.md): say it once, in the log, not per request.
if (process.env.NODE_ENV !== "test" && !ffmpegStatus().available) {
  console.warn(
    "[media] FFmpeg was not found on PATH. The audio and video tools will report that it is required until it is installed (macOS: brew install ffmpeg · Ubuntu/Debian: sudo apt install ffmpeg · Windows: winget install Gyan.FFmpeg), or set FFMPEG_PATH.",
  );
}
