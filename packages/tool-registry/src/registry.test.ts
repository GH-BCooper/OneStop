import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CATEGORIES,
  GROUPS,
  PHASE_FILES,
  PLATFORM_FEATURES,
  RegistryError,
  acceptAttribute,
  acceptsFileName,
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

  it("marks no tool offline before an offline test exists (CLAUDE.md §8)", () => {
    expect(tools.filter((t) => t.offline)).toEqual([]);
  });

  it("flags internet-only categories correctly", () => {
    for (const t of tools.filter((x) => x.category === "online-media")) {
      expect(t.network).toBe("required");
      expect(t.execution).toBe("remote");
    }
    expect(tools.find((t) => t.id === "spotify-link-info")?.outputTypes).toEqual(["json"]);
  });

  it("wires exactly one demo tool to a working executor", () => {
    expect(tools.filter((t) => t.status !== "stub").map((t) => t.id)).toEqual([
      "file-metadata-viewer",
    ]);
  });
});

const valid: ToolMeta = { ...tools[0]!, id: "x-tool", slug: "x-tool", sources: ["99.1"] };

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
