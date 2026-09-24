// The Workflow model and its persistence (15-workflows.md; master plan §16).
//
// The table itself came with phase 13; this module owns the logic: parsing whatever arrived over
// the wire into a chain the run engine can trust, and reading/writing rows for a signed-in user.
// Guests keep their workflows on the device (`apps/web/src/lib/localWorkflows.ts`) and never
// reach this module — same split as history and favourites in phase 14.
import { getTool } from "@onestop/tool-registry";
import type { Workflow, WorkflowInput, WorkflowStep } from "@onestop/types";
import { requirePrisma, type PrismaClient } from "../db/client.ts";
import {
  MAX_WORKFLOW_DESCRIPTION_LENGTH,
  MAX_WORKFLOW_NAME_LENGTH,
  MAX_WORKFLOW_STEPS,
  describeIssues,
  validateWorkflow,
} from "./validate.ts";

/** Ceiling on how many workflows one account can keep. */
export const MAX_WORKFLOWS_PER_USER = 100;

export class WorkflowNotFoundError extends Error {
  readonly code = "NOT_FOUND";
  constructor() {
    super("That workflow does not exist.");
    this.name = "WorkflowNotFoundError";
  }
}

export class InvalidWorkflowError extends Error {
  readonly code = "UNSUPPORTED_INPUT";
  constructor(message: string) {
    super(message);
    this.name = "InvalidWorkflowError";
  }
}

export class TooManyWorkflowsError extends Error {
  readonly code = "UNSUPPORTED_INPUT";
  constructor() {
    super(`You can keep at most ${MAX_WORKFLOWS_PER_USER} workflows. Delete one first.`);
    this.name = "TooManyWorkflowsError";
  }
}

function plainObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Turns untrusted JSON into a step list. Unknown shapes are dropped rather than guessed at, and
 * option values are kept only when they are primitives — no nested objects reach an executor
 * through a saved workflow.
 */
export function parseSteps(value: unknown): WorkflowStep[] {
  if (!Array.isArray(value)) return [];
  const steps: WorkflowStep[] = [];
  for (const raw of value.slice(0, MAX_WORKFLOW_STEPS)) {
    const entry = plainObject(raw);
    const toolId = typeof entry.toolId === "string" ? entry.toolId.trim() : "";
    if (toolId === "") continue;
    const options: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(plainObject(entry.options))) {
      if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") {
        options[key] = val;
      }
    }
    steps.push(Object.keys(options).length > 0 ? { toolId, options } : { toolId });
  }
  return steps;
}

export function normaliseName(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, MAX_WORKFLOW_NAME_LENGTH) : "";
}

export function normaliseDescription(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, MAX_WORKFLOW_DESCRIPTION_LENGTH);
  return trimmed === "" ? null : trimmed;
}

/** Parses and validates a create/update body. Throws `InvalidWorkflowError` with one message. */
export function parseWorkflowInput(body: Record<string, unknown>): WorkflowInput {
  const name = normaliseName(body.name);
  const description = normaliseDescription(body.description);
  const steps = parseSteps(body.steps);
  const result = validateWorkflow(steps, { checkName: true, name, description });
  if (!result.valid) throw new InvalidWorkflowError(describeIssues(result.issues));
  return { name, description, steps };
}

interface WorkflowRow {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  steps: unknown;
  favorite: boolean;
  useCount: number;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toWorkflow(row: WorkflowRow): Workflow {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    description: row.description,
    steps: parseSteps(row.steps),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    scope: "account",
    favorite: row.favorite,
    useCount: row.useCount,
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
  };
}

/** Short "Merge PDF → Compress PDF" line for a list row. Unknown ids show as their id. */
export function describeChain(steps: WorkflowStep[]): string {
  return steps.map((s) => getTool(s.toolId)?.name ?? s.toolId).join(" → ");
}

/** This user's workflows, most recently updated first. */
export async function listWorkflows(
  userId: string,
  prisma: PrismaClient = requirePrisma(),
): Promise<Workflow[]> {
  const rows = await prisma.workflow.findMany({
    where: { userId },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
  });
  return (rows as WorkflowRow[]).map(toWorkflow);
}

/** One workflow, or undefined when it is not this user's. */
export async function getWorkflow(
  userId: string,
  id: string,
  prisma: PrismaClient = requirePrisma(),
): Promise<Workflow | undefined> {
  const row = await prisma.workflow.findFirst({ where: { id, userId } });
  return row ? toWorkflow(row as WorkflowRow) : undefined;
}

export async function createWorkflow(
  userId: string,
  input: WorkflowInput,
  prisma: PrismaClient = requirePrisma(),
): Promise<Workflow> {
  const count = await prisma.workflow.count({ where: { userId } });
  if (count >= MAX_WORKFLOWS_PER_USER) throw new TooManyWorkflowsError();
  const row = await prisma.workflow.create({
    data: {
      userId,
      name: input.name,
      description: input.description ?? null,
      steps: input.steps as never,
    },
  });
  return toWorkflow(row as WorkflowRow);
}

/** Replaces a workflow's name, description and steps. Throws when it is not this user's. */
export async function updateWorkflow(
  userId: string,
  id: string,
  input: WorkflowInput,
  prisma: PrismaClient = requirePrisma(),
): Promise<Workflow> {
  const existing = await prisma.workflow.findFirst({ where: { id, userId }, select: { id: true } });
  if (!existing) throw new WorkflowNotFoundError();
  const row = await prisma.workflow.update({
    where: { id },
    data: {
      name: input.name,
      description: input.description ?? null,
      steps: input.steps as never,
    },
  });
  return toWorkflow(row as WorkflowRow);
}

/** Stars or un-stars a workflow. Throws when it is not this user's. */
export async function setWorkflowFavorite(
  userId: string,
  id: string,
  favorite: boolean,
  prisma: PrismaClient = requirePrisma(),
): Promise<Workflow> {
  const existing = await prisma.workflow.findFirst({ where: { id, userId }, select: { id: true } });
  if (!existing) throw new WorkflowNotFoundError();
  const row = await prisma.workflow.update({ where: { id }, data: { favorite } });
  return toWorkflow(row as WorkflowRow);
}

/** Counts one successful run. Quietly does nothing when the workflow is not this user's. */
export async function recordWorkflowUse(
  userId: string,
  id: string,
  prisma: PrismaClient = requirePrisma(),
): Promise<void> {
  await prisma.workflow.updateMany({
    where: { id, userId },
    data: { useCount: { increment: 1 }, lastUsedAt: new Date() },
  });
}

/** Deletes one workflow. False when it does not exist or belongs to someone else. */
export async function deleteWorkflow(
  userId: string,
  id: string,
  prisma: PrismaClient = requirePrisma(),
): Promise<boolean> {
  const { count } = await prisma.workflow.deleteMany({ where: { id, userId } });
  return count > 0;
}
