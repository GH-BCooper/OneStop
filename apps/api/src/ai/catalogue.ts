// Answers "catalogue" intents — "list all the pdf tools", "how many image tools do you have" —
// straight from `@onestop/tool-registry`. No model call, no file, no network: this must work
// offline and for free exactly like the registry itself does (CLAUDE.md §2).
import { GROUPS, toolHref, toolsForCatalogPage } from "@onestop/tool-registry";
import type { ToolCatalogueAnswer, ToolCatalogueGroup } from "@onestop/types";

/** Keyword → catalogue group id, in the order `GROUPS` itself uses. */
const SCOPE_KEYWORDS: { re: RegExp; id: string }[] = [
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
export function buildCatalogueAnswer(request: string): ToolCatalogueAnswer {
  const scope = catalogueScope(request);
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
  if (answer.groups.length === 1) {
    const group = answer.groups[0]!;
    return `OneStop has ${group.count} ${group.name} tool${group.count === 1 ? "" : "s"}:`;
  }
  return "I can help you convert files, work with PDFs, images, audio, video, data, QR codes, and more — just ask and I'll do it. Here's the toolset I currently have:";
}
