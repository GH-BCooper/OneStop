// POST /api/workflows/run — run a chain of tools over one or many files (15-workflows.md).
//
// Accepts multipart/form-data:
//   steps       JSON array of { toolId, options? }; omit it and pass `workflowId` instead
//   workflowId  a saved workflow of the signed-in user, used when `steps` is absent
//   name        display name for the result panel (optional)
//   mode        "chain" (default) = all files into step 1, or "batch" = each file through the
//               whole chain on its own, with a per-file result
//   concurrency batch only: how many files to work on at once (1–4)
//   files       the input files
//
// Every step still goes through the phase-04 pipeline, so validation, size limits, job history and
// temp-file retention are exactly the same as running the tool from its own page. A guest can run
// any workflow: only *saving* one needs an account.
import {
  describeIssues,
  endProgress,
  getPrisma,
  getWorkflow,
  loadFileCoreConfig,
  parseSteps,
  recordWorkflowUse,
  runBatch,
  runWorkflow,
  setProgress,
  validateWorkflow,
  type PipelineFileInput,
} from "@onestop/api";
import { ERROR_MESSAGES, type WorkflowStep } from "@onestop/types";
import { NextResponse } from "next/server";
import { currentUserId } from "@/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Counting a run is bookkeeping: it must never turn a finished run into an error. */
async function noteUse(userId: string, workflowId: string): Promise<void> {
  try {
    const prisma = getPrisma();
    if (prisma) await recordWorkflowUse(userId, workflowId, prisma);
  } catch (err) {
    console.error("[api/workflows/run] could not record the run", err);
  }
}

function problem(status: number, code: string, message: string) {
  return NextResponse.json(
    { ok: false, error: { code, message } },
    { status, headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request): Promise<Response> {
  const config = loadFileCoreConfig();

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > config.maxRequestBytes) {
    return problem(413, "UNSUPPORTED_INPUT", ERROR_MESSAGES.tooLarge);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch (err) {
    console.error("[api/workflows/run] could not read the request body", err);
    return problem(400, "UNSUPPORTED_INPUT", "The upload could not be read. Please try again.");
  }

  const userId = await currentUserId();

  // ---- which chain -----------------------------------------------------------------------
  let steps: WorkflowStep[];
  let name = typeof form.get("name") === "string" ? (form.get("name") as string) : "Workflow";
  let workflowId: string | null = null;

  const rawSteps = form.get("steps");
  if (typeof rawSteps === "string" && rawSteps.trim() !== "") {
    try {
      steps = parseSteps(JSON.parse(rawSteps));
    } catch {
      return problem(400, "UNSUPPORTED_INPUT", "The workflow steps could not be read.");
    }
  } else {
    const saved = form.get("workflowId");
    if (typeof saved !== "string" || saved.trim() === "") {
      return problem(400, "UNSUPPORTED_INPUT", "No workflow was specified.");
    }
    const prisma = getPrisma();
    if (!prisma || !userId) {
      return problem(401, "AUTH_REQUIRED", "Sign in to run a workflow saved to your account.");
    }
    const workflow = await getWorkflow(userId, saved, prisma);
    if (!workflow) return problem(404, "NOT_FOUND", "That workflow does not exist.");
    steps = workflow.steps;
    name = workflow.name;
    workflowId = workflow.id;
  }

  const validation = validateWorkflow(steps);
  if (!validation.valid) {
    return problem(422, "UNSUPPORTED_INPUT", describeIssues(validation.issues));
  }

  // ---- the files -------------------------------------------------------------------------
  const uploads = form.getAll("files").filter((v): v is File => v instanceof File);
  if (uploads.length === 0) {
    return problem(400, "UNSUPPORTED_INPUT", "Choose at least one file to run this workflow on.");
  }
  if (uploads.length > config.maxFilesPerRequest) {
    return problem(
      413,
      "UNSUPPORTED_INPUT",
      `Choose at most ${config.maxFilesPerRequest} files at a time.`,
    );
  }

  let total = 0;
  const files: PipelineFileInput[] = [];
  for (const upload of uploads) {
    if (upload.size > config.maxUploadBytes) {
      return problem(413, "UNSUPPORTED_INPUT", ERROR_MESSAGES.tooLarge);
    }
    total += upload.size;
    if (total > config.maxRequestBytes) {
      return problem(413, "UNSUPPORTED_INPUT", ERROR_MESSAGES.tooLarge);
    }
    files.push({
      name: upload.name,
      mimeType: upload.type,
      bytes: new Uint8Array(await upload.arrayBuffer()),
    });
  }

  // ---- run -------------------------------------------------------------------------------
  const rawToken = form.get("progressToken");
  const progressToken = typeof rawToken === "string" && rawToken.trim() !== "" ? rawToken : null;
  const batch = form.get("mode") === "batch";
  try {
    if (batch) {
      const concurrency = Number(form.get("concurrency"));
      const result = await runBatch({
        steps,
        files,
        workflowId,
        name,
        userId,
        ...(Number.isFinite(concurrency) ? { concurrency } : {}),
      }, {
        onFileProgress: (p) => {
          const done = p.status !== "running";
          const percent = ((p.fileIndex + (done ? 1 : 0)) / p.fileCount) * 100;
          const verb = p.status === "running" ? "Processing" : p.status === "success" ? "Finished" : "Failed";
          setProgress(progressToken, percent, `${verb} ${p.name} (${p.fileIndex + 1}/${p.fileCount})`);
        },
      });
      endProgress(progressToken, result.failed === 0);
      if (workflowId && userId && result.succeeded > 0) await noteUse(userId, workflowId);
      return NextResponse.json(
        { ok: result.failed === 0, mode: "batch", batch: result },
        { status: 200, headers: { "cache-control": "no-store" } },
      );
    }
    const result = await runWorkflow({ steps, files, workflowId, name, userId }, {
      onProgress: (p) => {
        const done = p.status !== "running";
        const percent = ((p.stepIndex + (done ? 1 : 0)) / p.stepCount) * 100;
        const verb = p.status === "running" ? "Running" : p.status === "success" ? "Finished" : "Failed";
        setProgress(progressToken, percent, `${verb} step ${p.stepIndex + 1}/${p.stepCount}: ${p.toolName}`);
      },
    });
    endProgress(progressToken, result.ok);
    if (workflowId && userId && result.ok) await noteUse(userId, workflowId);
    return NextResponse.json(
      { ok: result.ok, mode: "chain", run: result },
      { status: result.ok ? 200 : 422, headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    console.error("[api/workflows/run] unexpected failure", err);
    endProgress(progressToken, false);
    return problem(500, "FAILED", "Something went wrong. Please try again.");
  }
}
