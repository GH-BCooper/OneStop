// The four example workflows from master plan §8, as ready-made templates (15-workflows.md).
//
// They live beside the chain rules so the builder can offer them without importing the server.
// They are seeds, not fixtures: "Use this template" copies the steps into the builder, where the
// user can rename, reorder or re-option them before saving. `workflows.test.ts` also runs all four
// end to end, so a template that stops working fails the build rather than the user.
import type { WorkflowTemplate } from "@onestop/types";

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: "images-to-compressed-pdf",
    name: "Images → PDF → Compress",
    description: "Combine photos or scans into one PDF, then shrink it for sharing by email.",
    steps: [{ toolId: "image-to-pdf" }, { toolId: "compress-pdf", options: { level: "balanced" } }],
  },
  {
    id: "scan-to-translated-pdf",
    name: "PDF → OCR → Translate → PDF",
    description:
      "Read the text out of a scanned PDF, translate it, and lay it back out as a new PDF.",
    steps: [
      { toolId: "ocr-pdf", options: { output: "txt" } },
      { toolId: "document-translator", options: { from: "en", to: "es" } },
      { toolId: "document-to-pdf" },
    ],
  },
  {
    id: "csv-clean-to-excel",
    name: "CSV → Clean → Excel",
    description: "Tidy up a messy CSV export, then turn it into a formatted Excel workbook.",
    steps: [
      { toolId: "spreadsheet-cleaner", options: { duplicates: true } },
      { toolId: "csv-to-excel" },
    ],
  },
  {
    id: "cutout-to-webp",
    name: "Image → Remove Background → Resize → WebP",
    description: "Cut the subject out of a photo, size it for the web and save it as WebP.",
    steps: [
      { toolId: "background-removal" },
      { toolId: "image-resizer", options: { mode: "longest", longest: 1024 } },
      { toolId: "image-format-converter", options: { format: "webp" } },
    ],
  },
];

export function getWorkflowTemplate(id: string): WorkflowTemplate | undefined {
  return WORKFLOW_TEMPLATES.find((t) => t.id === id);
}
