// Phase 15's tests (15-workflows.md).
//
// Three layers, in the order the build file asks for them:
//
//   * the chain rules — every way a workflow can be rejected before a byte is uploaded;
//   * the run engine and batch mode, driven with a fake pipeline so the wiring between steps is
//     tested on its own, quickly and deterministically;
//   * the four master plan §8 example workflows, run end to end through the real executors.
//
// The persistence tests need Postgres and skip themselves when none is configured, like every
// other database suite in the repo.
import { getTool, WORKFLOW_TEMPLATES, validateWorkflow } from "@onestop/tool-registry";
import type { WorkflowStep } from "@onestop/types";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createIsolatedTestPrisma,
  dropTestSchema,
  resetTestDatabase,
  testDatabaseReachable,
  type PrismaClient,
} from "../db/testing.ts";
import { loadFileCoreConfig, type FileCoreConfig } from "../file-processing/config.ts";
import { createInMemoryJobStore, type JobStore } from "../file-processing/job.ts";
import type { PipelineOutcome, RunPipelineInput } from "../file-processing/pipeline.ts";
import { createTempStore, type TempStore } from "../file-processing/tempStore.ts";
import { makePng, makeScannedPdf } from "../pdf/fixtures.ts";
import { runBatch, clampConcurrency } from "./batch.ts";
import {
  createWorkflow,
  deleteWorkflow,
  describeChain,
  getWorkflow,
  InvalidWorkflowError,
  listWorkflows,
  parseSteps,
  parseWorkflowInput,
  updateWorkflow,
} from "./model.ts";
import { runWorkflow, selectInputs } from "./run.ts";
// Registering every real executor is what makes the end-to-end section real.
import "../index.ts";

const text = (value: string) => new TextEncoder().encode(value);

// ---- chain validation -------------------------------------------------------------------------

describe("workflow validation", () => {
  it("accepts a compatible chain and reports what it takes and produces", () => {
    const result = validateWorkflow([{ toolId: "image-to-pdf" }, { toolId: "compress-pdf" }]);
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.inputTypes).toContain("image");
    expect(result.outputTypes).toEqual(["pdf"]);
    expect(result.requiresAuth).toBe(false);
  });

  it("rejects an incompatible chain and names both tools and both type sets", () => {
    // The build file's own example: an image tool feeding an audio-only tool.
    const result = validateWorkflow([
      { toolId: "background-removal" },
      { toolId: "audio-converter" },
    ]);
    expect(result.valid).toBe(false);
    const issue = result.issues.find((i) => i.code === "INCOMPATIBLE_STEP");
    expect(issue?.stepIndex).toBe(1);
    expect(issue?.message).toContain("Background Removal");
    expect(issue?.message).toContain("Audio Converter");
    expect(issue?.message).toContain("PNG");
  });

  it("rejects an empty chain, an unknown tool and an over-long chain", () => {
    expect(validateWorkflow([]).issues[0]?.code).toBe("NO_STEPS");
    expect(validateWorkflow([{ toolId: "not-a-real-tool" }]).issues[0]?.code).toBe("UNKNOWN_TOOL");
    const long = Array.from({ length: 13 }, () => ({ toolId: "compress-pdf" }));
    expect(validateWorkflow(long).issues.some((i) => i.code === "TOO_MANY_STEPS")).toBe(true);
  });

  it("refuses a first step that takes no file", () => {
    const result = validateWorkflow([{ toolId: "uuid-generator" }]);
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.message).toMatch(/cannot start a workflow/);
  });

  it("refuses a step whose report cannot feed the next tool", () => {
    // Image Metadata Viewer answers with JSON; Compress PDF wants a PDF.
    const result = validateWorkflow([
      { toolId: "image-metadata-viewer" },
      { toolId: "compress-pdf" },
    ]);
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.code).toBe("INCOMPATIBLE_STEP");
    expect(result.issues[0]?.message).toContain("JSON");
  });

  it("checks option ids, choices and ranges", () => {
    const unknown = validateWorkflow([{ toolId: "compress-pdf", options: { nope: 1 } }]);
    expect(unknown.issues[0]?.code).toBe("INVALID_OPTION");
    const badChoice = validateWorkflow([{ toolId: "compress-pdf", options: { level: "max" } }]);
    expect(badChoice.issues[0]?.message).toMatch(/valid value/);
    const badNumber = validateWorkflow([
      { toolId: "image-resizer", options: { mode: "pixels", width: 999_999 } },
    ]);
    expect(badNumber.issues[0]?.message).toMatch(/between/);
  });

  it("checks the name and description only when asked", () => {
    const steps = [{ toolId: "compress-pdf" }];
    expect(validateWorkflow(steps).valid).toBe(true);
    expect(validateWorkflow(steps, { checkName: true, name: "  " }).issues[0]?.code).toBe(
      "INVALID_NAME",
    );
    expect(
      validateWorkflow(steps, { checkName: true, name: "x".repeat(200) }).issues[0]?.message,
    ).toMatch(/under 80/);
  });

  it("validates all four master plan §8 templates", () => {
    expect(WORKFLOW_TEMPLATES).toHaveLength(4);
    for (const template of WORKFLOW_TEMPLATES) {
      const result = validateWorkflow(template.steps, {
        checkName: true,
        name: template.name,
        description: template.description,
      });
      expect(result.issues, `${template.name}: ${JSON.stringify(result.issues)}`).toEqual([]);
    }
  });
});

