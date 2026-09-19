// Build-time validation of a workflow chain (15-workflows.md).
//
// This lives in the registry rather than in the API because it is pure registry knowledge — which
// tool accepts what — and because both sides need it: the server validates every save and every
// run, and the browser's builder validates each edit with no round trip. `apps/api/src/workflows/
// validate.ts` re-exports it for the server side.
//
// The whole point of validating here rather than at run time is that a user should never upload a
// file, wait for step 1, and only then be told step 2 could never have accepted its output. So the
// builder calls this on every edit and refuses to save a chain that cannot work.
//
// The rule is deliberately simple, matching the simple model: step N+1 must accept at least one of
// the file types step N declares it produces. Type families ("image", "audio", "video") expand to
// their extensions first, and a tool that accepts "any" accepts everything.
import { getTool } from "./index";
import { expandTypes, fileInputTypes, inputKind, typeLabel } from "./io";
import { getToolOptions, type ToolOption } from "./options";
import type { ToolMeta } from "./schema";
import type {
  WorkflowIssue,
  WorkflowIssueCode,
  WorkflowStep,
  WorkflowValidation,
} from "@onestop/types";

/** A chain longer than this is almost certainly a mistake, and every step costs a temp file. */
export const MAX_WORKFLOW_STEPS = 12;
export const MAX_WORKFLOW_NAME_LENGTH = 80;
export const MAX_WORKFLOW_DESCRIPTION_LENGTH = 500;

function issue(code: WorkflowIssueCode, stepIndex: number | null, message: string): WorkflowIssue {
  return { code, stepIndex, message };
}

/** The file types a step can hand on. Non-file output kinds are dropped. */
export function stepOutputTypes(tool: Pick<ToolMeta, "outputTypes">): string[] {
  return expandTypes(tool.outputTypes.filter((t) => t !== "text" && t !== "url"));
}

/** The file types a step will accept from the step before it. */
export function stepInputTypes(tool: Pick<ToolMeta, "inputTypes">): string[] {
  return expandTypes(fileInputTypes(tool));
}

/**
 * The types both steps agree on, i.e. what may actually flow between them. Empty means the chain
 * is broken. A tool that accepts "any" takes whatever the previous step produced.
 */
export function compatibleTypes(
  producer: Pick<ToolMeta, "outputTypes">,
  consumer: Pick<ToolMeta, "inputTypes">,
): string[] {
  const produced = stepOutputTypes(producer);
  const accepted = stepInputTypes(consumer);
  if (accepted.includes("any")) return produced;
  return produced.filter((t) => accepted.includes(t));
}

/** Light per-option checking, so a saved workflow cannot carry a value the tool will reject. */
function checkOptions(tool: ToolMeta, step: WorkflowStep, index: number): WorkflowIssue[] {
  const values = step.options ?? {};
  const declared = getToolOptions(tool.id);
  const byId = new Map<string, ToolOption>(declared.map((o) => [o.id, o]));
  const issues: WorkflowIssue[] = [];

  for (const [key, value] of Object.entries(values)) {
    const option = byId.get(key);
    if (!option) {
      issues.push(issue("INVALID_OPTION", index, `${tool.name} has no option called "${key}".`));
      continue;
    }
    if (option.type === "select") {
      const allowed = option.choices.map((c) => c.value);
      if (typeof value !== "string" || !allowed.includes(value)) {
        issues.push(issue("INVALID_OPTION", index, `Choose a valid value for "${option.label}".`));
      }
    } else if (option.type === "number") {
      const n = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(n) || n < option.min || n > option.max) {
        issues.push(
          issue(
            "INVALID_OPTION",
            index,
            `"${option.label}" must be between ${option.min} and ${option.max}.`,
          ),
        );
      }
    } else if (option.type === "boolean" && typeof value !== "boolean") {
      issues.push(issue("INVALID_OPTION", index, `"${option.label}" must be on or off.`));
    }
  }
  return issues;
}

export interface ValidateWorkflowOptions {
  /** Include the name/description checks. The run endpoint validates the chain only. */
  checkName?: boolean;
  name?: string;
  description?: string | null;
}

/**
 * Validates a whole chain. Never throws: an unusable workflow comes back as `valid: false` with
 * one issue per problem, each already worded for the user.
 */
