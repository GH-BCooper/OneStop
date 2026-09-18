import { PHASE_FILES, type ToolMeta } from "@onestop/tool-registry";
import { Badge } from "@onestop/ui";

/** Capability labels shared by tool cards and tool pages, all derived from registry metadata. */
export function ToolBadges({ tool, showPhase = true }: { tool: ToolMeta; showPhase?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {tool.offline ? (
        <Badge tone="success">Works offline</Badge>
      ) : tool.network === "required" ? (
        <Badge tone="warning">Needs internet</Badge>
      ) : tool.network === "optional" ? (
        <Badge>Local or online</Badge>
      ) : (
        <Badge>Runs locally</Badge>
      )}
      {tool.requiresAuth && <Badge>Account required</Badge>}
      {tool.supportsBatch && <Badge>Batch</Badge>}
      {tool.category === "ai" && <Badge tone="primary">AI</Badge>}
      {tool.localModel === "optional" && (
        <Badge title="Works without AI; uses a local AI model when one is enabled in Settings">
          AI optional
        </Badge>
      )}
      {tool.localModel === "required" && <Badge tone="warning">Needs local AI model</Badge>}
      {showPhase &&
        (tool.status === "stub" ? (
          <Badge title={`Built in ${PHASE_FILES[tool.phase]}`}>Coming in phase {tool.phase}</Badge>
        ) : (
          <Badge tone="success">{tool.status === "demo" ? "Demo" : "Available"}</Badge>
        ))}
    </div>
  );
}
