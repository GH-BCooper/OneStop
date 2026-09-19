#!/usr/bin/env node
// Downloads a project-local FFmpeg build into `.tools/ffmpeg/` (19-testing.md).
//
// Why this exists: the phase-10 media tools are `offline: true`, and CLAUDE.md §8 only allows
// that flag once an offline test for the tool passes. Those tests need FFmpeg, so on a machine
// without it they skip themselves and `scripts/check-offline-coverage.mjs` fails the build - the
// honest outcome, but an annoying one for a contributor who just wants `npm run verify` green.
//
// This is a convenience, never a requirement. FFmpeg installed system-wide (winget/brew/apt) is
// found first and is what the README still recommends; the app itself is unchanged either way -
// it looks at FFMPEG_PATH, then PATH, then the usual install folders.
//
// The builds are the official free, statically linked ones. Nothing here is paid or account-gated.
//
// Usage:  node scripts/fetch-ffmpeg.mjs        (prints the paths when it is done)
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, ".tools");
const target = path.join(dir, "ffmpeg");

const SOURCES = {
  win32: {
    url: "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip",
    archive: "ffmpeg.zip",
  },
  linux: {
    url: "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz",
    archive: "ffmpeg.tar.xz",
  },
};

function exe(name) {
  return process.platform === "win32" ? `${name}.exe` : name;
}

/** Finds ffmpeg/ffprobe anywhere under `.tools/`, whatever the archive called its folder. */
function findBinaries(from) {
  const wanted = new Map([
    [exe("ffmpeg"), null],
    [exe("ffprobe"), null],
  ]);
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (wanted.has(entry.name) && !wanted.get(entry.name)) wanted.set(entry.name, full);
    }
  };
  if (fs.existsSync(from)) walk(from);
  const ffmpeg = wanted.get(exe("ffmpeg"));
  const ffprobe = wanted.get(exe("ffprobe"));
  return ffmpeg && ffprobe ? { ffmpeg, ffprobe } : null;
}

const already = findBinaries(dir);
if (already && !process.argv.includes("--force")) {
  report(already, "already downloaded");
  process.exit(0);
}

const source = SOURCES[process.platform];
if (!source) {
  console.error(
    `No project-local build is offered for ${process.platform}.\n` +
      `Install FFmpeg instead (macOS: brew install ffmpeg), or set FFMPEG_PATH/FFPROBE_PATH.`,
  );
  process.exit(1);
}

fs.mkdirSync(dir, { recursive: true });
const archive = path.join(dir, source.archive);
console.log(`Downloading ${source.url} …`);
const response = await fetch(source.url, { redirect: "follow" });
if (!response.ok || !response.body) {
  console.error(`Download failed: HTTP ${response.status}`);
  process.exit(1);
}
await pipeline(response.body, fs.createWriteStream(archive));

console.log("Extracting …");
fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });
if (source.archive.endsWith(".zip")) {
  // tar(1) ships with Windows 10+ and reads zips; it is much faster than Expand-Archive.
  execFileSync("tar", ["-xf", archive, "-C", target], { stdio: "inherit" });
} else {
  execFileSync("tar", ["-xJf", archive, "-C", target], { stdio: "inherit" });
}
fs.rmSync(archive, { force: true });

const found = findBinaries(target);
if (!found) {
  console.error("The archive did not contain ffmpeg and ffprobe.");
  process.exit(1);
}
if (process.platform !== "win32") {
  fs.chmodSync(found.ffmpeg, 0o755);
  fs.chmodSync(found.ffprobe, 0o755);
}
report(found, "ready");

function report(found, state) {
  console.log(`FFmpeg ${state}:`);
  console.log(`  FFMPEG_PATH=${found.ffmpeg}`);
  console.log(`  FFPROBE_PATH=${found.ffprobe}`);
  console.log(
    `\nThe test setup picks these up automatically (tests/setup/env.ts). To use them for the\n` +
      `app as well, copy the two lines above into your .env.`,
  );
}
