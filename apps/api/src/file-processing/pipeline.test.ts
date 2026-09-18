import { getTool, registerExecutor } from "@onestop/tool-registry";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadFileCoreConfig, type FileCoreConfig } from "./config.ts";
import { createInMemoryJobStore, type JobStore } from "./job.ts";
import { runPipeline, UnknownToolError, detectExecutionMode } from "./pipeline.ts";
import { createTempStore, type TempStore } from "./tempStore.ts";
import "./index.ts"; // registers the real file-metadata executor

const DEMO_TOOL = "file-metadata-viewer";
const bytes = (text: string) => new TextEncoder().encode(text);
const PDF = new Uint8Array([...bytes("%PDF-1.7\n"), ...bytes("body")]);

let dir: string;
let temp: TempStore;
let jobs: JobStore;
let config: FileCoreConfig;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "onestop-pipeline-test-"));
  temp = createTempStore({ tempDir: dir, ttlMs: 60_000, autoSweep: false });
  jobs = createInMemoryJobStore();
  config = { ...loadFileCoreConfig(), tempDir: dir, maxUploadBytes: 1024 };
});

afterEach(async () => {
  await temp.dispose();
  await fs.rm(dir, { recursive: true, force: true });
});

const deps = () => ({ jobs, temp, config });

async function filesOnDisk(): Promise<string[]> {
  return fs.readdir(dir).catch(() => []);
}

describe("runPipeline — happy path", () => {
  it("runs the demo tool end to end and leaves a downloadable result", async () => {
    const outcome = await runPipeline(
      {
        toolId: DEMO_TOOL,
        files: [{ name: "notes.txt", mimeType: "text/plain", bytes: bytes("hello world") }],
      },
      deps(),
    );

    expect(outcome.ok).toBe(true);
    expect(outcome.job.status).toBe("success");
    expect(outcome.job.toolId).toBe(DEMO_TOOL);
    expect(outcome.job.userId).toBeNull();

    // Real processing: the checksum is of the actual bytes, not of the metadata.
    const output = outcome.output as { files: { sha256: string; size: number; name: string }[] };
    expect(output.files[0]?.name).toBe("notes.txt");
    expect(output.files[0]?.size).toBe(11);
    expect(output.files[0]?.sha256).toBe(
      "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
    );

    // One downloadable output file, still in the store, readable through it.
    expect(outcome.files).toHaveLength(1);
    const result = outcome.files[0]!;
    expect(result.url).toBe(`/api/files/${result.id}`);
    expect(result.mimeType).toBe("application/json");
    const downloaded = JSON.parse(new TextDecoder().decode(await temp.read(result.id))) as {
      fileCount: number;
    };
    expect(downloaded.fileCount).toBe(1);

    // The input is gone; only the output remains on disk.
    expect(await filesOnDisk()).toEqual([result.id]);
    expect(temp.list().filter((f) => f.kind === "input")).toHaveLength(0);
    expect(outcome.job.outputMetadata).toMatchObject({ execution: "local" });
  });

  it("records the metadata the Job model promises, without any file contents", async () => {
    const outcome = await runPipeline(
      { toolId: DEMO_TOOL, files: [{ name: "../../etc/passwd.txt", bytes: bytes("secret") }] },
      deps(),
    );
    expect(outcome.ok).toBe(true);
    const serialised = JSON.stringify(outcome.job);
    expect(serialised).toContain("passwd.txt");
    expect(serialised).not.toContain("../");
    expect(serialised).not.toContain("secret");
  });
});

