// File Merger / File Splitter / File Type Converter (12-dev-utility-tools.md §14.4-14.6).
//
// Splitting and merging are byte operations: a split part is a plain slice, and merging is a
// concatenation in part order, so `split` followed by `merge` returns the original bytes exactly.
//
// The File Type Converter deliberately converts nothing itself. It asks the registry which tool
// turns this extension into the requested one and runs that tool's executor — so an image request
// lands in phase 09's converter, a spreadsheet request in phase 08's, and there is never a second
// implementation of a conversion to keep in step (CLAUDE.md §7).
import type { Executor } from "@onestop/tool-registry";
import {
  defaultOptionValues,
  expandTypes,
  fileInputTypes,
  getExecutor,
  getToolOptions,
  hasExecutor,
  tools,
  type ToolMeta,
} from "@onestop/tool-registry";
import type { ExecResult, FileRef, OutputFile } from "@onestop/types";
import {
  MIME,
  bytesLabel,
  optEnum,
  optNumber,
  optString,
  plural,
  readFiles,
  runUtilTool,
  safeStem,
  unsupported,
  type UtilFile,
} from "./common.ts";
import { buildZip } from "./zip.ts";

// ---- File Splitter ----------------------------------------------------------------------------

export const PART_SUFFIX = /\.part(\d+)$/i;

export interface FilePart {
  name: string;
  bytes: Uint8Array;
}

export function splitBytes(
  bytes: Uint8Array,
  name: string,
  { partBytes, partCount }: { partBytes?: number; partCount?: number },
): FilePart[] {
  const size = partBytes ?? Math.ceil(bytes.length / Math.max(1, partCount ?? 1));
  if (size <= 0) throw unsupported("Choose a part size larger than zero.");
  const count = Math.max(1, Math.ceil(bytes.length / size));
  if (count > 999) {
    throw unsupported(
      `That would make ${count} parts. Use a larger part size (at most 999 parts).`,
    );
  }
  const width = Math.max(3, String(count).length);
  const parts: FilePart[] = [];
  for (let i = 0; i < count; i += 1) {
    parts.push({
      name: `${name}.part${String(i + 1).padStart(width, "0")}`,
      bytes: bytes.slice(i * size, Math.min((i + 1) * size, bytes.length)),
    });
  }
  return parts;
}

/** A plain-text recipe, so the parts can be rejoined without OneStop (`cat`/`copy /b`). */
export function joinInstructions(original: string, parts: FilePart[]): string {
  const names = parts.map((p) => p.name);
  return [
    `These ${parts.length} parts make up "${original}".`,
    "",
    "Rejoin them with OneStop's File Merger, or from a terminal:",
    `  macOS / Linux:  cat ${names.join(" ")} > ${original}`,
    `  Windows:        copy /b ${names.join("+")} ${original}`,
    "",
    "Parts:",
    ...parts.map((p) => `  ${p.name}  ${p.bytes.length} bytes`),
    "",
  ].join("\n");
}

export const fileSplitterExecutor: Executor = (input, options, ctx) =>
  runUtilTool("file-splitter", async () => {
    const file = await readFiles(input, ctx).then((f) => f[0]!);
    const by = optEnum(options, "by", ["size", "count"] as const, "size");
    const parts =
      by === "size"
        ? splitBytes(file.bytes, file.ref.name, {
            partBytes: Math.round(
              optNumber(options, "partSize", 10, { min: 0.01, max: 2048 }) * 1024 * 1024,
            ),
          })
        : splitBytes(file.bytes, file.ref.name, {
            partCount: optNumber(options, "parts", 2, { min: 2, max: 999 }),
          });

    const entries = [
      ...parts.map((p) => ({ name: p.name, bytes: p.bytes })),
      {
        name: `${safeStem(file.name, "file")}-rejoin.txt`,
        bytes: new TextEncoder().encode(joinInstructions(file.ref.name, parts)),
      },
    ];
    const zip = await buildZip(entries, 6);
    return {
      ok: true,
      output: {
        originalName: file.ref.name,
        originalSize: file.bytes.length,
        parts: parts.map((p) => ({ name: p.name, size: p.bytes.length })),
      },
      summary: `Split ${file.ref.name} (${bytesLabel(file.bytes.length)}) into ${parts.length} parts of up to ${bytesLabel(parts[0]!.bytes.length)}. The archive also holds a note on how to rejoin them.`,
      files: [{ name: `${safeStem(file.name, "file")}-parts.zip`, mimeType: MIME.zip, bytes: zip }],
    };
  });

