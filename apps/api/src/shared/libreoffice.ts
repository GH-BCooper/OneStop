// LibreOffice headless — the *optional* high-fidelity office converter (06-pdf-tools-advanced.md).
//
// Never required: `office-convert.ts` checks `findLibreOffice()` and falls back to the built-in
// converters when it returns null. When it is present it is run with `shell: false`, a private
// throwaway profile, a timeout, and a scratch directory that is always deleted — the input is a
// document it converts, never something it executes.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Where a Windows install can be, beyond `PATH`. LibreOffice's installer does not add itself to
 * `PATH`, and it happily installs onto a drive other than C: - which is how a machine with a
 * perfectly good LibreOffice still reported "not installed" during phase 20. Every entry is one
 * `existsSync`, the answer is cached, and `LIBREOFFICE_PATH` always wins over all of it.
 */
function windowsCandidates(): string[] {
  const roots = new Set<string>();
  for (const key of ["ProgramFiles", "ProgramW6432", "ProgramFiles(x86)", "LOCALAPPDATA"]) {
    const value = process.env[key];
    if (value) roots.add(value);
  }
  // Drive-root installs (D:\LibreOffice\...), which the installer offers and people accept.
  for (const letter of "CDEFGH") roots.add(`${letter}:\\`);
  return [...roots].map((root) => path.join(root, "LibreOffice", "program", "soffice.exe"));
}

const CANDIDATES_BY_PLATFORM: Record<string, string[]> = {
  win32: [
    "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
    "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
  ],
  darwin: ["/Applications/LibreOffice.app/Contents/MacOS/soffice"],
  linux: [
    "/usr/bin/soffice",
    "/usr/bin/libreoffice",
    "/usr/local/bin/soffice",
    "/snap/bin/libreoffice",
    "/opt/libreoffice/program/soffice",
  ],
};

export type LibreOfficeLocator = () => string | null;

function defaultLocator(): string | null {
  const configured = process.env.LIBREOFFICE_PATH;
  if (configured) return existsSync(configured) ? configured : null;
  const exe = process.platform === "win32" ? ["soffice.exe"] : ["soffice", "libreoffice"];
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    for (const name of exe) {
      const candidate = path.join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  const candidates = [
    ...(CANDIDATES_BY_PLATFORM[process.platform] ?? []),
    ...(process.platform === "win32" ? windowsCandidates() : []),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

let locator: LibreOfficeLocator = defaultLocator;
let cached: { value: string | null } | null = null;

/** Tests use this to simulate LibreOffice being missing (or present). Pass null to restore. */
export function setLibreOfficeLocator(next: LibreOfficeLocator | null): void {
  locator = next ?? defaultLocator;
  cached = null;
}

/**
 * The answer is cached for the life of the process, like FFmpeg's and yt-dlp's: the search is a
 * few dozen `existsSync` calls and it is asked once per conversion. Installing LibreOffice while
 * the server is running therefore needs a restart, which is what its own setup message says.
 */
export function findLibreOffice(): string | null {
  if (!cached) {
    let value: string | null;
    try {
      value = locator();
    } catch {
      value = null;
    }
    cached = { value };
  }
  return cached.value;
}

export class LibreOfficeError extends Error {
  constructor(
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "LibreOfficeError";
  }
}

/**
 * Converts `bytes` (a file with extension `from`) to `to` with soffice. `filter` is an optional
 * `--convert-to` filter suffix, `infilter` an import filter (e.g. "writer_pdf_import").
 */
export async function convertWithLibreOffice(
  bytes: Uint8Array,
  from: string,
  to: string,
  {
    timeoutMs = 120_000,
    infilter,
    signal,
  }: { timeoutMs?: number; infilter?: string; signal?: AbortSignal } = {},
): Promise<Uint8Array> {
  const binary = findLibreOffice();
  if (!binary) throw new LibreOfficeError("LibreOffice is not installed.");
  if (!/^[a-z0-9]{1,5}$/.test(from) || !/^[a-z0-9]{1,5}$/.test(to)) {
    throw new LibreOfficeError("Unsupported conversion.");
  }
  const dir = await mkdtemp(path.join(os.tmpdir(), "onestop-lo-"));
  try {
    const inputPath = path.join(dir, `input.${from}`);
    await writeFile(inputPath, bytes);
    const args = [
      "--headless",
      "--norestore",
      "--nolockcheck",
      "--nodefault",
      "--nologo",
      `-env:UserInstallation=${pathToFileURL(path.join(dir, "profile")).href}`,
      ...(infilter ? [`--infilter=${infilter}`] : []),
      "--convert-to",
      to,
      "--outdir",
      path.join(dir, "out"),
      inputPath,
    ];
    await new Promise<void>((resolve, reject) => {
      const child = spawn(binary, args, {
        shell: false,
        // Without these, soffice asks the OS default printer for page metrics before laying out a
        // document. On Windows an offline network printer turns that into a modal "Waiting for
        // printer connection" dialog that blocks the conversion until someone clicks Cancel.
        env: { ...process.env, SAL_DISABLE_DEFAULTPRINTER: "1", SAL_DISABLE_PRINTERLIST: "1" },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      let stderr = "";
      child.stderr.on("data", (chunk: Buffer) => {
        if (stderr.length < 4000) stderr += chunk.toString();
      });
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new LibreOfficeError("LibreOffice took too long.", "timeout"));
      }, timeoutMs);
      const onAbort = () => child.kill("SIGKILL");
      signal?.addEventListener("abort", onAbort, { once: true });
      child.on("error", (err) => {
        clearTimeout(timer);
        reject(new LibreOfficeError("LibreOffice could not be started.", err));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        if (code === 0) resolve();
        else
          reject(
            new LibreOfficeError(
              "LibreOffice could not convert this file.",
              stderr || `exit ${code}`,
            ),
          );
      });
    });
    const produced = (await readdir(path.join(dir, "out")).catch(() => [])).find((f) =>
      f.toLowerCase().endsWith(`.${to}`),
    );
    if (!produced) throw new LibreOfficeError("LibreOffice produced no output for this file.");
    return new Uint8Array(await readFile(path.join(dir, "out", produced)));
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
