"use client";

// The "list/count OneStop's own tools" panel for a "catalogue" assistant intent
// (16-ai-assistant.md). Read straight from the registry, not the model — every entry here is a
// real, clickable tool page, never a made-up name.
import type { ToolCatalogueAnswer } from "@onestop/types";
import { Badge, Card, CardTitle } from "@onestop/ui";
import Link from "next/link";

export function ToolCatalogue({ catalogue }: { catalogue: ToolCatalogueAnswer }) {
  const single = catalogue.groups.length === 1 ? catalogue.groups[0] : null;

  return (
    <Card className="flex flex-col gap-4" data-testid="tool-catalogue">
      <CardTitle>
        {single ? `${single.name} tools — ${single.count}` : `All OneStop tools — ${catalogue.totalTools}`}
      </CardTitle>
      {catalogue.groups.map((group) => (
        <section
          key={group.id}
          className="flex flex-col gap-2"
          data-testid={`tool-catalogue-group-${group.id}`}
        >
          <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            <Badge tone="neutral">
              <span aria-hidden="true">{group.icon}</span> {group.name} · {group.count}
            </Badge>
            <Link href={group.href} className="text-xs font-normal text-primary underline">
              Open category
            </Link>
          </h3>
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
        </section>
      ))}
    </Card>
  );
}
