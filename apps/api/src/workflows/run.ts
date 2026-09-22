// The workflow run engine (15-workflows.md; master plan §14: "repeat the same pipeline per step
// and pass validated output to the next step").
//
// It deliberately owns no processing of its own. Every step is an ordinary `runPipeline` call, so
// a workflow step is validated, job-tracked, timed out, size-checked and history-logged exactly
// like the same tool run from its own page. What this module adds is only the wiring between
// steps: read the previous step's stored output back, hand it on, and report progress.
import { randomUUID } from "node:crypto";
import { acceptsFileName, getTool, type ToolMeta } from "@onestop/tool-registry";
import type {
  OutputFileRef,
  WorkflowProgress,
  WorkflowRunResult,
  WorkflowStep,
  WorkflowStepRun,
} from "@onestop/types";
import {
  runPipeline,
  type PipelineDeps,
  type PipelineFileInput,
  type PipelineOutcome,
} from "../file-processing/pipeline.ts";
import { getTempStore, type TempStore } from "../file-processing/tempStore.ts";
import { describeIssues, validateWorkflow } from "./validate.ts";

export interface WorkflowRunInput {
  steps: WorkflowStep[];
  /** The files the first step runs on. */
  files: PipelineFileInput[];
  workflowId?: string | null;
  name?: string;
  userId?: string | null;
}

export interface WorkflowRunDeps extends PipelineDeps {
  onProgress?: (progress: WorkflowProgress) => void;
  /** Injected by the tests so a chain can be exercised without real executors. */
  runStep?: typeof runPipeline;
}

function stepRun(
  index: number,
  tool: Pick<ToolMeta, "id" | "name"> | undefined,
  toolId: string,
  patch: Partial<WorkflowStepRun> = {},
): WorkflowStepRun {
  return {
    index,
    toolId,
    toolName: tool?.name ?? toolId,
    status: "skipped",
    jobId: null,
    summary: null,
    files: [],
    error: null,
    durationMs: 0,
    ...patch,
  };
}

/**
 * Which of the previous step's outputs this tool should be given. A step that produced more than
 * one kind of file (OCR PDF emits a searchable PDF *and* a text file) hands on only what the next
 * tool can actually read — the chain was already proved compatible at build time.
 */
export function selectInputs(
  tool: Pick<ToolMeta, "inputTypes">,
  files: PipelineFileInput[],
): PipelineFileInput[] {
  const usable = files.filter((f) => acceptsFileName(tool, f.name));
  return usable.length > 0 ? usable : files;
}

/**
 * How many pipeline calls one step needs. A tool that takes files one at a time still works in a
 * chain: it simply runs once per file and the outputs are concatenated.
 */
function groupsFor(tool: ToolMeta, files: PipelineFileInput[]): PipelineFileInput[][] {
  if (tool.supportsBatch || files.length <= 1) return [files];
  return files.map((file) => [file]);
}

/** Reads a stored output back so the next step can be given its bytes. */
async function reload(temp: TempStore, files: OutputFileRef[]): Promise<PipelineFileInput[]> {
  const loaded: PipelineFileInput[] = [];
  for (const file of files) {
    loaded.push({ name: file.name, mimeType: file.mimeType, bytes: await temp.read(file.id) });
  }
  return loaded;
}

/**
 * Runs one chain over one set of input files.
 *
 * Never throws for anything a user can cause: a failed step comes back as `ok: false` with the
 * step's own message, the steps after it marked "skipped", and the steps before it still listed
 * with their results so the user can see how far the run got.
 */
