"use client";

// Running a workflow from the browser (15-workflows.md).
//
// Two modes, both served by `POST /api/workflows/run`:
//
//   chain - every chosen file goes into step 1 together (Merge PDF, Image → PDF and friends need
//           that), and one result comes out;
//   batch - each file goes through the whole chain on its own, and every file gets its own
//           success or failure. One bad file never stops the rest.
//
// The upload pre-check reuses the tool page's, so a file the first step cannot read is caught
// before anything leaves the device — the server revalidates regardless.
import { getTool, fileInputTypes, typeLabel } from "@onestop/tool-registry";
import type { BatchRunResult, OutputFileRef, WorkflowRunResult, WorkflowStep } from "@onestop/types";
import { Badge, Button, buttonClasses, Card, CardTitle } from "@onestop/ui";
import { useState } from "react";
import { FilePreview, previewable } from "@/components/tools/ToolStateMachine";
import { checkFiles, formatBytes, UploadZone } from "@/components/tools/UploadZone";
import { newProgressToken, useProgressPolling } from "@/lib/useProgress";

export interface WorkflowRunnerProps {
  steps: WorkflowStep[];
  name: string;
  /** Set when the chain is a saved account workflow, so the server can re-read it by id. */
  workflowId?: string | null;
}

type Mode = "chain" | "batch";

interface RunResponse {
  ok?: boolean;
  mode?: Mode;
  run?: WorkflowRunResult;
  batch?: BatchRunResult;
  error?: { message?: string };
}

const statusTone = { success: "success", failed: "danger", skipped: "neutral" } as const;

/** One result file: a Download button, plus a View toggle for inline-previewable types. */
function FileResultRow({ file }: { file: OutputFileRef }) {
  const [open, setOpen] = useState(false);
  const canPreview = previewable([file]).length > 0;
  return (
    <li className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <a
          href={file.url}
          download={file.name}
          className={buttonClasses("primary")}
          data-testid="result-download"
        >
          Download {file.name}
        </a>
        {canPreview ? (
          <Button
            variant="secondary"
            onClick={() => setOpen((v) => !v)}
            data-testid="preview-toggle"
          >
            {open ? "Hide view" : "View"}
          </Button>
        ) : null}
        <span className="text-sm text-fg-muted">({formatBytes(file.size)})</span>
      </div>
      {open && canPreview ? (
        <div data-testid="result-preview">
          <FilePreview file={file} />
        </div>
      ) : null}
    </li>
  );
}

