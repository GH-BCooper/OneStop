// POST /api/tools/run — the one entry point into the file-processing pipeline (04-file-core.md).
//
// Accepts multipart/form-data:
//   toolId   (required) a registry id
//   files    (repeatable) the uploaded files
//   text     (optional)   text/URL input for non-file tools
//   options  (optional)   JSON object of tool options
//
// Validation happens server-side; the client's checks are only there to fail fast and politely.
import {
  consumeRate,
  loadFileCoreConfig,
  RUN_RATE_LIMIT,
  runPipeline,
  UnknownToolError,
} from "@onestop/api";
import { ERROR_MESSAGES } from "@onestop/types";
import { NextResponse } from "next/server";
import { currentUserId } from "@/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TEXT_LENGTH = 1_000_000;

/**
 * The caller's address, as far as the deployment can tell (17-online-media-network-tools.md).
 * Behind a proxy that is the first entry of `x-forwarded-for`; locally there is no header at all
 * and the answer is null. Tools treat it as untrusted input - it is reported, never trusted.
 */
function clientIpOf(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || request.headers.get("x-real-ip") || null;
}

function problem(status: number, code: string, message: string) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status });
}

export async function POST(request: Request): Promise<Response> {
  const config = loadFileCoreConfig();

  // Per-caller rate limit (phase 20). Phases 04, 12, 13 and 16 each logged that this endpoint had
  // none; a personal instance never notices the limit, and an exposed one cannot be used as free
  // compute. It is counted before the body is read, so a flood costs no disk.
  const caller = clientIpOf(request) ?? "local";
  const waitSeconds = consumeRate(`tools-run:${caller}`, RUN_RATE_LIMIT);
  if (waitSeconds !== null) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "FAILED",
          message: `Too many runs in a row. Wait ${waitSeconds} seconds and try again.`,
        },
      },
      { status: 429, headers: { "retry-after": String(waitSeconds) } },
    );
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > config.maxRequestBytes) {
    return problem(413, "UNSUPPORTED_INPUT", ERROR_MESSAGES.tooLarge);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch (err) {
    console.error("[api/tools/run] could not read the request body", err);
    return problem(400, "UNSUPPORTED_INPUT", "The upload could not be read. Please try again.");
  }

  const toolId = form.get("toolId");
  if (typeof toolId !== "string" || toolId.trim() === "") {
    return problem(400, "UNSUPPORTED_INPUT", "No tool was specified.");
  }
  const rawToken = form.get("progressToken");
  const progressToken = typeof rawToken === "string" && rawToken.trim() !== "" ? rawToken : null;

  const rawText = form.get("text");
  const text = typeof rawText === "string" ? rawText : null;
  if (text !== null && text.length > MAX_TEXT_LENGTH) {
    return problem(413, "UNSUPPORTED_INPUT", ERROR_MESSAGES.tooLarge);
  }

  let options: Record<string, unknown> = {};
  const rawOptions = form.get("options");
  if (typeof rawOptions === "string" && rawOptions.trim() !== "") {
    try {
      const parsed: unknown = JSON.parse(rawOptions);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return problem(400, "UNSUPPORTED_INPUT", "The tool options could not be read.");
      }
      options = parsed as Record<string, unknown>;
    } catch {
      return problem(400, "UNSUPPORTED_INPUT", "The tool options could not be read.");
    }
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
  const files = [];
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

  try {
    // Signed in: the job (and anything a tool stores) is attributed to the user. Guest: null,
    // and every public tool still runs - auth is never required to use one (master plan 9).
    const userId = await currentUserId();
    const outcome = await runPipeline(
      { toolId, userId, files, text, options, clientIp: clientIpOf(request), progressToken },
      { config },
    );
    return NextResponse.json(
      {
        ok: outcome.ok,
        job: outcome.job,
        output: outcome.output ?? null,
        summary: outcome.summary ?? null,
        files: outcome.files,
        error: outcome.error ?? null,
      },
      { status: outcome.ok ? 200 : 422, headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    if (err instanceof UnknownToolError) {
      return problem(404, "UNSUPPORTED_INPUT", "That tool does not exist.");
    }
    console.error("[api/tools/run] unexpected failure", err);
    return problem(500, "FAILED", "Something went wrong. Please try again.");
  }
}