describe("runPipeline — validation", () => {
  it("rejects a file type the tool does not accept", async () => {
    const outcome = await runPipeline(
      {
        toolId: "merge-pdf",
        files: [{ name: "song.mp3", mimeType: "audio/mpeg", bytes: bytes("x") }],
      },
      deps(),
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.job.status).toBe("failed");
    expect(outcome.error).toEqual({
      code: "UNSUPPORTED_INPUT",
      message: "This file type is not supported.",
    });
    expect(await filesOnDisk()).toEqual([]);
  });

  it("rejects an oversized file before anything is written", async () => {
    const outcome = await runPipeline(
      {
        toolId: DEMO_TOOL,
        files: [{ name: "big.txt", bytes: new Uint8Array(config.maxUploadBytes + 1) }],
      },
      deps(),
    );
    expect(outcome.error?.message).toBe(
      "The file is too large for local processing. Try a smaller file.",
    );
    expect(await filesOnDisk()).toEqual([]);
  });

  it("rejects a traversal filename whose real extension the tool does not accept", async () => {
    const outcome = await runPipeline(
      { toolId: "merge-pdf", files: [{ name: "../../etc/passwd", bytes: PDF }] },
      deps(),
    );
    expect(outcome.ok).toBe(false);
    expect(await filesOnDisk()).toEqual([]);
  });

  it("asks for a file when none was given, and refuses a batch for a single-file tool", async () => {
    const none = await runPipeline({ toolId: "merge-pdf", files: [] }, deps());
    expect(none.error?.message).toMatch(/choose a file/i);
    const pair = [
      { name: "a.pdf", mimeType: "application/pdf", bytes: PDF },
      { name: "b.pdf", mimeType: "application/pdf", bytes: PDF },
    ];
    const batch = await runPipeline({ toolId: "ocr-to-word", files: pair }, deps());
    expect(batch.error?.message).toMatch(/one file at a time/i);
  });

  it("lets a file-or-text tool take typed text instead of a file, but not a file-only tool (07)", async () => {
    const typed = await runPipeline({ toolId: "grammar-checker", text: "i could of gone" }, deps());
    expect(typed.error?.message ?? "").not.toMatch(/choose a file/i);
    const empty = await runPipeline({ toolId: "grammar-checker", text: "   " }, deps());
    expect(empty.error?.message).toBe("Choose a file or enter some text first.");
    const fileOnly = await runPipeline({ toolId: "word-to-pdf", text: "hello" }, deps());
    expect(fileOnly.error?.message).toMatch(/choose a file first/i);
  });

  it("never stores a password or drawn signature on the job record (06)", async () => {
    const outcome = await runPipeline(
      {
        toolId: "remove-pdf-password",
        files: [{ name: "a.pdf", mimeType: "application/pdf", bytes: PDF }],
        options: { password: "hunter22" },
      },
      deps(),
    );
    const stored = JSON.stringify(await jobs.get(outcome.job.id));
    expect(stored).not.toContain("hunter22");
    expect(outcome.job.inputMetadata.options).toEqual({ password: "[redacted]" });

    const signed = await runPipeline(
      {
        toolId: "sign-pdf",
        files: [{ name: "a.pdf", mimeType: "application/pdf", bytes: PDF }],
        options: { source: "draw", signature: "data:image/png;base64,AAAA", signerName: "Ada" },
      },
      deps(),
    );
    expect(signed.job.inputMetadata.options).toMatchObject({
      signature: "[signature]",
      signerName: "Ada",
    });
  });

  it("requires a session for a tool marked requiresAuth", async () => {
    // No tool carries `requiresAuth` today: 11-qr-tools.md turned it off for the dynamic QR tools
    // until 13-auth-database.md brings real accounts. The pipeline rule still has to hold, so the
    // flag is flipped on one tool for the length of this test.
    const tool = getTool(DEMO_TOOL)!;
    tool.requiresAuth = true;
    try {
      const outcome = await runPipeline({ toolId: tool.id, files: [{ name: "a.txt", mimeType: "text/plain", bytes: bytes("a") }] }, deps());
      expect(outcome.error?.code).toBe("AUTH_REQUIRED");
      const signedIn = await runPipeline(
        { toolId: tool.id, userId: "user-1", files: [{ name: "a.txt", mimeType: "text/plain", bytes: bytes("a") }] },
        deps(),
      );
      expect(signedIn.ok).toBe(true);
    } finally {
      tool.requiresAuth = false;
    }
  });

  it("throws only for an unknown tool id", async () => {
    await expect(runPipeline({ toolId: "no-such-tool" }, deps())).rejects.toBeInstanceOf(
      UnknownToolError,
    );
  });
});

