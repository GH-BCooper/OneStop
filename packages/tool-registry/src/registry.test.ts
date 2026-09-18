import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CATEGORIES,
  GROUPS,
  PHASE_FILES,
  PLATFORM_FEATURES,
  RegistryError,
  TOOL_OPTIONS,
  VERIFIED_OFFLINE,
  acceptAttribute,
  acceptsFileName,
  defaultOptionValues,
  getExecutor,
  inputKind,
  loadRegistry,
  tools,
  type ToolMeta,
} from "./index";

const root = path.resolve(import.meta.dirname, "../../..");

/** Every top-level numbered item in docs/OneStop_Features.md §1–15, as "section.item". */
function featureItems(): { ref: string; name: string }[] {
  const doc = readFileSync(path.join(root, "docs/OneStop_Features.md"), "utf8");
  const items: { ref: string; name: string }[] = [];
  let section: number | null = null;
  for (const line of doc.split(/\r?\n/)) {
    const heading = /^## (\d+) /.exec(line);
    if (heading) {
      const n = Number(heading[1]);
      section = n <= 15 ? n : null;
      continue;
    }
    if (line.startsWith("## ")) section = null;
    const item = /^(\d+)\. (.+)$/.exec(line);
    if (section !== null && item) items.push({ ref: `${section}.${item[1]}`, name: item[2]! });
  }
  return items;
}

