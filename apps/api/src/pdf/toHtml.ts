// PDF → HTML (Features 1.6).
//
// Two layouts, one self-contained file (images inlined as data: URLs, no external requests):
// - "layout": each page is its rendered image with the real text laid over it, transparent but
//   selectable — looks exactly like the PDF, and search/copy still work.
// - "flow": clean, reflowable HTML — headings and paragraphs rebuilt from the text, no images.
// The output carries a strict Content-Security-Policy and never contains script.
import type { Executor } from "@onestop/tool-registry";
import {
  baseName,
  optEnum,
  optNumber,
  optString,
  parsePageSelection,
  readSinglePdf,
  throwIfAborted,
} from "./document.ts";
import { runPdfTool, unsupported } from "./errors.ts";
import { plural } from "./inputs.ts";
import { bodyFontSize, layoutFromDocument, toBlocks, type PageLayout } from "./layout.ts";
import { readTitle } from "./title.ts";
import { renderPage, withPdfJs } from "./render.ts";

export const PDF_TO_HTML_TOOL_ID = "pdf-to-html";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const CSP =
  "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";

function documentShell(title: string, style: string, body: string): string {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${CSP}">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="generator" content="OneStop">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>${style}</style>`,
    "</head>",
    `<body>${body}</body>`,
    "</html>",
    "",
  ].join("\n");
}

const LAYOUT_STYLE = [
  "body{margin:0;background:#e5e7eb;font-family:Arial,Helvetica,sans-serif}",
  ".page{position:relative;margin:16px auto;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.2);overflow:hidden}",
  ".page img{position:absolute;inset:0;width:100%;height:100%;user-select:none}",
  ".page span{position:absolute;white-space:pre;color:transparent;line-height:1;transform-origin:0 0}",
  ".page.text-only span{color:#111}",
  "@media print{body{background:#fff}.page{margin:0;box-shadow:none;page-break-after:always}}",
].join("");

const FLOW_STYLE = [
  "body{max-width:48rem;margin:2rem auto;padding:0 1rem;font-family:Georgia,serif;line-height:1.6;color:#111}",
  "h1,h2,h3{font-family:Arial,Helvetica,sans-serif;line-height:1.25}",
  "hr{border:0;border-top:1px solid #ccc;margin:2rem 0}",
  ".page-marker{font:12px Arial,sans-serif;color:#888}",
].join("");

function layoutPage(page: PageLayout, image: string | null): string {
  const spans = page.lines
    .flatMap((line) => line.runs)
    .map((run) => {
      const style = [
        `left:${run.x.toFixed(1)}pt`,
        `top:${run.y.toFixed(1)}pt`,
        `font-size:${run.fontSize.toFixed(1)}pt`,
        run.bold ? "font-weight:bold" : "",
        run.italic ? "font-style:italic" : "",
      ]
        .filter(Boolean)
        .join(";");
      return `<span style="${style}">${escapeHtml(run.text)}</span>`;
    })
    .join("");
  const img = image ? `<img alt="" src="${image}">` : "";
  return `<section class="page${image ? "" : " text-only"}" id="page-${page.pageNumber}" style="width:${page.width.toFixed(1)}pt;height:${page.height.toFixed(1)}pt">${img}${spans}</section>`;
}

export function flowHtml(pages: PageLayout[]): string {
  const body = bodyFontSize(pages);
  const parts: string[] = [];
  for (const page of pages) {
    if (parts.length) parts.push(`<hr><p class="page-marker">Page ${page.pageNumber}</p>`);
    for (const block of toBlocks(page, body)) {
      const text = escapeHtml(block.text);
      const tag =
        block.kind === "heading1"
          ? "h1"
          : block.kind === "heading2"
            ? "h2"
            : block.kind === "heading3"
              ? "h3"
              : "p";
      const inner =
        tag === "p" && block.bold
          ? `<strong>${text}</strong>`
          : tag === "p" && block.italic
            ? `<em>${text}</em>`
            : text;
      parts.push(`<${tag}>${inner}</${tag}>`);
    }
  }
  return parts.join("\n");
}

export const pdfToHtmlExecutor: Executor = async (input, options, ctx) =>
  runPdfTool(PDF_TO_HTML_TOOL_ID, async () => {
    const file = await readSinglePdf(input, ctx);
    const mode = optEnum(options, "mode", ["layout", "flow", "text"] as const, "layout");
    const dpi = optNumber(options, "dpi", 110, { min: 72, max: 200 });
    const title = (await readTitle(file.bytes)) || baseName(file.ref.name);

    const html = await withPdfJs(file.bytes, async (pdf) => {
      const selected = parsePageSelection(optString(options, "pages"), pdf.numPages);
      const pages = await layoutFromDocument(pdf, selected, ctx?.signal);
      if (mode === "flow") {
        if (pages.every((p) => p.lines.length === 0)) {
          throw unsupported(
            "No text was found — this PDF looks like a scan. Run OCR PDF first, or use the Exact layout.",
          );
        }
        return documentShell(title, FLOW_STYLE, flowHtml(pages));
      }
      const sections: string[] = [];
      for (const page of pages) {
        throwIfAborted(ctx?.signal);
        let image: string | null = null;
        if (mode === "layout") {
          const rendered = await renderPage(pdf, page.pageNumber, {
            dpi,
            format: "jpg",
            quality: 0.8,
          });
          image = `data:image/jpeg;base64,${Buffer.from(rendered.bytes).toString("base64")}`;
        }
        sections.push(layoutPage(page, image));
      }
      return { html: documentShell(title, LAYOUT_STYLE, sections.join("\n")), count: pages.length };
    });

    const text = typeof html === "string" ? html : html.html;
    const count = typeof html === "string" ? null : html.count;
    const bytes = new TextEncoder().encode(text);
    return {
      ok: true,
      output: { mode, bytes: bytes.length },
      summary:
        mode === "flow"
          ? "Converted to reflowable HTML."
          : `Converted ${plural(count ?? 0, "page")} to HTML${mode === "layout" ? " with the exact page look and selectable text" : ""}.`,
      files: [{ name: `${baseName(file.ref.name)}.html`, mimeType: "text/html", bytes }],
    };
  });
