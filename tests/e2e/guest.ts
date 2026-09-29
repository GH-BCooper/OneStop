// Support for the end-to-end files that use OneStop as a guest: the shell, the tool pages for
// images, media, developer utilities and file handling.
//
// Once accounts are configured (a database plus a session secret) the app gates every page except
// the landing page and the catalogue behind sign-in, and running any tool needs an account. That is
// the right behaviour for a hosted deployment, but it means a *guest* can only be tested against a
// server with no accounts at all - which is a real, supported way to run OneStop (no database, no
// gating, history kept on the device). Those tests therefore get their own server with the database
// switched off, and nothing they do can reach a real database.
//
// `npm run test:e2e:shared` starts that server once and passes its address in E2E_GUEST_BASE_URL.
// Run on its own, each file starts its own.
import { spawn, type ProcessEnvOptions } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/** The address of a guest-mode server that something else already started, if there is one. */
function sharedGuestUrl(): string | undefined {
  return process.env.E2E_GUEST_BASE_URL ?? process.env.E2E_BASE_URL;
}

/** Where a guest-mode test should point its browser. */
export function guestBaseUrl(ownServerUrl: string): string {
  return sharedGuestUrl() ?? ownServerUrl;
}

/** True when a server is already running, so the file must not start its own. */
export function guestServerIsShared(): boolean {
  return sharedGuestUrl() !== undefined;
}

/**
 * The environment for a server a file starts itself. An empty DATABASE_URL is what "no accounts"
 * means (`authIsConfigured` is false), and it also keeps a `.env` pointing at a real database from
 * being reached by a test run. Next.js never overrides a variable that is already set, even to "".
 */
export function guestServerEnv(): NonNullable<ProcessEnvOptions["env"]> {
  return { ...process.env, DATABASE_URL: "", MAIL_TRANSPORT: "console" };
}

/**
 * For the files that need an account server *and* a guest one (history, workflows, journeys): the
 * shared guest server when there is one, otherwise a private one on `ownPort`. `stop` is a no-op
 * for a server this call did not start.
 */
export async function ensureGuestServer(
  root: string,
  ownPort: number,
): Promise<{ url: string; stop: () => void }> {
  if (guestServerIsShared()) return { url: guestBaseUrl(""), stop: () => {} };
  if (!existsSync(path.join(root, "apps/web/.next/BUILD_ID"))) {
    throw new Error("Run `npm run build` before `npm run test:e2e`.");
  }
  const url = `http://127.0.0.1:${ownPort}`;
  const child = spawn(
    process.execPath,
    [
      path.join(root, "node_modules/next/dist/bin/next"),
      "start",
      "-p",
      String(ownPort),
      "-H",
      "127.0.0.1",
    ],
    {
      cwd: path.join(root, "apps/web"),
      stdio: "ignore",
      env: { ...guestServerEnv(), APP_URL: url },
    },
  );
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return { url, stop: () => child.kill() };
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  child.kill();
  throw new Error(`The guest server did not start at ${url}`);
}
