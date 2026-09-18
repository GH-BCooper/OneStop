// The file-processing pipeline (04-file-core.md; master plan §14).
//
//   select / upload -> validate -> create job -> detect execution mode -> process
//   -> validate output -> result -> optional download -> delete temporary data
//
// Every file tool in phases 05-17 runs through this one function. It owns the filesystem and the
// job lifecycle; executors only ever see bytes in and bytes out.
import {
  getExecutor,
  getTool,
  acceptsTypedText,
  inputKind,
  type ToolMeta,
  fileInputTypes,
  redactOptionValues,
} from "@onestop/tool-registry";
import {
  ERROR_MESSAGES,
  type ExecContext,
  type ExecErrorCode,
  type ExecResult,
  type FileRef,
  type Job,
  type OutputFileRef,
} from "@onestop/types";
import { loadFileCoreConfig, type FileCoreConfig } from "./config.ts";
import { getJobStore, type JobStore } from "./job.ts";
import { getTempStore, type TempFile, type TempStore } from "./tempStore.ts";
import { sanitizeFileName, validateOutputFile, validateUpload } from "./validate.ts";

/** Where a download is served from. Kept here so the client never builds the URL itself. */
export const FILE_DOWNLOAD_PATH = "/api/files";

export const DEFAULT_EXECUTION_TIMEOUT_MS = 120_000;

export interface PipelineFileInput {
  name: string;
  mimeType?: string;
  bytes: Uint8Array;
}

export interface RunPipelineInput {
  toolId: string;
  userId?: string | null;
  files?: PipelineFileInput[];
  text?: string | null;
  options?: Record<string, unknown>;
}

export interface PipelineOutcome {
  job: Job;
  ok: boolean;
  output?: unknown;
  summary?: string;
  files: OutputFileRef[];
  error?: { code: ExecErrorCode; message: string };
}

export interface PipelineDeps {
  jobs?: JobStore;
  temp?: TempStore;
  config?: FileCoreConfig;
  timeoutMs?: number;
  /** Reported online state of the server, for the remote-execution check. */
  online?: boolean;
}

export class UnknownToolError extends Error {
  constructor(readonly toolId: string) {
    super(`No tool is registered with the id "${toolId}".`);
    this.name = "UnknownToolError";
  }
}

/**
 * Which side processes the job. Phase 04 reads it straight off the registry; phases 16/17 can
 * refine it (e.g. "local unless the user picked a hosted AI provider").
 */
export function detectExecutionMode(tool: Pick<ToolMeta, "execution">): "local" | "remote" {
  return tool.execution;
}

function fail(code: ExecErrorCode, message: string): { code: ExecErrorCode; message: string } {
  return { code, message };
}