export async function runWorkflow(
  input: WorkflowRunInput,
  deps: WorkflowRunDeps = {},
): Promise<WorkflowRunResult> {
  const startedAt = Date.now();
  // `temp` stays in `pipelineDeps`: the engine and every step it runs have to share one store,
  // or a step's output cannot be read back for the step after it.
  const { onProgress, runStep = runPipeline, ...pipelineDeps } = deps;
  const temp = deps.temp ?? getTempStore();
  const steps = input.steps;
  const name = input.name ?? "Workflow";
  const base = {
    workflowId: input.workflowId ?? null,
    name,
  };
  // Only multi-step chains need grouping in history — a one-step "workflow" is indistinguishable
  // from running that tool directly, so it is logged exactly the same way.
  const runId = steps.length > 1 ? randomUUID() : null;

  const validation = validateWorkflow(steps);
  if (!validation.valid) {
    return {
      ...base,
      ok: false,
      steps: steps.map((s, i) => stepRun(i, getTool(s.toolId), s.toolId)),
      files: [],
      error: describeIssues(validation.issues),
      durationMs: Date.now() - startedAt,
    };
  }
  if (input.files.length === 0) {
    return {
      ...base,
      ok: false,
      steps: steps.map((s, i) => stepRun(i, getTool(s.toolId), s.toolId)),
      files: [],
      error: "Choose at least one file to run this workflow on.",
      durationMs: Date.now() - startedAt,
    };
  }

  const records: WorkflowStepRun[] = steps.map((s, i) => stepRun(i, getTool(s.toolId), s.toolId));
  let carried: PipelineFileInput[] = input.files;
  let lastFiles: OutputFileRef[] = [];
  let failure: string | null = null;

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index]!;
    const tool = getTool(step.toolId)!;
    const stepStartedAt = Date.now();
    onProgress?.({
      stepIndex: index,
      stepCount: steps.length,
      toolId: tool.id,
      toolName: tool.name,
      status: "running",
    });

    // The first step gets exactly what the user chose; later steps get whatever of the previous
    // step's output this tool can read.
    const inputs = index === 0 ? carried : selectInputs(tool, carried);
    const outcomes: PipelineOutcome[] = [];
    let stepError: string | null = null;

    for (const group of groupsFor(tool, inputs)) {
      const outcome = await runStep(
        {
          toolId: tool.id,
          userId: input.userId ?? null,
          files: group,
          options: step.options ?? {},
          ...(runId
            ? { workflow: { runId, name, stepIndex: index, stepCount: steps.length } }
            : {}),
        },
        pipelineDeps,
      );
      outcomes.push(outcome);
      if (!outcome.ok) {
        stepError = outcome.error?.message ?? "This step could not be completed.";
        break;
      }
    }

    const produced = outcomes.flatMap((o) => o.files);
    const lastOutcome = outcomes[outcomes.length - 1];
    const summary = outcomes.map((o) => o.summary).filter((s): s is string => Boolean(s));

    records[index] = stepRun(index, tool, tool.id, {
      status: stepError ? "failed" : "success",
      jobId: lastOutcome?.job.id ?? null,
      summary: summary.length > 0 ? summary.join(" · ") : null,
      files: produced,
      error: stepError,
      durationMs: Date.now() - stepStartedAt,
    });

    onProgress?.({
      stepIndex: index,
      stepCount: steps.length,
      toolId: tool.id,
      toolName: tool.name,
      status: stepError ? "failed" : "success",
    });

    if (stepError) {
      failure = `${tool.name}: ${stepError}`;
      break;
    }

    lastFiles = produced;
    if (index < steps.length - 1) {
      if (produced.length === 0) {
        records[index] = { ...records[index]!, status: "failed", error: "It produced no file." };
        failure = `${tool.name} produced no file, so the next step had nothing to work on.`;
        break;
      }
      try {
        carried = await reload(temp, produced);
      } catch (err) {
        console.error(`[workflow] could not re-read step ${index + 1} output`, err);
        records[index] = {
          ...records[index]!,
          status: "failed",
          error: "Its result expired before the next step could read it.",
        };
        failure = `${tool.name}: its result expired before the next step could read it.`;
        break;
      }
    }
  }

  return {
    ...base,
    ok: failure === null,
    steps: records,
    files: failure === null ? lastFiles : [],
    error: failure,
    durationMs: Date.now() - startedAt,
  };
}
