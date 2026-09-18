// OpenDocument Text (.odt) → text / PDF, the no-LibreOffice fallback (07-word-ppt-tools.md).
//
// Reads `content.xml`: headings keep their level, paragraphs and list items come through in order,
// table cells are separated by tabs. Styling is not reproduced — LibreOffice is the fidelity path.
import JSZip from "jszip";
import { FlowPdf } from "./flowPdf.ts";
import { OfficeReadError } from "./toPdf.ts";

export interface OdtBlock {
  kind: "heading" | "paragraph";
  level: number;
  text: string;
}

function decode(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

function inlineText(xml: string): string {
  return decode(
    xml
      .replace(/<text:s(?:\s+text:c="(\d+)")?\s*\/>/g, (_, n?: string) =>
        " ".repeat(Number(n ?? 1)),
      )
      .replace(/<text:tab\s*\/>/g, "\t")
      .replace(/<text:line-break\s*\/>/g, "\n")
      .replace(/<[^>]+>/g, ""),
  );
}

export async function odtBlocks(bytes: Uint8Array): Promise<OdtBlock[]> {
  let xml: string | undefined;
  try {
    xml = await (await JSZip.loadAsync(bytes)).file("content.xml")?.async("string");
  } catch (err) {
    throw new OfficeReadError("This OpenDocument file could not be read. It may be damaged.", err);
  }
  if (!xml)
    throw new OfficeReadError("This OpenDocument file could not be read. It may be damaged.");
  const body = /<office:text\b[^>]*>([\s\S]*)<\/office:text>/.exec(xml)?.[1] ?? "";
  const cleaned = body
    .replace(/<text:note\b[\s\S]*?<\/text:note>/g, "")
    .replace(/<\/table:table-cell>/g, "\t</table:table-cell>");
  const blocks: OdtBlock[] = [];
  for (const m of cleaned.matchAll(/<text:(h|p)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/text:\1>)/g)) {
    const text = inlineText(m[3] ?? "");
    if (m[1] === "h") {
      const level = Number(/text:outline-level="(\d+)"/.exec(m[2]!)?.[1] ?? 1);
      blocks.push({ kind: "heading", level, text });
    } else {
      blocks.push({ kind: "paragraph", level: 0, text });
    }
  }
  return blocks;
}

export async function odtToText(bytes: Uint8Array): Promise<string> {
  return (await odtBlocks(bytes))
    .map((b) => b.text)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function odtToPdf(bytes: Uint8Array): Promise<Uint8Array> {
  const blocks = await odtBlocks(bytes);
  const pdf = await FlowPdf.create();
  for (const block of blocks) {
    if (block.kind === "heading") pdf.heading(block.text, block.level);
    else pdf.paragraph([{ text: block.text.replace(/\t/g, "    ") }]);
  }
  return pdf.save();
}
