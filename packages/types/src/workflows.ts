// Workflow contracts (15-workflows.md; master plan §8 and §16).
//
// A workflow is a straight, ordered chain of registry tools: no branching, no conditions. Each
// step's output files are handed to the next step, so the only thing the model has to describe is
// "which tool, with which options, in which order".
import type { OutputFileRef } from "./index";

/** One link in the chain: a registry tool id plus the options it should run with. */
export interface WorkflowStep {
  toolId: string;
  /** Option values, keyed by the option ids the registry declares for that tool. */
  options?: Record<string, unknown>;
}

/** A saved workflow, as stored on the `workflows` table (master plan §16). */
export interface Workflow {
  id: string;
  /** null for a workflow kept on this device only (a guest, or a local draft). */
  userId: string | null;
  name: string;
  description: string | null;
  steps: WorkflowStep[];
  createdAt: string;
  updatedAt: string;
  /** Where it lives: the account (synced) or this device only. Mirrors `HistoryEntry.scope`. */
  scope: "account" | "device";
  /** Starred by the user. */
  favorite: boolean;
  /** How many times it has been run successfully. */
  useCount: number;
  /** When it was last run successfully, or null if it never has been. */
  lastUsedAt: string | null;
}

/** What the create/update endpoints accept. */
export interface WorkflowInput {
  name: string;
  description?: string | null;
  steps: WorkflowStep[];
}

export type WorkflowIssueCode =
  | "NO_STEPS"
  | "TOO_MANY_STEPS"
  | "UNKNOWN_TOOL"
  | "TOOL_UNAVAILABLE"
  | "INCOMPATIBLE_STEP"
  | "NO_FILE_OUTPUT"
  | "INVALID_NAME"
  | "INVALID_OPTION";

/** One reason a chain was rejected. `stepIndex` is null when it is about the workflow itself. */
export interface WorkflowIssue {
  code: WorkflowIssueCode;
  /** Zero-based index of the offending step, or null for a whole-workflow problem. */
  stepIndex: number | null;
  /** Short and actionable — this is shown in the builder as-is (CLAUDE.md §7). */
  message: string;
}

export interface WorkflowValidation {
  valid: boolean;
  issues: WorkflowIssue[];
  /** File types the first step accepts, for the run form's file picker. */
  inputTypes: string[];
  /** File types the last step produces. */
  outputTypes: string[];
  /** True when any step needs a signed-in user. */
  requiresAuth: boolean;
  /** True when every step can run without the internet. */
  offline: boolean;
}

export type WorkflowStepStatus = "success" | "failed" | "skipped";

/** What one step did during a run. */
export interface WorkflowStepRun {
  index: number;
  toolId: string;
  toolName: string;
  status: WorkflowStepStatus;
  jobId: string | null;
  summary: string | null;
  /** Files this step produced, as handed to the next step. */
  files: OutputFileRef[];
  error: string | null;
  durationMs: number;
}

export interface WorkflowRunResult {
  ok: boolean;
  workflowId: string | null;
  name: string;
  steps: WorkflowStepRun[];
  /** The last successful step's files: the result of the workflow. */
  files: OutputFileRef[];
  error: string | null;
  durationMs: number;
}

/** Progress as a run moves through the chain, for the UI's per-step indicator. */
export interface WorkflowProgress {
  stepIndex: number;
  stepCount: number;
  toolId: string;
  toolName: string;
  status: "running" | "success" | "failed";
}

/** One input file's outcome in a batch. A failure here never stops the other files. */
export interface BatchFileResult {
  /** The input file's (sanitised) name. */
  name: string;
  ok: boolean;
  files: OutputFileRef[];
  /** Per-step detail, so a failure can be traced to the step that caused it. */
  steps: WorkflowStepRun[];
  error: string | null;
  durationMs: number;
}

export interface BatchRunResult {
  total: number;
  succeeded: number;
  failed: number;
  results: BatchFileResult[];
  durationMs: number;
}

/** Progress as a batch works through its files. */
export interface BatchProgress {
  fileIndex: number;
  fileCount: number;
  name: string;
  status: "running" | "success" | "failed";
}

/** A ready-made workflow the user can start from (master plan §8's four examples). */
export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
}
