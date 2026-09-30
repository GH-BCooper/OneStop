import { describe, expect, it } from "vitest";
import { parseDirection, searchTools, tools } from "./index";

const top = (query: string) => searchTools(tools, { query })[0]?.id;

describe("search relevance (master §21 examples)", () => {
  it.each([
    ["make a pdf from images", "image-to-pdf"],
    ["remove background", "background-removal"],
    ["compress my video", "video-compressor"],
    ["convert csv to json", "csv-to-json"],
  ])('"%s" → %s', (query, id) => {
    expect(top(query)).toBe(id);
  });
});

describe("search relevance (more)", () => {
  it.each([
    ["convert json to csv", "json-to-csv"],
    ["pdf to word", "pdf-to-word"],
    ["combine pdfs", "merge-pdf"],
    ["shrink a pdf", "compress-pdf"],
    ["what is my ip", "public-ip-detector"],
    ["youtube mp3", "youtube-to-mp3"],
    ["unzip", "zip-extractor"],
    ["wifi qr", "wifi-to-qr"],
    ["extract audio from video", "extract-audio"],
    ["uuid", "uuid-generator"],
    ["Merge PDF", "merge-pdf"],
  ])('"%s" → %s', (query, id) => {
    expect(top(query)).toBe(id);
  });

  it("returns nothing for gibberish", () => {
    expect(searchTools(tools, { query: "qwxzzy" })).toEqual([]);
  });

  it("parses conversion direction", () => {
    expect(parseDirection("make a pdf from images")).toEqual({ source: "image", target: "pdf" });
    expect(parseDirection("convert csv to json")).toEqual({ source: "csv", target: "json" });
    expect(parseDirection("compress my video")).toEqual({});
  });
});

describe("filters and sorting", () => {
  it("filters by registry category and by catalogue group", () => {
    const pdf = searchTools(tools, { category: "pdf" });
    expect(pdf.length).toBe(tools.filter((t) => t.category === "pdf").length);
    expect(pdf.length).toBeGreaterThanOrEqual(26);
    expect(pdf.every((t) => t.category === "pdf")).toBe(true);
    const media = searchTools(tools, { category: "media" });
    expect(new Set(media.map((t) => t.category))).toEqual(
      new Set(["audio", "video", "online-media"]),
    );
  });

  it("filters by subcategory", () => {
    const ppt = searchTools(tools, { category: "documents", subcategory: "PowerPoint" });
    expect(ppt.map((t) => t.subcategory)).toEqual(ppt.map(() => "PowerPoint"));
    expect(ppt.length).toBe(
      tools.filter((t) => t.category === "documents" && t.subcategory === "PowerPoint").length,
    );
  });

  it("filters by tags", () => {
    const online = searchTools(tools, { tags: ["online"] });
    expect(online.some((t) => t.id === "dns-lookup")).toBe(true);
    expect(online.some((t) => t.id === "merge-pdf")).toBe(false);
    const offline = searchTools(tools, { tags: ["offline"] });
    expect(offline.some((t) => t.id === "dns-lookup")).toBe(false);
    const ai = searchTools(tools, { tags: ["ai"] });
    expect(ai.every((t) => t.category === "ai")).toBe(true);
    const imageFiles = searchTools(tools, { tags: ["image", "file"] });
    expect(imageFiles.some((t) => t.id === "image-resizer")).toBe(true);
    expect(imageFiles.some((t) => t.id === "uuid-generator")).toBe(false);
  });

  it("combines query with filters", () => {
    const results = searchTools(tools, { query: "compress", category: "pdf" });
    expect(results[0]?.id).toBe("compress-pdf");
    expect(results.every((t) => t.category === "pdf")).toBe(true);
  });

  it("sorts by name, popularity and recently used", () => {
    const byName = searchTools(tools, { sort: "name" }).map((t) => t.name);
    expect(byName).toEqual([...byName].sort((a, b) => a.localeCompare(b)));
    const byPop = searchTools(tools, { sort: "popularity" });
    expect(byPop[0]!.popularity).toBeGreaterThanOrEqual(byPop.at(-1)!.popularity);
    const recent = searchTools(tools, { sort: "recent", recentIds: ["dns-lookup", "merge-pdf"] });
    expect(recent.slice(0, 2).map((t) => t.id)).toEqual(["dns-lookup", "merge-pdf"]);
  });
});

describe("search relevance (found in the end-to-end QA pass)", () => {
  it.each([
    ["qr code", "qr-code-generator"],
    ["image to text", "ai-ocr"],
    ["speech to text", "auto-subtitle-generator"],
    ["excel to pdf", "excel-to-pdf"],
  ])('"%s" → %s first', (query, id) => {
    expect(top(query)).toBe(id);
  });

  it("does not offer the reverse tool ahead of the right one (speech to text vs text to speech)", () => {
    const ids = searchTools(tools, { query: "speech to text" }).map((t) => t.id);
    expect(ids.indexOf("auto-subtitle-generator")).toBeLessThan(
      ids.indexOf("text-to-speech-reader") === -1 ? Infinity : ids.indexOf("text-to-speech-reader"),
    );
    const reverse = searchTools(tools, { query: "text to speech" }).map((t) => t.id);
    expect(reverse[0]).toBe("text-to-speech-reader");
  });

  it("keeps a several-word query short instead of listing every tool that mentions one word", () => {
    const results = searchTools(tools, { query: "csv json" });
    expect(results.length).toBeLessThan(25);
    expect(
      results
        .slice(0, 2)
        .map((t) => t.id)
        .sort(),
    ).toEqual(["csv-to-json", "json-to-csv"]);
  });

  it("leaves a single broad word broad, and never trims below five", () => {
    expect(searchTools(tools, { query: "pdf" }).length).toBeGreaterThan(30);
    expect(searchTools(tools, { query: "speech to text" }).length).toBeGreaterThanOrEqual(5);
  });
});
