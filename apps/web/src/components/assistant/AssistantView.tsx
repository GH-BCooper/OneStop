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

// What the client tells the assistant about each saved workflow (see the plan route).
interface WorkflowSummary {
  id: string;
  name: string;
  favorite: boolean;
  useCount: number;
  lastUsedAt: string | null;
  steps?: { toolId: string; options?: Record<string, unknown> }[];
}
import { Badge, Button, buttonClasses, Card } from "@onestop/ui";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { checkFiles, formatBytes } from "@/components/tools/UploadZone";
import {
  createThread,
  fallbackTitle,
  getThread,
  newThreadId,
  renameThread,
  saveThreadTurns,
  type StoredTurn,
} from "@/lib/assistant-threads";
import { useFavorites } from "@/lib/use-favorites";
import { activeAiProvider, aiHeaders } from "@/lib/preferences";
import {
  fetchWorkflows,
  readLocalWorkflows,
  saveLocalWorkflow,
  saveRemoteWorkflow,
  WORKFLOWS_CHANGED,
} from "@/lib/workflows";
import { AgentTurnView, RotatingNotice, PLANNING_NOTICES } from "./AgentTurn";
import type { AgentTurnData } from "@/lib/agent-types";
import { Markdown } from "./Markdown";
import { Recommendations } from "./Recommendations";
import { ToolCatalogue } from "./ToolCatalogue";

/** Anything can be attached: which tools may run is decided by the plan, not by the picker. */
const ANY_FILE = { name: "the assistant", inputTypes: ["any"], supportsBatch: true };

