// POST /api/assistant/run — run a plan the user has seen and approved (16-ai-assistant.md).
//
// The plan arrives as JSON in a multipart form beside the files. It is *re-validated here*, not
// trusted: `assertPlanIsRunnable` checks every tool id against the registry and puts the whole
// chain through `validateWorkflow` before anything executes. A plan naming a tool that does not
// exist is refused with a 422 that names it — the "allow-list" acceptance criterion, enforced at
// the last possible moment rather than only where the plan was built.
//
// Execution itself is phase 15's `runWorkflow` over phase 04's pipeline, so uploads are validated
// and sanitised, jobs are recorded and temp files expire exactly as they do everywhere else.
import {
  PlanRejectedError,
  executePlan,
  isAiProviderId,
  loadFileCoreConfig,
  type PipelineFileInput,
} from "@onestop/api";
import { ERROR_MESSAGES, type ExecutionPlan } from "@onestop/types";
import { NextResponse } from "next/server";
import { currentUserId } from "@/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function problem(
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
) {
  return NextResponse.json(
    { ok: false, error: { code, message }, ...extra },
    { status, headers: { "cache-control": "no-store" } },
  );
}

/** Keeps only `{ toolId, options }` with primitive option values — the shape the planner emits. */
function readPlan(raw: unknown): ExecutionPlan | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const body = parsed as { steps?: unknown; explanation?: unknown };
  if (!Array.isArray(body.steps)) return null;
  const steps = body.steps
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
      const step = entry as { toolId?: unknown; options?: unknown };
      if (typeof step.toolId !== "string" || step.toolId.trim() === "") return null;
      const options: Record<string, unknown> = {};
      if (step.options && typeof step.options === "object" && !Array.isArray(step.options)) {
        for (const [key, value] of Object.entries(step.options as Record<string, unknown>)) {
          if (
            typeof value === "string" ||
            typeof value === "number" ||
            typeof value === "boolean"
          ) {
            options[key] = value;
          }
        }
      }
      return { toolId: step.toolId.trim(), options };
    })
    .filter((s): s is { toolId: string; options: Record<string, unknown> } => s !== null);
  if (steps.length === 0) return null;
  return {
    steps,
    explanation: typeof body.explanation === "string" ? body.explanation.slice(0, 2000) : "",
  };
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
    console.error("[api/assistant/run] could not read the request body", err);
    return problem(400, "UNSUPPORTED_INPUT", "The upload could not be read. Please try again.");
  }

  const plan = readPlan(form.get("plan"));
  if (!plan) return problem(400, "UNSUPPORTED_INPUT", "The plan could not be read.");

  // The runtime choice rides along so a planned step that is itself an AI tool (a summary, a
  // question about a file) uses the same runtime the user picked in Settings.
  const provider = form.get("provider");
  const apiKey = request.headers.get("x-onestop-ai-key");
  const credentials = {
    ...(isAiProviderId(provider) ? { aiProvider: provider } : {}),
    ...(apiKey && apiKey.trim() !== "" ? { aiKey: apiKey } : {}),
  };
  if (Object.keys(credentials).length > 0) {
    plan.steps = plan.steps.map((step) => ({
      ...step,
      options: { ...credentials, ...step.options },
    }));
  }

  const uploads = form.getAll("files").filter((v): v is File => v instanceof File);
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
  if (files.length === 0) {
    return problem(400, "UNSUPPORTED_INPUT", "Attach the files the assistant should work on.");
  }

  const userId = await currentUserId();
  try {
    const result = await executePlan({ plan, files, userId, name: "AI Assistant" });
    return NextResponse.json(
      {
        ok: result.run.ok && result.outputsValid,
        run: result.run,
        note: result.note,
      },
      {
        status: result.run.ok && result.outputsValid ? 200 : 422,
        headers: { "cache-control": "no-store" },
      },
    );
  } catch (err) {
    if (err instanceof PlanRejectedError) {
      return problem(422, "UNSUPPORTED_INPUT", err.message, { rejected: err.rejected });
    }
    console.error("[api/assistant/run] unexpected failure", err);
    return problem(500, "FAILED", "Something went wrong. Please try again.");
  }
}
