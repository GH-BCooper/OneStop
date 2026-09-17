"use client";

import { Button } from "@onestop/ui";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export function HomeSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    // TODO(03-tool-registry.md): /tools reads `q` once registry search exists.
    router.push(q ? `/tools?q=${encodeURIComponent(q)}` : "/tools");
  };

  return (
    <form role="search" onSubmit={onSubmit} className="flex w-full flex-col gap-2 sm:flex-row">
      <label htmlFor="home-search" className="sr-only">
        What do you want to do?
      </label>
      <input
        id="home-search"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="e.g. merge two PDFs, compress a photo, convert CSV to Excel"
        className="h-14 w-full min-w-0 rounded-lg sm:flex-1 border border-border bg-surface px-4 text-base text-fg shadow-sm placeholder:text-fg-muted focus-visible:outline-2 focus-visible:outline-ring"
      />
      <Button type="submit" size="lg" variant="secondary" className="h-14">
        Search tools
      </Button>
    </form>
  );
}
