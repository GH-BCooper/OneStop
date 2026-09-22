"use client";

// The "list/count OneStop's own tools" panel for a "catalogue" assistant intent
// (16-ai-assistant.md). Read straight from the registry, not the model — every entry here is a
// real, clickable tool page, never a made-up name.
import type { ToolCatalogueAnswer, ToolCatalogueGroup } from "@onestop/types";
import { Badge, Card } from "@onestop/ui";
import Link from "next/link";
import { useState } from "react";

/** One category card: icon, name, count, and an expandable list of its tools. */
function CategoryCard({ group, defaultOpen }: { group: ToolCatalogueGroup; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Card
      className="flex flex-col gap-2"
      data-testid={`tool-catalogue-group-${group.id}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold">
          <Badge tone="neutral">
            <span aria-hidden="true">{group.icon}</span> {group.name} · {group.count}
          </Badge>
        </h3>
        <div className="flex items-center gap-3 text-xs">
          <Link href={group.href} className="font-normal text-primary underline">
            Open category
          </Link>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="font-normal text-primary underline"
          >
            {open ? "Hide tools" : `Show ${group.count} tool${group.count === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
      {open && (
        <ul className="flex flex-wrap gap-2">
          {group.tools.map((tool) => (
            <li key={tool.id}>
              <Link
                href={tool.href}
                className="inline-block rounded-md border border-border px-2 py-1 text-xs font-medium text-primary underline hover:bg-surface-muted"
              >
                {tool.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function ToolCatalogue({ catalogue }: { catalogue: ToolCatalogueAnswer }) {
  const single = catalogue.groups.length === 1 ? catalogue.groups[0] : null;

  if (single) {
    return (
      <div data-testid="tool-catalogue">
        <CategoryCard group={single} defaultOpen />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="tool-catalogue">
      <p className="text-sm font-medium text-fg-muted">
        {catalogue.totalTools} tools across {catalogue.groups.length} categories — tap a card to see
        what's inside.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {catalogue.groups.map((group) => (
          <CategoryCard key={group.id} group={group} defaultOpen={false} />
        ))}
      </div>
    </div>
  );
}
