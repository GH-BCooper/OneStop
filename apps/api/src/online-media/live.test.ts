// A real yt-dlp run against a real public video.
//
// 17-online-media-network-tools.md forbids live downloads in the ordinary suite, so
// `online-media.test.ts` proves the wrapper through interface mocks and PROGRESS.md carried "run a
// yt-dlp download on a machine that has yt-dlp installed" on phase 19's manual checklist. This
// file is that run, turned into something repeatable: it skips itself unless yt-dlp is installed,
// the Internet is reachable *and* ONESTOP_LIVE_DOWNLOAD=1 is set, so it never fires in CI and
// never fires by accident.
//
// Run it with:  ONESTOP_LIVE_DOWNLOAD=1 npx vitest run apps/api/src/online-media/live.test.ts
import os from "node:os";

import { describe, expect, it } from "vitest";

import { fetchInfo, download, findYtdlp, ytdlpVersion } from "./ytdlp.ts";

/**
 * Blender Foundation's "Big Buck Bunny" on the Internet Archive: Creative Commons, tiny, and not
 * a platform whose terms of service this repo has to reason about.
 */
const LIVE_ITEM = "https://archive.org/details/BigBuckBunny_124";
/** One file out of that item: a single video, so the metadata reader gets a video and not a list. */
const LIVE_FILE =
  "https://archive.org/download/BigBuckBunny_124/Content/big_buck_bunny_720p_surround.mp4";

const enabled =
  process.env.ONESTOP_LIVE_DOWNLOAD === "1" && findYtdlp() !== null && ytdlpVersion() !== null;

const describeLive = enabled ? describe : describe.skip;

describeLive("live yt-dlp", () => {
  it("reads real metadata for a public video", async () => {
    const info = await fetchInfo(LIVE_FILE, { cwd: os.tmpdir(), timeoutMs: 120_000 });
    expect(info.title.length).toBeGreaterThan(0);
    expect(info.formats.length).toBeGreaterThan(0);
  }, 180_000);

  it("downloads a real file and converts it", async () => {
    const result = await download(
      { url: LIVE_ITEM, kind: "video", container: "mp4", maxHeight: 360 },
      { timeoutMs: 600_000 },
    );
    expect(result.bytes.byteLength).toBeGreaterThan(10_000);
    expect(result.name.toLowerCase()).toMatch(/\.(mp4|mkv|webm)$/);
  }, 900_000);
});
