"use client";

import { Button } from "@onestop/ui";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

// The two ways in from the home page. The box is a message to the assistant: Enter, or "Ask
// OneStop AI" beside it, sends it straight to the AI Assistant, which starts working on it rather
// than leaving it as a draft. "Search tools" underneath looks the same words up in the catalogue.
export function HomeSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");

  const askAssistant = () => {
    const q = query.trim();
    router.push(q ? `/assistant?q=${encodeURIComponent(q)}` : "/assistant");
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    askAssistant();
  };

  const searchTools = () => {
    const q = query.trim();
    router.push(q ? `/tools?q=${encodeURIComponent(q)}` : "/tools");
  };

  return (
    <div className="flex w-full flex-col items-center gap-6">
      <form
        id="home-search-form"
        role="search"
        onSubmit={onSubmit}
        className="flex w-full flex-col gap-2 sm:flex-row"
      >
        <label htmlFor="home-search" className="sr-only">
          What do you want to do?
        </label>
        <input
          id="home-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. make a pdf from images, remove background, convert csv to json"
          className="h-14 w-full min-w-0 rounded-lg border border-border bg-surface px-4 text-base text-fg shadow-sm placeholder:text-fg-muted focus-visible:outline-2 focus-visible:outline-ring sm:flex-1"
        />
        <Button type="submit" size="lg" variant="primary" className="h-14">
          <span aria-hidden="true">✨</span>
          Ask OneStop AI
        </Button>
      </form>
      <Button type="button" size="lg" variant="secondary" onClick={searchTools}>
        Search tools
      </Button>
    </div>
  );
}
