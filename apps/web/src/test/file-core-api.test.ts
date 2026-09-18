// Integration tests for the phase-04 HTTP surface: upload -> process -> download -> delete.
// The route handlers are imported directly, so this exercises the real pipeline, the real
// validation and the real temp store without needing a running server.
import {
  createInMemoryJobStore,
  createTempStore,
  setJobStore,
  setTempStore,
  type TempStore,
} from "@onestop/api";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as getFile, DELETE as deleteFile } from "@/app/api/files/[id]/route";
import { GET as getJob } from "@/app/api/jobs/[id]/route";
import { POST as runTool } from "@/app/api/tools/run/route";

const DEMO_TOOL = "file-metadata-viewer";
const RUN_URL = "http://localhost/api/tools/run";

let dir: string;
let temp: TempStore;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "onestop-route-test-"));
  temp = createTempStore({ tempDir: dir, ttlMs: 60_000, autoSweep: false });
  setTempStore(temp);
  setJobStore(createInMemoryJobStore());
});

afterEach(async () => {
  setTempStore(null);
  setJobStore(null);
  await temp.dispose();
  await fs.rm(dir, { recursive: true, force: true });
});

interface RunBody {
  ok: boolean;
  job?: { id: string; status: string };
  output?: unknown;
  summary?: string | null;
  files?: { id: string; name: string; url: string; mimeType: string; size: number }[];
  error?: { code: string; message: string } | null;
}

async function run(form: FormData): Promise<{ status: number; body: RunBody }> {
  const response = await runTool(new Request(RUN_URL, { method: "POST", body: form }));
  return { status: response.status, body: (await response.json()) as RunBody };
}

function formWith(file: File, toolId = DEMO_TOOL): FormData {
  const form = new FormData();
  form.set("toolId", toolId);
  form.append("files", file);
  return form;
}

describe("POST /api/tools/run", () => {
  it("runs the demo tool end to end and offers a downloadable result", async () => {
    const { status, body } = await run(
      formWith(new File(["hello world"], "notes.txt", { type: "text/plain" })),
    );

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.job?.status).toBe("success");
    expect(body.summary).toMatch(/notes\.txt/);
    expect(body.files).toHaveLength(1);

    // ---- download ----------------------------------------------------------------------
    const id = body.files![0]!.id;
    const download = await getFile(new Request(`http://localhost/api/files/${id}`), {
      params: Promise.resolve({ id }),
    });
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toBe("application/json");
    expect(download.headers.get("content-disposition")).toContain("notes.txt.metadata.json");
    expect(download.headers.get("x-content-type-options")).toBe("nosniff");
    const report = JSON.parse(await download.text()) as { files: { sha256: string }[] };
    expect(report.files[0]?.sha256).toBe(
      "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
    );

    // ---- the job is queryable ----------------------------------------------------------
    const jobResponse = await getJob(new Request("http://localhost/api/jobs/x"), {
      params: Promise.resolve({ id: body.job!.id }),
    });
    expect(jobResponse.status).toBe(200);
    expect(((await jobResponse.json()) as { job: { status: string } }).job.status).toBe("success");

    // ---- delete temporary data ---------------------------------------------------------
    const removed = await deleteFile(new Request(`http://localhost/api/files/${id}`), {
      params: Promise.resolve({ id }),
    });
    expect(removed.status).toBe(200);
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it("shows the exact §22 message for an unsupported file type", async () => {
    const { status, body } = await run(
      formWith(new File(["id3"], "song.mp3", { type: "audio/mpeg" }), "merge-pdf"),
    );
    expect(status).toBe(422);
    expect(body.ok).toBe(false);
    expect(body.error).toEqual({
      code: "UNSUPPORTED_INPUT",
      message: "This file type is not supported.",
    });
  });

  it("shows the exact §22 message for an oversized file", async () => {
    const previous = process.env.MAX_UPLOAD_MB;
    process.env.MAX_UPLOAD_MB = "0.001"; // ~1 KB
    try {
      const { status, body } = await run(
        formWith(new File(["x".repeat(5000)], "notes.txt", { type: "text/plain" })),
      );
      expect(status).toBe(413);
      expect(body.error?.message).toBe(
        "The file is too large for local processing. Try a smaller file.",
      );
    } finally {
      if (previous === undefined) delete process.env.MAX_UPLOAD_MB;
      else process.env.MAX_UPLOAD_MB = previous;
    }
  });

  it("sanitises a path-traversal filename before anything touches the filesystem", async () => {
    const form = new FormData();
    form.set("toolId", DEMO_TOOL);
    form.append("files", new File(["hello"], "../../etc/passwd.txt", { type: "text/plain" }));
    const result = await run(form);
    expect(result.body.ok).toBe(true);
    expect(result.body.files![0]!.name).toBe("passwd.txt.metadata.json");
    // Nothing was written outside the store's own directory, and names are never paths.
    for (const entry of await fs.readdir(dir)) expect(entry).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("rejects an unknown tool, a missing tool id and unreadable options", async () => {
    const unknown = new FormData();
    unknown.set("toolId", "no-such-tool");
    expect((await run(unknown)).status).toBe(404);

    expect((await run(new FormData())).status).toBe(400);

    const badOptions = formWith(new File(["x"], "a.txt", { type: "text/plain" }));
    badOptions.set("options", "{not json");
    expect((await run(badOptions)).status).toBe(400);
  });

  it("reports a not-yet-implemented tool instead of faking success", async () => {
    const pdf = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])], "a.pdf", {
      type: "application/pdf",
    });
    // Phases 05-07 built the PDF and Office tools, so this checks one that is still to come (phase 16).
    const { body } = await run(formWith(pdf, "ai-pdf-summarizer"));
    expect(body.error?.code).toBe("NOT_IMPLEMENTED");
    expect(body.error?.message).toContain("16-ai-assistant.md");
  });
});

describe("GET /api/files/:id", () => {
  it("404s for an id that is not one of ours, without touching the filesystem", async () => {
    for (const id of ["../../etc/passwd", "..", "not-a-uuid"]) {
      const response = await getFile(new Request("http://localhost/api/files/x"), {
        params: Promise.resolve({ id }),
      });
      expect(response.status).toBe(404);
    }
  });

  it("404s once a file has expired", async () => {
    let clock = 0;
    const expiring = createTempStore({
      tempDir: dir,
      ttlMs: 10,
      autoSweep: false,
      now: () => clock,
    });
    setTempStore(expiring);
    const record = await expiring.put({ name: "a.json", bytes: new TextEncoder().encode("{}") });
    clock = 1_000;
    const response = await getFile(new Request("http://localhost/api/files/x"), {
      params: Promise.resolve({ id: record.id }),
    });
    expect(response.status).toBe(404);
    expect(await fs.readdir(dir)).toEqual([]);
    await expiring.dispose();
  });
});