export function validateWorkflow(
  steps: WorkflowStep[],
  options: ValidateWorkflowOptions = {},
): WorkflowValidation {
  const issues: WorkflowIssue[] = [];

  if (options.checkName) {
    const name = (options.name ?? "").trim();
    if (name === "") {
      issues.push(issue("INVALID_NAME", null, "Give the workflow a name."));
    } else if (name.length > MAX_WORKFLOW_NAME_LENGTH) {
      issues.push(
        issue("INVALID_NAME", null, `Keep the name under ${MAX_WORKFLOW_NAME_LENGTH} characters.`),
      );
    }
    if ((options.description ?? "").length > MAX_WORKFLOW_DESCRIPTION_LENGTH) {
      issues.push(
        issue(
          "INVALID_NAME",
          null,
          `Keep the description under ${MAX_WORKFLOW_DESCRIPTION_LENGTH} characters.`,
        ),
      );
    }
  }

  if (steps.length === 0) {
    issues.push(issue("NO_STEPS", null, "Add at least one step."));
    return {
      valid: false,
      issues,
      inputTypes: [],
      outputTypes: [],
      requiresAuth: false,
      offline: false,
    };
  }
  if (steps.length > MAX_WORKFLOW_STEPS) {
    issues.push(
      issue("TOO_MANY_STEPS", null, `A workflow can have at most ${MAX_WORKFLOW_STEPS} steps.`),
    );
  }

  const resolved: (ToolMeta | undefined)[] = steps.map((s) => getTool(s.toolId));

  resolved.forEach((tool, index) => {
    const step = steps[index]!;
    if (!tool) {
      issues.push(
        issue("UNKNOWN_TOOL", index, `Step ${index + 1} uses a tool that no longer exists.`),
      );
      return;
    }
    if (tool.status !== "available") {
      issues.push(issue("TOOL_UNAVAILABLE", index, `${tool.name} is not ready to run yet.`));
    }
    // Every step but the last has to hand something on.
    if (index < steps.length - 1 && stepOutputTypes(tool).length === 0) {
      issues.push(
        issue(
          "NO_FILE_OUTPUT",
          index,
          `${tool.name} does not produce a file, so nothing can follow it. Move it to the end.`,
        ),
      );
    }
    issues.push(...checkOptions(tool, step, index));
  });

  const first = resolved[0];
  if (first && inputKind(first) !== "file") {
    issues.push(
      issue(
        "INCOMPATIBLE_STEP",
        0,
        `${first.name} does not take files, so it cannot start a workflow.`,
      ),
    );
  }

  for (let i = 1; i < resolved.length; i += 1) {
    const producer = resolved[i - 1];
    const consumer = resolved[i];
    if (!producer || !consumer) continue;
    if (stepInputTypes(consumer).length === 0) {
      issues.push(
        issue(
          "INCOMPATIBLE_STEP",
          i,
          `${consumer.name} does not take files, so it cannot follow ${producer.name}.`,
        ),
      );
      continue;
    }
    if (compatibleTypes(producer, consumer).length === 0) {
      issues.push(
        issue(
          "INCOMPATIBLE_STEP",
          i,
          `${producer.name} produces ${typeLabel(producer.outputTypes)}, but ${consumer.name} only accepts ${typeLabel(fileInputTypes(consumer))}. Add a converter between them or pick a different tool.`,
        ),
      );
    }
  }

  const usable = resolved.filter((t): t is ToolMeta => t !== undefined);
  const last = resolved[resolved.length - 1];

  return {
    valid: issues.length === 0,
    issues,
    inputTypes: first ? fileInputTypes(first) : [],
    outputTypes: last ? last.outputTypes : [],
    requiresAuth: usable.some((t) => t.requiresAuth),
    offline: usable.length === steps.length && usable.every((t) => t.offline),
  };
}

/** One message summarising why a chain was rejected, for an API response or a toast. */
export function describeIssues(issues: WorkflowIssue[]): string {
  if (issues.length === 0) return "";
  const first = issues[0]!;
  const prefix = first.stepIndex === null ? "" : `Step ${first.stepIndex + 1}: `;
  return issues.length === 1
    ? `${prefix}${first.message}`
    : `${prefix}${first.message} (and ${issues.length - 1} more problem${issues.length > 2 ? "s" : ""})`;
}
