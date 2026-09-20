"use client";

// `/assistant` — the AI Assistant, as a chat (16-ai-assistant.md; item 6 of the redesign).
//
// The pipeline underneath is unchanged (master plan §7.2): plan first, run only on request, and
// the assistant can never call anything outside the tool registry. What changed is the shell: a
// transcript of turns instead of one card that gets replaced, so a conversation can go back and
// forth and attach different files each time — and a new "chat" intent (server-side, `ai/intent.ts`
// + `ai/assistant.ts`) so small talk and general questions get an actual conversational reply
// instead of "OneStop cannot do that".
import { getTool, toolHref } from "@onestop/tool-registry";
import type { AiStatus, AssistantPlan, WorkflowRunResult } from "@onestop/types";
import { Badge, Button, buttonClasses } from "@onestop/ui";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { checkFiles, formatBytes } from "@/components/tools/UploadZone";
import { aiHeaders, readPreferredAI } from "@/lib/preferences";
import { Recommendations } from "./Recommendations";

/** Anything can be attached: which tools may run is decided by the plan, not by the picker. */
const ANY_FILE = { name: "the assistant", inputTypes: ["any"], supportsBatch: true };

const EXAMPLES = [
  "Convert this PDF to Excel, remove the first 2 pages, then compress the result",
  "Merge these PDFs and add page numbers",
  "What is the notice period in this contract?",
  "Remove the background from these photos and save them as WebP",
  "Hi! What can you help me with?",
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
  error?: { message?: string };
}

type TurnStatus = "planning" | "planned" | "running" | "done" | "failed";

interface Turn {
  id: string;
  request: string;
  files: File[];
  status: TurnStatus;
  plan?: AssistantPlan;
  run?: WorkflowRunResult;
  note?: string | null;
  error?: string;
}

const statusTone = { success: "success", failed: "danger", skipped: "neutral" } as const;

