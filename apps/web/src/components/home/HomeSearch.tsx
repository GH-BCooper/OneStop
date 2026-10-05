"use client";

import { Button } from "@onestop/ui";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export function HomeSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [asking, setAsking] = useState(false);

  const askAssistant = () => {
    const q = query.trim();
    setAsking(true);
    router.push(q ? `/assistant?q=${encodeURIComponent(q)}` : "/assistant");
    // Navigation normally unmounts this component. Keeping a short fallback makes the control
    // recover if navigation is interrupted (for example, while the PWA is reconnecting).
    window.setTimeout(() => setAsking(false), 800);
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    askAssistant();
  };

  const searchTools = () => {
    const q = query.trim();
    router.push(q ? `/tools?q=${encodeURIComponent(q)}` : "/tools");
  };

  return (
    <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center">
      <form id="home-search-form" role="search" onSubmit={onSubmit} className="min-w-0 flex-1">
        <label htmlFor="home-search" className="sr-only">
          What do you want to do?
        </label>
        <div className="flex min-h-14 items-center gap-2 rounded-xl border border-border bg-bg/70 p-1.5 shadow-inner transition-shadow focus-within:border-primary focus-within:ring-2 focus-within:ring-ring">
          <span aria-hidden="true" className="pl-2 text-lg">
            ✦
          </span>
          <input
            id="home-search"
            type="search"
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="e.g. Convert these images to PDF, then compress it"
            className="h-11 min-w-0 flex-1 bg-transparent px-1 text-sm text-fg outline-none placeholder:text-fg-muted sm:text-base"
          />
          <Button
            type="submit"
            size="md"
            variant="primary"
            disabled={asking}
            aria-busy={asking}
            className="shrink-0 px-3 sm:px-4"
          >
            <span aria-hidden="true">{asking ? "…" : "✨"}</span>
            <span className="hidden sm:inline">{asking ? "Opening…" : "Ask OneStop AI"}</span>
            <span className="sm:hidden">Ask AI</span>
          </Button>
        </div>
      </form>
      <Button
        type="button"
        size="md"
        variant="secondary"
        onClick={searchTools}
        className="shrink-0"
      >
        Search tools
      </Button>
    </div>
  );
}
