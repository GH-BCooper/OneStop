# Phase 10 — Audio & Video Tools

## Objective
Implement all Audio and Video tools from the Feature & Tool List using local FFmpeg.

## Depends On
04-file-core.md

## Tools Implemented This Phase
**Audio:** Video → MP3, Audio Converter, Audio Compressor, Audio Trimmer, Audio Merger, Audio → WAV/MP3/AAC/FLAC, Extract Audio from Video, Audio Metadata Viewer/Editor, Volume Normalizer, Audio Waveform Generator.

**Video:** Video Converter, Video Compressor, Video → MP4/WebM/GIF, Video Trimmer, Video Merger, Video Resizer, Video Rotation, Extract Audio, Extract Frames, Subtitle Extraction, Subtitle Conversion, Change Video Resolution/Quality.

## Library
`fluent-ffmpeg` wrapping a locally installed FFmpeg binary — free and industry-standard. This is a **required local dependency**, not optional like LibreOffice; document clear install instructions per OS (macOS: `brew install ffmpeg`; Ubuntu/Debian: `apt install ffmpeg`; Windows: documented binary download) and detect at startup whether FFmpeg is on PATH.

## Modules / Files
`apps/api/media/{convertAudio.ts, convertVideo.ts, trim.ts, merge.ts, extractAudio.ts, extractFrames.ts, subtitles.ts, waveform.ts, normalize.ts, metadata.ts, ffmpegCheck.ts}`.

## Acceptance Criteria
- [ ] Every listed tool works fully offline once FFmpeg is installed, with no other paid or cloud dependency.
- [ ] Conversions preserve reasonable quality/duration; trims produce the correct output length; merges produce correct total duration.
- [ ] Subtitle extraction/conversion correctly handles at least SRT and VTT.
- [ ] Waveform generator produces a usable visual (SVG/PNG or a data structure the frontend can render as a waveform).
- [ ] If FFmpeg is missing, every tool in this module shows one consistent, clear message ("FFmpeg is required for audio/video tools — see setup instructions") instead of crashing or hanging.

## Test Cases
- Fixture-based tests: known-duration audio/video clips → assert output duration/codec/resolution match expectations for each tool.
- Merge test: two clips of known duration → output duration ≈ sum (within a small tolerance).
- Missing-FFmpeg test: simulate FFmpeg not on PATH, confirm the graceful error path fires for a representative sample of tools in this module.
- Subtitle round-trip test: SRT → VTT → SRT preserves timing and text.

## Notes
Log the exact FFmpeg version you tested against in PROGRESS.md, and confirm the install instructions you wrote actually work on at least one real OS before marking this phase complete.
