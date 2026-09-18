// PDF → Word (Features 1.1), PDF → Excel (1.2), PDF → PowerPoint (1.3 / 5.2).
//
// Thin executors over the shared `office-convert` interface, which phases 07/08 reuse for the
// opposite direction. A PDF with no text layer is refused for the text-based modes with a pointer
// to OCR PDF, rather than returning an empty document.
import type { Executor } from "@onestop/tool-registry";
import { pdfToOffice, type OfficeTarget } from "../shared/office-convert.ts";
import { baseName, optEnum, optString, readSinglePdf } from "./document.ts";
import { runPdfTool, unsupported } from "./errors.ts";
import { plural } from "./inputs.ts";
import { readTitle } from "./title.ts";

export const PDF_TO_WORD_TOOL_ID = "pdf-to-word";
export const PDF_TO_EXCEL_TOOL_ID = "pdf-to-excel";
export const PDF_TO_POWERPOINT_TOOL_ID = "pdf-to-powerpoint";

const MIME: Record<OfficeTarget, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

const NAMES: Record<OfficeTarget, string> = { docx: "Word", xlsx: "Excel", pptx: "PowerPoint" };

function converter(toolId: string, target: OfficeTarget): Executor {
  return async (input, options, ctx) =>
    runPdfTool(toolId, async () => {
      const file = await readSinglePdf(input, ctx);
      const layout =
        target === "xlsx"
          ? "editable"
          : optEnum(
              options,
              "layout",
              ["editable", "exact"] as const,
              target === "pptx" ? "exact" : "editable",
            );
      const engine = optEnum(options, "engine", ["builtin", "libreoffice"] as const, "builtin");
      const sheets = optEnum(options, "sheets", ["per-page", "single"] as const, "per-page");
      const title = await readTitle(file.bytes);

      const result = await pdfToOffice(file.bytes, target, {
        pages: optString(options, "pages"),
        layout,
        sheets,
        engine,
        ...(title ? { title } : { title: baseName(file.ref.name) }),
        ...(ctx?.signal ? { signal: ctx.signal } : {}),
      });
      if (result.engine === "builtin" && layout === "editable" && result.units === 0) {
        throw unsupported(
          target === "xlsx"
            ? "No text or tables were found — this PDF looks like a scan. Run OCR PDF first, then convert."
            : "No text was found — this PDF looks like a scan. Run OCR PDF first, or choose the Exact layout.",
        );
      }
      const what =
        target === "xlsx"
          ? `${plural(result.units ?? 0, "row")} from ${plural(result.pages ?? 0, "page")}`
          : plural(result.pages ?? 0, target === "pptx" ? "slide" : "page");
      return {
        ok: true,
        output: {
          engine: result.engine,
          layout,
          pages: result.pages ?? null,
          notice: result.notice ?? null,
        },
        summary: `Converted ${what} to ${NAMES[target]}.${result.notice ? ` ${result.notice}` : ""}`,
        files: [
          {
            name: `${baseName(file.ref.name)}.${target}`,
            mimeType: MIME[target],
            bytes: result.bytes,
          },
        ],
      };
    });
}

export const pdfToWordExecutor = converter(PDF_TO_WORD_TOOL_ID, "docx");
export const pdfToExcelExecutor = converter(PDF_TO_EXCEL_TOOL_ID, "xlsx");
export const pdfToPowerPointExecutor = converter(PDF_TO_POWERPOINT_TOOL_ID, "pptx");
