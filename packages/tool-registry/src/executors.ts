// Executor lookup. Phase 03 ships one working "echo" executor (File Metadata Viewer, which just
// reflects the metadata of the files it's given) to prove the plumbing; every other tool gets a
// stub that reports NOT_IMPLEMENTED so the UI can say "Coming in a later phase" instead of
// pretending to succeed. Phases 05–17 register real executors here by tool id.
import type { FileRef } from "@onestop/types";
import { PHASE_FILES, type Executor, type ToolMeta } from "./schema";

export const echoExecutor: Executor = async (input) => {
  if (!Array.isArray(input) || input.length === 0) {
    return { ok: false, code: "UNSUPPORTED_INPUT", message: "Choose at least one file." };
  }
  const files = input.map((f: FileRef) => ({
    name: f.name,
    size: f.size,
    type: f.type || "unknown",
    lastModified: f.lastModified ? new Date(f.lastModified).toISOString() : null,
  }));
  const total = files.reduce((sum, f) => sum + f.size, 0);
  return {
    ok: true,
    output: { files },
    summary: `${files.length} file${files.length === 1 ? "" : "s"}, ${total} bytes in total.`,
  };
};

export function stubExecutor(tool: Pick<ToolMeta, "name" | "phase">): Executor {
  return async () => ({
    ok: false,
    code: "NOT_IMPLEMENTED",
    message: `${tool.name} is coming in a later phase (${PHASE_FILES[tool.phase]}).`,
  });
}

const executors: Record<string, Executor> = {
  "file-metadata-viewer": echoExecutor,
};

export function getExecutor(tool: Pick<ToolMeta, "id" | "name" | "phase">): Executor {
  return executors[tool.id] ?? stubExecutor(tool);
}

export function hasExecutor(id: string): boolean {
  return id in executors;
}