// ---- File Merger ------------------------------------------------------------------------------

/** "file.bin.part10" sorts after "file.bin.part9", which a plain string sort gets wrong. */
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, "en", { numeric: true, sensitivity: "base" });
}

export function mergedName(files: UtilFile[]): string {
  const stripped = files.map((f) => f.ref.name.replace(PART_SUFFIX, ""));
  const first = stripped[0]!;
  if (stripped.every((n) => n === first) && first !== files[0]!.ref.name) return first;
  return `${safeStem(files[0]!.name, "merged")}-merged${files[0]!.ext ? `.${files[0]!.ext}` : ".bin"}`;
}

export const fileMergerExecutor: Executor = (input, options, ctx) =>
  runUtilTool("file-merger", async () => {
    const files = await readFiles(input, ctx, { min: 2, what: "file part" });
    const order = optEnum(options, "order", ["name", "given"] as const, "name");
    const sorted =
      order === "name" ? [...files].sort((a, b) => naturalCompare(a.ref.name, b.ref.name)) : files;

    const parts = sorted.filter((f) => !/-rejoin\.txt$/i.test(f.ref.name));
    const numbered = parts.filter((f) => PART_SUFFIX.test(f.ref.name));
    if (numbered.length > 0 && numbered.length === parts.length) {
      const seen = numbered.map((f) => Number(PART_SUFFIX.exec(f.ref.name)![1]));
      const missing = [];
      for (let i = 1; i <= Math.max(...seen); i += 1) if (!seen.includes(i)) missing.push(i);
      if (missing.length > 0) {
        throw unsupported(
          `Part${missing.length === 1 ? "" : "s"} ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} missing, so the file would be corrupt. Upload every part.`,
        );
      }
    }

    const total = parts.reduce((sum, f) => sum + f.bytes.length, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      merged.set(part.bytes, offset);
      offset += part.bytes.length;
    }
    const name = safeStem(optString(options, "outputName", "") || mergedName(parts), "merged");
    const withExt = /\.[A-Za-z0-9]{1,8}$/.test(name) ? name : `${name}.bin`;
    return {
      ok: true,
      output: {
        order: parts.map((f) => f.ref.name),
        bytes: total,
        recognisedParts: numbered.length === parts.length,
      },
      summary: `Joined ${plural(parts.length, "part")} into ${withExt} (${bytesLabel(total)}), in ${order === "name" ? "name" : "upload"} order: ${parts.map((f) => f.ref.name).join(" → ")}.`,
      files: [{ name: withExt, mimeType: MIME.bin, bytes: merged }],
    };
  });

// ---- File Type Converter ----------------------------------------------------------------------

export interface ConversionRoute {
  tool: ToolMeta;
  /** The option to set on the delegate so it produces the requested type, if it has one. */
  formatOption?: string;
}

/** Tools that accept literally anything would match every request; they are never a route. */
function acceptsExtension(tool: ToolMeta, ext: string): boolean {
  const types = fileInputTypes(tool);
  if (types.includes("any") || types.length === 0) return false;
  return expandTypes(types).includes(ext);
}

function producesType(tool: ToolMeta, target: string): boolean {
  if (tool.outputTypes.includes("any")) return false;
  return expandTypes(tool.outputTypes).includes(target);
}

/**
 * The best registered tool for `ext → target`. Preference order: a tool that names the target
 * exactly in its outputs (PDF → Word) over one that produces a whole family (Image Resizer
 * outputs "image"), then the more popular one — which is also the more general one in practice.
 */