describe("registry contents", () => {
  const items = featureItems();

  it("parses the Features document", () => {
    expect(items.length).toBeGreaterThan(230);
  });

  it("covers every Features item exactly once (tool entry or workflow platform feature)", () => {
    const owners = new Map<string, string[]>();
    for (const t of tools)
      for (const s of t.sources) owners.set(s, [...(owners.get(s) ?? []), t.id]);
    for (const f of PLATFORM_FEATURES) {
      for (const s of f.sources) owners.set(s, [...(owners.get(s) ?? []), f.name]);
    }
    const missing = items.filter((i) => !owners.has(i.ref)).map((i) => `${i.ref} ${i.name}`);
    const doubled = [...owners].filter(([, o]) => o.length > 1);
    const unknown = [...owners.keys()].filter((ref) => !items.some((i) => i.ref === ref));
    expect(missing).toEqual([]);
    expect(doubled).toEqual([]);
    expect(unknown).toEqual([]);
  });

  it("has unique ids and slugs, with id === slug", () => {
    expect(new Set(tools.map((t) => t.id)).size).toBe(tools.length);
    for (const t of tools) expect(t.slug).toBe(t.id);
  });

  it("uses known categories, and every category and group has tools", () => {
    for (const c of CATEGORIES) expect(tools.some((t) => t.category === c.id)).toBe(true);
    for (const g of GROUPS) {
      expect(g.categories.every((c) => CATEGORIES.some((x) => x.id === c))).toBe(true);
    }
    const grouped = GROUPS.flatMap((g) => g.categories);
    expect([...grouped].sort()).toEqual(CATEGORIES.map((c) => c.id).sort());
  });

  it("keeps group ids from colliding with a different category id", () => {
    for (const g of GROUPS) {
      const cat = CATEGORIES.find((c) => c.id === g.id);
      if (cat) expect(g.categories).toEqual([cat.id]);
    }
  });

  it("points every tool at an existing build phase file", () => {
    for (const t of tools) {
      expect(existsSync(path.join(root, "docs/build", PHASE_FILES[t.phase]))).toBe(true);
    }
  });

  it("marks a tool offline only when a passing offline test says so (CLAUDE.md §8)", () => {
    expect(
      tools
        .filter((t) => t.offline)
        .map((t) => t.id)
        .sort(),
    ).toEqual([...VERIFIED_OFFLINE].sort());
    // An offline tool must also be one that never needed the network by design.
    for (const tool of tools.filter((t) => t.offline)) expect(tool.network).toBe("none");
  });

  it("flags internet-only categories correctly", () => {
    for (const t of tools.filter((x) => x.category === "online-media")) {
      expect(t.network).toBe("required");
      expect(t.execution).toBe("remote");
    }
    expect(tools.find((t) => t.id === "spotify-link-info")?.outputTypes).toEqual(["json"]);
  });

  it("only marks a tool non-stub once a phase has actually built it", () => {
    // Phase 04's demo tool plus the eleven core PDF tools built in 05-pdf-tools-core.md.
    expect(
      tools
        .filter((t) => t.status !== "stub")
        .map((t) => t.id)
        .sort(),
    ).toEqual(
      [
        "compress-pdf",
        "delete-pdf-pages",
        "extract-pdf-pages",
        "file-metadata-viewer",
        "merge-pdf",
        "pdf-to-images",
        "pdf-to-text",
        "reorder-pdf-pages",
        "repair-pdf",
        "resize-pdf",
        "rotate-pdf-pages",
        "split-pdf",
        // 06-pdf-tools-advanced.md
        "add-page-numbers-to-pdf",
        "add-watermark-to-pdf",
        "compare-pdfs",
        "edit-pdf-metadata",
        "fill-pdf-forms",
        "ocr-pdf",
        "password-protect-pdf",
        "pdf-to-excel",
        "pdf-to-html",
        "pdf-to-pdfa",
        "pdf-to-powerpoint",
        "pdf-to-word",
        "remove-pdf-metadata",
        "remove-pdf-password",
        "sign-pdf",
        // 07-word-ppt-tools.md
        "compress-documents",
        "compress-presentation",
        "document-metadata",
        "document-summarizer",
        "document-to-images",
        "document-to-pdf",
        "document-translator",
        "extract-slides",
        "grammar-checker",
        "merge-documents",
        "merge-presentations",
        "ocr-to-word",
        "powerpoint-to-images",
        "powerpoint-to-pdf",
        "powerpoint-to-text",
        "rearrange-slides",
        "remove-slides",
        "split-documents",
        "split-presentation",
        "text-formatter",
        "word-to-excel",
        "word-to-html",
        "word-to-pdf",
        "word-to-text",
        // 08-excel-csv-data-tools.md
        "excel-to-pdf",
        "excel-to-word",
        "excel-to-csv",
        "excel-to-json",
        "excel-to-xml",
        "csv-to-excel",
        "csv-to-json",
        "csv-to-xml",
        "json-to-excel",
        "json-to-xml",
        "json-to-csv",
        "json-to-yaml",
        "xml-to-excel",
        "xml-to-json",
        "xml-to-csv",
        "yaml-to-json",
        "excel-merger",
        "excel-splitter",
        "csv-merger",
        "csv-splitter",
        "spreadsheet-cleaner",
        "duplicate-row-remover",
        "empty-row-column-remover",
        "column-row-transformer",
        "spreadsheet-formatter",
        "data-validator",
        "json-formatter",
        "json-validator",
        "xml-formatter",
        "xml-validator",
        // 09-image-tools.md
        "image-to-pdf",
        "image-resizer",
        "image-cropper",
        "image-compressor",
        "image-format-converter",
        "jpg-png-converter",
        "jpg-webp-converter",
        "png-webp-converter",
        "image-to-gif",
        "background-blur",
        "background-removal",
        "object-removal",
        "image-upscaler",
        "image-enhancer",
        "image-sharpening",
        "image-denoiser",
        "image-watermark",
        "add-text-to-image",
        "image-metadata-viewer",
        "remove-image-metadata",
        "image-color-adjustment",
        "rotate-image",
        "flip-image",
        "fit-image-to-square",
        "fit-image-to-circle",
        "meme-generator",
        "basic-image-editor",
        // 10-audio-video-tools.md
        "video-to-mp3",
        "audio-converter",
        "audio-compressor",
        "audio-trimmer",
        "audio-merger",
        "audio-to-wav",
        "audio-to-mp3",
        "audio-to-aac",
        "audio-to-flac",
        "extract-audio",
        "audio-metadata-editor",
        "volume-normalizer",
        "audio-waveform-generator",
        "video-converter",
        "video-compressor",
        "video-to-mp4",
        "video-to-webm",
        "video-to-gif",
        "video-trimmer",
        "video-merger",
        "video-resizer",
        "rotate-video",
        "extract-frames",
        "subtitle-extraction",
        "subtitle-conversion",
        "change-video-resolution",
        "change-video-quality",
      ].sort(),
    );
    for (const tool of tools.filter((t) => t.status === "available")) {
      expect(
        ["05", "06", "07", "08", "09", "10"],
        `${tool.id} is available but not from a built phase`,
      ).toContain(tool.phase);
    }
  });

  it("only defines options for tools that exist, with usable defaults", () => {
    for (const [id, options] of Object.entries(TOOL_OPTIONS)) {
      const tool = tools.find((t) => t.id === id);
      expect(tool, `TOOL_OPTIONS has an entry for the unknown tool "${id}"`).toBeDefined();
      const ids = options.map((o) => o.id);
      expect(new Set(ids).size, `duplicate option id in ${id}`).toBe(ids.length);
      for (const option of options) {
        if (option.type === "select") {
          expect(option.choices.map((c) => c.value)).toContain(option.default);
        }
        if (option.showWhen) expect(ids).toContain(option.showWhen.option);
      }
      expect(Object.keys(defaultOptionValues(id)).sort()).toEqual([...ids].sort());
    }
  });
});

