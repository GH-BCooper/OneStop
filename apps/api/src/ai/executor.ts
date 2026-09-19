// Steps five to eight of master plan §7.2: execute the tool(s), validate the outputs, show
// progress, return the result (16-ai-assistant.md).
//
// This module runs *nothing itself*. It re-validates the plan and hands it to phase 15's
// `runWorkflow`, which runs every step through phase 04's pipeline. That is the whole security
// story of the assistant in one sentence: the AI's plan is an ordinary workflow, subject to the
// same registry check, the same upload validation, the same size limits, the same job records and
// the same temp-file retention as a tool a human clicked. There is no other path, and in
// particular there is no shell: the assistant cannot express "run a command", only "run tool X".
import { describeIssues, getTool, validateWorkflow, type ToolMeta } from "@onestop/tool-registry";
import type {
  ExecutionPlan,
  ExecutionStep,
  WorkflowProgress,
  WorkflowRunResult,
  WorkflowStep,
} from "@onestop/types";
import type { PipelineFileInput } from "../file-processing/pipeline.ts";
import { runWorkflow, type WorkflowRunDeps } from "../workflows/run.ts";

export class PlanRejectedError extends Error {
  readonly code = "UNSUPPORTED_INPUT";
  constructor(
    message: string,
    readonly rejected: { toolId: string; reason: string }[] = [],
  ) {
    super(message);
    this.name = "PlanRejectedError";
  }
}

/**
 * The allow-list gate, applied immediately before anything runs.
 *
 * The planner already checked its own answer, but this runs again on whatever actually reaches
 * the executor — including a plan that arrived over HTTP from the browser. A step naming a tool
 * the registry does not have is rejected here, loudly, and nothing at all is executed.
 */
export function assertPlanIsRunnable(plan: ExecutionPlan): ToolMeta[] {
  if (!plan || !Array.isArray(plan.steps) || plan.steps.length === 0) {
    throw new PlanRejectedError("There is nothing to run.");
  }
  const rejected: { toolId: string; reason: string }[] = [];
  const resolved: ToolMeta[] = [];
  for (const step of plan.steps) {
    const toolId = typeof step?.toolId === "string" ? step.toolId.trim() : "";
    const tool = toolId === "" ? undefined : getTool(toolId);
    if (!tool) {
      rejected.push({
        toolId: toolId || "(empty)",
        reason: "There is no such tool in the OneStop registry.",
      });
      continue;
    }
    if (tool.status !== "available") {
      rejected.push({ toolId: tool.id, reason: `${tool.name} is not ready to run yet.` });
      continue;
    }
    resolved.push(tool);
  }
  if (rejected.length > 0) {
    const names = rejected.map((r) => `"${r.toolId}"`).join(", ");
    console.error(
      `[ai/executor] refused to run a plan naming ${rejected.length} unknown or unavailable tool(s): ${names}`,
    );
    throw new PlanRejectedError(
      `The plan referred to ${names}, which ${rejected.length === 1 ? "is not a OneStop tool" : "are not OneStop tools"}. Nothing was run.`,
      rejected,
    );
  }
  const validation = validateWorkflow(toWorkflowSteps(plan.steps));
  if (!validation.valid) throw new PlanRejectedError(describeIssues(validation.issues));
  return resolved;
}

export function toWorkflowSteps(steps: ExecutionStep[]): WorkflowStep[] {
  return steps.map((step) => ({ toolId: step.toolId, options: step.options ?? {} }));
}

export interface ExecutePlanInput {
  plan: ExecutionPlan;
  files: PipelineFileInput[];
  userId?: string | null;
  name?: string;
}

export interface ExecutePlanResult {
  run: WorkflowRunResult;
  /** Output validation: every step that succeeded produced at least one usable file. */
  outputsValid: boolean;
  note: string | null;
}

/**
 * Runs a validated plan. Never throws for anything the user can cause: a failed step comes back
 * inside `run` with the step's own message, exactly as the Workflows page shows it.
 */
export async function executePlan(
  input: ExecutePlanInput,
  deps: WorkflowRunDeps & { onProgress?: (p: WorkflowProgress) => void } = {},
): Promise<ExecutePlanResult> {
  assertPlanIsRunnable(input.plan);
  const run = await runWorkflow(
    {
      steps: toWorkflowSteps(input.plan.steps),
      files: input.files,
      name: input.name ?? "AI Assistant",
      userId: input.userId ?? null,
    },
    deps,
  );

  // Output validation (§7.2's "validate outputs"): a chain that reports success but produced
  // nothing to hand back is a failure the user should hear about, not a silent empty result.
  const producedNothing = run.ok && run.files.length === 0;
  const lastTool = getTool(input.plan.steps[input.plan.steps.length - 1]?.toolId ?? "");
  const lastMakesFiles = (lastTool?.outputTypes.length ?? 0) > 0;
  const outputsValid = !producedNothing || !lastMakesFiles;

  return {
    run,
    outputsValid,
    note: outputsValid
      ? null
      : `${lastTool?.name ?? "The last step"} finished but produced no file. Check the options and try again.`,
  };
}
