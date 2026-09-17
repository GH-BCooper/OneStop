"use client";

import {
  defaultOptionValues,
  fileInputTypes,
  getToolOptions,
  inputKind,
  PHASE_FILES,
  typeLabel,
  visibleOptionValues,
  type ToolMeta,
} from "@onestop/tool-registry";
import {
  DEFAULT_MAX_UPLOAD_BYTES,
  ERROR_MESSAGES,
  type ExecErrorCode,
  type FileRef,
  type OutputFileRef,
} from "@onestop/types";
import { Button, Card } from "@onestop/ui";
import { useCallback, useEffect, useId, useReducer, useState } from "react";
import { recordRecentTool } from "@/lib/recent-tools";
import {
  initialToolState,
  toolReducer,
  ToolStateView,
  type ToolInput,
  type ToolState,
} from "./ToolStateMachine";
import { ToolOptions, type OptionValues } from "./ToolOptions";
import { checkFiles, UploadZone } from "./UploadZone";

const OFFLINE_MESSAGE = ERROR_MESSAGES.offline;
/** The one entry point into the phase-04 pipeline. */
export const RUN_ENDPOINT = "/api/tools/run";

interface RunResponse {
  ok: boolean;
  job?: { id: string; status: string };
  output?: unknown;
  summary?: string | null;
  files?: OutputFileRef[];
  error?: { code: ExecErrorCode | string; message: string } | null;
}

function toFileRefs(files: File[]): FileRef[] {
  return files.map((f) => ({
    name: f.name,
    size: f.size,
    type: f.type,
    lastModified: f.lastModified,
  }));
}

/**
 * Client-side pre-check so obvious mistakes never reach the network. The server revalidates
 * everything (see `apps/api/src/file-processing/validate.ts`); this is convenience, not security.
 * Returns an actionable message, or null when the input is usable.
 */
export function validateToolInput(tool: ToolMeta, input: ToolInput | null): string | null {
  if (!input) return "Add an input first.";
  if (input.kind === "files") {
    if (input.files.length === 0) return "Choose a file first.";
    if (!tool.supportsBatch && input.files.length > 1) return "This tool takes one file at a time.";
    return checkFiles(tool, input.files, DEFAULT_MAX_UPLOAD_BYTES);
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
  // The real File objects, kept beside the reducer's metadata so they can be uploaded.
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState(state.input?.kind === "text" ? state.input.value : "");
  const toolOptions = getToolOptions(tool.id);
  const [optionValues, setOptionValues] = useState<OptionValues>(() =>
    defaultOptionValues(tool.id),
  );
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

  const selectFiles = (picked: File[]) => {
    setFiles(picked);
    if (picked.length === 0) dispatch({ type: "CLEAR" });
    else dispatch({ type: "SELECT", input: { kind: "files", files: toFileRefs(picked) } });
  };

  const rejectFiles = (message: string) => {
    dispatch({ type: "SELECT", input: { kind: "files", files: toFileRefs(files) } });
    dispatch({ type: "VALIDATE" });
    dispatch({ type: "REJECT", message });
  };

  const onTextChange = (value: string) => {
    setText(value);
    if (value.length === 0) dispatch({ type: "CLEAR" });
    else dispatch({ type: "SELECT", input: { kind: "text", value } });
  };

  const clear = () => {
    setFiles([]);
    setText("");
    dispatch({ type: "CLEAR" });
  };

  const setOption = (id: string, value: string | number | boolean) =>
    setOptionValues((current) => ({ ...current, [id]: value }));

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
    const body = new FormData();
    body.set("toolId", tool.id);
    for (const file of files) body.append("files", file);
    if (state.input?.kind === "text") body.set("text", state.input.value);
    if (toolOptions.length > 0) {
      body.set("options", JSON.stringify(visibleOptionValues(tool.id, optionValues)));
    }

    try {
      const response = await fetch(RUN_ENDPOINT, { method: "POST", body });
      const data = (await response.json()) as RunResponse;
      if (data.ok) {
        dispatch({
          type: "SUCCEED",
          output: data.output,
          ...(data.summary ? { summary: data.summary } : {}),
          ...(data.files && data.files.length > 0 ? { files: data.files } : {}),
        });
        return;
      }
      const code = data.error?.code ?? "FAILED";
      const message = data.error?.message ?? "Something went wrong. Please try again.";
      if (code === "NOT_IMPLEMENTED") {
        dispatch({ type: "UNAVAILABLE", reason: "not-implemented", message });
      } else if (code === "OFFLINE") {
        dispatch({ type: "UNAVAILABLE", reason: "offline", message: OFFLINE_MESSAGE });
      } else if (code === "AUTH_REQUIRED") {
        dispatch({ type: "UNAVAILABLE", reason: "auth-required", message });
      } else if (code === "UNSUPPORTED_INPUT") {
        dispatch({ type: "REJECT", message });
      } else {
        dispatch({ type: "FAIL", message });
      }
    } catch (err) {
      console.error(`[tool:${tool.id}] run request failed`, err);
      if (isOffline()) {
        dispatch({ type: "UNAVAILABLE", reason: "offline", message: OFFLINE_MESSAGE });
      } else {
        dispatch({ type: "FAIL", message: "The tool stopped unexpectedly. Please try again." });
      }
    }
  }, [tool, state.input, files, toolOptions.length, optionValues]);

  /** Fallback download for tools whose result is JSON shown on the page. */
  const download = () => {
    const blob = new Blob([JSON.stringify(state.output, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${tool.slug}-result.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const hasInput = state.input?.kind === "files" ? files.length > 0 : text.length > 0;

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
          <UploadZone
            tool={tool}
            files={files}
            disabled={busy}
            inputId={inputId}
            onSelect={selectFiles}
            onReject={rejectFiles}
          />
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
        <ToolOptions
          options={toolOptions}
          values={optionValues}
          disabled={busy}
          onChange={setOption}
        />
      </section>

      <div className="flex flex-wrap gap-2">
        <Button size="lg" onClick={run} disabled={state.status !== "selected"}>
          Run {tool.name}
        </Button>
        {hasInput && !busy && (
          <Button size="lg" variant="ghost" onClick={clear}>
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