export function findRoute(
  ext: string,
  target: string,
  catalogue: readonly ToolMeta[] = tools,
): ConversionRoute | null {
  const candidates = catalogue.filter(
    (t) =>
      t.id !== "file-type-converter" &&
      t.status === "available" &&
      hasExecutor(t.id) &&
      acceptsExtension(t, ext) &&
      producesType(t, target),
  );
  if (candidates.length === 0) return null;
  const score = (t: ToolMeta) => (t.outputTypes.includes(target) ? 1000 : 0) + t.popularity;
  const tool = candidates.sort((a, b) => score(b) - score(a))[0]!;
  const formatOption = getToolOptions(tool.id).find(
    (o) =>
      o.type === "select" &&
      (o.id === "format" || o.id === "target") &&
      o.choices.some((c) => c.value === target),
  );
  return formatOption ? { tool, formatOption: formatOption.id } : { tool };
}

/** Every target the catalogue can reach from this extension, for the "what else?" message. */
export function targetsFor(ext: string, catalogue: readonly ToolMeta[] = tools): string[] {
  const out = new Set<string>();
  for (const tool of catalogue) {
    if (tool.id === "file-type-converter" || tool.status !== "available" || !hasExecutor(tool.id))
      continue;
    if (!acceptsExtension(tool, ext)) continue;
    for (const type of expandTypes(tool.outputTypes)) if (type !== "any") out.add(type);
  }
  return [...out].sort();
}

export const fileTypeConverterExecutor: Executor = async (input, options, ctx) =>
  runUtilTool("file-type-converter", async () => {
    if (!Array.isArray(input) || input.length === 0) throw unsupported("Choose a file first.");
    const target = optString(options, "target", "").trim().toLowerCase().replace(/^\./, "");
    if (target === "") throw unsupported("Choose the format to convert to.");

    // One route per extension: a mixed upload is handled group by group.
    const groups = new Map<string, FileRef[]>();
    for (const ref of input as FileRef[]) {
      const ext = ref.name.includes(".") ? ref.name.split(".").pop()!.toLowerCase() : "";
      if (ext === target) {
        throw unsupported(`${ref.name} is already a .${target} file.`);
      }
      groups.set(ext, [...(groups.get(ext) ?? []), ref]);
    }

    const files: OutputFile[] = [];
    const summaries: string[] = [];
    const routes: Record<string, string> = {};
    for (const [ext, refs] of groups) {
      const route = findRoute(ext, target);
      if (!route) {
        const available = targetsFor(ext);
        throw unsupported(
          available.length > 0
            ? `OneStop cannot turn a .${ext} file into .${target} yet. From .${ext} it can make: ${available.join(", ")}.`
            : `OneStop has no tool that converts a .${ext} file yet.`,
        );
      }
      routes[ext] = route.tool.name;
      const delegateOptions: Record<string, unknown> = {
        ...defaultOptionValues(route.tool.id),
        ...(route.formatOption ? { [route.formatOption]: target } : {}),
      };
      const batches = route.tool.supportsBatch ? [refs] : refs.map((r) => [r]);
      for (const batch of batches) {
        const result: ExecResult = await getExecutor(route.tool)(batch, delegateOptions, ctx);
        if (!result.ok) {
          return {
            ok: false,
            code: result.code,
            message: `${route.tool.name} could not do this conversion: ${result.message}`,
          };
        }
        files.push(...(result.files ?? []));
        if (result.summary) summaries.push(result.summary);
      }
    }

    if (files.length === 0) {
      throw unsupported(
        `That conversion produced no file. Try ${Object.values(routes)[0]} directly.`,
      );
    }
    const via = [...new Set(Object.values(routes))].join(" and ");
    return {
      ok: true,
      output: { target, routedTo: routes, fileCount: files.length },
      summary:
        `Converted ${plural(input.length, "file")} to .${target} using ${via}. ${summaries.join(" ")}`.trim(),
      files,
    };
  });
