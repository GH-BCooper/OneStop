// The generic tool-page state machine (master plan §20): every tool moves through the same eight
// states, so the UI for each state is defined once here and reused by every tool page.
import type { FileRef, OutputFileRef } from "@onestop/types";
import { Button, buttonClasses, Card } from "@onestop/ui";
import Link from "next/link";

export const TOOL_STATES = [
  "empty",
  "selected",
  "validating",
  "processing",
  "success",
  "failed",
  "unavailable",
  "unsupported",
] as const;
export type ToolStateName = (typeof TOOL_STATES)[number];

export type ToolInput =
  { kind: "files"; files: FileRef[] } | { kind: "text"; value: string } | { kind: "none" };

export type UnavailableReason = "offline" | "not-implemented" | "auth-required";

export interface ToolState {
  status: ToolStateName;
  input: ToolInput | null;
  message?: string;
  reason?: UnavailableReason;
  output?: unknown;
  summary?: string;
  /** Downloadable files the pipeline stored for this run (04-file-core.md). */
  files?: OutputFileRef[];
}

export type ToolEvent =
  | { type: "SELECT"; input: ToolInput }
  | { type: "CLEAR" }
  | { type: "VALIDATE" }
  | { type: "REJECT"; message: string }
  | { type: "START" }
  | { type: "SUCCEED"; output: unknown; summary?: string; files?: OutputFileRef[] }
  | { type: "FAIL"; message: string }
  | { type: "UNAVAILABLE"; reason: UnavailableReason; message: string }
  | { type: "RESET" };

export function initialToolState(needsInput: boolean): ToolState {
  return needsInput
    ? { status: "empty", input: null }
    : { status: "selected", input: { kind: "none" } };
}

const busy = (s: ToolState) => s.status === "validating" || s.status === "processing";

/** Pure transition function; events that don't apply to the current state are ignored. */
export function toolReducer(state: ToolState, event: ToolEvent): ToolState {
  switch (event.type) {
    case "SELECT":
      return busy(state) ? state : { status: "selected", input: event.input };
    case "CLEAR":
      if (busy(state)) return state;
      return state.input?.kind === "none" ? state : { status: "empty", input: null };
    case "VALIDATE":
      return state.status === "selected" ? { status: "validating", input: state.input } : state;
    case "REJECT":
      // Rejection can come from the client pre-check (validating) or from the server's own
      // validation once the upload is under way (processing).
      return state.status === "validating" || state.status === "processing"
        ? { status: "unsupported", input: state.input, message: event.message }
        : state;
    case "START":
      return state.status === "validating" ? { status: "processing", input: state.input } : state;
    case "SUCCEED":
      return state.status === "processing"
        ? {
            status: "success",
            input: state.input,
            output: event.output,
            summary: event.summary,
            files: event.files,
          }
        : state;
    case "FAIL":
      return state.status === "processing"
        ? { status: "failed", input: state.input, message: event.message }
        : state;
    case "UNAVAILABLE":
      return {
        status: "unavailable",
        input: state.input,
        reason: event.reason,
        message: event.message,
      };
    case "RESET":
      if (busy(state)) return state;
      return state.input
        ? { status: "selected", input: state.input }
        : { status: "empty", input: null };
  }
}

function describeInput(input: ToolInput | null): string {
  if (!input || input.kind === "none") return "Ready to run.";
  if (input.kind === "text") return `Ready: ${input.value.length} characters entered.`;
  const n = input.files.length;
  return `Ready: ${n === 1 ? input.files[0]!.name : `${n} files`} selected.`;
}

export interface ToolStateViewProps {
  state: ToolState;
  toolName: string;
  acceptedTypes?: string;
  onReset?: () => void;
  onDownload?: () => void;
}

const titles: Record<ToolStateName, string> = {
  empty: "Nothing selected yet",
  selected: "Ready",
  validating: "Checking your input…",
  processing: "Processing…",
  success: "Done",
  failed: "Something went wrong",
  unavailable: "Unavailable",
  unsupported: "This input isn't supported",
};

