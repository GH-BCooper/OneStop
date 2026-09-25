"use client";

// One agentic answer: the live list of tool steps, then the reply, downloads, tool output and
// any buttons the assistant handed over (open a page, etc.).
import { Button, buttonClasses } from "@onestop/ui";
import Link from "next/link";
import { useEffect, useState } from "react";
import { formatBytes } from "@/components/tools/UploadZone";
import type { AgentTurnData } from "@/lib/agent-types";
import { Markdown } from "./Markdown";

export const PLANNING_NOTICES = [
  "Figuring out…",
  "Processing…",
  "Preparing…",
  "Reading your request…",
  "Lining up the right tools…",
  "Last-minute changes…",
  "Almost there…",
];

/** A status line that changes every couple of seconds, so a slow answer never looks frozen. */
export function RotatingNotice({ messages }: { messages: string[] }) {
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

const dot = { running: "os-pulse-dot", done: "bg-success", failed: "bg-danger" } as const;

function Steps({ data, live }: { data: AgentTurnData; live: boolean }) {
  if (data.steps.length === 0) return null;
  return (
    <ol
      className="flex flex-col gap-1.5"
      data-testid="agent-steps"
      aria-label="What the assistant did"
    >
      {data.steps.map((step) => (
        <li
          key={step.id}
          className="os-rise flex items-start gap-2 rounded-lg border border-border bg-surface-muted/60 px-2.5 py-1.5 text-xs"
        >
          <span
            aria-hidden="true"
            className={`mt-1 inline-block h-2 w-2 shrink-0 rounded-full ${
              step.status === "running" && live
                ? dot.running
                : step.status === "failed"
                  ? dot.failed
                  : dot.done
            }`}
          />
          <span className="min-w-0">
            <span className="font-medium">{step.label}</span>
            {step.detail && <span className="block truncate text-fg-muted">{step.detail}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

function OutputText({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <pre className="max-h-64 overflow-auto rounded-lg border border-border bg-surface-muted p-2.5 font-mono text-xs whitespace-pre-wrap">
        {text.slice(0, 6000)}
      </pre>
      <Button
        size="sm"
        variant="ghost"
        className="self-start"
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? "Copied ✓" : "Copy result"}
      </Button>
    </div>
  );
}

export function AgentTurnView({ data, live }: { data: AgentTurnData; live: boolean }) {
  const shownText = data.outputs.filter((o) => o.text && o.text.length <= 6000).slice(-1)[0];
  return (
    <div className="flex flex-col gap-3" data-testid="assistant-agent">
      <Steps data={data} live={live} />
      {live && data.message === null && <RotatingNotice messages={PLANNING_NOTICES} />}
      {data.message !== null && (
        <div className="os-rise">
          <Markdown text={data.message} />
        </div>
      )}
      {shownText?.text && <OutputText text={shownText.text} />}
      {data.files.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {data.files.map((file) => (
            <li key={file.id}>
              <a
                className={buttonClasses("secondary", "sm")}
                href={file.url}
                download
                data-testid="result-download"
              >
                ⬇ {file.name}{" "}
                <span className="text-xs text-fg-muted">({formatBytes(file.size)})</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      {data.actions.some((a) => a.type === "navigate") && (
        <div className="flex flex-wrap gap-2">
          {data.actions.map((a, i) =>
            a.type === "navigate" ? (
              <Link key={i} href={a.href} className={buttonClasses("primary", "sm")}>
                {a.label} →
              </Link>
            ) : null,
          )}
        </div>
      )}
      {data.actions.filter((a) => a.type !== "navigate").length > 0 && !live && (
        <p className="text-xs text-fg-muted">
          {data.actions
            .map((a) =>
              a.type === "save_workflow"
                ? `Workflow “${a.name}” saved`
                : a.type === "favorite"
                  ? a.on
                    ? `Starred ${a.toolId}`
                    : `Unstarred ${a.toolId}`
                  : "",
            )
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
      {data.model && !live && <p className="text-[11px] text-fg-muted">via {data.model}</p>}
    </div>
  );
}
