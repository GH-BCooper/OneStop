// Registry loader: validates every entry when the module is first imported, so a bad entry
// fails `next build`, `npm test` and dev startup loudly instead of shipping a broken catalogue.
import { CATEGORY_IDS, PHASE_FILES, type PlatformFeature, type ToolMeta } from "./schema";

/**
 * Tool ids with a passing offline test. `loadRegistry` is what sets `offline: true`, from this
 * list alone, so an entry can never claim it on its own (CLAUDE.md §8). 19-testing.md audits the
 * list; a phase adds an id here only once its own test proves the tool makes no network call.
 *
 * The eleven core PDF tools qualify via the "offline" suite in `apps/api/src/pdf/pdf.test.ts`,
 * which runs each of them with `fetch`, `http.get/request` and `https.get/request` replaced by
 * traps that throw.
 */
export const VERIFIED_OFFLINE: readonly string[] = [
  "compress-pdf",
  "delete-pdf-pages",
  "extract-pdf-pages",
  "merge-pdf",
  "pdf-to-images",
  "pdf-to-text",
  "reorder-pdf-pages",
  "repair-pdf",
  "resize-pdf",
  "rotate-pdf-pages",
  "split-pdf",
  // 06-pdf-tools-advanced.md — apps/api/src/pdf/advanced.test.ts "offline" suite.
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
  // 07-word-ppt-tools.md — apps/api/src/documents/documents.test.ts "offline" suite.
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
  // 08-excel-csv-data-tools.md — apps/api/src/data/data.test.ts "offline" suite.
  "column-row-transformer",
  "csv-merger",
  "csv-splitter",
  "csv-to-excel",
  "csv-to-json",
  "csv-to-xml",
  "data-validator",
  "duplicate-row-remover",
  "empty-row-column-remover",
  "excel-merger",
  "excel-splitter",
  "excel-to-csv",
  "excel-to-json",
  "excel-to-pdf",
  "excel-to-word",
  "excel-to-xml",
  "json-formatter",
  "json-to-csv",
  "json-to-excel",
  "json-to-xml",
  "json-to-yaml",
  "json-validator",
  "spreadsheet-cleaner",
  "spreadsheet-formatter",
  "xml-formatter",
  "xml-to-csv",
  "xml-to-excel",
  "xml-to-json",
  "xml-validator",
  "yaml-to-json",
  // 09-image-tools.md — apps/api/src/images/images.test.ts "offline" suite (built-in methods; a
  // local AI model, when configured, is a user choice on top).
  "add-text-to-image",
  "background-blur",
  "background-removal",
  "basic-image-editor",
  "fit-image-to-circle",
  "fit-image-to-square",
  "flip-image",
  "image-color-adjustment",
  "image-compressor",
  "image-cropper",
  "image-denoiser",
  "image-enhancer",
  "image-format-converter",
  "image-metadata-viewer",
  "image-resizer",
  "image-sharpening",
  "image-to-gif",
  "image-to-pdf",
  "image-upscaler",
  "image-watermark",
  "jpg-png-converter",
  "jpg-webp-converter",
  "meme-generator",
  "object-removal",
  "png-webp-converter",
  "remove-image-metadata",
  "rotate-image",
  // 10-audio-video-tools.md — apps/api/src/media/media.test.ts "offline" suite.
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
  // 11-qr-tools.md - apps/api/src/qr/qr.test.ts "offline" suite. The four dynamic tools are not
  // here: they resolve through a OneStop URL, which is exactly what needs the network.
  "qr-code-generator",
  "qr-code-scanner",
  "url-to-qr",
  "text-to-qr",
  "image-to-qr",
  "audio-to-qr",
  "contact-to-qr",
  "email-to-qr",
  "phone-to-qr",
  "wifi-to-qr",
  "qr-code-customization",
];

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SOURCE_RE = /^\d{1,2}\.\d{1,2}$/;

