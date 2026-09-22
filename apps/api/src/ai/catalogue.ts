// Answers "catalogue" intents — "list all the pdf tools", "how many image tools do you have" —
// straight from `@onestop/tool-registry`. No model call, no file, no network: this must work
// offline and for free exactly like the registry itself does (CLAUDE.md §2).
import { getTool, GROUPS, toolHref, toolsForCatalogPage } from "@onestop/tool-registry";
import type { ToolCatalogueAnswer, ToolCatalogueGroup } from "@onestop/types";

/** A saved workflow, as the client already has it in hand — enough to link to its "use" view. */
export interface WorkflowSummary {
  id: string;
  name: string;
}

/** Extra, per-user data the registry itself does not have — round-tripped from the client exactly
 *  like `AssistantRequest.profile`, so this stays a no-DB, no-network answer either way. */
export interface CatalogueExtras {
  workflows?: WorkflowSummary[];
  favoriteToolIds?: string[];
}

/** Keyword → catalogue group id, in the order `GROUPS` itself uses. */
const SCOPE_KEYWORDS: { re: RegExp; id: string }[] = [
  { re: /\bworkflows?\b/i, id: "workflows" },
  { re: /\bfavou?rites?\b/i, id: "favorites" },
  { re: /\bpdf\b/i, id: "pdf" },
  { re: /\bword\b|\bpowerpoint\b|\bppt\b|\bdocx?\b|\bdocuments?\b/i, id: "documents" },
  { re: /\bexcel\b|\bcsv\b|\bspreadsheet\b|\bjson\b|\bxml\b|\byaml\b/i, id: "data" },
  { re: /\bimages?\b|\bphotos?\b|\bpictures?\b/i, id: "images" },
  {
    re: /\baudio\b|\bvideo\b|\bmedia\b|\bmusic\b|\byoutube\b|\binstagram\b|\bspotify\b/i,
    id: "media",
  },
  { re: /\bqr\b/i, id: "qr" },
  { re: /\bai\b/i, id: "ai" },
  { re: /\butilit(y|ies)\b|\bdeveloper\b|\bdev\b|\bnetwork\b|\bhash\b|\bbase ?64\b/i, id: "utilities" },
];

/** The group a request is asking about, or "all" when nothing narrows it down. */
export function catalogueScope(request: string): string {
  for (const { re, id } of SCOPE_KEYWORDS) {
    if (re.test(request)) return id;
  }
  return "all";
}

/** Builds the counts + clickable listing for a "catalogue" intent. Never throws, never empty. */
export function buildCatalogueAnswer(request: string, extras: CatalogueExtras = {}): ToolCatalogueAnswer {
  const scope = catalogueScope(request);

  // "list my workflows" — not registry groups, but the client's own saved-workflow list, so this
  // still never touches the model or a database (CLAUDE.md §2). Each entry links straight to the
  // workflow's "use" view, ready to run on new files with one click.
  if (scope === "workflows") {
    const workflows = extras.workflows ?? [];
    const tools = workflows.map((w) => ({ id: w.id, name: w.name, href: `/workflows/${w.id}?use=1` }));
    return {
      scope,
      totalTools: tools.length,
      groups: [
        { id: "workflows", name: "Workflows", icon: "🧩", href: "/workflows", count: tools.length, tools },
      ],
    };
  }

  // "what are my favourite tools" — the client's starred tool ids, resolved back to real registry
  // entries so a retired or renamed tool never shows up as a dead link.
  if (scope === "favorites") {
    const tools = (extras.favoriteToolIds ?? [])
      .map((id) => getTool(id))
      .filter((t): t is NonNullable<ReturnType<typeof getTool>> => Boolean(t))
      .map((t) => ({ id: t.id, name: t.name, href: toolHref(t) }));
    return {
      scope,
      totalTools: tools.length,
      groups: [
        {
          id: "favorites",
          name: "Favourite tools",
          icon: "⭐",
          href: "/tools",
          count: tools.length,
          tools,
        },
      ],
    };
  }

  const selected = scope === "all" ? GROUPS : GROUPS.filter((g) => g.id === scope);
  const groups: ToolCatalogueGroup[] = (selected.length > 0 ? selected : GROUPS).map((g) => {
    const groupTools = [...toolsForCatalogPage(g.id)].sort((a, b) => a.name.localeCompare(b.name));
    return {
      id: g.id,
      name: g.name,
      icon: g.icon,
      href: `/tools/${g.id}`,
      count: groupTools.length,
      tools: groupTools.map((t) => ({ id: t.id, name: t.name, href: toolHref(t) })),
    };
  });
  const totalTools = groups.reduce((sum, g) => sum + g.count, 0);
  return { scope: selected.length > 0 ? scope : "all", totalTools, groups };
}

/** The plain-words line the assistant says before the clickable card listing. */
export function catalogueMessage(answer: ToolCatalogueAnswer): string {
  if (answer.scope === "workflows") {
    const count = answer.totalTools;
    return count === 0
      ? "You don't have any saved workflows yet — build one on the Workflows page and it'll show up here."
      : `You have ${count} saved workflow${count === 1 ? "" : "s"} — tap one to open it and run it on new files:`;
  }
  if (answer.scope === "favorites") {
    const count = answer.totalTools;
    return count === 0
      ? "You haven't starred any tools yet — tap the star on a tool's card to add one."
      : `You have ${count} favourite tool${count === 1 ? "" : "s"}:`;
  }
  if (answer.groups.length === 1) {
    const group = answer.groups[0]!;
    return `OneStop has ${group.count} ${group.name} tool${group.count === 1 ? "" : "s"}:`;
  }
  return "I can help you convert files, work with PDFs, images, audio, video, data, QR codes, and more — just ask and I'll do it. Here's the toolset I currently have:";
}
