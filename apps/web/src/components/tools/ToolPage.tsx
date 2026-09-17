"use client";

import {
  acceptAttribute,
  acceptsFileName,
  fileInputTypes,
  getExecutor,
  inputKind,
  PHASE_FILES,
  typeLabel,
  type ToolMeta,
} from "@onestop/tool-registry";
import type { FileRef } from "@onestop/types";
import { Button, Card } from "@onestop/ui";
import { useCallback, useEffect, useId, useReducer, useState, type DragEvent } from "react";
import { recordRecentTool } from "@/lib/recent-tools";
import {
  initialToolState,
  toolReducer,
  ToolStateView,
  type ToolInput,
  type ToolState,
} from "./ToolStateMachine";

const OFFLINE_MESSAGE = "This tool needs an Internet connection. Connect and try again.";

function toFileRefs(list: FileList | File[]): FileRef[] {
  return Array.from(list, (f) => ({
    name: f.name,
    size: f.size,
    type: f.type,
    lastModified: f.lastModified,
  }));
}

/** Returns an actionable message when the input can't be used, or null when it's fine. */
export function validateToolInput(tool: ToolMeta, input: ToolInput | null): string | null {
  if (!input) return "Add an input first.";
  if (input.kind === "files") {
    if (input.files.length === 0) return "Choose a file first.";
    if (!tool.supportsBatch && input.files.length > 1) return "This tool takes one file at a time.";
    if (input.files.some((f) => !acceptsFileName(tool, f.name))) {
      return "This file type is not supported.";
    }
  }
  if (input.kind === "text") {
    const value = input.value.trim();
    if (!value) return "Enter some text first.";
    if (inputKind(tool) === "url" && !/^https?:\/\/[^\s/$.?#][^\s]*$/i.test(value)) {
      return "Enter a full link starting with http:// or https://.";
    }
  }
  return null;
}

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

export interface ToolPageProps {
  tool: ToolMeta;
  /** Start in a given state; used by tests and state previews. */
  initialState?: ToolState;
}

export function ToolPage({ tool, initialState }: ToolPageProps) {
  const kind = inputKind(tool);
  const [state, dispatch] = useReducer(
    toolReducer,
    initialState ?? initialToolState(kind !== "none"),
  );
  const [dragging, setDragging] = useState(false);
  const [text, setText] = useState(state.input?.kind === "text" ? state.input.value : "");
  const inputId = useId();
  const busy = state.status === "validating" || state.status === "processing";
  const accepted = typeLabel(fileInputTypes(tool));

  useEffect(() => {
    recordRecentTool(tool.id);
    if (tool.network !== "required") return;
    const goOffline = () =>
      dispatch({ type: "UNAVAILABLE", reason: "offline", message: OFFLINE_MESSAGE });
    if (isOffline()) goOffline();
    window.addEventListener("offline", goOffline);
    return () => window.removeEventListener("offline", goOffline);
  }, [tool.id, tool.network]);

  const selectFiles = (list: FileList | File[] | null) => {
    if (!list || list.length === 0) return;
    dispatch({ type: "SELECT", input: { kind: "files", files: toFileRefs(list) } });
  };

  const onTextChange = (value: string) => {
    setText(value);
    if (value.length === 0) dispatch({ type: "CLEAR" });
    else dispatch({ type: "SELECT", input: { kind: "text", value } });
  };

  const onDrop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setDragging(false);
    selectFiles(e.dataTransfer.files);
  };

  const run = useCallback(async () => {
    dispatch({ type: "VALIDATE" });
    const problem = validateToolInput(tool, state.input);
    if (problem) {
      dispatch({ type: "REJECT", message: problem });
      return;
    }
    if (tool.network === "required" && isOffline()) {
      dispatch({ type: "UNAVAILABLE", reason: "offline", message: OFFLINE_MESSAGE });
      return;
    }
    if (tool.requiresAuth) {
      // TODO(13-auth-database.md): check the real session instead of assuming signed out.
      dispatch({
        type: "UNAVAILABLE",
        reason: "auth-required",
        message: `Sign in to use ${tool.name}.`,
      });
      return;
    }
    dispatch({ type: "START" });
    const input = state.input;
    const payload =
      input?.kind === "files" ? input.files : input?.kind === "text" ? input.value : null;
    try {
      const result = await getExecutor(tool)(payload, {});
      if (result.ok) {
        dispatch({ type: "SUCCEED", output: result.output, summary: result.summary });
      } else if (result.code === "NOT_IMPLEMENTED") {
        dispatch({ type: "UNAVAILABLE", reason: "not-implemented", message: result.message });
      } else if (result.code === "OFFLINE") {
        dispatch({ type: "UNAVAILABLE", reason: "offline", message: OFFLINE_MESSAGE });
      } else if (result.code === "AUTH_REQUIRED") {
        dispatch({ type: "UNAVAILABLE", reason: "auth-required", message: result.message });
      } else {
        dispatch({ type: "FAIL", message: result.message });
      }
    } catch (err) {
      console.error(`[tool:${tool.id}] executor threw`, err);
      dispatch({ type: "FAIL", message: "The tool stopped unexpectedly. Please try again." });
    }
  }, [tool, state.input]);

  const download = () => {
    const blob = new Blob([JSON.stringify(state.output, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${tool.slug}-result.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const files = state.input?.kind === "files" ? state.input.files : [];

  return (
    <div className="flex flex-col gap-6">
      {tool.status === "stub" && (
        <Card className="border-dashed text-sm" data-testid="coming-soon">
          <p className="font-semibold">Coming in a later phase</p>
          <p className="text-fg-muted">
            Processing for this tool is built in{" "}
            <code className="font-mono">{PHASE_FILES[tool.phase]}</code>. You can try the page, but
            nothing will be processed yet.
          </p>
        </Card>
      )}

      <section aria-labelledby={`${inputId}-input`} className="flex flex-col gap-3">
        <h2 id={`${inputId}-input`} className="text-lg font-semibold">
          Input
        </h2>
        {kind === "file" && (
          <>
            <label
              htmlFor={inputId}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={`flex min-h-36 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed p-6 text-center ${
                dragging ? "border-primary bg-surface-muted" : "border-border bg-surface"
              }`}
            >
              <span className="font-medium">
                Drop {tool.supportsBatch ? "files" : "a file"} here or click to browse
              </span>
              <span className="text-sm text-fg-muted">Accepted: {accepted}</span>
            </label>
            <input
              id={inputId}
              type="file"
              className="sr-only"
              multiple={tool.supportsBatch}
              accept={acceptAttribute(tool)}
              disabled={busy}
              onChange={(e) => selectFiles(e.target.files)}
            />
            {files.length > 0 && (
              <ul className="flex flex-col gap-1 text-sm" aria-label="Selected files">
                {files.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="flex justify-between gap-2">
                    <span className="truncate">{f.name}</span>
                    <span className="shrink-0 text-fg-muted">{f.size} bytes</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        {kind === "text" && (
          <>
            <label htmlFor={inputId} className="sr-only">
              Text input
            </label>
            <textarea
              id={inputId}
              value={text}
              disabled={busy}
              onChange={(e) => onTextChange(e.target.value)}
              rows={6}
              placeholder="Paste or type here"
              className="w-full rounded-lg border border-border bg-surface p-3 font-mono text-sm text-fg focus-visible:outline-2 focus-visible:outline-ring"
            />
          </>
        )}
        {kind === "url" && (
          <>
            <label htmlFor={inputId} className="sr-only">
              Link
            </label>
            <input
              id={inputId}
              type="url"
              value={text}
              disabled={busy}
              onChange={(e) => onTextChange(e.target.value)}
              placeholder="https://"
              className="h-12 w-full rounded-lg border border-border bg-surface px-3 text-fg focus-visible:outline-2 focus-visible:outline-ring"
            />
          </>
        )}
        {kind === "none" && <p className="text-sm text-fg-muted">This tool needs no input.</p>}
      </section>

      <section aria-labelledby={`${inputId}-options`} className="flex flex-col gap-2">
        <h2 id={`${inputId}-options`} className="text-lg font-semibold">
          Options
        </h2>
        {/* TODO(phase file in PHASE_FILES[tool.phase]): tool-specific options. */}
        <p className="text-sm text-fg-muted">No options for this tool yet.</p>
      </section>

      <div className="flex flex-wrap gap-2">
        <Button size="lg" onClick={run} disabled={state.status !== "selected"}>
          Run {tool.name}
        </Button>
        {files.length > 0 && !busy && (
          <Button size="lg" variant="ghost" onClick={() => dispatch({ type: "CLEAR" })}>
            Clear
          </Button>
        )}
      </div>

      <ToolStateView
        state={state}
        toolName={tool.name}
        acceptedTypes={kind === "file" ? accepted : undefined}
        onReset={() => dispatch({ type: "RESET" })}
        onDownload={download}
      />
    </div>
  );
}
