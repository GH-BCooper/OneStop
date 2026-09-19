// Notices a tool page must show (17-online-media-network-tools.md).
//
// The build file requires a visible legal notice on the Online Media pages. It lives in the
// registry rather than in the page or the executor so all three quote the same words: the tool
// page renders it, the executor repeats it in the run summary and in the downloaded report, and
// the AI assistant can show it before it runs one of these tools on someone's behalf.
export interface ToolNotice {
  /** "legal" is rendered as a warning; "info" as a plain note. */
  tone: "legal" | "info";
  title: string;
  body: string;
}

export const DOWNLOAD_LEGAL_NOTICE =
  "You are responsible for what you download. Use these tools only for material you own, that is licensed for reuse, or that the platform's terms allow you to save. OneStop does not circumvent DRM and is not a way to take copyrighted work you have no right to.";

export const SPOTIFY_METADATA_NOTICE =
  "Spotify links are read for information only. There is no legitimate way to take audio from Spotify, so OneStop does not do it — this is a permanent decision, not a missing feature.";

const DOWNLOAD_NOTICE: ToolNotice = {
  tone: "legal",
  title: "Your responsibility",
  body: DOWNLOAD_LEGAL_NOTICE,
};

export const TOOL_NOTICES: Record<string, ToolNotice[]> = {
  "youtube-to-mp3": [DOWNLOAD_NOTICE],
  "youtube-to-mp4": [DOWNLOAD_NOTICE],
  "youtube-quality-selector": [DOWNLOAD_NOTICE],
  "instagram-reel-to-mp3": [DOWNLOAD_NOTICE],
  "instagram-reel-to-mp4": [DOWNLOAD_NOTICE],
  "instagram-quality-selector": [DOWNLOAD_NOTICE],
  "spotify-link-info": [{ tone: "info", title: "Information only", body: SPOTIFY_METADATA_NOTICE }],
};

export function getToolNotices(toolId: string): ToolNotice[] {
  return TOOL_NOTICES[toolId] ?? [];
}