function Bubble({ from, children }: { from: "user" | "assistant"; children: React.ReactNode }) {
  return (
    <div className={`flex ${from === "user" ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${
          from === "user"
            ? "bg-primary text-primary-fg"
            : "border border-border bg-surface text-fg"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

function RuntimeStatus({ status }: { status: AiStatus | null }) {
  return (
    <div className="flex flex-col gap-1 text-xs text-fg-muted" data-testid="assistant-runtime">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={status?.available ? (status.local ? "success" : "warning") : "neutral"}>
          {status === null
            ? "Checking…"
            : status.available
              ? status.local
                ? "On this device"
                : "Third-party service"
              : "Not configured"}
        </Badge>
        <span>{status?.message ?? "Checking…"}</span>
        <Link href="/settings" className="text-primary hover:underline">
          Change in Settings
        </Link>
      </div>
      {status?.available && <p data-testid="assistant-disclosure">{status.disclosure}</p>}
      {status && !status.available && (
        <p>
          The assistant still works: it plans with OneStop&rsquo;s own rules, and every tool it
          runs has a built-in offline method.
        </p>
      )}
    </div>
  );
}

function AssistantTurn({ turn, onRun, onDiscard }: { turn: Turn; onRun: () => void; onDiscard: () => void }) {
  if (turn.status === "planning") {
    return (
      <Bubble from="assistant">
        <span className="text-fg-muted">Thinking…</span>
      </Bubble>
    );
  }

  if (turn.status === "failed") {
    return (
      <Bubble from="assistant">
        <p role="alert" className="text-danger">
          {turn.error}
        </p>
      </Bubble>
    );
  }

  if (turn.status === "running") {
    return (
      <Bubble from="assistant">
        <span className="text-fg-muted">Running…</span>
      </Bubble>
    );
  }

  if (turn.status === "done" && turn.run) {
    const run = turn.run;
    return (
      <Bubble from="assistant">
        <div className="flex flex-col gap-3" data-testid="assistant-result">
          <div className="flex items-center gap-2">
            <Badge tone={run.ok ? "success" : "danger"}>{run.ok ? "Finished" : "Stopped"}</Badge>
            <span className="text-xs text-fg-muted">{Math.round(run.durationMs / 100) / 10}s</span>
          </div>
          {run.error && (
            <p role="alert" className="text-danger">
              {run.error}
            </p>
          )}
          {turn.note && <p className="text-danger">{turn.note}</p>}
          <ol className="flex flex-col gap-2">
            {run.steps.map((step) => (
              <li
                key={step.index}
                className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2"
              >
                <Badge tone={statusTone[step.status]}>{step.index + 1}</Badge>
                <span className="font-medium">{step.toolName}</span>
                <span className="text-fg-muted">{step.error ?? step.summary ?? step.status}</span>
              </li>
            ))}
          </ol>
          {run.files.length > 0 && (
            <div className="flex flex-col gap-2">
              <ul className="flex flex-col gap-1">
                {run.files.map((file) => (
                  <li key={file.id}>
                    <a
                      className={buttonClasses("secondary", "sm")}
                      href={file.url}
                      download
                      data-testid="result-download"
                    >
                      Download {file.name}
                    </a>{" "}
                    <span className="text-xs text-fg-muted">({formatBytes(file.size)})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Bubble>
    );
  }

  if (turn.status === "planned" && turn.plan) {
    const plan = turn.plan;

    // Plain conversation: no tool ran, nothing to confirm — just the reply.
    if (plan.intent.kind === "chat") {
      return (
        <Bubble from="assistant">
          <p className="whitespace-pre-line">{plan.message}</p>
        </Bubble>
      );
    }

    if (!plan.plan) {
      return (
        <Bubble from="assistant">
          <div className="flex flex-col gap-3">
            <p className="whitespace-pre-line">{plan.message}</p>
            {plan.recommendations && <Recommendations groups={plan.recommendations} />}
          </div>
        </Bubble>
      );
    }

    const needsFiles = plan.plan.steps.length > 0 && turn.files.length === 0;

    return (
      <Bubble from="assistant">
        <div className="flex flex-col gap-3" data-testid="assistant-plan">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="neutral">{plan.intent.kind.replace("-", " ")}</Badge>
            {plan.runtime && <Badge tone={plan.runtime.local ? "success" : "warning"}>planned by {plan.runtime.model}</Badge>}
          </div>
          <p className="whitespace-pre-line">{plan.plan.explanation}</p>
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
                  className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2"
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
          {plan.rejected.length > 0 && (
            <div className="rounded-md border border-warning p-3" data-testid="assistant-rejected">
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
          {needsFiles && <p className="text-warning">Attach the file(s) this needs, then run it.</p>}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={needsFiles} onClick={onRun} data-testid="assistant-run">
              Run
            </Button>
            <Button size="sm" variant="ghost" onClick={onDiscard}>
              Discard
            </Button>
          </div>
        </div>
      </Bubble>
    );
  }

  return null;
}

export function AssistantView() {
  const [request, setRequest] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [greeting, setGreeting] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const transcriptEnd = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadStatus(controller.signal);
    return () => controller.abort();
  }, [loadStatus]);

  // One hello per visit to the empty screen - fetched once, not re-fetched as turns come and go.
  useEffect(() => {
    const controller = new AbortController();
    const picked = readPreferredAI();
    const query = picked ? `?provider=${encodeURIComponent(picked)}` : "";
    fetch(`/api/assistant/greeting${query}`, {
      headers: aiHeaders(picked),
      signal: controller.signal,
    })
      .then((response) => response.json())
      .then((body: { greeting?: { message?: string } }) => {
        if (body.greeting?.message) setGreeting(body.greeting.message);
      })
      .catch(() => {
        // No greeting is a cosmetic loss, never a blocker - the composer works either way.
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    transcriptEnd.current?.scrollIntoView?.({ behavior: "smooth", block: "end" });
  }, [turns]);

  const busy = turns.some((t) => t.status === "planning" || t.status === "running");

  const addFiles = (picked: File[]) => {
    if (picked.length === 0) return;
    const next = [...files, ...picked];
    const problem = checkFiles(ANY_FILE, next);
    if (problem) {
      setComposerError(problem);
      return;
    }
    setComposerError(null);
    setFiles(next);
  };

  const removeFileAt = (index: number) => {
    setFiles((all) => all.filter((_, i) => i !== index));
  };

  const updateTurn = (id: string, patch: Partial<Turn>) => {
    setTurns((all) => all.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  };

  const send = async () => {
    if (request.trim() === "") {
      setComposerError("Describe what you would like done, or just say hello.");
      return;
    }
    setComposerError(null);
    const id = crypto.randomUUID();
    const turn: Turn = { id, request: request.trim(), files, status: "planning" };
    setTurns((all) => [...all, turn]);
    setRequest("");
    setFiles([]);

    try {
      const response = await fetch("/api/assistant/plan", {
        method: "POST",
        headers: { "content-type": "application/json", ...aiHeaders(provider) },
        body: JSON.stringify({
          request: turn.request,
          fileNames: turn.files.map((f) => f.name),
          provider,
        }),
      });
      const body = (await response.json()) as PlanResponse;
      if (body.plan) updateTurn(id, { status: "planned", plan: body.plan });
      else {
        updateTurn(id, {
          status: "failed",
          error: body.error?.message ?? "The assistant could not plan that. Please try again.",
        });
      }
    } catch {
      updateTurn(id, {
        status: "failed",
        error: "The assistant could not be reached. Check your connection and try again.",
      });
    }
  };

  const runTurn = async (id: string) => {
    const turn = turns.find((t) => t.id === id);
    if (!turn?.plan?.plan) return;
    updateTurn(id, { status: "running" });

    const form = new FormData();
    form.set("plan", JSON.stringify(turn.plan.plan.steps));
    if (provider) form.set("provider", provider);
    for (const file of turn.files) form.append("files", file);

    try {
      const response = await fetch("/api/assistant/run", {
        method: "POST",
        headers: aiHeaders(provider),
        body: form,
      });
      const body = (await response.json()) as RunResponse;
      if (body.run) updateTurn(id, { status: "done", run: body.run, note: body.note ?? null });
      else {
        updateTurn(id, {
          status: "failed",
          error: body.error?.message ?? "The plan could not be run. Please try again.",
        });
      }
    } catch {
      updateTurn(id, {
        status: "failed",
        error: "The plan could not be run. Check your connection and try again.",
      });
    }
  };

  const composer = (
    <div
      data-testid="assistant-composer"
      data-dragging={dragging ? "true" : "false"}
      onDragOver={(e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        if (!busy) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setDragging(false);
        if (!busy) addFiles(Array.from(e.dataTransfer.files));
      }}
      className={`flex flex-col gap-2 rounded-2xl border p-2 transition-colors ${
        dragging ? "border-primary bg-surface-muted" : "border-border bg-surface"
      }`}
    >
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 px-1 pt-1" aria-label="Attached files">
          {files.map((file, i) => (
            <li
              key={`${file.name}-${file.size}-${i}`}
              className="flex items-center gap-1.5 rounded-full bg-surface-muted px-2.5 py-1 text-xs"
            >
              <span className="max-w-40 truncate">📎 {file.name}</span>
              <span className="text-fg-muted">{formatBytes(file.size)}</span>
              <button
                type="button"
                aria-label={`Remove ${file.name}`}
                disabled={busy}
                className="text-fg-muted hover:text-danger disabled:opacity-60"
                onClick={() => removeFileAt(i)}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <label htmlFor="assistant-request" className="sr-only">
        Message the assistant
      </label>
      <div className="flex items-end gap-2">
        <button
          type="button"
          aria-label="Attach files"
          disabled={busy}
          onClick={() => fileInputRef.current?.click()}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border text-lg hover:bg-surface-muted disabled:opacity-60"
        >
          <span aria-hidden="true">📎</span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          aria-label="Attach files"
          className="sr-only"
          disabled={busy}
          onChange={(e) => {
            addFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
        <textarea
          id="assistant-request"
          data-testid="assistant-request"
          rows={2}
          className="w-full flex-1 resize-none rounded-md border-0 bg-transparent p-2 text-sm text-fg focus-visible:outline-2 focus-visible:outline-ring"
          placeholder="Ask anything, or describe a task — e.g. convert this PDF to Excel — or attach any file"
          value={request}
          disabled={busy}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          onChange={(e) => setRequest(e.target.value)}
        />
        <Button size="lg" disabled={busy} onClick={() => void send()}>
          {busy ? "…" : "Send"}
        </Button>
      </div>
      {composerError && (
        <p role="alert" className="px-1 text-sm text-danger">
          {composerError}
        </p>
      )}
    </div>
  );

  if (turns.length === 0) {
    return (
      <div className="flex flex-col gap-6" data-testid="assistant">
        <RuntimeStatus status={status} />
        {greeting && (
          <div className="mx-auto w-full max-w-2xl">
            <Bubble from="assistant">
              <p data-testid="assistant-greeting">{greeting}</p>
            </Bubble>
          </div>
        )}
        <div className="mx-auto w-full max-w-2xl">{composer}</div>
        <div className="flex flex-col items-center gap-4 py-6 text-center">
          <p className="text-2xl font-bold">What would you like done?</p>
          <p className="max-w-xl text-sm text-fg-muted">
            Chat naturally, attach any file — documents, images, audio, video — or describe a task.
            The assistant only ever runs OneStop&rsquo;s own tools, and always shows the plan before
            running it.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
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
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="assistant">
      <RuntimeStatus status={status} />
      <div className="flex flex-col gap-4">
        {turns.map((turn) => (
          <div key={turn.id} className="flex flex-col gap-3">
            <Bubble from="user">
              <p className="whitespace-pre-line">{turn.request}</p>
              {turn.files.length > 0 && (
                <ul className="mt-1 text-xs opacity-80">
                  {turn.files.map((f) => (
                    <li key={f.name}>
                      📎 {f.name} · {formatBytes(f.size)}
                    </li>
                  ))}
                </ul>
              )}
            </Bubble>
            <AssistantTurn
              turn={turn}
              onRun={() => void runTurn(turn.id)}
              onDiscard={() => setTurns((all) => all.filter((t) => t.id !== turn.id))}
            />
          </div>
        ))}
        <div ref={transcriptEnd} />
      </div>
      {composer}
    </div>
  );
}
