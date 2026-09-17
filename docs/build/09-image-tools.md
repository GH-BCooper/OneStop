# Phase 09 — Image Tools

## Objective
Implement all 28 image tools from the Feature & Tool List.

## Depends On
04-file-core.md

## Tools Implemented This Phase
Image → PDF, PDF → Image (thin wrapper around phase 05's `toImages`), Resizer, Cropper, Compressor, Format Converter (incl. JPG↔PNG, JPG↔WebP, PNG↔WebP, Image → GIF), Background Blur, Background Removal, Object Removal, Upscaler, Enhancer, Sharpening, Denoiser, Watermark, Add Text to Image, Metadata Viewer/Remover, Color Adjustment, Rotate, Flip, Fit to Square (fill/contain/stretch/repeat/blur-background), Fit to Circle (same 5 modes), Meme Generator, Basic Image Editor.

## Split: Deterministic vs AI-based Tools
**Deterministic (implement fully now, offline, via `sharp`):** Resizer, Cropper, Compressor, Format Converter, Watermark, Add Text, Metadata Viewer/Remover, Color Adjustment, Rotate, Flip, Fit to Square/Circle (all 5 modes each), Basic Image Editor, Meme Generator, Background Blur (simple gaussian blur of the whole image or a naive foreground-preserving blur is acceptable here).

**AI-based (need a model):** Background Removal, Object Removal, Upscaler, Enhancer, Sharpening (AI-based variant — a basic unsharp-mask sharpening via `sharp` should also exist as the non-AI default), Denoiser.
- Implement these behind a common interface now (`packages/tool-registry` marks them `offline: "maybe"`-equivalent — pick a concrete flag, e.g. `requiresLocalModel: true`).
- Provide a basic non-AI fallback wherever reasonable (e.g. simple edge-detection-based object removal is out of scope — it's fine for these specific ones to hard-require phase 16's local model runtime, but they must degrade with a clear, specific message: "This feature needs a local AI model. Enable one in Settings." — never a generic crash).

## Modules / Files
`apps/api/images/{resize.ts, crop.ts, compress.ts, convert.ts, watermark.ts, textOverlay.ts, metadata.ts, colorAdjust.ts, rotateFlip.ts, fitShape.ts, meme.ts, basicEditor.ts, blur.ts, bgRemoval.ts, objectRemoval.ts, upscale.ts, enhance.ts, sharpen.ts, denoise.ts}`.

## Acceptance Criteria
- [ ] All deterministic tools work fully offline via `sharp`, verified against fixture images.
- [ ] Fit to Square/Circle correctly implements all 5 sub-modes (fill, contain, stretch, repeat, blur-background) with visibly different output for each.
- [ ] Format conversions preserve transparency where the target format supports it (e.g. PNG → WebP keeps alpha).
- [ ] AI-based tools show the correct "needs a local AI model" state when no model runtime is configured, and produce a real result once one is (can be tested against a stub/mock model interface in this phase; full Ollama wiring is phase 16 — just make sure the interface is ready).
- [ ] Metadata Viewer/Remover correctly reads and strips EXIF data from a fixture with known EXIF fields.

## Test Cases
- Pixel-dimension assertions after resize/crop for known input/output sizes.
- Format conversion integrity: convert A→B→A and confirm no corruption; alpha-channel presence check where relevant.
- Watermark/text-overlay presence check (e.g. diff against a baseline, or check pixel region changed).
- All 5 fit-to-square and 5 fit-to-circle modes tested against one input image, asserting visibly distinct outputs.
- AI-tool fallback test: with no model runtime configured, confirm the correct blocked-state message appears (not a crash, not a fake success).

## Notes
Don't let the AI-dependent subset block the rest of this phase — ship the deterministic majority fully working, and clearly flag the AI-dependent minority's status in PROGRESS.md.
