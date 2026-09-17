import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute path to `processors/python/`. */
export const PYTHON_PROCESSORS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../processors/python",
);

export type PythonBridgeErrorCode =
  | "PYTHON_NOT_FOUND"
  | "SCRIPT_NOT_FOUND"
  | "TIMEOUT"
  | "PROCESS_FAILED"
  | "INVALID_JSON"
  | "OUTPUT_TOO_LARGE";

export class PythonBridgeError extends Error {
  readonly code: PythonBridgeErrorCode;
  readonly detail: string | undefined;

  constructor(code: PythonBridgeErrorCode, message: string, detail?: string) {
    super(message);
    this.name = "PythonBridgeError";
    this.code = code;
    this.detail = detail;
  }
}

export interface RunPythonOptions {
  /** Python executable. Defaults to `PYTHON_PATH` env var, then `python3` (`python` on Windows). */
  pythonPath?: string;
  /** Kill the process after this many ms. Default 30s. */
  timeoutMs?: number;
  /** Max bytes accepted on stdout. Default 10 MiB. */
  maxOutputBytes?: number;
}

const SCRIPT_NAME = /^[a-z0-9_]+\.py$/i;

function defaultPython(): string {
  return process.env.PYTHON_PATH || (process.platform === "win32" ? "python" : "python3");
}

/**
 * Run a script from `processors/python/`, sending `input` as JSON on stdin and
 * parsing a single JSON document from stdout.
 *
 * Only bare script names inside the processors directory are accepted (never a
 * user-supplied path), and no shell is involved.
 */
export function runPython<TOutput = unknown>(
  script: string,
  input: unknown = {},
  options: RunPythonOptions = {},
): Promise<TOutput> {
  const pythonPath = options.pythonPath ?? defaultPython();
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxOutputBytes = options.maxOutputBytes ?? 10 * 1024 * 1024;

  if (!SCRIPT_NAME.test(script)) {
    return Promise.reject(
      new PythonBridgeError("SCRIPT_NOT_FOUND", `Invalid processor script name: ${script}`),
    );
  }
  const scriptPath = path.join(PYTHON_PROCESSORS_DIR, script);

  return new Promise<TOutput>((resolve, reject) => {
    let settled = false;
    const fail = (error: PythonBridgeError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };

    const child = spawn(pythonPath, [scriptPath], {
      cwd: PYTHON_PROCESSORS_DIR,
      shell: false,
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONDONTWRITEBYTECODE: "1" },
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      fail(
        new PythonBridgeError(
          "TIMEOUT",
          `Python processor "${script}" timed out after ${timeoutMs}ms.`,
        ),
      );
    }, timeoutMs);

    child.on("error", (err: NodeJS.ErrnoException) => {
      fail(
        err.code === "ENOENT"
          ? new PythonBridgeError(
              "PYTHON_NOT_FOUND",
              `Python interpreter not found at "${pythonPath}". Install Python 3 or set PYTHON_PATH.`,
              err.message,
            )
          : new PythonBridgeError(
              "PROCESS_FAILED",
              "Failed to start Python processor.",
              err.message,
            ),
      );
    });

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxOutputBytes) {
        child.kill("SIGKILL");
        fail(new PythonBridgeError("OUTPUT_TOO_LARGE", "Python processor output too large."));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));

    child.on("close", (code) => {
      if (settled) return;
      const errText = Buffer.concat(stderr).toString("utf8").trim();
      if (code !== 0) {
        const missingScript = /can't open file|No such file/i.test(errText);
        fail(
          new PythonBridgeError(
            missingScript ? "SCRIPT_NOT_FOUND" : "PROCESS_FAILED",
            missingScript
              ? `Python processor "${script}" not found.`
              : `Python processor "${script}" exited with code ${code}.`,
            errText,
          ),
        );
        return;
      }
      const raw = Buffer.concat(stdout).toString("utf8").trim();
      let parsed: TOutput;
      try {
        parsed = JSON.parse(raw) as TOutput;
      } catch {
        fail(
          new PythonBridgeError(
            "INVALID_JSON",
            `Python processor "${script}" returned invalid JSON.`,
            raw.slice(0, 500),
          ),
        );
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(parsed);
    });

    // If the process dies before reading stdin, the error/close handlers report it.
    child.stdin.on("error", () => undefined);
    child.stdin.end(JSON.stringify(input));
  });
}