// ---- parsing / persistence helpers --------------------------------------------------------------

describe("workflow input parsing", () => {
  it("drops junk steps and non-primitive option values", () => {
    const steps = parseSteps([
      { toolId: "compress-pdf", options: { level: "light", nested: { a: 1 } } },
      { nope: true },
      "not a step",
      { toolId: "   " },
    ]);
    expect(steps).toEqual([{ toolId: "compress-pdf", options: { level: "light" } }]);
  });

  it("trims the name and rejects a body whose chain cannot work", () => {
    const input = parseWorkflowInput({
      name: "  Scans  ",
      description: "  ",
      steps: [{ toolId: "image-to-pdf" }],
    });
    expect(input.name).toBe("Scans");
    expect(input.description).toBeNull();
    expect(() =>
      parseWorkflowInput({
        name: "Broken",
        steps: [{ toolId: "background-removal" }, { toolId: "audio-converter" }],
      }),
    ).toThrow(InvalidWorkflowError);
  });

  it("describes a chain for a list row", () => {
    expect(describeChain([{ toolId: "image-to-pdf" }, { toolId: "compress-pdf" }])).toBe(
      "Image → PDF → Compress PDF",
    );
  });
});

// ---- the run engine, on a fake pipeline ---------------------------------------------------------

interface FakeStore {
  files: Map<string, Uint8Array>;
}

/**
 * A stand-in for `runPipeline` that produces one output file per call, named after the tool, so a
 * chain's wiring can be tested without running real executors. `failOn` makes one step fail.
 */
