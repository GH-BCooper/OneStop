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
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Fragment, useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { checkFiles, formatBytes } from "@/components/tools/UploadZone";
import { activeAiProvider, aiHeaders } from "@/lib/preferences";
import { Recommendations } from "./Recommendations";

/** Anything can be attached: which tools may run is decided by the plan, not by the picker. */
const ANY_FILE = { name: "the assistant", inputTypes: ["any"], supportsBatch: true };

const EXAMPLES = [
  {
    icon: "📄",
    text: "Convert this PDF to Excel, remove the first 2 pages, then compress the result",
  },
  { icon: "🔗", text: "Merge these PDFs and add page numbers" },
  { icon: "💬", text: "What is the notice period in this contract?" },
  { icon: "🖼️", text: "Remove the background from these photos and save them as WebP" },
  { icon: "👋", text: "Hi! What can you help me with?" },
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
          from === "user" ? "bg-primary text-primary-fg" : "border border-border bg-surface text-fg"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

/** One short line, only when the assistant cannot answer - no provider names, no setup steps. */
function OutOfService({ status }: { status: AiStatus | null }) {
  if (!status || status.available) return null;
  return (
    <p
      role="status"
      data-testid="assistant-out-of-service"
      className="rounded-lg border border-warning/50 bg-warning/10 px-3 py-2 text-sm"
    >
      AI assistant is out of service right now. Check your{" "}
      <Link href="/account?tab=app" className="font-medium underline">
        app settings
      </Link>{" "}
      for issue remediation.
    </p>
  );
}

/** Text with any http(s) address turned into a link, e.g. the "increase your credits" page. */
function Linkified({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (!/^https?:\/\//.test(part)) return <Fragment key={i}>{part}</Fragment>;
        const url = part.replace(/[.,;:!?)]+$/, "");
        const tail = part.slice(url.length);
        return (
          <Fragment key={i}>
            <a
              href={url}
              target="_blank"
              rel="noreferrer noopener"
              className="font-medium underline"
            >
              {url}
            </a>
            {tail}
          </Fragment>
        );
      })}
    </>
  );
}

const PLANNING_NOTICES = [
  "Figuring out…",
  "Processing…",
  "Preparing…",
  "Reading your request…",
  "Lining up the right tools…",
  "Last-minute changes…",
  "Almost there…",
];

const RUNNING_NOTICES = [
  "Running…",
  "Working on your files…",
  "Crunching…",
  "Putting it together…",
  "Polishing the result…",
  "Last-minute changes…",
];

/** A status line that changes every couple of seconds, so a slow answer never looks frozen. */
function RotatingNotice({ messages }: { messages: string[] }) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setIndex((i) => (i + 1) % messages.length), 2200);
    return () => clearInterval(timer);
  }, [messages]);
  return (
    <span
      role="status"
      aria-live="polite"
      data-testid="assistant-notice"
      className="inline-flex items-center gap-2 text-fg-muted"
    >
      <span aria-hidden="true" className="os-pulse-dot" />
      {messages[index]}
    </span>
  );
}

