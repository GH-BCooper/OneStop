"use client";

// `/assistant` — the AI Assistant workspace (master plan §7; 16-ai-assistant.md).
//
// The flow on screen is master plan §7.2's pipeline, made visible:
//
//   1. the visitor describes the task and attaches files
//   2. "Plan it" calls /api/assistant/plan — nothing is uploaded yet, only the file *names*
//   3. the plan is shown as numbered OneStop tools, with the options it chose
//   4. "Run the plan" calls /api/assistant/run, which re-checks every tool id and runs the chain
//   5. each step reports success or failure, and the result files are offered for download
//
// Two things are deliberately always on screen: which runtime is in use with its privacy
// disclosure, and — when the request is out of scope — the Free/Paid external recommendations
// instead of an invented tool.
import { getTool, toolHref } from "@onestop/tool-registry";
import type { AiStatus, AssistantPlan, WorkflowRunResult } from "@onestop/types";
import { Badge, Button, Card, CardTitle, buttonClasses } from "@onestop/ui";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { formatBytes, UploadZone } from "@/components/tools/UploadZone";
import { aiHeaders, readPreferredAI } from "@/lib/preferences";
import { Recommendations } from "./Recommendations";

/** Anything can be attached: which tools may run is decided by the plan, not by the picker. */
const ANY_FILE = { name: "the assistant", inputTypes: ["any"], supportsBatch: true };

const EXAMPLES = [
  "Convert this PDF to Excel, remove the first 2 pages, then compress the result",
  "Merge these PDFs and add page numbers",
  "What is the notice period in this contract?",
  "Remove the background from these photos and save them as WebP",
];

interface PlanResponse {
  ok?: boolean;
  plan?: AssistantPlan;
  error?: { message?: string };
}

interface RunResponse {
  ok?: boolean;
  run?: WorkflowRunResult;
  note?: string | null;
  rejected?: { toolId: string; reason: string }[];
  error?: { message?: string };
}

const statusTone = { success: "success", failed: "danger", skipped: "neutral" } as const;

