// The phase-15 HTTP surface (15-workflows.md).
//
// The route handlers are imported directly, so this exercises the real chain validation, the real
// pipeline and the real temp store without a running server. The saved-workflow CRUD routes need
// Postgres and are covered in `apps/api/src/workflows/workflows.test.ts`; what is tested here is
// the part a guest uses, which needs no database at all: running a chain, and a batch.
import {
  createInMemoryJobStore,
  createTempStore,
  setJobStore,
  setTempStore,
  type TempStore,
} from "@onestop/api";
import type { BatchRunResult, WorkflowRunResult } from "@onestop/types";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as runWorkflowRoute } from "@/app/api/workflows/run/route";

const URL_ = "http://localhost/api/workflows/run";
const CHAIN = JSON.stringify([{ toolId: "image-to-pdf" }, { toolId: "compress-pdf" }]);

let dir: string;
let temp: TempStore;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "onestop-workflow-route-test-"));
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

interface Body {
  ok?: boolean;
  mode?: string;
  run?: WorkflowRunResult;
  batch?: BatchRunResult;
  error?: { code: string; message: string };
}

async function post(form: FormData): Promise<{ status: number; body: Body }> {
  const response = await runWorkflowRoute(new Request(URL_, { method: "POST", body: form }));
  return { status: response.status, body: (await response.json()) as Body };
}

async function png(): Promise<Uint8Array> {
  const { makePng } = await import("../../../api/src/pdf/fixtures.ts");
  return makePng(200, 120);
}

function fileOf(bytes: Uint8Array, name: string, type: string): File {
  return new File([bytes as BlobPart], name, { type });
}

describe("POST /api/workflows/run", () => {
  it("runs a chain over the uploaded files and returns the last step's result", async () => {
    const form = new FormData();
    form.set("steps", CHAIN);
    form.set("name", "Scans");
    form.append("files", fileOf(await png(), "a.png", "image/png"));
    form.append("files", fileOf(await png(), "b.png", "image/png"));

    const { status, body } = await post(form);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.run?.steps.map((s) => s.status)).toEqual(["success", "success"]);
    expect(body.run?.files[0]?.url).toMatch(/^\/api\/files\//);
  }, 120_000);

  it("refuses an incompatible chain before anything is processed", async () => {
    const form = new FormData();
    form.set(
      "steps",
      JSON.stringify([{ toolId: "background-removal" }, { toolId: "audio-converter" }]),
    );
    form.append("files", fileOf(await png(), "a.png", "image/png"));

    const { status, body } = await post(form);
    expect(status).toBe(422);
    expect(body.error?.message).toContain("Audio Converter");
  });

  it("asks for a workflow and for files when they are missing", async () => {
    const empty = new FormData();
    expect((await post(empty)).body.error?.message).toMatch(/No workflow/);

    const noFiles = new FormData();
    noFiles.set("steps", CHAIN);
    expect((await post(noFiles)).body.error?.message).toMatch(/at least one file/);
  });

  it("requires a signed-in user to run a saved workflow by id", async () => {
    const form = new FormData();
    form.set("workflowId", "some-id");
    form.append("files", fileOf(await png(), "a.png", "image/png"));
    const { status, body } = await post(form);
    expect(status).toBe(401);
    expect(body.error?.code).toBe("AUTH_REQUIRED");
  });

  it("reports every file in a batch, and one failure does not stop the others", async () => {
    const form = new FormData();
    form.set("steps", CHAIN);
    form.set("mode", "batch");
    form.set("concurrency", "2");
    for (const name of ["a.png", "b.png"]) {
      form.append("files", fileOf(await png(), name, "image/png"));
    }
    form.append("files", fileOf(new TextEncoder().encode("not a png"), "broken.png", "image/png"));

    const { status, body } = await post(form);
    expect(status).toBe(200);
    expect(body.mode).toBe("batch");
    expect(body.batch?.total).toBe(3);
    expect(body.batch?.succeeded).toBe(2);
    expect(body.batch?.failed).toBe(1);
    const failure = body.batch?.results.find((r) => r.name === "broken.png");
    expect(failure?.error).toBeTruthy();
  }, 120_000);
});