export function WorkflowRunner({ steps, name, workflowId = null }: WorkflowRunnerProps) {
  const first = getTool(steps[0]?.toolId ?? "");
  const [files, setFiles] = useState<File[]>([]);
  const [mode, setMode] = useState<Mode>("chain");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<WorkflowRunResult | null>(null);
  const [batch, setBatch] = useState<BatchRunResult | null>(null);
  const [progressToken, setProgressToken] = useState<string | null>(null);
  const progress = useProgressPolling(progressToken, running);

  if (!first) return null;

  // The chain's first step decides what may be uploaded; batch mode always takes many files.
  const pickerTool = {
    name: first.name,
    inputTypes: first.inputTypes,
    supportsBatch: mode === "batch" ? true : first.supportsBatch,
  };

  const start = async () => {
    const problem = checkFiles(pickerTool, files);
    if (problem) {
      setError(problem);
      return;
    }
    setRunning(true);
    setError(null);
    setRun(null);
    setBatch(null);

    const token = newProgressToken();
    setProgressToken(token);

    const form = new FormData();
    form.set("steps", JSON.stringify(steps));
    form.set("name", name);
    form.set("mode", mode);
    form.set("progressToken", token);
    if (workflowId) form.set("workflowId", workflowId);
    for (const file of files) form.append("files", file);

    try {
      const response = await fetch("/api/workflows/run", { method: "POST", body: form });
      const body = (await response.json()) as RunResponse;
      if (body.run) setRun(body.run);
      if (body.batch) setBatch(body.batch);
      if (!body.run && !body.batch) {
        setError(body.error?.message ?? "The workflow could not be run. Please try again.");
      }
    } catch {
      setError("The workflow could not be run. Check your connection and try again.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card className="flex flex-col gap-4" data-testid="workflow-runner">
      <CardTitle>Run this workflow</CardTitle>
      <p className="text-sm text-fg-muted">
        Starts with {first.name}, which takes {typeLabel(fileInputTypes(first))}.
      </p>

      <fieldset className="flex flex-wrap gap-4" disabled={running}>
        <legend className="sr-only">How to run the files</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="workflow-mode"
            checked={mode === "chain"}
            onChange={() => setMode("chain")}
          />
          All files into one run
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="workflow-mode"
            checked={mode === "batch"}
            onChange={() => setMode("batch")}
          />
          Batch: each file separately
        </label>
      </fieldset>

      <UploadZone
        tool={pickerTool}
        files={files}
        disabled={running}
        onSelect={(picked) => {
          setFiles(picked);
          setError(null);
        }}
        onReject={setError}
      />

      {files.length > 0 ? (
        <ul className="flex flex-col gap-1 text-sm text-fg-muted">
          {files.map((file) => (
            <li key={`${file.name}-${file.size}`}>
              {file.name} · {formatBytes(file.size)}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={running || files.length === 0} onClick={() => void start()}>
          {running ? "Running…" : "Run workflow"}
        </Button>
        {files.length > 0 && !running ? (
          <Button variant="ghost" onClick={() => setFiles([])}>
            Clear files
          </Button>
        ) : null}
      </div>

      {running ? (
        <div className="flex flex-col gap-1">
          <div
            role="progressbar"
            aria-label="Workflow progress"
            aria-valuemin={0}
            aria-valuemax={100}
            {...(progress ? { "aria-valuenow": progress.percent } : {})}
            className="h-2 w-full overflow-hidden rounded-full bg-surface-muted"
          >
            {progress ? (
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
                style={{ width: `${progress.percent}%` }}
              />
            ) : (
              <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
            )}
          </div>
          {progress && (
            <p className="text-xs text-fg-muted">
              {progress.label} — {progress.percent}%
            </p>
          )}
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      {run ? (
        <div className="flex flex-col gap-3" data-testid="workflow-run-result">
          <div className="flex items-center gap-2">
            <Badge tone={run.ok ? "success" : "danger"}>{run.ok ? "Finished" : "Stopped"}</Badge>
            <span className="text-sm text-fg-muted">{Math.round(run.durationMs / 100) / 10}s</span>
          </div>
          {run.error ? (
            <p role="alert" className="text-sm text-danger">
              {run.error}
            </p>
          ) : null}
          <ol className="flex flex-col gap-2">
            {run.steps.map((step) => (
              <li
                key={step.index}
                className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2 text-sm"
              >
                <Badge tone={statusTone[step.status]}>{step.index + 1}</Badge>
                <span className="font-medium">{step.toolName}</span>
                <span className="text-fg-muted">{step.error ?? step.summary ?? step.status}</span>
              </li>
            ))}
          </ol>
          {run.files.length > 0 ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">Result</p>
              <ul className="flex flex-col gap-2">
                {run.files.map((file) => (
                  <FileResultRow key={file.id} file={file} />
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {batch ? (
        <div className="flex flex-col gap-3" data-testid="workflow-batch-result">
          <div className="flex items-center gap-2">
            <Badge tone={batch.failed === 0 ? "success" : "danger"}>
              {batch.succeeded} of {batch.total} finished
            </Badge>
            {batch.failed > 0 ? <Badge tone="danger">{batch.failed} failed</Badge> : null}
          </div>
          <ul className="flex flex-col gap-2">
            {batch.results.map((result) => (
              <li key={result.name} className="rounded-md border border-border p-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={result.ok ? "success" : "danger"}>
                    {result.ok ? "OK" : "Failed"}
                  </Badge>
                  <span className="font-medium">{result.name}</span>
                </div>
                {result.error ? <p className="mt-1 text-danger">{result.error}</p> : null}
                {result.files.length > 0 ? (
                  <ul className="mt-2 flex flex-col gap-2">
                    {result.files.map((file) => (
                      <FileResultRow key={file.id} file={file} />
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}
