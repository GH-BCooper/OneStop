// Workflow storage on the client (15-workflows.md).
//
// Same split as history and favourites in phase 14: a signed-in user's workflows live in Postgres
// behind `/api/workflows`, a guest's live in localStorage on this device. Both paths hand back the
// same `Workflow[]`, so the list and the builder are written once. Running a workflow never needs
// an account — only keeping one across devices does.
import type { Workflow, WorkflowInput, WorkflowStep } from "@onestop/types";

export const WORKFLOWS_KEY = "onestop-workflows";
export const WORKFLOWS_CHANGED = "onestop:workflows-changed";
/** Matches `MAX_WORKFLOWS_PER_USER` on the server so the two paths behave alike. */
export const MAX_LOCAL_WORKFLOWS = 100;

function announce(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(WORKFLOWS_CHANGED));
}

function parseStep(value: unknown): WorkflowStep | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  if (typeof entry.toolId !== "string" || entry.toolId === "") return null;
  const options: Record<string, unknown> = {};
  const raw = entry.options;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") {
        options[key] = val;
      }
    }
  }
  return Object.keys(options).length > 0
    ? { toolId: entry.toolId, options }
    : { toolId: entry.toolId };
}

function parseWorkflow(value: unknown): Workflow | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.name !== "string") return null;
  const steps = Array.isArray(row.steps)
    ? row.steps.map(parseStep).filter((s): s is WorkflowStep => s !== null)
    : [];
  const now = new Date().toISOString();
  return {
    id: row.id,
    userId: null,
    name: row.name,
    description: typeof row.description === "string" ? row.description : null,
    steps,
    createdAt: typeof row.createdAt === "string" ? row.createdAt : now,
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : now,
    scope: "device",
    favorite: row.favorite === true,
    useCount:
      typeof row.useCount === "number" && Number.isFinite(row.useCount) && row.useCount > 0
        ? Math.floor(row.useCount)
        : 0,
    lastUsedAt: typeof row.lastUsedAt === "string" ? row.lastUsedAt : null,
  };
}

export function readLocalWorkflows(): Workflow[] {
  try {
    const raw = localStorage.getItem(WORKFLOWS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(parseWorkflow)
      .filter((w): w is Workflow => w !== null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch {
    return [];
  }
}

function writeLocalWorkflows(workflows: Workflow[]): void {
  try {
    localStorage.setItem(WORKFLOWS_KEY, JSON.stringify(workflows.slice(0, MAX_LOCAL_WORKFLOWS)));
  } catch {
    // Storage can be blocked (private mode). Losing a saved chain is a shame, never a crash.
  }
  announce();
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function saveLocalWorkflow(input: WorkflowInput, id?: string): Workflow {
  const all = readLocalWorkflows();
  const now = new Date().toISOString();
  const existing = id ? all.find((w) => w.id === id) : undefined;
  const workflow: Workflow = {
    id: existing?.id ?? id ?? newId(),
    userId: null,
    name: input.name,
    description: input.description ?? null,
    steps: input.steps,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    scope: "device",
    favorite: existing?.favorite ?? false,
    useCount: existing?.useCount ?? 0,
    lastUsedAt: existing?.lastUsedAt ?? null,
  };
  writeLocalWorkflows([workflow, ...all.filter((w) => w.id !== workflow.id)]);
  return workflow;
}

export function deleteLocalWorkflow(id: string): void {
  writeLocalWorkflows(readLocalWorkflows().filter((w) => w.id !== id));
}

/** Stars or un-stars a device workflow in place — no reordering, no new `updatedAt`. */
export function setLocalFavorite(id: string, favorite: boolean): void {
  const all = readLocalWorkflows();
  if (!all.some((w) => w.id === id)) return;
  writeLocalWorkflows(all.map((w) => (w.id === id ? { ...w, favorite } : w)));
}

/** Counts one successful run of a device workflow. */
export function recordLocalUse(id: string): void {
  const all = readLocalWorkflows();
  if (!all.some((w) => w.id === id)) return;
  const now = new Date().toISOString();
  writeLocalWorkflows(
    all.map((w) => (w.id === id ? { ...w, useCount: w.useCount + 1, lastUsedAt: now } : w)),
  );
}

export function getLocalWorkflow(id: string): Workflow | undefined {
  return readLocalWorkflows().find((w) => w.id === id);
}

// ---- the account path ---------------------------------------------------------------------

interface ApiResponse {
  ok?: boolean;
  workflow?: unknown;
  workflows?: unknown;
  error?: { message?: string };
}

async function call(url: string, init?: RequestInit): Promise<ApiResponse> {
  const response = await fetch(url, {
    ...init,
    headers: init?.body ? { "content-type": "application/json" } : undefined,
  });
  const body = (await response.json().catch(() => ({}))) as ApiResponse;
  if (!response.ok) {
    throw new Error(body.error?.message ?? "That could not be saved. Please try again.");
  }
  return body;
}

function asWorkflow(value: unknown): Workflow | null {
  const parsed = parseWorkflow(value);
  if (!parsed) return null;
  const row = value as Record<string, unknown>;
  return {
    ...parsed,
    userId: typeof row.userId === "string" ? row.userId : null,
    scope: "account",
  };
}

// ---- filters ------------------------------------------------------------------------------

export type WorkflowFilter = "all" | "favorites" | "recent" | "frequent";

/** A workflow has to have been run at least this many times to count as "frequently used". */
export const FREQUENT_MIN_USES = 2;

/** Narrows and orders the list for a filter: favourites A–Z-stable, recent newest-run first,
 *  frequent most-run first (ties broken by the most recent run). "all" keeps the given order. */
export function filterWorkflows(workflows: Workflow[], filter: WorkflowFilter): Workflow[] {
  const byRecent = (a: Workflow, b: Workflow) =>
    (b.lastUsedAt ?? "").localeCompare(a.lastUsedAt ?? "");
  switch (filter) {
    case "favorites":
      return workflows.filter((w) => w.favorite);
    case "recent":
      return workflows.filter((w) => w.lastUsedAt !== null).sort(byRecent);
    case "frequent":
      return workflows
        .filter((w) => w.useCount >= FREQUENT_MIN_USES)
        .sort((a, b) => b.useCount - a.useCount || byRecent(a, b));
    default:
      return workflows;
  }
}

export async function fetchWorkflows(): Promise<Workflow[]> {
  const body = await call("/api/workflows");
  return Array.isArray(body.workflows)
    ? body.workflows.map(asWorkflow).filter((w): w is Workflow => w !== null)
    : [];
}

export async function fetchWorkflow(id: string): Promise<Workflow | null> {
  const body = await call(`/api/workflows/${encodeURIComponent(id)}`);
  return asWorkflow(body.workflow);
}

export async function saveRemoteWorkflow(input: WorkflowInput, id?: string): Promise<Workflow> {
  const body = await call(id ? `/api/workflows/${encodeURIComponent(id)}` : "/api/workflows", {
    method: id ? "PUT" : "POST",
    body: JSON.stringify(input),
  });
  const workflow = asWorkflow(body.workflow);
  if (!workflow) throw new Error("That could not be saved. Please try again.");
  announce();
  return workflow;
}

export async function setRemoteFavorite(id: string, favorite: boolean): Promise<void> {
  await call(`/api/workflows/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ favorite }),
  });
  announce();
}

export async function deleteRemoteWorkflow(id: string): Promise<void> {
  await call(`/api/workflows/${encodeURIComponent(id)}`, { method: "DELETE" });
  announce();
}
