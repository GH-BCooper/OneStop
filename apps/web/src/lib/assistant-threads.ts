// AI Assistant chat history — one thread per conversation, kept on this device (free-first,
// local-first: no server model, no account sync, matches the guest half of `workflows.ts`).
//
// A thread only ever lives in localStorage. What is persisted per turn is display data (the
// request text, file names/sizes, the plan and the run result) — never the attached `File` objects
// themselves, so a reload can always show a conversation again but never re-runs a stale turn.
import type { AssistantPlan, WorkflowRunResult } from "@onestop/types";

export const THREADS_KEY = "onestop-assistant-threads";
export const THREADS_CHANGED = "onestop:assistant-threads-changed";
export const SIDEBAR_COLLAPSED_KEY = "onestop-assistant-sidebar-collapsed";
export const MAX_THREADS = 200;
const MAX_TURNS_PER_THREAD = 200;

export interface StoredFileMeta {
  name: string;
  size: number;
}

export interface StoredTurn {
  id: string;
  request: string;
  files: StoredFileMeta[];
  status: "planning" | "planned" | "running" | "done" | "failed";
  plan?: AssistantPlan;
  run?: WorkflowRunResult;
  note?: string | null;
  error?: string;
}

export interface AssistantThread {
  id: string;
  title: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  turns: StoredTurn[];
}

function announce(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(THREADS_CHANGED));
}

function isFileMeta(value: unknown): value is StoredFileMeta {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.name === "string" && typeof row.size === "number";
}

const TURN_STATUSES = ["planning", "planned", "running", "done", "failed"] as const;

function parseTurn(value: unknown): StoredTurn | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.request !== "string") return null;
  const status = (TURN_STATUSES as readonly string[]).includes(row.status as string)
    ? (row.status as StoredTurn["status"])
    : "failed";
  return {
    id: row.id,
    request: row.request,
    files: Array.isArray(row.files) ? row.files.filter(isFileMeta) : [],
    status,
    ...(row.plan ? { plan: row.plan as AssistantPlan } : {}),
    ...(row.run ? { run: row.run as WorkflowRunResult } : {}),
    ...(row.note !== undefined ? { note: row.note as string | null } : {}),
    ...(typeof row.error === "string" ? { error: row.error } : {}),
  };
}

function parseThread(value: unknown): AssistantThread | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.title !== "string") return null;
  const now = new Date().toISOString();
  return {
    id: row.id,
    title: row.title,
    pinned: row.pinned === true,
    createdAt: typeof row.createdAt === "string" ? row.createdAt : now,
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : now,
    turns: Array.isArray(row.turns)
      ? row.turns.map(parseTurn).filter((t): t is StoredTurn => t !== null)
      : [],
  };
}

function sortThreads(threads: AssistantThread[]): AssistantThread[] {
  return [...threads].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

export function readThreads(): AssistantThread[] {
  try {
    const raw = localStorage.getItem(THREADS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return sortThreads(parsed.map(parseThread).filter((t): t is AssistantThread => t !== null));
  } catch {
    return [];
  }
}

function writeThreads(threads: AssistantThread[]): void {
  try {
    localStorage.setItem(THREADS_KEY, JSON.stringify(threads.slice(0, MAX_THREADS)));
  } catch {
    // Storage can be blocked (private mode). Losing chat history is a shame, never a crash.
  }
  announce();
}

export function getThread(id: string): AssistantThread | undefined {
  return readThreads().find((t) => t.id === id);
}

/** Creates a new thread with one (already in-flight) turn and returns it. */
export function createThread(id: string, title: string, turn: StoredTurn): AssistantThread {
  const now = new Date().toISOString();
  const thread: AssistantThread = {
    id,
    title,
    pinned: false,
    createdAt: now,
    updatedAt: now,
    turns: [turn],
  };
  writeThreads([thread, ...readThreads()]);
  return thread;
}

export function saveThreadTurns(id: string, turns: StoredTurn[]): void {
  const all = readThreads();
  const existing = all.find((t) => t.id === id);
  if (!existing) return;
  const now = new Date().toISOString();
  const next: AssistantThread = {
    ...existing,
    turns: turns.slice(-MAX_TURNS_PER_THREAD),
    updatedAt: now,
  };
  writeThreads([next, ...all.filter((t) => t.id !== id)]);
}

export function renameThread(id: string, title: string): void {
  const trimmed = title.trim().slice(0, 120);
  if (trimmed === "") return;
  const all = readThreads();
  const existing = all.find((t) => t.id === id);
  if (!existing) return;
  writeThreads(all.map((t) => (t.id === id ? { ...t, title: trimmed } : t)));
}

export function setThreadPinned(id: string, pinned: boolean): void {
  const all = readThreads();
  if (!all.some((t) => t.id === id)) return;
  writeThreads(all.map((t) => (t.id === id ? { ...t, pinned } : t)));
}

export function deleteThread(id: string): void {
  writeThreads(readThreads().filter((t) => t.id !== id));
}

export function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeSidebarCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    // A collapse preference that fails to save just resets next visit — not worth surfacing.
  }
}

/** A short title from the raw request, used the instant a thread is created and if AI titling fails. */
export function fallbackTitle(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean === "") return "New chat";
  return clean.length <= 48 ? clean : `${clean.slice(0, 45).trimEnd()}…`;
}

export function newThreadId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `thread-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
