// Integration tests for the phase-04 HTTP surface: upload -> process -> download -> delete.
// The route handlers are imported directly, so this exercises the real pipeline, the real
// validation and the real temp store without needing a running server.
import {
  createInMemoryJobStore,
  createTempStore,
  setJobStore,
  resetRateLimits,
  RUN_RATE_LIMIT,
  setTempStore,
  type TempStore,
} from "@onestop/api";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PHASE_FILES, hasExecutor, stubExecutor, tools } from "@onestop/tool-registry";
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
  resetRateLimits();
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
  it("rate-limits a caller that floods it, with a retry-after the UI can use", async () => {
    // Phase 20: phases 04/12/13/16 each logged that this endpoint had no per-IP limit.
    const headers = { "x-forwarded-for": "203.0.113.9" };
    const post = () =>
      runTool(
        new Request(RUN_URL, {
          method: "POST",
          headers,
          body: formWith(new File([new Uint8Array([1, 2, 3])], "a.bin")),
        }),
      );
    for (let i = 0; i < RUN_RATE_LIMIT.limit; i += 1) {
      expect((await post()).status).not.toBe(429);
    }
    const limited = await post();
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    const body = (await limited.json()) as RunBody;
    expect(body.ok).toBe(false);
    expect(body.error?.message).toMatch(/Wait \d+ seconds/);

    // A different caller is unaffected.
    const other = await runTool(
      new Request(RUN_URL, {
        method: "POST",
        headers: { "x-forwarded-for": "198.51.100.4" },
        body: formWith(new File([new Uint8Array([1, 2, 3])], "a.bin")),
      }),
    );
    expect(other.status).not.toBe(429);
  });

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
    for (const entry of await fs.readdir(dir)) {
      expect(entry).toMatch(/^[0-9a-f-]{36}(\.meta\.json)?$/);
    }
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

  it("never lets a tool without an executor fake success", async () => {
    // Phase 17 was the last phase to add tools, so every registry entry now has a real executor
    // and none is left on the stub. The guarantee this test exists for is the stub's own
    // behaviour, so that is asserted directly: a tool with no executor reports NOT_IMPLEMENTED
    // and names the phase file that will build it, rather than returning ok.
    const unbuilt = tools.filter((t) => !hasExecutor(t.id));
    expect(unbuilt.map((t) => t.id)).toEqual([]);

    // `ToolPhase` only names phases that own tools, so the stand-in borrows one; what is being
    // asserted is the stub's shape, not which phase it points at.
    const pretend = { id: "not-built-yet", name: "Something Later", phase: "17" } as const;
    const stub = await stubExecutor(pretend)(null, {}, undefined);
    expect(stub.ok).toBe(false);
    if (!stub.ok) {
      expect(stub.code).toBe("NOT_IMPLEMENTED");
      expect(stub.message).toContain(PHASE_FILES[pretend.phase]);
    }
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
