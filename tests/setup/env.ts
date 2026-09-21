// Shared test environment setup (19-testing.md).
//
// Three jobs, all about making the suite tell the truth on a developer's machine:
//
//   1. Load `.env`, so a local Postgres configured there is actually used rather than the
//      database suites silently skipping themselves.
//   2. Never send real email. A developer's `.env` may hold a real SMTP/Resend/Brevo credential, and
//      the auth suites drive the sign-up and reset routes for real - so the mail transport is
//      pinned to the console (which the tests read the code/link back from).
//   3. Point FFMPEG_PATH/FFPROBE_PATH at a project-local FFmpeg (`node scripts/fetch-ffmpeg.mjs`)
//      when there is no system one. The phase-10 tools are flagged `offline: true`, and
//      `scripts/check-offline-coverage.mjs` fails the build if their offline suite skipped - so
//      "FFmpeg is not installed" has to be a solvable problem, not a reason to lower the bar.
//
// System-installed binaries always win: this only fills in what is missing, and it changes
// nothing about how the app itself finds FFmpeg (env, then PATH, then the usual install folders).
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");

try {
  process.loadEnvFile(path.join(root, ".env"));
} catch {
  // No .env: CI exports what it needs, and every suite that needs more skips itself.
}

process.env.MAIL_TRANSPORT = "console";

const onPath = (name: string): boolean => {
  const exe = process.platform === "win32" ? `${name}.exe` : name;
  return (process.env.PATH ?? "")
    .split(path.delimiter)
    .some((dir) => dir && fs.existsSync(path.join(dir, exe)));
};

/** ffmpeg/ffprobe from `.tools/`, whatever the downloaded archive called its folder. */
function localFfmpeg(): { ffmpeg: string; ffprobe: string } | null {
  const tools = path.join(root, ".tools");
  if (!fs.existsSync(tools)) return null;
  const exe = (name: string) => (process.platform === "win32" ? `${name}.exe` : name);
  const found = new Map<string, string>();
  const walk = (dir: string, depth: number) => {
    if (depth > 4) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (!found.has(entry.name)) found.set(entry.name, full);
    }
  };
  walk(tools, 0);
  const ffmpeg = found.get(exe("ffmpeg"));
  const ffprobe = found.get(exe("ffprobe"));
  return ffmpeg && ffprobe ? { ffmpeg, ffprobe } : null;
}

if (!process.env.FFMPEG_PATH && !onPath("ffmpeg")) {
  const local = localFfmpeg();
  if (local) {
    process.env.FFMPEG_PATH = local.ffmpeg;
    process.env.FFPROBE_PATH ||= local.ffprobe;
  }
}