/** Input checks that don't depend on file bytes. Returns null when the input is usable. */
function checkShape(
  tool: ToolMeta,
  input: RunPipelineInput,
): { code: ExecErrorCode; message: string } | null {
  const kind = inputKind(tool);
  const files = input.files ?? [];
  const text = (input.text ?? "").trim();

  if (kind === "file") {
    if (files.length === 0 && acceptsTypedText(tool) && text !== "") return null;
    if (files.length === 0) {
      return fail(
        "UNSUPPORTED_INPUT",
        acceptsTypedText(tool) ? "Choose a file or enter some text first." : "Choose a file first.",
      );
    }
    if (!tool.supportsBatch && files.length > 1) {
      return fail("UNSUPPORTED_INPUT", "This tool takes one file at a time.");
    }
    return null;
  }
  if (files.length > 0 && fileInputTypes(tool).length === 0) {
    return fail("UNSUPPORTED_INPUT", ERROR_MESSAGES.unsupportedType);
  }
  if (kind === "url") {
    if (text === "") return fail("UNSUPPORTED_INPUT", "Enter a link first.");
    if (!/^https?:\/\/[^\s/$.?#][^\s]*$/i.test(text)) {
      return fail("UNSUPPORTED_INPUT", "Enter a full link starting with http:// or https://.");
    }
    return null;
  }
  if (kind === "text" && text === "") return fail("UNSUPPORTED_INPUT", "Enter some text first.");
  return null;
}

async function runExecutorWithTimeout(
  tool: ToolMeta,
  payload: FileRef[] | string | null,
  options: Record<string, unknown>,
  ctx: ExecContext,
  timeoutMs: number,
): Promise<ExecResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  const execute = getExecutor(tool);
  try {
    return await Promise.race<ExecResult>([
      execute(payload, options, { ...ctx, signal: controller.signal }),
      new Promise<ExecResult>((_, reject) => {
        controller.signal.addEventListener("abort", () => {
          reject(new Error(`Executor for "${tool.id}" exceeded ${timeoutMs}ms.`));
        });
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs one tool end to end. Never throws for user-caused problems — those come back as a failed
 * job plus an actionable message. It throws only for programming errors (unknown tool id).
 */
export async function runPipeline(
  input: RunPipelineInput,
  deps: PipelineDeps = {},
): Promise<PipelineOutcome> {
  const tool = getTool(input.toolId);
  if (!tool) throw new UnknownToolError(input.toolId);

  const config = deps.config ?? loadFileCoreConfig();
  const jobs = deps.jobs ?? getJobStore();
  const temp = deps.temp ?? getTempStore();
  const timeoutMs = deps.timeoutMs ?? DEFAULT_EXECUTION_TIMEOUT_MS;
  const inputFiles = input.files ?? [];
  const options = input.options ?? {};
  const mode = detectExecutionMode(tool);

  // ---- create job ---------------------------------------------------------------------------
  const job = await jobs.create({
    toolId: tool.id,
    userId: input.userId ?? null,
    inputMetadata: {
      execution: mode,
      fileCount: inputFiles.length,
      files: inputFiles.map((f) => ({
        name: sanitizeFileName(f.name),
        size: f.bytes.length,
        type: f.mimeType ?? "",
      })),
      ...(input.text ? { textLength: input.text.length } : {}),
      // Passwords and drawn signatures are passed to the tool but never stored on the job.
      ...(Object.keys(options).length > 0 ? { options: redactOptionValues(tool.id, options) } : {}),
    },
  });

  const stored: TempFile[] = [];
  const cleanupInputs = async () => {
    for (const file of stored) await temp.delete(file.id);
  };

  const failJob = async (
    code: ExecErrorCode,
    message: string,
    detail?: Record<string, unknown>,
  ): Promise<PipelineOutcome> => {
    const failed = await jobs.update(job.id, {
      status: "failed",
      outputMetadata: { code, message, ...detail },
    });
    return { job: failed, ok: false, files: [], error: { code, message } };
  };

  try {
    // ---- validate -------------------------------------------------------------------------
    await jobs.update(job.id, { status: "validating" });

    if (tool.requiresAuth && !input.userId) {
      return await failJob("AUTH_REQUIRED", `Sign in to use ${tool.name}.`);
    }

    const shapeProblem = checkShape(tool, input);
    if (shapeProblem) return await failJob(shapeProblem.code, shapeProblem.message);

    if (inputFiles.length > config.maxFilesPerRequest) {
      return await failJob(
        "UNSUPPORTED_INPUT",
        `Choose at most ${config.maxFilesPerRequest} files at a time.`,
      );
    }

    for (const file of inputFiles) {
      const result = validateUpload(
        { name: file.name, size: file.bytes.length, type: file.mimeType, head: file.bytes },
        { tool, maxBytes: config.maxUploadBytes },
      );
      if (!result.valid) {
        return await failJob("UNSUPPORTED_INPUT", result.reason ?? ERROR_MESSAGES.unsupportedType, {
          rejectedFile: sanitizeFileName(file.name),
        });
      }
    }

    // ---- store validated inputs -------------------------------------------------------------
    const refs: FileRef[] = [];
    for (const file of inputFiles) {
      const record = await temp.put({
        name: file.name,
        bytes: file.bytes,
        ...(file.mimeType ? { mimeType: file.mimeType } : {}),
        kind: "input",
        jobId: job.id,
      });
      stored.push(record);
      refs.push({
        name: record.name,
        size: record.size,
        type: record.mimeType,
        lastModified: record.createdAt,
        tempId: record.id,
      });
    }

    // ---- detect execution mode --------------------------------------------------------------
    if (mode === "remote" && deps.online === false) {
      return await failJob("OFFLINE", ERROR_MESSAGES.offline);
    }

    // ---- process ----------------------------------------------------------------------------
    await jobs.update(job.id, { status: "processing" });
    const payload: FileRef[] | string | null = refs.length > 0 ? refs : (input.text ?? null);

    const ctx: ExecContext = {
      jobId: job.id,
      readFile: async (file) => {
        if (!file.tempId) throw new Error("This file has no temp handle.");
        if (!stored.some((s) => s.id === file.tempId)) {
          throw new Error("A tool may only read files from its own job.");
        }
        return temp.read(file.tempId);
      },
    };

    let result: ExecResult;
    try {
      result = await runExecutorWithTimeout(tool, payload, options, ctx, timeoutMs);
    } catch (err) {
      console.error(`[pipeline] ${tool.id} threw`, err);
      return await failJob("FAILED", "The tool stopped unexpectedly. Please try again.");
    }

    if (!result.ok) return await failJob(result.code, result.message);

    // ---- validate output --------------------------------------------------------------------
    const outputs: OutputFileRef[] = [];
    for (const file of result.files ?? []) {
      const check = validateOutputFile(file, config.maxUploadBytes);
      if (!check.valid) {
        console.error(`[pipeline] ${tool.id} produced an invalid output file: ${check.reason}`);
        return await failJob("FAILED", "The result could not be prepared. Please try again.");
      }
      const record = await temp.put({
        name: file.name,
        bytes: file.bytes,
        mimeType: file.mimeType,
        kind: "output",
        jobId: job.id,
      });
      outputs.push({
        id: record.id,
        name: record.name,
        mimeType: record.mimeType,
        size: record.size,
        url: `${FILE_DOWNLOAD_PATH}/${record.id}`,
        expiresAt: new Date(record.expiresAt).toISOString(),
      });
    }

    // ---- result -----------------------------------------------------------------------------
    const finished = await jobs.update(job.id, {
      status: "success",
      outputMetadata: {
        execution: mode,
        summary: result.summary ?? null,
        files: outputs.map(({ id, name, mimeType, size, expiresAt }) => ({
          id,
          name,
          mimeType,
          size,
          expiresAt,
        })),
      },
    });

    return {
      job: finished,
      ok: true,
      output: result.output,
      ...(result.summary === undefined ? {} : { summary: result.summary }),
      files: outputs,
    };
  } catch (err) {
    console.error(`[pipeline] unexpected failure for job ${job.id}`, err);
    return await failJob("FAILED", "Something went wrong. Please try again.");
  } finally {
    // ---- delete temporary data --------------------------------------------------------------
    // Inputs go immediately, success or failure. Outputs stay until they are downloaded or the
    // retention window closes, whichever comes first.
    await cleanupInputs();
  }
}
