import { inputKind, toolHref, typeLabel, type ToolMeta } from "@onestop/tool-registry";
import { Card, CardDescription, CardTitle } from "@onestop/ui";
import Link from "next/link";
import { ToolBadges } from "./ToolBadges";

function inputLabel(tool: ToolMeta): string {
  const kind = inputKind(tool);
  if (kind === "none") return "No input";
  if (kind === "text") return "Text";
  if (kind === "url") return "Link";
  return typeLabel(tool.inputTypes.filter((t) => t !== "text" && t !== "url"));
}

export function ToolCard({ tool }: { tool: ToolMeta }) {
  return (
    <Link
      href={toolHref(tool)}
      className="block h-full rounded-lg focus-visible:outline-2 focus-visible:outline-ring"
      data-tool-id={tool.id}
    >
      <Card interactive className="flex h-full flex-col gap-2">
        <CardTitle>{tool.name}</CardTitle>
        <CardDescription>{tool.description}</CardDescription>
        <p className="text-xs text-fg-muted">
          <span className="sr-only">Input: </span>
          {inputLabel(tool)} <span aria-hidden="true">→</span>
          <span className="sr-only"> Output: </span> {typeLabel(tool.outputTypes)}
        </p>
        <div className="mt-auto">
          <ToolBadges tool={tool} />
        </div>
      </Card>
    </Link>
  );
}