const EXAMPLES = [
  { icon: "🔗", title: "Make a QR code", text: "Make a QR code for https://example.com" },
  { icon: "🔐", title: "Hash & encode", text: "Hash the text OneStop with SHA-256, then Base64 encode the hash" },
  { icon: "📄", title: "Chain PDF tools", text: "Merge these PDFs, remove page 2, then compress the result" },
  { icon: "🔁", title: "Build a workflow", text: "Create a workflow that converts a PDF to Word and compresses it, call it PDF Shrinker" },
  { icon: "📊", title: "Clean my data", text: "Convert this CSV to JSON and tell me who the oldest person is" },
  { icon: "🧭", title: "Find the right tool", text: "How do I resize an image? Which options do I get?" },
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

interface FileMeta {
  name: string;
  size: number;
}

interface Turn {
  id: string;
  request: string;
  /** The live `File` objects — only present for turns created this session (needed to run them). */
  files: File[];
  /** Name/size for display, always present — this is what survives a reload. */
  fileMeta: FileMeta[];
  status: TurnStatus;
  plan?: AssistantPlan;
  run?: WorkflowRunResult;
  note?: string | null;
  error?: string;
  agent?: AgentTurnData | undefined;
}

function toStored(turn: Turn): StoredTurn {
  return {
    id: turn.id,
    request: turn.request,
    files: turn.fileMeta,
    status: turn.status,
    ...(turn.plan ? { plan: turn.plan } : {}),
    ...(turn.run ? { run: turn.run } : {}),
    ...(turn.note !== undefined ? { note: turn.note } : {}),
    ...(turn.error !== undefined ? { error: turn.error } : {}),
    ...(turn.agent ? { agent: turn.agent } : {}),
  };
}

function fromStored(turn: StoredTurn): Turn {
  // A turn saved mid-flight can never finish once the page has reloaded - showing it as still
  // "working" would leave the composer locked forever.
  const interrupted = turn.status === "planning" || turn.status === "running";
  return {
    id: turn.id,
    request: turn.request,
    files: [],
    fileMeta: turn.files,
    status: interrupted ? "failed" : turn.status,
    ...(interrupted ? { error: "That request was interrupted. Send it again." } : {}),
    ...(turn.plan ? { plan: turn.plan } : {}),
    ...(turn.run ? { run: turn.run } : {}),
    ...(turn.note !== undefined ? { note: turn.note } : {}),
    ...(!interrupted && turn.error !== undefined ? { error: turn.error } : {}),
    ...(turn.agent ? { agent: turn.agent } : {}),
  };
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

/** A little over the server's own per-call AI budget (120s), so the server's reason wins if it can. */
const PLAN_TIMEOUT_MS = 150_000;
/** A whole agent turn (several model calls plus the tools): generous, but never forever. */
const AGENT_TIMEOUT_MS = 300_000;

const RUNNING_NOTICES = [
  "Running…",
  "Working on your files…",
  "Crunching…",
  "Putting it together…",
  "Polishing the result…",
  "Last-minute changes…",
];

function AssistantTurn({
  turn,
  onRun,
  onDiscard,
}: {
  turn: Turn;
  onRun: () => void;
  onDiscard: () => void;
}) {
  if (turn.agent && turn.status !== "failed") {
    return (
      <Bubble from="assistant">
        <AgentTurnView data={turn.agent} live={turn.status === "planning" || turn.status === "running"} />
      </Bubble>
    );
  }

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
        <Card className="flex flex-col gap-3" data-testid="assistant-result">
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
        </Card>
      </Bubble>
    );
  }

  if (turn.status === "planned" && turn.plan) {
    const plan = turn.plan;

    // Plain conversation: no tool ran, nothing to confirm — just the reply.
    if (plan.intent.kind === "chat") {
      return (
        <Bubble from="assistant">
          <Markdown text={plan.message ?? ""} />
        </Bubble>
      );
    }

    // "List the pdf tools" etc. — a registry listing, not a plan to confirm and run.
    if (plan.intent.kind === "catalogue") {
      return (
        <Bubble from="assistant">
          <div className="flex flex-col gap-3">
            <p className="whitespace-pre-line">{plan.message}</p>
            {plan.catalogue && plan.catalogue.totalTools > 0 && (
              <ToolCatalogue catalogue={plan.catalogue} />
            )}
          </div>
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
        <Card className="flex flex-col gap-3" data-testid="assistant-plan">
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
        </Card>
      </Bubble>
    );
  }

  return null;
}

export function AssistantView() {
  // The thread comes from the URL on the client. A brand-new chat gets its URL through the
  // History API (not a router navigation), which keeps this component mounted so the answer that
  // is still on its way lands in the right place - a full navigation remounts it and loses it.
  const pathname = usePathname();
  const threadId = pathname.startsWith("/assistant/") ? (pathname.split("/")[2] ?? null) : null;
  const [request, setRequest] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [greeting, setGreeting] = useState<string | null>(null);
  const [turns, setTurnsState] = useState<Turn[]>([]);
  // Always the latest list, so async callbacks can compute the next one without a state updater
  // (an updater must stay pure: saving a thread from inside one updated the sidebar mid-render).
  const turnsRef = useRef<Turn[]>([]);
  const setTurns = (next: Turn[]) => {
    turnsRef.current = next;
    setTurnsState(next);
  };
  const [composerError, setComposerError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const transcriptEnd = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // The request currently in flight, so the Stop button can cancel it.
  const inFlight = useRef<AbortController | null>(null);

  // The active thread id. A ref, not state: `send()` and `updateTurn()` run inside async callbacks
  // and setState updaters and need the id that is current *right now*, not one captured when the
  // closure was created.
  const currentIdRef = useRef<string | null>(threadId);
  // Set by `send()` for the one render where it creates a brand-new thread and pushes its URL
  // itself — the prop change that follows is an echo of that, not a switch to hydrate from storage.
  const skipNextHydrateRef = useRef(false);

  // Every other change of `threadId` — a sidebar click, "New chat", the browser's own back/forward
  // button, or a direct/refreshed load of `/assistant/<id>` — reloads that thread's turns from
  // storage. This also covers the initial mount, so a refresh on a thread's URL restores its chat.
  useEffect(() => {
    const incoming = threadId ?? null;
    currentIdRef.current = incoming;
    if (skipNextHydrateRef.current) {
      skipNextHydrateRef.current = false;
      return;
    }
    setTurns(incoming ? (getThread(incoming)?.turns.map(fromStored) ?? []) : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  const provider = typeof window === "undefined" ? null : activeAiProvider();
  // Saved AI keys are namespaced to the signed-in account, so the status/greeting calls below wait
  // for the session to settle before reading them - otherwise a fast first paint could briefly use
  // the guest scope's (empty) keys for a signed-in "own provider" user.
  const { data: session, status: sessionStatus } = useSession();
  const sessionReady = sessionStatus !== "loading";
  const userId = session?.user?.id ?? null;
  const { favorites, isFavorite, toggle: toggleFavorite } = useFavorites();

  // "list my workflows" needs the same list the Workflows page shows — account or this device —
  // kept in hand so a "catalogue" answer never has to fetch anything mid-turn.
  const [workflowSummaries, setWorkflowSummaries] = useState<WorkflowSummary[]>([]);
  useEffect(() => {
    if (!sessionReady) return;
    let cancelled = false;
    const load = async () => {
      try {
        const list = userId ? await fetchWorkflows() : readLocalWorkflows();
        if (!cancelled) setWorkflowSummaries(list.map((w) => ({
            id: w.id,
            name: w.name,
            favorite: w.favorite,
            useCount: w.useCount,
            lastUsedAt: w.lastUsedAt,
            steps: w.steps,
          })));
      } catch {
        if (!cancelled) setWorkflowSummaries([]);
      }
    };
    void load();
    window.addEventListener(WORKFLOWS_CHANGED, load);
    return () => {
      cancelled = true;
      window.removeEventListener(WORKFLOWS_CHANGED, load);
    };
  }, [sessionReady, userId]);

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

  // The home page's "Ask OneStop AI" carries whatever was typed in its search box. It is a
  // message the user already pressed send on, so it is sent — not left sitting in the composer.
  // The query string is dropped afterwards so a refresh does not ask the same thing twice.
  const [pending, setPending] = useState<string | null>(null);
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search).get("q");
      if (!q || q.trim() === "") return;
      setPending(q.trim().slice(0, 4000));
      window.history.replaceState(null, "", window.location.pathname);
    } catch {
      // No query string is the normal case.
    }
  }, []);

  useEffect(() => {
    if (pending === null || !sessionReady) return;
    setPending(null);
    void send(pending);
    // `send` is deliberately not a dependency: it is re-created every render, and clearing
    // `pending` above is what keeps this to exactly one send.
  }, [pending, sessionReady]);

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
    const next = turnsRef.current.map((t) => (t.id === id ? { ...t, ...patch } : t));
    setTurns(next);
    if (currentIdRef.current) saveThreadTurns(currentIdRef.current, next.map(toStored));
  };

  const stop = () => inFlight.current?.abort();

  const send = async (override?: string) => {
    const text = (override ?? request).trim();
    if (text === "") {
      setComposerError("Describe what you would like done, or just say hello.");
      return;
    }
    setComposerError(null);
    const id = crypto.randomUUID();
    // Prior plain-conversation turns from this same thread, oldest first, round-tripped so the
    // assistant can answer a follow-up ("what did I just ask", "my name") — nothing is persisted
    // server-side, so this is the only place the history lives.
    const history = turns
      .flatMap((t) => {
        const answer = t.agent?.message ?? (t.plan?.intent.kind === "chat" ? t.plan.message : null);
        return answer
          ? [
              { role: "user" as const, content: t.request },
              { role: "assistant" as const, content: answer },
            ]
          : [];
      })
      .slice(-16);
    const fileMeta = files.map((f) => ({ name: f.name, size: f.size }));
    const turn: Turn = { id, request: text, files, fileMeta, status: "planning" };

    // First message of a fresh conversation: mint the thread now, give it a URL of its own (so the
    // browser's back button walks back through chats, per the redesign), and title it — first with
    // a plain truncation, then upgraded in the background if the AI can do better.
    let startTitle: () => void = () => {};
    const isNewThread = currentIdRef.current === null;
    const activeId = currentIdRef.current ?? newThreadId();
    if (isNewThread) {
      currentIdRef.current = activeId;
      skipNextHydrateRef.current = true;
      createThread(activeId, fallbackTitle(text), toStored(turn));
      window.history.pushState(null, "", `/assistant/${activeId}`);
      // Started only once the answer is in (see below): a local model on a CPU handles one request
      // at a time, and a cosmetic title must never make the real answer wait behind it.
      startTitle = () => {
        fetch("/api/assistant/title", {
          method: "POST",
          headers: { "content-type": "application/json", ...aiHeaders() },
          body: JSON.stringify({ request: text, provider }),
          signal: AbortSignal.timeout(30_000),
        })
          .then((r) => r.json())
          .then((body: { title?: string }) => {
            if (body.title) renameThread(activeId, body.title);
          })
          .catch(() => {
            // A title is cosmetic — the truncated fallback already saved above is fine on its own.
          });
      };
    } else {
      saveThreadTurns(activeId, [...turns, turn].map(toStored));
    }

    setTurns([...turnsRef.current, turn]);
    setRequest("");
    setFiles([]);

    const controller = new AbortController();
    inFlight.current = controller;
    try {
      const outcome = await runAgent(turn, history, controller);
      if (outcome === "fallback") {
        updateTurn(id, { agent: undefined });
        await legacyPlan(turn, history, controller);
      }
    } catch (err) {
      const stopped = controller.signal.aborted;
      const timedOut = err instanceof DOMException && err.name === "TimeoutError";
      updateTurn(id, {
        status: "failed",
        error: stopped
          ? "Stopped."
          : timedOut
            ? "The AI is taking too long to answer. If you use Ollama, it may be slow on this computer — try a smaller model, or pick another AI service in settings."
            : "The assistant could not be reached. Check your connection and try again.",
      });
    } finally {
      if (inFlight.current === controller) inFlight.current = null;
      startTitle();
    }
  };

  /** Applies what the agent asked the app itself to do: save a workflow, star a tool. */
  const applyActions = async (actions: AgentTurnData["actions"]) => {
    for (const action of actions) {
      try {
        if (action.type === "save_workflow") {
          const input = { name: action.name, steps: action.steps };
          if (userId) await saveRemoteWorkflow(input);
          else saveLocalWorkflow(input);
        } else if (action.type === "favorite" && isFavorite(action.toolId) !== action.on) {
          toggleFavorite(action.toolId);
        }
      } catch (err) {
        console.error("[assistant] could not apply an action", err);
      }
    }
  };

  /** One agentic turn over the NDJSON stream. "fallback" means no AI runtime: use the rule planner. */
  const runAgent = async (
    turn: Turn,
    history: { role: "user" | "assistant"; content: string }[],
    controller: AbortController,
  ): Promise<"done" | "fallback"> => {
    const form = new FormData();
    form.set("message", turn.request);
    form.set("history", JSON.stringify(history));
    form.set("workflows", JSON.stringify(workflowSummaries));
    form.set("favoriteToolIds", JSON.stringify(favorites));
    if (provider) form.set("provider", provider);
    for (const file of turn.files) form.append("files", file);

    const data: AgentTurnData = {
      steps: [],
      message: null,
      files: [],
      outputs: [],
      actions: [],
      model: null,
    };
    const push = () => {
      updateTurn(turn.id, { status: "planning", agent: { ...data, steps: [...data.steps] } });
    };
    push();

    const response = await fetch("/api/assistant/agent", {
      method: "POST",
      headers: aiHeaders(),
      body: form,
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(AGENT_TIMEOUT_MS)]),
    });
    // No readable stream (an old server, a proxy that buffers): the plan flow still works.
    if (!response.body) return "fallback";
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finished = false;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl = buffer.indexOf("\n");
      while (nl >= 0) {
        const raw = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        nl = buffer.indexOf("\n");
        if (raw === "") continue;
        let event: Record<string, unknown>;
        try {
          event = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          continue;
        }
        if (event.type === "step") {
          const step = event as unknown as AgentTurnData["steps"][number];
          const i = data.steps.findIndex((x) => x.id === step.id);
          if (i >= 0) data.steps[i] = step;
          else data.steps.push(step);
          push();
        } else if (event.type === "final") {
          finished = true;
          const runtime = event.runtime as { model?: string } | null;
          Object.assign(data, {
            message: String(event.message ?? ""),
            files: event.files ?? [],
            outputs: event.outputs ?? [],
            actions: event.actions ?? [],
            model: runtime?.model ?? null,
          });
          updateTurn(turn.id, { status: "done", agent: { ...data, steps: [...data.steps] } });
          void applyActions(data.actions);
        } else if (event.type === "error") {
          finished = true;
          // Any AI trouble (none configured, rate limit, timeout) drops to the rule planner, which
          // needs no model - the assistant keeps doing what it can rather than just apologising.
          if (String(event.code).startsWith("AI_")) return "fallback";
          updateTurn(turn.id, {
            status: "failed",
            error: String(event.message ?? "The assistant hit a problem."),
          });
        }
      }
    }
    if (!finished) {
      updateTurn(turn.id, {
        status: "failed",
        error: "The connection dropped before the answer finished. Please try again.",
      });
    }
    return "done";
  };

  /** The original plan-then-confirm flow: works with no AI at all, via the rule planner. */
  const legacyPlan = async (
    turn: Turn,
    history: { role: "user" | "assistant"; content: string }[],
    controller: AbortController,
  ) => {
    updateTurn(turn.id, { status: "planning" });
    const response = await fetch("/api/assistant/plan", {
      method: "POST",
      headers: { "content-type": "application/json", ...aiHeaders() },
      body: JSON.stringify({
        request: turn.request,
        fileNames: turn.files.map((f) => f.name),
        history,
        provider,
        workflows: workflowSummaries,
        favoriteToolIds: favorites,
      }),
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(PLAN_TIMEOUT_MS)]),
    });
    const body = (await response.json()) as PlanResponse;
    if (body.plan) updateTurn(turn.id, { status: "planned", plan: body.plan });
    else {
      updateTurn(turn.id, {
        status: "failed",
        error: body.error?.message ?? "The assistant could not plan that. Please try again.",
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

    const controller = new AbortController();
    inFlight.current = controller;
    try {
      const response = await fetch("/api/assistant/run", {
        method: "POST",
        headers: aiHeaders(),
        body: form,
        signal: controller.signal,
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
        error: controller.signal.aborted
          ? "Stopped."
          : "The plan could not be run. Check your connection and try again.",
      });
    } finally {
      if (inFlight.current === controller) inFlight.current = null;
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
        {busy ? (
          <button
            type="button"
            aria-label="Stop"
            data-testid="assistant-stop"
            onClick={stop}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-fg transition-colors hover:bg-primary-hover"
          >
            <span aria-hidden="true" className="block h-3.5 w-3.5 rounded-sm bg-current" />
          </button>
        ) : (
          <button
            type="button"
            aria-label="Send"
            disabled={request.trim() === ""}
            onClick={() => void send()}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-lg font-bold text-primary-fg transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span aria-hidden="true">↑</span>
          </button>
        )}
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
        <div className="grid w-full max-w-2xl grid-cols-1 gap-2 px-4 sm:grid-cols-2">
          {EXAMPLES.map((example) => (
            <button
              key={example.text}
              type="button"
              className="os-glow os-rise flex items-start gap-3 rounded-xl border border-border bg-surface/70 px-3 py-2.5 text-left text-sm backdrop-blur transition-[transform,border-color] duration-200 hover:-translate-y-0.5 hover:border-primary"
              onClick={() => setRequest(example.text)}
            >
              <span aria-hidden="true" className="text-xl">
                {example.icon}
              </span>
              <span className="min-w-0">
                <span className="block font-semibold">{example.title}</span>
                <span className="block text-xs text-fg-muted">{example.text}</span>
              </span>
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
              {turn.fileMeta.length > 0 && (
                <ul className="mt-1 text-xs opacity-80">
                  {turn.fileMeta.map((f) => (
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
              onDiscard={() => {
                const next = turnsRef.current.filter((t) => t.id !== turn.id);
                setTurns(next);
                if (currentIdRef.current) saveThreadTurns(currentIdRef.current, next.map(toStored));
              }}
            />
          </div>
        ))}
        <div ref={transcriptEnd} />
      </div>
      {composer}
    </div>
  );
}