export function AssistantView() {
  const [request, setRequest] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [plan, setPlan] = useState<AssistantPlan | null>(null);
  const [planning, setPlanning] = useState(false);
  const [running, setRunning] = useState(false);
  const [run, setRun] = useState<WorkflowRunResult | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const provider = typeof window === "undefined" ? null : readPreferredAI();

  const loadStatus = useCallback(async (signal?: AbortSignal) => {
    const picked = readPreferredAI();
    try {
      const query = picked ? `?provider=${encodeURIComponent(picked)}` : "";
      const response = await fetch(`/api/assistant/status${query}`, {
        headers: aiHeaders(picked),
        ...(signal ? { signal } : {}),
      });
      const body = (await response.json()) as { status?: AiStatus };
      setStatus(body.status ?? null);
    } catch {
      // A failed status check is not an error the visitor has to act on: the assistant still
      // works, because every planned tool has a non-AI path.
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadStatus(controller.signal);
    return () => controller.abort();
  }, [loadStatus]);

  const makePlan = async () => {
    if (request.trim() === "") {
      setError("Describe what you would like done.");
      return;
    }
    setPlanning(true);
    setError(null);
    setPlan(null);
    setRun(null);
    setNote(null);
    try {
      const response = await fetch("/api/assistant/plan", {
        method: "POST",
        headers: { "content-type": "application/json", ...aiHeaders(provider) },
        body: JSON.stringify({
          request,
          fileNames: files.map((f) => f.name),
          provider,
        }),
      });
      const body = (await response.json()) as PlanResponse;
      if (body.plan) setPlan(body.plan);
      else setError(body.error?.message ?? "The assistant could not plan that. Please try again.");
    } catch {
      setError("The assistant could not be reached. Check your connection and try again.");
    } finally {
      setPlanning(false);
    }
  };

  const runPlan = async () => {
    if (!plan?.plan) return;
    if (files.length === 0) {
      setError("Attach the files the assistant should work on.");
      return;
    }
    setRunning(true);
    setError(null);
    setRun(null);
    setNote(null);

    const form = new FormData();
    form.set("plan", JSON.stringify(plan.plan));
    if (provider) form.set("provider", provider);
    for (const file of files) form.append("files", file);

    try {
      const response = await fetch("/api/assistant/run", {
        method: "POST",
        headers: aiHeaders(provider),
        body: form,
      });
      const body = (await response.json()) as RunResponse;
      if (body.run) setRun(body.run);
      if (body.note) setNote(body.note);
      if (!body.run) {
        setError(body.error?.message ?? "The plan could not be run. Please try again.");
      }
    } catch {
      setError("The plan could not be run. Check your connection and try again.");
    } finally {
      setRunning(false);
    }
  };

  const needsFiles = plan?.plan ? plan.plan.steps.length > 0 : false;

  return (
    <div className="flex flex-col gap-6" data-testid="assistant">
      {/* Which runtime, and what that means for the visitor's files. Always visible. */}
      <Card className="flex flex-col gap-2" data-testid="assistant-runtime">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>AI runtime</CardTitle>
          {/* Until the check comes back the badge says so: "Not configured" is a claim about the
              machine, and making it before anything has been checked would be a lie for a moment. */}
          <Badge tone={status?.available ? (status.local ? "success" : "warning") : "neutral"}>
            {status === null
              ? "Checking…"
              : status.available
                ? status.local
                  ? "On this device"
                  : "Third-party service"
                : "Not configured"}
          </Badge>
        </div>
        <p className="text-sm text-fg-muted">{status?.message ?? "Checking…"}</p>
        {status?.available && (
          <p className="text-sm" data-testid="assistant-disclosure">
            {status.disclosure}
          </p>
        )}
        {status && !status.available && (
          <p className="text-sm text-fg-muted">
            The assistant still works: it plans with OneStop&rsquo;s own rules, and every tool it
            runs has a built-in offline method.
          </p>
        )}
        <div>
          <Link href="/settings" className={buttonClasses("ghost", "sm")}>
            Change in Settings
          </Link>
        </div>
      </Card>

      <Card className="flex flex-col gap-4">
        <div>
          <CardTitle>What would you like done?</CardTitle>
          <p className="mt-1 text-sm text-fg-muted">
            Describe it in plain words. The assistant only ever runs OneStop tools — it can never
            run anything else.
          </p>
        </div>
        <label htmlFor="assistant-request" className="sr-only">
          Your request
        </label>
        <textarea
          id="assistant-request"
          data-testid="assistant-request"
          rows={3}
          className="w-full rounded-md border border-border bg-surface p-3 text-sm text-fg focus-visible:outline-2 focus-visible:outline-ring"
          placeholder="Convert this PDF to Excel, remove the first 2 pages, then compress the result"
          value={request}
          disabled={planning || running}
          onChange={(e) => setRequest(e.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              className="rounded-full border border-border bg-surface px-3 py-1 text-xs text-fg-muted hover:border-primary hover:text-fg"
              onClick={() => setRequest(example)}
            >
              {example}
            </button>
          ))}
        </div>

        <UploadZone
          tool={ANY_FILE}
          files={files}
          disabled={planning || running}
          onSelect={(picked) => {
            setFiles(picked);
            setError(null);
          }}
          onReject={setError}
        />
        {files.length > 0 && (
          <ul className="flex flex-col gap-1 text-sm text-fg-muted">
            {files.map((file) => (
              <li key={`${file.name}-${file.size}`}>
                {file.name} · {formatBytes(file.size)}
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={planning || running} onClick={() => void makePlan()}>
            {planning ? "Thinking…" : "Plan it"}
          </Button>
          {files.length > 0 && !planning && !running && (
            <Button variant="ghost" onClick={() => setFiles([])}>
              Clear files
            </Button>
          )}
        </div>

        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </Card>

      {plan && (
        <Card className="flex flex-col gap-3" data-testid="assistant-plan">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>{plan.plan ? "The plan" : "OneStop cannot do that"}</CardTitle>
            <Badge tone="neutral">{plan.intent.kind.replace("-", " ")}</Badge>
            {plan.runtime && (
              <Badge tone={plan.runtime.local ? "success" : "warning"}>
                planned by {plan.runtime.model}
              </Badge>
            )}
          </div>

          {plan.plan ? (
            <>
              <p className="text-sm whitespace-pre-line">{plan.plan.explanation}</p>
              <ol className="flex flex-col gap-2">
                {plan.plan.steps.map((step, index) => {
                  const tool = getTool(step.toolId);
                  const details = Object.entries(step.options ?? {})
                    .filter(([key]) => key !== "aiProvider" && key !== "aiKey")
                    .map(([key, value]) => `${key}: ${String(value)}`)
                    .join(", ");
                  return (
                    <li
                      key={`${step.toolId}-${index}`}
                      className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2 text-sm"
                    >
                      <Badge tone="neutral">{index + 1}</Badge>
                      {tool ? (
                        <Link href={toolHref(tool)} className="font-medium text-primary underline">
                          {tool.name}
                        </Link>
                      ) : (
                        <span className="font-medium">{step.toolId}</span>
                      )}
                      {details && <span className="text-fg-muted">{details}</span>}
                    </li>
                  );
                })}
              </ol>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  disabled={running || !needsFiles}
                  onClick={() => void runPlan()}
                  data-testid="assistant-run"
                >
                  {running ? "Running…" : "Run the plan"}
                </Button>
                <Button variant="ghost" disabled={running} onClick={() => setPlan(null)}>
                  Discard
                </Button>
              </div>
            </>
          ) : (
            <p className="text-sm">{plan.message}</p>
          )}

          {plan.rejected.length > 0 && (
            <div
              className="rounded-md border border-warning p-3 text-sm"
              data-testid="assistant-rejected"
            >
              <p className="font-medium">Some suggested steps were refused</p>
              <ul className="mt-1 flex flex-col gap-1 text-fg-muted">
                {plan.rejected.map((r) => (
                  <li key={r.toolId}>
                    <code className="font-mono">{r.toolId}</code> — {r.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}

      {plan?.recommendations && <Recommendations groups={plan.recommendations} />}

      {run && (
        <Card className="flex flex-col gap-3" data-testid="assistant-result">
          <div className="flex items-center gap-2">
            <Badge tone={run.ok ? "success" : "danger"}>{run.ok ? "Finished" : "Stopped"}</Badge>
            <span className="text-sm text-fg-muted">{Math.round(run.durationMs / 100) / 10}s</span>
          </div>
          {run.error && (
            <p role="alert" className="text-sm text-danger">
              {run.error}
            </p>
          )}
          {note && <p className="text-sm text-danger">{note}</p>}
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
          {run.files.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">Result</p>
              <ul className="flex flex-col gap-1">
                {run.files.map((file) => (
                  <li key={file.id}>
                    <a className="text-sm text-primary underline" href={file.url} download>
                      {file.name}
                    </a>{" "}
                    <span className="text-sm text-fg-muted">({formatBytes(file.size)})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