const unavailableTitles: Record<UnavailableReason, string> = {
  offline: "Internet connection required",
  "not-implemented": "Coming in a later phase",
  "auth-required": "Sign in required",
};

/** Result files a browser can show inline. At most four, so a big batch stays readable. */
function previewable(files: OutputFileRef[] | undefined): OutputFileRef[] {
  return (files ?? []).filter((f) => f.mimeType.startsWith("image/")).slice(0, 4);
}

/** Renders the result/progress panel for the current state. */
export function ToolStateView({
  state,
  toolName,
  acceptedTypes,
  onReset,
  onDownload,
}: ToolStateViewProps) {
  const title =
    state.status === "unavailable" && state.reason
      ? unavailableTitles[state.reason]
      : titles[state.status];
  const tone =
    state.status === "success"
      ? "border-success"
      : state.status === "failed" || state.status === "unsupported"
        ? "border-danger"
        : state.status === "unavailable"
          ? "border-warning"
          : "";

  return (
    <Card className={`flex flex-col gap-3 ${tone}`} data-state={state.status}>
      <div role="status" aria-live="polite" className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{title}</h2>
        {state.status === "empty" && (
          <p className="text-sm text-fg-muted">Add your input above to use {toolName}.</p>
        )}
        {state.status === "selected" && (
          <p className="text-sm text-fg-muted">{describeInput(state.input)}</p>
        )}
        {state.status === "success" && state.summary && <p className="text-sm">{state.summary}</p>}
        {(state.status === "failed" ||
          state.status === "unsupported" ||
          state.status === "unavailable") &&
          state.message && <p className="text-sm">{state.message}</p>}
        {state.status === "unsupported" && acceptedTypes && (
          <p className="text-sm text-fg-muted">Accepted: {acceptedTypes}.</p>
        )}
      </div>

      {(state.status === "validating" || state.status === "processing") && (
        <div
          role="progressbar"
          aria-label={title}
          className="h-2 w-full overflow-hidden rounded-full bg-surface-muted"
        >
          <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
        </div>
      )}

      {state.status === "success" && (
        <>
          {state.files && state.files.length > 0 && (
            <p className="text-xs text-fg-muted">
              Result files are deleted from the server automatically — download them now.
            </p>
          )}
          {/* An image result is worth seeing before downloading it — a QR code especially, since
              the whole point is to point a phone at it (11-qr-tools.md). */}
          {previewable(state.files).length > 0 && (
            <div className="flex flex-wrap gap-3" data-testid="result-preview">
              {previewable(state.files).map((file) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={file.id}
                  src={file.url}
                  alt={file.name}
                  className="max-h-64 w-auto rounded-lg border border-border bg-white p-2"
                />
              ))}
            </div>
          )}
          {state.output !== undefined && (
            <pre className="max-h-64 overflow-auto rounded-md bg-surface-muted p-3 text-xs">
              {JSON.stringify(state.output, null, 2)}
            </pre>
          )}
          <div className="flex flex-wrap gap-2">
            {state.files && state.files.length > 0 ? (
              state.files.map((file) => (
                <a
                  key={file.id}
                  href={file.url}
                  download={file.name}
                  data-testid="result-download"
                  className={buttonClasses("primary")}
                >
                  Download {file.name}
                </a>
              ))
            ) : (
              <Button onClick={onDownload}>Download</Button>
            )}
            <Button variant="secondary" disabled title="Saving results arrives with accounts">
              Save
            </Button>
            <Button variant="ghost" onClick={onReset}>
              Run again
            </Button>
          </div>
        </>
      )}

      {(state.status === "failed" || state.status === "unsupported") && (
        <div>
          <Button variant="secondary" onClick={onReset}>
            Try again
          </Button>
        </div>
      )}

      {state.status === "unavailable" && state.reason === "auth-required" && (
        <div>
          <Link href="/auth/login" className={buttonClasses("secondary")}>
            Sign in
          </Link>
        </div>
      )}
      {state.status === "unavailable" && state.reason === "offline" && (
        <div>
          <Button variant="secondary" onClick={onReset}>
            Try again
          </Button>
        </div>
      )}
    </Card>
  );
}