export class RegistryError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Tool registry is invalid:\n  - ${problems.join("\n  - ")}`);
    this.name = "RegistryError";
  }
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => isNonEmptyString(x));
}

/** Returns a list of problems for one entry (empty when valid). */
export function validateEntry(entry: unknown): string[] {
  const problems: string[] = [];
  if (typeof entry !== "object" || entry === null) return ["entry is not an object"];
  const e = entry as Partial<Record<keyof ToolMeta, unknown>>;
  const label = isNonEmptyString(e.id) ? e.id : "<missing id>";
  const need = (ok: boolean, msg: string) => {
    if (!ok) problems.push(`${label}: ${msg}`);
  };

  need(isNonEmptyString(e.id), "missing id");
  need(isNonEmptyString(e.slug), "missing slug");
  if (isNonEmptyString(e.slug)) need(SLUG_RE.test(e.slug), `invalid slug "${e.slug}"`);
  need(isNonEmptyString(e.name), "missing name");
  need(
    typeof e.category === "string" && (CATEGORY_IDS as readonly string[]).includes(e.category),
    `unknown category "${String(e.category)}"`,
  );
  need(isNonEmptyString(e.subcategory), "missing subcategory");
  need(isStringArray(e.inputTypes), "inputTypes must be an array of strings");
  need(isStringArray(e.outputTypes) && e.outputTypes.length > 0, "outputTypes must be non-empty");
  need(e.execution === "local" || e.execution === "remote", "execution must be local|remote");
  need(typeof e.offline === "boolean", "offline must be boolean");
  need(
    e.network === "none" || e.network === "optional" || e.network === "required",
    "network must be none|optional|required",
  );
  need(typeof e.supportsBatch === "boolean", "supportsBatch must be boolean");
  need(typeof e.requiresAuth === "boolean", "requiresAuth must be boolean");
  need(isStringArray(e.keywords), "keywords must be an array of strings");
  need(isNonEmptyString(e.description), "missing description");
  need(typeof e.phase === "string" && e.phase in PHASE_FILES, `unknown phase "${String(e.phase)}"`);
  need(
    e.status === "stub" || e.status === "demo" || e.status === "available",
    "status must be stub|demo|available",
  );
  need(
    typeof e.popularity === "number" && e.popularity >= 0 && e.popularity <= 100,
    "popularity must be 0–100",
  );
  need(
    isStringArray(e.sources) && e.sources.length > 0 && e.sources.every((s) => SOURCE_RE.test(s)),
    'sources must be non-empty "section.item" references',
  );

  if (e.localModel !== undefined) {
    need(
      e.localModel === "optional" || e.localModel === "required",
      "localModel must be optional|required",
    );
  }

  if (e.offline === true && !VERIFIED_OFFLINE.includes(label)) {
    problems.push(`${label}: offline:true without a passing offline test (see VERIFIED_OFFLINE)`);
  }
  if (e.network === "required" && e.offline === true) {
    problems.push(`${label}: a tool that requires the network cannot be offline`);
  }
  if (e.network === "required" && e.execution !== "remote") {
    problems.push(`${label}: network "required" tools must use execution "remote"`);
  }
  return problems;
}

/** Validates the whole registry. Throws a RegistryError listing every problem found. */
export function loadRegistry(
  entries: readonly unknown[],
  platformFeatures: readonly PlatformFeature[] = [],
): ToolMeta[] {
  const problems = entries.flatMap(validateEntry);
  const seen = (key: "id" | "slug") => {
    const counts = new Map<string, number>();
    for (const e of entries as Partial<ToolMeta>[]) {
      if (isNonEmptyString(e?.[key])) counts.set(e[key], (counts.get(e[key]) ?? 0) + 1);
    }
    for (const [value, n] of counts) {
      if (n > 1) problems.push(`duplicate ${key} "${value}" (${n} entries)`);
    }
  };
  seen("id");
  seen("slug");

  const sourceOwners = new Map<string, string>();
  const claim = (source: string, owner: string) => {
    const prev = sourceOwners.get(source);
    if (prev) problems.push(`Features item ${source} is claimed by both "${prev}" and "${owner}"`);
    else sourceOwners.set(source, owner);
  };
  for (const e of entries as Partial<ToolMeta>[]) {
    if (isStringArray(e?.sources)) e.sources.forEach((s) => claim(s, e.id ?? "?"));
  }
  for (const f of platformFeatures) f.sources.forEach((s) => claim(s, f.name));

  if (problems.length > 0) throw new RegistryError(problems);
  // `offline` is derived, never authored: an entry says what it needs (`network`), and this list
  // says what has actually been proven.
  return (entries as ToolMeta[]).map((entry) =>
    VERIFIED_OFFLINE.includes(entry.id) ? { ...entry, offline: true } : entry,
  );
}