describe("runPipeline — failure paths", () => {
  it("marks the job failed and still deletes the temp file when an executor throws", async () => {
    const restore = registerExecutor(DEMO_TOOL, async () => {
      throw new Error("boom");
    });
    try {
      const outcome = await runPipeline(
        { toolId: DEMO_TOOL, files: [{ name: "a.txt", bytes: bytes("x") }] },
        deps(),
      );
      expect(outcome.ok).toBe(false);
      expect(outcome.job.status).toBe("failed");
      expect(outcome.error?.message).toBe("The tool stopped unexpectedly. Please try again.");
      expect(await filesOnDisk()).toEqual([]);
      expect(temp.list()).toHaveLength(0);
    } finally {
      restore();
    }
  });

  it("gives up on an executor that never finishes, and cleans up", async () => {
    const restore = registerExecutor(DEMO_TOOL, () => new Promise(() => {}));
    try {
      const outcome = await runPipeline(
        { toolId: DEMO_TOOL, files: [{ name: "a.txt", bytes: bytes("x") }] },
        { ...deps(), timeoutMs: 30 },
      );
      expect(outcome.ok).toBe(false);
      expect(await filesOnDisk()).toEqual([]);
    } finally {
      restore();
    }
  });

  it("refuses an output file the tool produced empty", async () => {
    const restore = registerExecutor(DEMO_TOOL, async () => ({
      ok: true,
      output: {},
      files: [{ name: "empty.json", mimeType: "application/json", bytes: new Uint8Array() }],
    }));
    try {
      const outcome = await runPipeline(
        { toolId: DEMO_TOOL, files: [{ name: "a.txt", bytes: bytes("x") }] },
        deps(),
      );
      expect(outcome.ok).toBe(false);
      expect(outcome.job.status).toBe("failed");
      expect(await filesOnDisk()).toEqual([]);
    } finally {
      restore();
    }
  });

  it("reports a stub tool as NOT_IMPLEMENTED rather than faking success", async () => {
    const outcome = await runPipeline(
      { toolId: "merge-pdf", files: [{ name: "a.pdf", mimeType: "application/pdf", bytes: PDF }] },
      deps(),
    );
    expect(outcome.error?.code).toBe("NOT_IMPLEMENTED");
    expect(outcome.error?.message).toContain("05-pdf-tools-core.md");
    expect(await filesOnDisk()).toEqual([]);
  });

  it("will not run a remote tool while the server is offline", async () => {
    const remote = getTool("youtube-to-mp3")!;
    expect(detectExecutionMode(remote)).toBe("remote");
    const outcome = await runPipeline(
      { toolId: remote.id, text: "https://youtu.be/abc" },
      { ...deps(), online: false },
    );
    expect(outcome.error).toEqual({
      code: "OFFLINE",
      message: "This tool needs an Internet connection. Connect and try again.",
    });
  });
});

describe("executor sandboxing", () => {
  it("only lets a tool read the files of its own job", async () => {
    const other = await temp.put({ name: "other.txt", bytes: bytes("not yours") });
    let error: unknown;
    const restore = registerExecutor(DEMO_TOOL, async (_input, _options, ctx) => {
      try {
        await ctx!.readFile({ name: "other.txt", size: 9, type: "text/plain", tempId: other.id });
      } catch (err) {
        error = err;
      }
      return { ok: true, output: {} };
    });
    try {
      await runPipeline(
        { toolId: DEMO_TOOL, files: [{ name: "a.txt", bytes: bytes("x") }] },
        deps(),
      );
      expect((error as Error).message).toMatch(/own job/i);
    } finally {
      restore();
    }
  });
});
