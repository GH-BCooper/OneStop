"use client";

// The Free / Paid external recommendations panel (master plan §7.3; 16-ai-assistant.md).
//
// Shown when OneStop genuinely cannot do what was asked. The two groups are always rendered
// separately and always labelled, each entry carries the four things §7.3 asks for — site name,
// link, purpose, limitation — and the panel says plainly that these are other people's services.
import type { RecommendationGroups, ExternalRecommendation } from "@onestop/types";
import { Badge, Card, CardTitle } from "@onestop/ui";

const EXTERNAL_NOTICE =
  "These are external services, not part of OneStop. Opening them needs an internet connection, and anything you upload there is subject to that service's own privacy policy.";

function Group({
  title,
  tone,
  items,
  testId,
}: {
  title: string;
  tone: "success" | "warning";
  items: ExternalRecommendation[];
  testId: string;
}) {
  if (items.length === 0) return null;
  return (
    <section className="flex flex-col gap-2" data-testid={testId}>
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Badge tone={tone}>{title}</Badge>
      </h3>
      <ul className="flex flex-col gap-3">
        {items.map((item) => (
          <li key={item.url} className="rounded-md border border-border p-3 text-sm">
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer noopener"
              className="font-medium text-primary underline"
            >
              {item.name}
            </a>
            <p className="mt-1">{item.purpose}</p>
            <p className="mt-1 text-fg-muted">
              <strong className="font-medium">Limitation:</strong> {item.limitation}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Recommendations({ groups }: { groups: RecommendationGroups }) {
  return (
    <Card className="flex flex-col gap-4" data-testid="external-recommendations">
      <div>
        <CardTitle>Other tools for {groups.topic}</CardTitle>
        <p className="mt-1 text-sm text-fg-muted">{EXTERNAL_NOTICE}</p>
      </div>
      <Group title="Free" tone="success" items={groups.free} testId="recommendations-free" />
      <Group title="Paid" tone="warning" items={groups.paid} testId="recommendations-paid" />
    </Card>
  );
}
