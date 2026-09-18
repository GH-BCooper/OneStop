// Metadata Remover (12-dev-utility-tools.md §14.8).
//
// The File Metadata Viewer listed alongside it (§14.7 / §12.21) already exists: phase 04 built it
// for real in `file-processing/executors/file-metadata.ts` as the proof that the pipeline worked,
// and it reports everything this phase would have — size, declared vs. sniffed format, checksums,
// text statistics. Phase 12 only promotes it from "demo" to "available" in the registry; there is
// deliberately no second copy here.
//
// The remover routes to the tool that already knows the format, exactly like the File Type
// Converter: images to phase 09, PDFs to phase 06, Word/ODT to phase 07, and the remaining OOXML
// formats through the documents module's own stripper. There is no generic "strip metadata from
// any file", because metadata lives in a different place in every format and a generic guess
// would either do nothing or corrupt the file.
import type { Executor } from "@onestop/tool-registry";
import { getExecutor, getTool, type ToolMeta } from "@onestop/tool-registry";
import type { ExecResult, FileRef, OutputFile } from "@onestop/types";
import { mimeTypeForExtension } from "../file-processing/validate.ts";
import { stripOoxmlMetadata } from "../documents/metadata.ts";
import { optBool, plural, readFiles, runUtilTool, unsupported, type UtilFile } from "./common.ts";

const IMAGE_EXTS = ["jpg", "jpeg", "png", "webp", "gif", "bmp", "tiff", "tif", "heic", "avif"];

// ---- remover ----------------------------------------------------------------------------------

export interface RemoverRoute {
  toolId: string;
  options?: Record<string, unknown>;
}

/** Which existing tool strips metadata from this extension. */
export function removerRouteFor(ext: string): RemoverRoute | null {
  if (IMAGE_EXTS.includes(ext)) return { toolId: "remove-image-metadata" };
  if (ext === "pdf") return { toolId: "remove-pdf-metadata" };
  if (ext === "docx" || ext === "doc" || ext === "odt") {
    return { toolId: "document-metadata", options: { mode: "remove", authors: true } };
  }
  return null;
}

/** OOXML formats with no dedicated remover: the documents module's stripper handles them. */
const OOXML_DIRECT = new Set(["pptx", "xlsx"]);

export const metadataRemoverExecutor: Executor = (input, options, ctx) =>
  runUtilTool("metadata-remover", async () => {
    const files = await readFiles(input, ctx);
    const authors = optBool(options, "authors", true);

    const outputs: OutputFile[] = [];
    const summaries: string[] = [];
    const handled: string[] = [];
    const skipped: { name: string; reason: string }[] = [];

    // Group by extension so a batch of images is one call to the phase-09 tool, not one each.
    const groups = new Map<string, UtilFile[]>();
    for (const file of files) groups.set(file.ext, [...(groups.get(file.ext) ?? []), file]);

    for (const [ext, group] of groups) {
      if (OOXML_DIRECT.has(ext)) {
        for (const file of group) {
          const cleaned = await stripOoxmlMetadata(file.bytes, { authors });
          outputs.push({
            name: file.ref.name,
            mimeType: file.ref.type || mimeTypeForExtension(ext),
            bytes: cleaned,
          });
          handled.push(file.ref.name);
        }
        summaries.push(
          `Stripped the document properties from ${plural(group.length, `.${ext} file`)}.`,
        );
        continue;
      }

      const route = removerRouteFor(ext);
      const tool: ToolMeta | undefined = route ? getTool(route.toolId) : undefined;
      if (!route || !tool) {
        for (const file of group) {
          skipped.push({
            name: file.ref.name,
            reason: `OneStop has no metadata stripper for .${ext} files yet`,
          });
        }
        continue;
      }

      const refs: FileRef[] = group.map((f) => f.ref);
      const batches = tool.supportsBatch ? [refs] : refs.map((r) => [r]);
      for (const batch of batches) {
        const result: ExecResult = await getExecutor(tool)(
          batch,
          { ...route.options, authors },
          ctx,
        );
        if (!result.ok) {
          for (const ref of batch) skipped.push({ name: ref.name, reason: result.message });
          continue;
        }
        outputs.push(...(result.files ?? []));
        handled.push(...batch.map((r) => r.name));
        if (result.summary) summaries.push(result.summary);
      }
    }

    if (outputs.length === 0) {
      throw unsupported(
        skipped[0]?.reason ??
          "None of these files has metadata OneStop can strip. Images, PDFs, Word, PowerPoint and Excel files are supported.",
      );
    }
    const note =
      skipped.length > 0
        ? ` ${plural(skipped.length, "file")} could not be cleaned: ${skipped.map((s) => `${s.name} (${s.reason})`).join("; ")}.`
        : "";
    return {
      ok: true,
      output: { cleaned: handled, skipped },
      summary:
        `Stripped metadata from ${plural(handled.length, "file")}. ${summaries.join(" ")}${note}`.trim(),
      files: outputs,
    };
  });