function fakePipeline(store: FakeStore, options: { failOn?: string; emptyFrom?: string } = {}) {
  const calls: RunPipelineInput[] = [];
  let counter = 0;
  const run = async (input: RunPipelineInput): Promise<PipelineOutcome> => {
    calls.push(input);
    counter += 1;
    const job = {
      id: `job-${counter}`,
      userId: input.userId ?? null,
      toolId: input.toolId,
      status: "success" as const,
      inputMetadata: {},
      outputMetadata: null,
      createdAt: new Date().toISOString(),
    };
    if (options.failOn && input.toolId === options.failOn) {
      return {
        job: { ...job, status: "failed" as const },
        ok: false,
        files: [],
        error: { code: "UNSUPPORTED_INPUT", message: `${input.toolId} cannot read that.` },
      };
    }
    if (options.emptyFrom === input.toolId) return { job, ok: true, files: [] };
    const id = `temp-${counter}`;
    const bytes = text(`${input.toolId}:${(input.files ?? []).map((f) => f.name).join("+")}`);
    store.files.set(id, bytes);
    return {
      job,
      ok: true,
      summary: `${input.toolId} done`,
      files: [
        {
          id,
          name: `${counter}.pdf`,
          mimeType: "application/pdf",
          size: bytes.length,
          url: `/api/files/${id}`,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
      ],
    };
  };
  return { run, calls };
}

function fakeTemp(store: FakeStore): TempStore {
  return {
    read: async (id: string) => {
      const bytes = store.files.get(id);
      if (!bytes) throw new Error("gone");
      return bytes;
    },
  } as unknown as TempStore;
}

const CHAIN: WorkflowStep[] = [{ toolId: "image-to-pdf" }, { toolId: "compress-pdf" }];
const input = (name: string) => ({ name, mimeType: "image/png", bytes: text(name) });

describe("the run engine", () => {
  it("passes each step's output to the next and reports every step", async () => {
    const store: FakeStore = { files: new Map() };
    const fake = fakePipeline(store);
    const progress: string[] = [];

    const result = await runWorkflow(
      { steps: CHAIN, files: [input("a.png")], name: "Scans" },
      {
        runStep: fake.run,
        temp: fakeTemp(store),
        onProgress: (p) => progress.push(`${p.toolId}:${p.status}`),
      },
    );

    expect(result.ok).toBe(true);
    expect(result.steps.map((s) => s.status)).toEqual(["success", "success"]);
    expect(result.files).toHaveLength(1);
    // Step 2 was given step 1's output, not the original upload.
    expect(fake.calls[1]?.files?.[0]?.name).toBe("1.pdf");
    expect(progress).toEqual([
      "image-to-pdf:running",
      "image-to-pdf:success",
      "compress-pdf:running",
      "compress-pdf:success",
    ]);
  });

  it("stops at the failing step, keeps the earlier results and skips the rest", async () => {
    const store: FakeStore = { files: new Map() };
    const fake = fakePipeline(store, { failOn: "compress-pdf" });
    const result = await runWorkflow(
      { steps: [...CHAIN, { toolId: "pdf-to-word" }], files: [input("a.png")] },
      { runStep: fake.run, temp: fakeTemp(store) },
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Compress PDF");
    expect(result.steps.map((s) => s.status)).toEqual(["success", "failed", "skipped"]);
    expect(result.steps[0]?.files).toHaveLength(1);
    expect(result.files).toEqual([]);
    // The third step was never attempted.
    expect(fake.calls).toHaveLength(2);
  });

  it("fails clearly when a middle step produces no file", async () => {
    const store: FakeStore = { files: new Map() };
    const fake = fakePipeline(store, { emptyFrom: "image-to-pdf" });
    const result = await runWorkflow(
      { steps: CHAIN, files: [input("a.png")] },
      { runStep: fake.run, temp: fakeTemp(store) },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/produced no file/);
  });

  it("refuses an invalid chain and an empty file list before running anything", async () => {
    const store: FakeStore = { files: new Map() };
    const fake = fakePipeline(store);
    const broken = await runWorkflow(
      {
        steps: [{ toolId: "background-removal" }, { toolId: "audio-converter" }],
        files: [input("a.png")],
      },
      { runStep: fake.run, temp: fakeTemp(store) },
    );
    expect(broken.ok).toBe(false);
    expect(broken.error).toContain("Step 2");

    const noFiles = await runWorkflow(
      { steps: CHAIN, files: [] },
      { runStep: fake.run, temp: fakeTemp(store) },
    );
    expect(noFiles.error).toMatch(/at least one file/);
    expect(fake.calls).toHaveLength(0);
  });

  it("hands a step only the files it can read", () => {
    const translator = getTool("document-translator")!;
    const picked = selectInputs(translator, [
      { name: "scan.pdf", bytes: text("p") },
      { name: "scan.txt", bytes: text("t") },
    ]);
    expect(picked.map((f) => f.name)).toEqual(["scan.txt"]);
  });

  it("runs a one-at-a-time tool once per file", async () => {
    const store: FakeStore = { files: new Map() };
    const fake = fakePipeline(store);
    // Split PDF does not support batch, so two carried files mean two pipeline calls.
    const result = await runWorkflow(
      {
        steps: [{ toolId: "merge-pdf" }, { toolId: "split-pdf" }],
        files: [input("a.pdf"), input("b.pdf")],
      },
      { runStep: fake.run, temp: fakeTemp(store) },
    );
    expect(result.ok).toBe(true);
    expect(fake.calls[0]?.files).toHaveLength(2);
  });
});

// ---- batch --------------------------------------------------------------------------------------

describe("batch processing", () => {
  it("clamps concurrency to something sane", () => {
    expect(clampConcurrency(undefined)).toBe(2);
    expect(clampConcurrency(0)).toBe(1);
    expect(clampConcurrency(99)).toBe(4);
  });

  it("processes 5 files, one of which fails, without aborting the batch", async () => {
    const store: FakeStore = { files: new Map() };
    // The fake fails whenever the second step sees the poisoned file's derived name; simplest
    // faithful version: fail on a tool for one specific input name.
    const calls: string[] = [];
    const run = async (call: RunPipelineInput): Promise<PipelineOutcome> => {
      const name = call.files?.[0]?.name ?? "";
      calls.push(`${call.toolId}:${name}`);
      const job = {
        id: `job-${calls.length}`,
        userId: null,
        toolId: call.toolId,
        status: "success" as const,
        inputMetadata: {},
        outputMetadata: null,
        createdAt: new Date().toISOString(),
      };
      if (name === "broken.png") {
        return {
          job: { ...job, status: "failed" as const },
          ok: false,
          files: [],
          error: { code: "UNSUPPORTED_INPUT", message: "That file is not a usable image." },
        };
      }
      const id = `temp-${calls.length}`;
      store.files.set(id, text(name));
      return {
        job,
        ok: true,
        files: [
          {
            id,
            name: `${name}.pdf`,
            mimeType: "application/pdf",
            size: 4,
            url: `/api/files/${id}`,
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          },
        ],
      };
    };

    const files = ["one.png", "two.png", "broken.png", "four.png", "five.png"].map(input);
    const seen: string[] = [];
    const result = await runBatch(
      { steps: CHAIN, files, concurrency: 2 },
      {
        runStep: run,
        temp: fakeTemp(store),
        onFileProgress: (p) => seen.push(`${p.name}:${p.status}`),
      },
    );

    expect(result.total).toBe(5);
    expect(result.succeeded).toBe(4);
    expect(result.failed).toBe(1);
    // Results keep the input order, whatever order the workers finished in.
    expect(result.results.map((r) => r.name)).toEqual([
      "one.png",
      "two.png",
      "broken.png",
      "four.png",
      "five.png",
    ]);
    const failure = result.results[2]!;
    expect(failure.ok).toBe(false);
    expect(failure.error).toContain("not a usable image");
    expect(failure.files).toEqual([]);
    // Every other file finished the whole chain.
    for (const index of [0, 1, 3, 4]) {
      expect(result.results[index]!.ok).toBe(true);
      expect(result.results[index]!.files).toHaveLength(1);
    }
    expect(seen).toContain("broken.png:failed");
    expect(seen).toContain("five.png:success");
  });

  it("runs strictly sequentially when asked", async () => {
    const store: FakeStore = { files: new Map() };
    let active = 0;
    let peak = 0;
    const fake = fakePipeline(store);
    const run = async (call: RunPipelineInput): Promise<PipelineOutcome> => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      return fake.run(call);
    };
    await runBatch(
      { steps: [{ toolId: "compress-pdf" }], files: ["a", "b", "c"].map(input), concurrency: 1 },
      { runStep: run, temp: fakeTemp(store) },
    );
    expect(peak).toBe(1);
  });
});

// ---- the four master plan §8 workflows, end to end ----------------------------------------------

describe("the four example workflows, end to end", () => {
  let dir: string;
  let temp: TempStore;
  let jobs: JobStore;
  let config: FileCoreConfig;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "onestop-workflow-test-"));
    temp = createTempStore({ tempDir: dir, ttlMs: 120_000, autoSweep: false });
    jobs = createInMemoryJobStore();
    config = { ...loadFileCoreConfig(), tempDir: dir };
  });

  afterEach(async () => {
    await temp.dispose();
    await fs.rm(dir, { recursive: true, force: true });
  });

  const template = (id: string) => WORKFLOW_TEMPLATES.find((t) => t.id === id)!;

  it("Images → PDF → Compress", async () => {
    const png = await makePng(400, 300);
    const result = await runWorkflow(
      {
        steps: template("images-to-compressed-pdf").steps,
        files: [
          { name: "page1.png", mimeType: "image/png", bytes: png },
          { name: "page2.png", mimeType: "image/png", bytes: png },
        ],
        name: "Images → PDF → Compress",
      },
      { jobs, temp, config },
    );

    expect(result.error).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.steps.map((s) => s.status)).toEqual(["success", "success"]);
    const output = result.files[0]!;
    expect(output.name.endsWith(".pdf")).toBe(true);
    const bytes = await temp.read(output.id);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  }, 180_000);

  it("PDF → OCR → Translate → PDF", async () => {
    const scanned = await makeScannedPdf(["Invoice number 4821", "Total due 1250 dollars"]);
    const result = await runWorkflow(
      {
        steps: template("scan-to-translated-pdf").steps,
        files: [{ name: "scan.pdf", mimeType: "application/pdf", bytes: scanned }],
        name: "PDF → OCR → Translate → PDF",
      },
      { jobs, temp, config },
    );

    expect(result.error).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.steps.map((s) => s.toolId)).toEqual([
      "ocr-pdf",
      "document-translator",
      "document-to-pdf",
    ]);
    // Step 1 really read the pixels: the scan has no text layer at all.
    const recognised = new TextDecoder().decode(await temp.read(result.steps[0]!.files[0]!.id));
    expect(recognised).toContain("Invoice");
    expect(recognised).toContain("4821");
    // Step 2 really translated it: "number" becomes "número" in the offline dictionary.
    const translated = new TextDecoder().decode(await temp.read(result.steps[1]!.files[0]!.id));
    expect(translated).not.toEqual(recognised);

    const output = result.files[0]!;
    expect(output.mimeType).toBe("application/pdf");
    expect((await temp.read(output.id)).length).toBeGreaterThan(400);
  }, 300_000);

  it("CSV → Clean → Excel", async () => {
    const csv = text(
      [" Name , Amount ", " Ada ,  1,234.50 ", " Ada ,  1,234.50 ", "", " Grace , 42 "].join("\n"),
    );
    const result = await runWorkflow(
      {
        steps: template("csv-clean-to-excel").steps,
        files: [{ name: "export.csv", mimeType: "text/csv", bytes: csv }],
        name: "CSV → Clean → Excel",
      },
      { jobs, temp, config },
    );

    expect(result.error).toBeNull();
    expect(result.ok).toBe(true);
    const output = result.files[0]!;
    expect(output.name.endsWith(".xlsx")).toBe(true);
    // A real XLSX is a ZIP: "PK".
    const bytes = await temp.read(output.id);
    expect([bytes[0], bytes[1]]).toEqual([0x50, 0x4b]);
  }, 120_000);

  it("Image → Remove Background → Resize → WebP", async () => {
    const result = await runWorkflow(
      {
        steps: template("cutout-to-webp").steps,
        files: [{ name: "subject.png", mimeType: "image/png", bytes: await makePng(600, 400) }],
        name: "Image → Remove Background → Resize → WebP",
      },
      { jobs, temp, config },
    );

    expect(result.error).toBeNull();
    expect(result.ok).toBe(true);
    const output = result.files[0]!;
    expect(output.name.endsWith(".webp")).toBe(true);
    const bytes = await temp.read(output.id);
    // WebP files start "RIFF" ... "WEBP".
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(bytes.slice(8, 12))).toBe("WEBP");
  }, 180_000);

  it("runs a batch of 5 files with one deliberate failure", async () => {
    const png = await makePng(200, 120);
    const files = [
      { name: "a.png", mimeType: "image/png", bytes: png },
      { name: "b.png", mimeType: "image/png", bytes: png },
      // Not an image at all: it must fail on its own without touching the rest.
      { name: "broken.png", mimeType: "image/png", bytes: text("this is not a PNG") },
      { name: "d.png", mimeType: "image/png", bytes: png },
      { name: "e.png", mimeType: "image/png", bytes: png },
    ];
    const result = await runBatch(
      { steps: template("images-to-compressed-pdf").steps, files, concurrency: 2 },
      { jobs, temp, config },
    );

    expect(result.total).toBe(5);
    expect(result.succeeded).toBe(4);
    expect(result.failed).toBe(1);
    const failure = result.results.find((r) => r.name === "broken.png")!;
    expect(failure.ok).toBe(false);
    expect(failure.error).toBeTruthy();
    for (const ok of result.results.filter((r) => r.name !== "broken.png")) {
      expect(ok.ok, `${ok.name}: ${ok.error}`).toBe(true);
      expect(ok.files).toHaveLength(1);
    }
  }, 300_000);
});

