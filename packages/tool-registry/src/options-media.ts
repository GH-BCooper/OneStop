// Per-tool options for the audio & video tools (10-audio-video-tools.md). Same declarative rules as
// options.ts: no React, no `node:` imports; `showWhen` is the only logic.
import type { BooleanOption, NumberOption, SelectOption, TextOption, ToolOption } from "./options";

const packaging: SelectOption = {
  id: "packaging",
  type: "select",
  label: "Deliver as",
  default: "zip",
  choices: [
    { value: "zip", label: "One ZIP archive" },
    { value: "files", label: "Separate downloads" },
  ],
  help: "Only applies when there is more than one result.",
};

const choice = (value: string, label: string) => ({ value, label });

const AUDIO_CHOICES = [
  choice("mp3", "MP3 — plays everywhere"),
  choice("m4a", "M4A (AAC) — small, good quality"),
  choice("aac", "AAC (.aac)"),
  choice("wav", "WAV — uncompressed"),
  choice("flac", "FLAC — lossless, smaller than WAV"),
  choice("ogg", "OGG Vorbis"),
  choice("opus", "Opus — best at low bitrates"),
  choice("wma", "WMA"),
];

const VIDEO_CHOICES = [
  choice("mp4", "MP4 (H.264) — plays everywhere"),
  choice("webm", "WebM (VP9) — for the web"),
  choice("mov", "MOV — QuickTime"),
  choice("mkv", "MKV — Matroska"),
  choice("avi", "AVI — legacy"),
];

const audioBitrate = (fallback: number, help?: string): NumberOption => ({
  id: "bitrate",
  type: "number",
  label: "Bitrate",
  default: fallback,
  min: 32,
  max: 320,
  step: 32,
  unit: "kbps",
  help: help ?? "Higher = better quality and a bigger file. Ignored for WAV and FLAC.",
});

const sampleRate: SelectOption = {
  id: "sampleRate",
  type: "select",
  label: "Sample rate",
  default: "keep",
  choices: [choice("keep", "Keep original"), choice("48000", "48 kHz"), choice("44100", "44.1 kHz"), choice("32000", "32 kHz"), choice("22050", "22.05 kHz")],
};

const channels: SelectOption = {
  id: "channels",
  type: "select",
  label: "Channels",
  default: "keep",
  choices: [choice("keep", "Keep original"), choice("2", "Stereo"), choice("1", "Mono — about half the size")],
};

const videoQuality = (fallback: string): SelectOption => ({
  id: "quality",
  type: "select",
  label: "Quality",
  default: fallback,
  choices: [
    choice("high", "High — largest file"),
    choice("good", "Good — balanced"),
    choice("medium", "Medium"),
    choice("low", "Low — smallest file"),
  ],
});

const timeField = (id: string, label: string, help: string, placeholder = "0:00"): TextOption => ({
  id,
  type: "text",
  label,
  default: "",
  placeholder,
  help,
});

const TIME_HELP = "Seconds (90) or minutes:seconds (1:30.5).";

const trimFields: ToolOption[] = [
  timeField("start", "Start at", TIME_HELP, "0:00"),
  timeField("end", "End at", `${TIME_HELP} Leave blank to keep the rest of the file.`, "end of file"),
  timeField("duration", "…or keep this long", "Used only when no end time is given.", "e.g. 0:30"),
];

const audioFormatSame = (label = "Output format"): SelectOption => ({
  id: "format",
  type: "select",
  label,
  default: "same",
  choices: [choice("same", "Same as the original"), ...AUDIO_CHOICES],
});