function AssistantTurn({
  turn,
  onRun,
  onDiscard,
}: {
  turn: Turn;
  onRun: () => void;
  onDiscard: () => void;
}) {
  if (turn.status === "planning") {
    return (
      <Bubble from="assistant">
        <RotatingNotice messages={PLANNING_NOTICES} />
      </Bubble>
    );
  }

  if (turn.status === "failed") {
    return (
      <Bubble from="assistant">
        <p role="alert" className="text-danger">
          <Linkified text={turn.error ?? ""} />
        </p>
      </Bubble>
    );
  }

  if (turn.status === "running") {
    return (
      <Bubble from="assistant">
        <RotatingNotice messages={RUNNING_NOTICES} />
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
          <p className="whitespace-pre-line">
            <Linkified text={plan.message ?? ""} />
          </p>
        </Bubble>
      );
    }

    if (!plan.plan) {
      return (
        <Bubble from="assistant">
          <div className="flex flex-col gap-3">
            <p className="whitespace-pre-line">
              <Linkified text={plan.message ?? ""} />
            </p>
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
            {plan.runtime && (
              <Badge tone={plan.runtime.local ? "success" : "warning"}>
                planned by {plan.runtime.model}
              </Badge>
            )}
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
          {needsFiles && (
            <p className="text-warning">Attach the file(s) this needs, then run it.</p>
          )}
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

  const provider = typeof window === "undefined" ? null : activeAiProvider();
  // Saved AI keys are namespaced to the signed-in account, so the status/greeting calls below wait
  // for the session to settle before reading them - otherwise a fast first paint could briefly use
  // the guest scope's (empty) keys for a signed-in "own provider" user.
  const { data: session, status: sessionStatus } = useSession();
  const sessionReady = sessionStatus !== "loading";
  const userId = session?.user?.id ?? null;

  const loadStatus = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/assistant/status", {
        headers: aiHeaders(),
        ...(signal ? { signal } : {}),
      });
      const body = (await response.json()) as { status?: AiStatus };
      setStatus(body.status ?? null);
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    if (!sessionReady) return;
    const controller = new AbortController();
    void loadStatus(controller.signal);
    return () => controller.abort();
  }, [loadStatus, sessionReady, userId]);

  // One hello per visit to the empty screen - fetched once, not re-fetched as turns come and go.
  useEffect(() => {
    if (!sessionReady) return;
    const controller = new AbortController();
    fetch("/api/assistant/greeting", {
      headers: aiHeaders(),
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
  }, [sessionReady, userId]);

  // The home page's "Ask OneStop AI" carries whatever was typed in its search box.
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search).get("q");
      if (q && q.trim()) setRequest(q.trim().slice(0, 4000));
    } catch {
      // No query string is the normal case.
    }
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
        headers: { "content-type": "application/json", ...aiHeaders() },
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
        headers: aiHeaders(),
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
      className={`flex flex-col gap-2 rounded-3xl border p-2 shadow-sm transition-colors ${
        dragging ? "border-primary bg-surface-muted" : "border-border bg-surface"
      }`}
    >
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 px-2 pt-1" aria-label="Attached files">
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
      <div className="flex items-end gap-1.5">
        <button
          type="button"
          aria-label="Attach files"
          disabled={busy}
          onClick={() => fileInputRef.current?.click()}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xl text-fg-muted hover:bg-surface-muted hover:text-fg disabled:opacity-60"
        >
          <span aria-hidden="true">+</span>
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
          rows={1}
          className="max-h-40 w-full flex-1 resize-none rounded-md border-0 bg-transparent px-1 py-2.5 text-sm text-fg focus-visible:outline-2 focus-visible:outline-ring"
          placeholder="Ask anything, or describe a task — or attach any file"
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
        <button
          type="button"
          aria-label="Send"
          disabled={busy || request.trim() === ""}
          onClick={() => void send()}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-lg font-bold text-primary-fg transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40"
        >
          <span aria-hidden="true">{busy ? "…" : "↑"}</span>
        </button>
      </div>
      {composerError && (
        <p role="alert" className="px-2 text-sm text-danger">
          {composerError}
        </p>
      )}
    </div>
  );

  if (turns.length === 0) {
    return (
      <div
        className="flex min-h-[65vh] flex-col items-center justify-center gap-6 py-10"
        data-testid="assistant"
      >
        <h2
          data-testid="assistant-greeting"
          className="max-w-2xl px-4 text-center text-2xl font-bold sm:text-3xl"
        >
          {greeting ?? "Where should we begin?"}
        </h2>
        <div className="w-full max-w-2xl px-4">{composer}</div>
        <div className="flex w-full max-w-md flex-col gap-0.5 px-4">
          {EXAMPLES.map((example) => (
            <button
              key={example.text}
              type="button"
              className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-fg-muted transition-colors hover:bg-surface-muted hover:text-fg"
              onClick={() => setRequest(example.text)}
            >
              <span aria-hidden="true" className="text-lg">
                {example.icon}
              </span>
              <span>{example.text}</span>
            </button>
          ))}
        </div>
        <div className="w-full max-w-md px-4">
          <OutOfService status={status} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="assistant">
      <OutOfService status={status} />
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