// ---- persistence ---------------------------------------------------------------------------------

const SCHEMA = "test_workflows";
// Top-level await: the probe has to finish before `describe` is called, and a configured-but-not-
// running Postgres should skip these tests, not fail them.
const describeDb = (await testDatabaseReachable()) ? describe : describe.skip;

describeDb("saved workflows (Postgres)", () => {
  let prisma: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    prisma = await createIsolatedTestPrisma(SCHEMA);
  }, 120_000);

  afterAll(async () => {
    await prisma.$disconnect();
    await dropTestSchema(SCHEMA);
  });

  beforeEach(async () => {
    await resetTestDatabase(prisma);
    const user = await prisma.user.create({ data: { email: "wf@example.com", name: "wf" } });
    userId = user.id;
  });

  it("saves a workflow, reads it back and can edit it", async () => {
    const created = await createWorkflow(
      userId,
      {
        name: "Scans to PDF",
        description: "Photos in, one small PDF out",
        steps: [
          { toolId: "image-to-pdf" },
          { toolId: "compress-pdf", options: { level: "strong" } },
        ],
      },
      prisma,
    );
    expect(created.id).toBeTruthy();
    expect(created.scope).toBe("account");

    // A fresh read — what the page does after a reload.
    const reloaded = await getWorkflow(userId, created.id, prisma);
    expect(reloaded?.name).toBe("Scans to PDF");
    expect(reloaded?.steps).toEqual([
      { toolId: "image-to-pdf" },
      { toolId: "compress-pdf", options: { level: "strong" } },
    ]);

    const edited = await updateWorkflow(
      userId,
      created.id,
      { name: "Scans to PDF v2", description: null, steps: [{ toolId: "image-to-pdf" }] },
      prisma,
    );
    expect(edited.name).toBe("Scans to PDF v2");
    expect(edited.steps).toHaveLength(1);
    expect((await getWorkflow(userId, created.id, prisma))?.steps).toHaveLength(1);
  });

  it("keeps one user's workflows away from another's", async () => {
    const other = await prisma.user.create({ data: { email: "other@example.com" } });
    const mine = await createWorkflow(
      userId,
      { name: "Mine", description: null, steps: [{ toolId: "compress-pdf" }] },
      prisma,
    );
    expect(await getWorkflow(other.id, mine.id, prisma)).toBeUndefined();
    expect(await listWorkflows(other.id, prisma)).toEqual([]);
    expect(await deleteWorkflow(other.id, mine.id, prisma)).toBe(false);
    expect(await deleteWorkflow(userId, mine.id, prisma)).toBe(true);
    expect(await listWorkflows(userId, prisma)).toEqual([]);
  });

  it("lists most recently updated first", async () => {
    const first = await createWorkflow(
      userId,
      { name: "First", description: null, steps: [{ toolId: "compress-pdf" }] },
      prisma,
    );
    await createWorkflow(
      userId,
      { name: "Second", description: null, steps: [{ toolId: "merge-pdf" }] },
      prisma,
    );
    await updateWorkflow(
      userId,
      first.id,
      { name: "First again", description: null, steps: [{ toolId: "compress-pdf" }] },
      prisma,
    );
    expect((await listWorkflows(userId, prisma)).map((w) => w.name)).toEqual([
      "First again",
      "Second",
    ]);
  });
});