export const MEDIA_TOOL_OPTIONS: Record<string, ToolOption[]> = {
  // ---- Audio ---------------------------------------------------------------------------------
  "video-to-mp3": [audioBitrate(192), channels, packaging],
  "audio-converter": [
    { id: "format", type: "select", label: "Convert to", default: "mp3", choices: AUDIO_CHOICES },
    audioBitrate(192),
    sampleRate,
    channels,
    packaging,
  ],
  "audio-compressor": [
    {
      id: "level",
      type: "select",
      label: "Compression",
      default: "balanced",
      choices: [
        choice("light", "Light — 128 kbps"),
        choice("balanced", "Balanced — 96 kbps"),
        choice("strong", "Strong — 64 kbps, mono"),
        choice("custom", "Custom bitrate"),
      ],
    },
    { ...audioBitrate(96, "Used with the Custom setting."), showWhen: { option: "level", equals: ["custom"] } },
    { ...audioFormatSame("Output format"), help: "Lossless files (WAV, FLAC) are compressed to MP3." },
    sampleRate,
    channels,
    packaging,
  ],
  "audio-trimmer": [
    ...trimFields,
    { id: "fadeIn", type: "number", label: "Fade in", default: 0, min: 0, max: 30, step: 0.5, unit: "s" },
    { id: "fadeOut", type: "number", label: "Fade out", default: 0, min: 0, max: 30, step: 0.5, unit: "s" },
  ],
  "audio-merger": [
    audioFormatSame("Output format"),
    { id: "gap", type: "number", label: "Gap between clips", default: 0, min: 0, max: 10, step: 0.5, unit: "s" },
  ],
  "audio-to-wav": [sampleRate, channels, packaging],
  "audio-to-mp3": [audioBitrate(192), sampleRate, channels, packaging],
  "audio-to-aac": [audioBitrate(192), sampleRate, channels, packaging],
  "audio-to-flac": [sampleRate, channels, packaging],
  "extract-audio": [
    {
      id: "format",
      type: "select",
      label: "Save as",
      default: "original",
      choices: [choice("original", "Original quality (copy the track, no re-encoding)"), ...AUDIO_CHOICES],
    },
    packaging,
  ],
  "audio-metadata-editor": [
    {
      id: "mode",
      type: "select",
      label: "Mode",
      default: "view",
      choices: [choice("view", "View the details and tags"), choice("edit", "Edit the tags")],
    },
    ...(
      [
        ["title", "Title"],
        ["artist", "Artist"],
        ["album", "Album"],
        ["albumArtist", "Album artist"],
        ["genre", "Genre"],
        ["year", "Year"],
        ["track", "Track number"],
        ["composer", "Composer"],
        ["comment", "Comment"],
      ] as const
    ).map(
      ([id, label]): TextOption => ({
        id,
        type: "text",
        label,
        default: "",
        placeholder: "Leave blank to keep",
        showWhen: { option: "mode", equals: ["edit"] },
      }),
    ),
    {
      id: "clear",
      type: "boolean",
      label: "Remove all existing tags first",
      default: false,
      showWhen: { option: "mode", equals: ["edit"] },
    },
    packaging,
  ],
  "volume-normalizer": [
    {
      id: "mode",
      type: "select",
      label: "Method",
      default: "loudness",
      choices: [
        choice("loudness", "Loudness (EBU R128) — what streaming services use"),
        choice("peak", "Peak — just lift the loudest part"),
      ],
    },
    {
      id: "target",
      type: "select",
      label: "Target loudness",
      default: "streaming",
      choices: [
        choice("streaming", "Streaming — −14 LUFS"),
        choice("podcast", "Podcast / spoken word — −16 LUFS"),
        choice("broadcast", "Broadcast (EBU R128) — −23 LUFS"),
        choice("custom", "Custom"),
      ],
      showWhen: { option: "mode", equals: ["loudness"] },
    },
    {
      id: "lufs",
      type: "number",
      label: "Custom loudness",
      default: -16,
      min: -40,
      max: -5,
      unit: "LUFS",
      showWhen: { option: "target", equals: ["custom"] },
    },
    {
      id: "truePeak",
      type: "number",
      label: "True-peak ceiling",
      default: -1,
      min: -9,
      max: 0,
      unit: "dBTP",
      showWhen: { option: "mode", equals: ["loudness"] },
    },
    {
      id: "peakDb",
      type: "number",
      label: "Peak ceiling",
      default: -1,
      min: -20,
      max: 0,
      unit: "dB",
      showWhen: { option: "mode", equals: ["peak"] },
    },
    packaging,
  ],
  "audio-waveform-generator": [
    {
      id: "output",
      type: "select",
      label: "Save as",
      default: "png",
      choices: [choice("png", "PNG image"), choice("svg", "SVG (sharp at any size)")],
    },
    {
      id: "style",
      type: "select",
      label: "Style",
      default: "bars",
      choices: [choice("bars", "Bars"), choice("filled", "Filled shape"), choice("line", "Outline")],
    },
    { id: "width", type: "number", label: "Width", default: 1200, min: 200, max: 4000, unit: "px" },
    { id: "height", type: "number", label: "Height", default: 300, min: 60, max: 2000, unit: "px" },
    {
      id: "colour",
      type: "text",
      label: "Wave colour",
      default: "#3b82f6",
      placeholder: "#3b82f6",
      help: "A hex code like #3b82f6, or a name: blue, green, red, black, white…",
    },
    { id: "background", type: "text", label: "Background", default: "#ffffff", placeholder: "#ffffff" },
    { id: "transparent", type: "boolean", label: "Transparent background", default: false },
    packaging,
  ],

  // ---- Video ---------------------------------------------------------------------------------
  "video-converter": [
    { id: "format", type: "select", label: "Convert to", default: "mp4", choices: VIDEO_CHOICES },
    {
      id: "mode",
      type: "select",
      label: "Method",
      default: "auto",
      choices: [
        choice("auto", "Copy the streams when possible (instant, lossless)"),
        choice("reencode", "Always re-encode"),
      ],
    },
    { ...videoQuality("good"), showWhen: { option: "mode", equals: ["reencode"] } },
    packaging,
  ],
  "video-compressor": [
    {
      id: "level",
      type: "select",
      label: "Compression",
      default: "balanced",
      choices: [
        choice("light", "Light — barely visible difference"),
        choice("balanced", "Balanced — recommended"),
        choice("strong", "Strong — smallest, capped at 720p"),
        choice("size", "Aim for a file size"),
      ],
    },
    {
      id: "targetMb",
      type: "number",
      label: "Target size",
      default: 10,
      min: 1,
      max: 4000,
      unit: "MB",
      showWhen: { option: "level", equals: ["size"] },
    },
    {
      id: "maxHeight",
      type: "select",
      label: "Resolution cap",
      default: "keep",
      choices: [choice("keep", "Keep original"), choice("1080", "1080p"), choice("720", "720p"), choice("480", "480p"), choice("360", "360p")],
    },
    packaging,
  ],
  "video-to-mp4": [videoQuality("good"), packaging],
  "video-to-webm": [videoQuality("good"), packaging],
  "video-to-gif": [
    timeField("start", "Start at", TIME_HELP, "0:00"),
    timeField("duration", "Length", "Up to 60 seconds. Leave blank for 10 s (or less).", "10"),
    { id: "fps", type: "number", label: "Frames per second", default: 10, min: 1, max: 30 },
    { id: "width", type: "number", label: "Width", default: 480, min: 0, max: 1280, unit: "px", help: "0 keeps the original width. Height follows automatically." },
    { id: "loop", type: "boolean", label: "Loop forever", default: true },
    packaging,
  ],
  "video-trimmer": [
    ...trimFields,
    {
      id: "mode",
      type: "select",
      label: "Cut",
      default: "precise",
      choices: [
        choice("precise", "Exactly where I said (re-encodes)"),
        choice("fast", "Fast — copy the streams (cuts at the nearest keyframe)"),
      ],
    },
  ],
  "video-merger": [
    { id: "format", type: "select", label: "Output format", default: "same", choices: [choice("same", "Same as the first clip"), ...VIDEO_CHOICES.filter((c) => c.value !== "avi")] },
    {
      id: "size",
      type: "select",
      label: "Frame size",
      default: "first",
      choices: [choice("first", "Match the first clip"), choice("largest", "Match the largest clip")],
      help: "Clips of a different shape are centred with black bars, never stretched.",
    },
  ],
  "video-resizer": [
    {
      id: "preset",
      type: "select",
      label: "Size",
      default: "custom",
      choices: [
        choice("custom", "Custom"),
        choice("1920x1080", "1920 × 1080 — landscape HD"),
        choice("1280x720", "1280 × 720 — landscape"),
        choice("1080x1920", "1080 × 1920 — vertical / stories"),
        choice("1080x1080", "1080 × 1080 — square"),
        choice("1080x1350", "1080 × 1350 — portrait 4:5"),
        choice("854x480", "854 × 480 — small"),
      ],
    },
    { id: "width", type: "number", label: "Width", default: 1280, min: 0, max: 7680, unit: "px", showWhen: { option: "preset", equals: ["custom"] } },
    { id: "height", type: "number", label: "Height", default: 0, min: 0, max: 7680, unit: "px", help: "0 = work it out from the width.", showWhen: { option: "preset", equals: ["custom"] } },
    {
      id: "mode",
      type: "select",
      label: "Fit",
      default: "pad",
      choices: [
        choice("pad", "Fit inside and fill the gaps"),
        choice("crop", "Fill the frame and crop"),
        choice("fit", "Fit inside, keep the shape (no bars)"),
        choice("stretch", "Stretch to fit"),
      ],
    },
    { id: "background", type: "text", label: "Bar colour", default: "black", placeholder: "black", showWhen: { option: "mode", equals: ["pad"] } },
    videoQuality("good"),
    packaging,
  ],
  "rotate-video": [
    {
      id: "angle",
      type: "select",
      label: "Rotate",
      default: "90",
      choices: [choice("0", "Don't rotate"), choice("90", "90° clockwise"), choice("180", "180°"), choice("270", "90° anticlockwise")],
    },
    {
      id: "flip",
      type: "select",
      label: "Flip",
      default: "none",
      choices: [choice("none", "No flip"), choice("horizontal", "Horizontally (mirror)"), choice("vertical", "Vertically"), choice("both", "Both")],
    },
    videoQuality("high"),
  ],
  "extract-frames": [
    {
      id: "mode",
      type: "select",
      label: "Which frames",
      default: "count",
      choices: [
        choice("count", "A number of frames, evenly spaced"),
        choice("interval", "One every few seconds"),
        choice("times", "At the times I list"),
        choice("single", "One frame"),
      ],
    },
    { id: "count", type: "number", label: "How many", default: 10, min: 1, max: 300, showWhen: { option: "mode", equals: ["count"] } },
    { id: "interval", type: "text", label: "Every", default: "1", placeholder: "1", help: "Seconds between frames, e.g. 0.5 or 5.", showWhen: { option: "mode", equals: ["interval"] } } as TextOption,
    { id: "times", type: "text", label: "Times", default: "", placeholder: "0:05, 0:30, 1:10", multiline: true, help: "Separate times with commas, spaces or new lines.", showWhen: { option: "mode", equals: ["times"] } },
    { id: "time", type: "text", label: "Time", default: "", placeholder: "0:05", help: TIME_HELP, showWhen: { option: "mode", equals: ["single"] } },
    { id: "format", type: "select", label: "Image format", default: "png", choices: [choice("png", "PNG — lossless"), choice("jpg", "JPG — smaller")] },
    { id: "width", type: "number", label: "Max width", default: 0, min: 0, max: 7680, unit: "px", help: "0 keeps the video's own size." },
    packaging,
  ],
  "subtitle-extraction": [
    { id: "format", type: "select", label: "Save as", default: "srt", choices: [choice("srt", "SRT"), choice("vtt", "WebVTT"), choice("ass", "ASS / SSA")] },
    { id: "track", type: "text", label: "Track", default: "all", placeholder: "all", help: 'Use "all", or a track number like 1.' },
    packaging,
  ],
  "subtitle-conversion": [
    { id: "format", type: "select", label: "Convert to", default: "vtt", choices: [choice("srt", "SRT"), choice("vtt", "WebVTT"), choice("ass", "ASS / SSA")] },
    { id: "offsetMs", type: "number", label: "Shift timing", default: 0, min: -3600000, max: 3600000, step: 100, unit: "ms", help: "Positive = later, negative = earlier." },
    packaging,
  ],
  "change-video-resolution": [
    {
      id: "resolution",
      type: "select",
      label: "Resolution",
      default: "720",
      choices: [
        choice("2160", "2160p — 4K"),
        choice("1440", "1440p — 2K"),
        choice("1080", "1080p — Full HD"),
        choice("720", "720p — HD"),
        choice("480", "480p"),
        choice("360", "360p"),
        choice("240", "240p"),
      ],
      help: "Applies to the short side, so vertical videos work too.",
    },
    { id: "upscale", type: "boolean", label: "Allow upscaling", default: false, help: "Off: a smaller video is left as it is." } as BooleanOption,
    videoQuality("good"),
    packaging,
  ],
  "change-video-quality": [
    videoQuality("medium"),
    { id: "audioBitrate", type: "number", label: "Audio bitrate", default: 128, min: 32, max: 320, step: 32, unit: "kbps" },
    packaging,
  ],
};
