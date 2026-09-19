// The registry-driven half of /status (18-pwa-offline.md).
//
// Every number and every label here comes from `offline-status.ts`, which reads the registry's
// `offline` and `network` flags - nothing on this page is written by hand, which is the whole point
// of replacing the phase-02 placeholder.
import { Badge, Card } from "@onestop/ui";
import Link from "next/link";
import {
  OFFLINE_CLASS_LABELS,
  type CategoryAvailability,
  type GroupOfflineSummary,
  type OfflineSummary,
  type OfflineTotals,
  type ToolOfflineRow,
} from "@/lib/offline-status";

const availabilityTone: Record<CategoryAvailability, "success" | "warning" | "danger"> = {
  full: "success",
  partial: "warning",
  none: "danger",
};

const availabilityLabel: Record<CategoryAvailability, string> = {
  full: "All work offline",
  partial: "Some work offline",
  none: "None work offline",
};

function ToolRow({ tool }: { tool: ToolOfflineRow }) {
  const tone =
    tool.offlineClass === "offline"
      ? "success"
      : tool.offlineClass === "online-only"
        ? "danger"
        : "neutral";
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 py-1 last:border-b-0">
      <Link href={tool.href} className="text-sm text-primary hover:underline">
        {tool.name}
      </Link>
      <span className="flex items-center gap-2">
        {tool.localModel && (
          <Badge tone="neutral" title="Better with a local model you run yourself">
            local model {tool.localModel}
          </Badge>
        )}
        <Badge tone={tone} data-offline-class={tool.offlineClass}>
          {OFFLINE_CLASS_LABELS[tool.offlineClass]}
        </Badge>
      </span>
    </li>
  );
}

function CategoryBlock({ category }: { category: OfflineSummary }) {
  return (
    <details className="rounded-lg border border-border bg-surface px-3 py-2">
      <summary className="cursor-pointer text-sm font-medium">
        {category.name}{" "}
        <span className="font-normal text-fg-muted">
          — {category.offline} of {category.total} work offline
        </span>
      </summary>
      <ul className="mt-2">
        {category.tools.map((tool) => (
          <ToolRow key={tool.id} tool={tool} />
        ))}
      </ul>
    </details>
  );
}

export function OfflineCatalogue({
  totals,
  groups,
}: {
  totals: OfflineTotals;
  groups: GroupOfflineSummary[];
}) {
  return (
    <section aria-labelledby="offline-capability" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="offline-capability" className="text-xl font-semibold">
          Offline capability by category
        </h2>
        <p className="text-sm text-fg-muted">
          Straight from the tool registry: a tool is listed as working offline only once an offline
          test for it passes. &ldquo;Not verified offline&rdquo; means it runs on this device but
          has no offline test yet, so nothing is promised.
        </p>
      </div>

      <dl
        data-testid="offline-totals"
        className="grid grid-cols-2 gap-3 sm:grid-cols-4"
        aria-label="Totals across every tool"
      >
        {[
          { label: "Tools in total", value: totals.total, tone: "" },
          {
            label: "Work offline",
            value: `${totals.offline} (${totals.offlinePercent}%)`,
            tone: "text-success",
          },
          { label: "Need the Internet", value: totals.onlineOnly, tone: "text-danger" },
          { label: "Not verified offline", value: totals.unverified, tone: "text-fg-muted" },
        ].map((tile) => (
          <Card key={tile.label} className="gap-1">
            <dt className="text-xs uppercase tracking-wide text-fg-muted">{tile.label}</dt>
            <dd className={`text-2xl font-bold ${tile.tone}`}>{tile.value}</dd>
          </Card>
        ))}
      </dl>

      <ul className="flex flex-col gap-3">
        {groups.map((group) => (
          <li key={group.id}>
            <Card className="gap-3" data-testid={`status-group-${group.id}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span aria-hidden="true" className="text-xl">
                  {group.icon}
                </span>
                <h3 className="text-lg font-semibold">{group.name}</h3>
                <Badge
                  tone={availabilityTone[group.availability]}
                  data-testid={`avail-${group.id}`}
                >
                  {availabilityLabel[group.availability]}
                </Badge>
                <span className="ml-auto text-sm text-fg-muted">
                  {group.offline} offline · {group.onlineOnly} need the Internet ·{" "}
                  {group.unverified} unverified · {group.total} total
                </span>
              </div>
              <div
                role="img"
                aria-label={`${group.offline} of ${group.total} tools in ${group.name} work offline`}
                className="flex h-2 w-full overflow-hidden rounded-full bg-surface-muted"
              >
                <span
                  className="h-full bg-success"
                  style={{ width: `${(group.offline / Math.max(1, group.total)) * 100}%` }}
                />
                <span
                  className="h-full bg-warning"
                  style={{ width: `${(group.unverified / Math.max(1, group.total)) * 100}%` }}
                />
                <span
                  className="h-full bg-danger"
                  style={{ width: `${(group.onlineOnly / Math.max(1, group.total)) * 100}%` }}
                />
              </div>
              <div className="flex flex-col gap-2">
                {group.categories.map((category) => (
                  <CategoryBlock key={category.id} category={category} />
                ))}
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}
