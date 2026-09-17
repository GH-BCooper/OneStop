import { Badge } from "@onestop/ui";

// TODO(18-pwa-offline.md): reflect real connectivity and per-tool availability.
export function ConnectionBadge() {
  return (
    <Badge tone="success" aria-label="Connection status: online">
      <span aria-hidden="true" className="h-2 w-2 rounded-full bg-success" />
      Online
    </Badge>
  );
}
