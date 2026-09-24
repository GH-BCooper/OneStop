# OneStop.exe: one-click start on Windows

`OneStop.exe`, in the repository root, runs OneStop on your own computer. You double-click it and it
opens in your browser.

## Using it

1. Double-click **`OneStop.exe`**. You can make a desktop shortcut to it with right-click → _Show
   more options_ → _Send to_ → _Desktop_. Always use a shortcut: the exe has to stay in this folder.
2. A small window shows progress while OneStop gets ready, and then your browser opens at
   **http://localhost:3000**.
3. OneStop keeps running in the **system tray** (the icon near the clock). Right-click the icon for
   these options:
   - **Open OneStop** opens it in the browser again (double-clicking the icon does the same).
   - **Restart** stops the server and starts it again, rebuilding first if the code changed.
   - **Show log** shows everything the server printed.
   - **Quit OneStop** stops the server completely.

Double-clicking the exe while OneStop is already running just opens the browser tab.

## What it does each time

| Step              | When it happens                                                                     | How long                        |
| ----------------- | ----------------------------------------------------------------------------------- | ------------------------------- |
| Check for Node.js | Every run. If it's missing, it offers to open the free download page.               | instant                         |
| Create `.env`     | Only if there is none. It copies `.env.example`, with no database and a new secret. | instant                         |
| `npm install`     | When `package-lock.json` changed, or `node_modules` is missing                      | 10 s, or minutes the first time |
| Download FFmpeg   | Only on a brand-new copy that has no FFmpeg anywhere                                | about 1 minute                  |
| Rebuild           | When anything in `apps/`, `packages/` or `prisma/` changed since the last build     | a few minutes                   |
| Start the server  | Every run: `next start` on port 3000, or the next free port if 3000 is taken        | a few seconds                   |

The server listens on **this computer only** (127.0.0.1), so other devices on your network can't
reach it. When you quit from the tray, or the launcher itself is closed, the server and everything
it started are stopped too. Nothing is left running in the background.

The launcher keeps its log and its "already installed/built" markers in `.onestop-launcher/`, which
git ignores. If something goes wrong, the error message offers to open the log.

Editing `.env` only needs **Restart**, with one exception: `NEXT_PUBLIC_*` values are built into
the app, so after changing one, make any small code change (or delete
`.onestop-launcher/build.stamp`) and then restart.

## Giving OneStop to someone else

Run:

```bash
npm run handover
```

This writes `dist/OneStop.zip`, a clean copy of the last commit that already contains `OneStop.exe`.
They unzip it and double-click `OneStop\OneStop.exe`. The first run takes several minutes and
needs internet, because it installs and builds.

**Don't just copy your own folder.** It contains your `.env` (database address, API keys, sign-in
secret) as well as gigabytes of `node_modules`. The zip leaves all of that out.

For the other person:

- **Node.js 22 or newer is required** (free, from https://nodejs.org). The launcher tells them if
  it's missing.
- Accounts are off until they add a `DATABASE_URL` to their `.env`. Every tool still works; only
  sign-in, synced history and favourites need the database.
- Optional extras (Python, LibreOffice, yt-dlp, Ollama) are covered in `docs/LOCAL_SETUP.md`.
  Without them, the tools that need them say so.
- The exe isn't code-signed, so Windows may show _"Windows protected your PC"_ the first time. They
  click **More info → Run anyway**. That's normal for any home-made program.

## Changing the launcher

The source is [`OneStopLauncher.cs`](OneStopLauncher.cs), one C# file. It's compiled with the C#
compiler that is built into Windows, so nothing extra is needed:

```bash
npm run build:launcher                 # recompile OneStop.exe
node scripts/build-launcher-icon.mjs   # regenerate onestop.ico from the logo
```

Commit the rebuilt `OneStop.exe` together with the source change.
