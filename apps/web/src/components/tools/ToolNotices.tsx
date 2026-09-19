import { getToolNotices } from "@onestop/tool-registry";

/**
 * The notices a tool must show before it is used (17-online-media-network-tools.md asks for a
 * visible legal notice on the Online Media pages). The text lives in the registry, so this
 * component stays free of per-tool knowledge like every other part of the generic tool page.
 */
export function ToolNotices({ toolId }: { toolId: string }) {
  const notices = getToolNotices(toolId);
  if (notices.length === 0) return null;
  return (
    <div className="flex flex-col gap-3" data-testid="tool-notices">
      {notices.map((notice) => (
        <aside
          key={notice.title}
          role="note"
          data-tone={notice.tone}
          className={
            notice.tone === "legal"
              ? "rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm"
              : "rounded-lg border border-border bg-surface p-4 text-sm"
          }
        >
          <p className="font-semibold">
            {notice.tone === "legal" && <span aria-hidden="true">⚠️ </span>}
            {notice.title}
          </p>
          <p className="text-fg-muted">{notice.body}</p>
        </aside>
      ))}
    </div>
  );
}
