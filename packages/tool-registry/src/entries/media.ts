import { defineCategory } from "../define";

// Features §7 (Audio), §8 (Video) and §9 (Online Media).
// "Extract Audio from Video" (§7.10) and "Extract Audio" (§8.10) are the same tool.
export const audioTools = defineCategory("audio", { phase: "10", sub: "Audio", status: "available" }, [
  { src: ["7.1"], name: "Video → MP3", in: ["video"], out: ["mp3"], batch: true, pop: 80, kw: ["mp4", "audio", "music", "convert", "extract sound"], desc: "Save the soundtrack of a video as an MP3." },
  { src: ["7.2"], name: "Audio Converter", in: ["audio"], out: ["mp3", "wav", "aac", "flac", "ogg", "m4a"], batch: true, pop: 55, kw: ["convert", "format", "sound", "music"], desc: "Convert audio between MP3, WAV, AAC, FLAC, OGG and M4A." },
  { src: ["7.3"], name: "Audio Compressor", in: ["audio"], out: ["audio"], batch: true, pop: 35, kw: ["shrink", "reduce size", "bitrate", "smaller", "sound"], desc: "Reduce audio file size by lowering the bitrate." },
  { src: ["7.4"], name: "Audio Trimmer", in: ["audio"], out: ["audio"], pop: 40, kw: ["trim", "cut", "clip", "ringtone", "sound"], desc: "Cut an audio file to the part you need." },
  { src: ["7.5"], name: "Audio Merger", in: ["audio"], out: ["audio"], batch: true, kw: ["combine", "join", "concatenate", "sound"], desc: "Join several audio files into one." },
  { src: ["7.6"], name: "Audio → WAV", in: ["audio"], out: ["wav"], batch: true, kw: ["convert", "wave", "lossless"], desc: "Convert audio to WAV." },
  { src: ["7.7"], name: "Audio → MP3", in: ["audio"], out: ["mp3"], batch: true, pop: 45, kw: ["convert", "music"], desc: "Convert audio to MP3." },
  { src: ["7.8"], name: "Audio → AAC", in: ["audio"], out: ["aac"], batch: true, kw: ["convert", "m4a"], desc: "Convert audio to AAC." },
  { src: ["7.9"], name: "Audio → FLAC", in: ["audio"], out: ["flac"], batch: true, kw: ["convert", "lossless"], desc: "Convert audio to lossless FLAC." },
  { src: ["7.10", "8.10"], name: "Extract Audio from Video", slug: "extract-audio", in: ["video"], out: ["audio"], batch: true, pop: 50, kw: ["extract audio", "soundtrack", "audio track", "wav", "aac"], desc: "Pull the audio track out of a video in its original or a chosen format." },
  { src: ["7.11"], name: "Audio Metadata Viewer/Editor", slug: "audio-metadata-editor", in: ["audio"], out: ["audio", "json"], kw: ["id3", "tags", "artist", "album", "title"], desc: "View and edit ID3 tags like title, artist and album." },
  { src: ["7.12"], name: "Volume Normalizer", in: ["audio"], out: ["audio"], batch: true, kw: ["normalize", "loudness", "louder", "level"], desc: "Even out loudness so files play at a consistent volume." },
  { src: ["7.13"], name: "Audio Waveform Generator", in: ["audio"], out: ["png", "svg"], kw: ["waveform", "visualize", "graph"], desc: "Draw a waveform image of an audio file." },
]);