// A fresh id is not in VERIFIED_OFFLINE, so it must not inherit a real tool's offline flag.
const valid: ToolMeta = {
  ...tools[0]!,
  id: "x-tool",
  slug: "x-tool",
  sources: ["99.1"],
  offline: false,
};

describe("loadRegistry", () => {
  it("accepts a valid registry", () => {
    expect(loadRegistry([valid])).toHaveLength(1);
  });

  it("fails loudly on duplicate ids and slugs", () => {
    const dup = { ...valid, sources: ["99.2"] };
    expect(() => loadRegistry([valid, dup])).toThrow(/duplicate id "x-tool"[\s\S]*duplicate slug/);
  });

  it.each([
    "id",
    "slug",
    "name",
    "category",
    "inputTypes",
    "outputTypes",
    "execution",
    "offline",
    "supportsBatch",
    "requiresAuth",
    "description",
  ] as const)("fails loudly when %s is missing", (field) => {
    const broken: Partial<ToolMeta> = { ...valid };
    delete broken[field];
    expect(() => loadRegistry([broken])).toThrow(RegistryError);
  });

  it("rejects unknown categories and bad slugs", () => {
    expect(() => loadRegistry([{ ...valid, category: "misc" }])).toThrow(/unknown category/);
    expect(() => loadRegistry([{ ...valid, slug: "Bad Slug" }])).toThrow(/invalid slug/);
  });

  it("rejects offline:true without a verified offline test", () => {
    expect(() => loadRegistry([{ ...valid, offline: true }])).toThrow(/offline test/);
  });

  it("rejects a Features item claimed twice", () => {
    const other = { ...valid, id: "y-tool", slug: "y-tool" };
    expect(() => loadRegistry([valid, other])).toThrow(/claimed by both/);
  });
});

describe("input helpers", () => {
  const byId = (id: string) => tools.find((t) => t.id === id)!;

  it("picks the right input control", () => {
    expect(inputKind(byId("merge-pdf"))).toBe("file");
    expect(inputKind(byId("url-encoder"))).toBe("text");
    expect(inputKind(byId("youtube-to-mp3"))).toBe("url");
    expect(inputKind(byId("uuid-generator"))).toBe("none");
  });

  it("validates file extensions against inputTypes", () => {
    expect(acceptsFileName(byId("image-to-pdf"), "holiday.JPG")).toBe(true);
    expect(acceptsFileName(byId("image-to-pdf"), "notes.docx")).toBe(false);
    expect(acceptsFileName(byId("merge-pdf"), "noextension")).toBe(false);
    expect(acceptsFileName(byId("zip-creator"), "anything.bin")).toBe(true);
    expect(acceptAttribute(byId("merge-pdf"))).toBe(".pdf");
    expect(acceptAttribute(byId("zip-creator"))).toBeUndefined();
  });
});

describe("executors", () => {
  it("echo executor reflects file metadata", async () => {
    const run = getExecutor({
      id: "file-metadata-viewer",
      name: "File Metadata Viewer",
      phase: "12",
    });
    const result = await run(
      [{ name: "a.txt", size: 12, type: "text/plain", lastModified: 0 }],
      {},
    );
    expect(result).toMatchObject({ ok: true, output: { files: [{ name: "a.txt", size: 12 }] } });
    await expect(run([], {})).resolves.toMatchObject({ ok: false, code: "UNSUPPORTED_INPUT" });
  });

  it("stub executors report NOT_IMPLEMENTED with the phase, never success", async () => {
    for (const t of tools.filter((x) => x.status === "stub")) {
      const result = await getExecutor(t)(null, {});
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("NOT_IMPLEMENTED");
        expect(result.message).toContain(PHASE_FILES[t.phase]);
      }
    }
  });
});