export const videoTools = defineCategory("video", { phase: "10", sub: "Video", status: "available" }, [
  { src: ["8.1"], name: "Video Converter", in: ["video"], out: ["mp4", "webm", "mov", "mkv", "avi"], batch: true, pop: 60, kw: ["convert", "format", "movie", "clip"], desc: "Convert videos between MP4, WebM, MOV, MKV and AVI." },
  { src: ["8.2"], name: "Video Compressor", in: ["video"], out: ["mp4"], batch: true, pop: 85, kw: ["compress", "shrink", "reduce size", "smaller", "movie", "clip"], desc: "Make a video smaller for sharing or uploading." },
  { src: ["8.3"], name: "Video → MP4", in: ["video"], out: ["mp4"], batch: true, pop: 45, kw: ["convert", "mov", "mkv", "avi"], desc: "Convert a video to MP4." },
  { src: ["8.4"], name: "Video → WebM", in: ["video"], out: ["webm"], batch: true, kw: ["convert", "web"], desc: "Convert a video to WebM." },
  { src: ["8.5"], name: "Video → GIF", in: ["video"], out: ["gif"], pop: 50, kw: ["animated", "animation", "clip", "convert"], desc: "Turn a video clip into an animated GIF." },
  { src: ["8.6"], name: "Video Trimmer", in: ["video"], out: ["video"], pop: 55, kw: ["trim", "cut", "clip", "shorten"], desc: "Cut a video down to the part you need." },
  { src: ["8.7"], name: "Video Merger", in: ["video"], out: ["video"], batch: true, kw: ["combine", "join", "concatenate", "clips"], desc: "Join several video clips into one." },
  { src: ["8.8"], name: "Video Resizer", in: ["video"], out: ["video"], batch: true, kw: ["resize", "dimensions", "aspect ratio", "crop", "scale"], desc: "Resize or re-frame a video to new dimensions." },
  { src: ["8.9"], name: "Video Rotation", slug: "rotate-video", in: ["video"], out: ["video"], kw: ["rotate", "turn", "orientation", "flip"], desc: "Rotate a video by 90, 180 or 270 degrees." },
  { src: ["8.11"], name: "Extract Frames", in: ["video"], out: ["png", "jpg", "zip"], kw: ["screenshot", "still", "thumbnail", "images"], desc: "Save frames from a video as images." },
  { src: ["8.12"], name: "Subtitle Extraction", in: ["video"], out: ["srt", "vtt"], kw: ["subtitles", "captions", "extract", "srt"], desc: "Extract embedded subtitle tracks from a video." },
  { src: ["8.13"], name: "Subtitle Conversion", in: ["srt", "vtt", "ass"], out: ["srt", "vtt", "ass"], batch: true, kw: ["subtitles", "captions", "convert", "srt", "vtt"], desc: "Convert subtitles between SRT, VTT and ASS." },
  { src: ["8.14"], name: "Change Video Resolution", in: ["video"], out: ["video"], batch: true, kw: ["resolution", "1080p", "720p", "4k", "downscale"], desc: "Change a video's resolution, e.g. 4K to 1080p." },
  { src: ["8.15"], name: "Change Video Quality", in: ["video"], out: ["video"], batch: true, kw: ["quality", "bitrate", "crf"], desc: "Trade video quality against file size." },
]);

// Hard rule from 17-online-media-network-tools.md: Spotify is metadata lookup only, never audio.
export const onlineMediaTools = defineCategory(
  "online-media",
  { phase: "17", sub: "Online Media", net: "required" },
  [
    { src: ["9.1"], name: "YouTube → MP3", in: ["url"], out: ["mp3"], pop: 70, kw: ["youtube", "download", "audio", "music", "link"], desc: "Save the audio of a YouTube video you have the right to download." },
    { src: ["9.2"], name: "YouTube → MP4", in: ["url"], out: ["mp4"], pop: 70, kw: ["youtube", "download", "video", "link"], desc: "Download a YouTube video you have the right to download." },
    { src: ["9.3"], name: "YouTube Quality Selector", in: ["url"], out: ["mp4", "mp3"], kw: ["youtube", "resolution", "quality", "formats"], desc: "List available YouTube formats and pick the quality to download." },
    { src: ["9.4"], name: "Instagram Reel → MP3", in: ["url"], out: ["mp3"], kw: ["instagram", "reel", "audio", "download", "link"], desc: "Save the audio of an Instagram Reel where permitted." },
    { src: ["9.5"], name: "Instagram Reel → MP4", in: ["url"], out: ["mp4"], kw: ["instagram", "reel", "video", "download", "link"], desc: "Download an Instagram Reel where permitted." },
    { src: ["9.6"], name: "Instagram Quality Selector", in: ["url"], out: ["mp4", "mp3"], kw: ["instagram", "reel", "resolution", "quality"], desc: "Pick the quality for an Instagram Reel download." },
    { src: ["9.7"], name: "Spotify Link Info", slug: "spotify-link-info", in: ["url"], out: ["json"], kw: ["spotify", "track", "album", "artist", "playlist", "link"], desc: "Look up track, album or artist info from a Spotify link (metadata only, no audio)." },
  ],
);
