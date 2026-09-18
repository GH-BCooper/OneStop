// Per-tool options (introduced in 05-pdf-tools-core.md).
//
// Options live in the registry, next to the rest of a tool's metadata, so all three consumers
// read the same source of truth: the generic tool page renders the controls, the pipeline hands
// the values to the executor, and phases 15/16 (workflows and the AI assistant) can discover what
// a tool can be asked to do without a human writing it down twice.
//
// Keep this declarative: no React, no `node:` imports. `showWhen` is the only bit of logic, and
// it is a plain equality test so a form can evaluate it without running arbitrary code.

import { DATA_TOOL_OPTIONS } from "./options-data";
import { IMAGE_TOOL_OPTIONS } from "./options-images";
import { MEDIA_TOOL_OPTIONS } from "./options-media";
import { QR_TOOL_OPTIONS } from "./options-qr";

export interface ToolOptionBase {
  id: string;
  label: string;
  help?: string;
  /** Show this option only when another option has one of these values. */
  showWhen?: { option: string; equals: string[] };
}

export interface SelectOption extends ToolOptionBase {
  type: "select";
  choices: { value: string; label: string }[];
  default: string;
}

export interface TextOption extends ToolOptionBase {
  type: "text";
  default: string;
  placeholder?: string;
  /** Rendered as a password field: never echoed on screen (Password Protect / Remove Password). */
  secret?: boolean;
  /** Rendered as a multi-line text area (e.g. Fill PDF Forms' field values). */
  multiline?: boolean;
}

export interface NumberOption extends ToolOptionBase {
  type: "number";
  default: number;
  min: number;
  max: number;
  step?: number;
  /** Shown after the field, e.g. "DPI" or "pages". */
  unit?: string;
}

export interface BooleanOption extends ToolOptionBase {
  type: "boolean";
  default: boolean;
}

/**
 * A drawing pad (06-pdf-tools-advanced.md, Sign PDF). The value is a `data:image/png;base64,…`
 * URL, or "" when nothing has been drawn; the server decodes and re-validates it.
 */
export interface SignatureOption extends ToolOptionBase {
  type: "signature";
  default: "";
}

/**
 * An image the user picks from their device (11-qr-tools.md, QR Code Customization's logo). Like
 * `signature`, the value is a `data:image/...;base64,...` URL, read in the browser and never
 * uploaded as a separate file; the server decodes and re-validates it.
 */
export interface ImageOption extends ToolOptionBase {
  type: "image";
  default: "";
}

export type ToolOption =
  | SelectOption
  | TextOption
  | NumberOption
  | BooleanOption
  | SignatureOption
  | ImageOption;

/** A page-selection field, used by six of the phase-05 tools with the same wording. */
function pageSelection(overrides: Partial<TextOption> = {}): TextOption {
  return {
    id: "pages",
    type: "text",
    label: "Pages",
    default: "",
    placeholder: "all",
    help: "Leave blank for every page. Accepts 1-3, 5, 9- and the words odd, even, first, last.",
    ...overrides,
  };
}

const packaging: SelectOption = {
  id: "packaging",
  type: "select",
  label: "Deliver as",
  default: "zip",
  choices: [
    { value: "zip", label: "One ZIP archive" },
    { value: "files", label: "Separate downloads" },
  ],
  help: "Only applies when there is more than one result.",
};

const positionChoices = [
  { value: "bottom-center", label: "Bottom centre" },
  { value: "bottom-right", label: "Bottom right" },
  { value: "bottom-left", label: "Bottom left" },
  { value: "top-center", label: "Top centre" },
  { value: "top-right", label: "Top right" },
  { value: "top-left", label: "Top left" },
];

const metadataField = (id: string, label: string): TextOption => ({
  id,
  type: "text",
  label,
  default: "",
  placeholder: "Keep current",
});

// ---- 07-word-ppt-tools.md shared options ------------------------------------------------------

const officeEngine: SelectOption = {
  id: "engine",
  type: "select",
  label: "Converter",
  default: "auto",
  choices: [
    { value: "auto", label: "Best available (LibreOffice if installed)" },
    { value: "builtin", label: "Built-in (always offline)" },
  ],
  help: "LibreOffice gives the closest layout; the built-in converter keeps text, tables and pictures.",
};

function imageExport(noun: "page" | "slide", dpi: number): ToolOption[] {
  return [
    {
      id: "format",
      type: "select",
      label: "Image format",
      default: "png",
      choices: [
        { value: "png", label: "PNG (sharp, larger)" },
        { value: "jpg", label: "JPG (smaller)" },
      ],
    },
    {
      id: "dpi",
      type: "number",
      label: "Resolution",
      default: dpi,
      min: 36,
      max: 300,
      step: 6,
      unit: "DPI",
    },
    {
      id: "quality",
      type: "number",
      label: "JPG quality",
      default: 85,
      min: 10,
      max: 100,
      step: 5,
      unit: "%",
      showWhen: { option: "format", equals: ["jpg"] },
    },
    pageSelection({
      label: noun === "slide" ? "Slides" : "Pages",
      help: `Leave blank for every ${noun}. Accepts 1-3, 5, 9- and the words odd, even, first, last.`,
    }),
    packaging,
  ];
}

const compressLevel: SelectOption = {
  id: "level",
  type: "select",
  label: "Compression",
  default: "balanced",
  choices: [
    { value: "light", label: "Light (lossless, pictures untouched)" },
    { value: "balanced", label: "Balanced (pictures up to 1920 px)" },
    { value: "strong", label: "Strong (pictures up to 1280 px, smaller files)" },
  ],
};

const translatorLanguages = [
  { value: "en", label: "English" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "it", label: "Italian" },
  { value: "pt", label: "Portuguese" },
];

/** Tool id → its options. A tool with no entry simply has none. */
export const TOOL_OPTIONS: Record<string, ToolOption[]> = {
  ...DATA_TOOL_OPTIONS,
  ...IMAGE_TOOL_OPTIONS,
  ...MEDIA_TOOL_OPTIONS,
  ...QR_TOOL_OPTIONS,
  "pdf-to-images": [
    {
      id: "format",
      type: "select",
      label: "Image format",
      default: "png",
      choices: [
        { value: "png", label: "PNG (sharp, larger)" },
        { value: "jpg", label: "JPG (smaller)" },
      ],
    },
    {
      id: "dpi",
      type: "number",
      label: "Resolution",
      default: 150,
      min: 36,
      max: 600,
      step: 6,
      unit: "DPI",
      help: "150 is good for screens, 300 for printing.",
    },
    {
      id: "quality",
      type: "number",
      label: "JPG quality",
      default: 85,
      min: 10,
      max: 100,
      step: 5,
      unit: "%",
      showWhen: { option: "format", equals: ["jpg"] },
    },
    pageSelection(),
    packaging,
  ],
  "pdf-to-text": [
    {
      id: "layout",
      type: "select",
      label: "Layout",
      default: "page-markers",
      choices: [
        { value: "page-markers", label: "Mark each page" },
        { value: "plain", label: "Continuous text" },
      ],
    },
    pageSelection(),
  ],
  "merge-pdf": [
    {
      id: "order",
      type: "select",
      label: "Order",
      default: "selected",
      choices: [
        { value: "selected", label: "The order I chose them" },
        { value: "name", label: "File name (A–Z)" },
        { value: "name-desc", label: "File name (Z–A)" },
      ],
    },
  ],
  "split-pdf": [
    {
      id: "mode",
      type: "select",
      label: "Split",
      default: "each-page",
      choices: [
        { value: "each-page", label: "Into single pages" },
        { value: "every-n", label: "Every N pages" },
        { value: "ranges", label: "By page ranges" },
      ],
    },
    {
      id: "size",
      type: "number",
      label: "Pages per file",
      default: 2,
      min: 1,
      max: 500,
      showWhen: { option: "mode", equals: ["every-n"] },
    },
    {
      id: "ranges",
      type: "text",
      label: "Ranges",
      default: "",
      placeholder: "1-3, 4-8",
      help: "One output PDF per range, separated by commas.",
      showWhen: { option: "mode", equals: ["ranges"] },
    },
    packaging,
  ],
  "extract-pdf-pages": [
    pageSelection({
      label: "Pages to keep",
      placeholder: "1-3, 7",
      help: "Leave blank to copy every page. Accepts 1-3, 5, 9- and the words odd, even, first, last.",
    }),
  ],
  "delete-pdf-pages": [
    pageSelection({
      label: "Pages to delete",
      placeholder: "2, 4-6",
      help: "Accepts 1-3, 5, 9- and the words odd, even, first, last. At least one page must remain.",
    }),
  ],
  "reorder-pdf-pages": [
    {
      id: "preset",
      type: "select",
      label: "New order",
      default: "custom",
      choices: [
        { value: "custom", label: "A specific order" },
        { value: "reverse", label: "Reverse every page" },
      ],
    },
    {
      id: "order",
      type: "text",
      label: "Page order",
      default: "",
      placeholder: "3,1,2",
      help: "List the pages in the order you want them. Anything you leave out keeps its place at the end.",
      showWhen: { option: "preset", equals: ["custom"] },
    },
  ],
  "rotate-pdf-pages": [
    {
      id: "angle",
      type: "select",
      label: "Rotate by",
      default: "90",
      choices: [
        { value: "90", label: "90° clockwise" },
        { value: "180", label: "180°" },
        { value: "270", label: "90° anticlockwise" },
      ],
    },
    pageSelection(),
  ],
  "compress-pdf": [
    {
      id: "level",
      type: "select",
      label: "How hard to try",
      default: "balanced",
      choices: [
        { value: "light", label: "Light — lossless, text stays selectable" },
        { value: "balanced", label: "Balanced — good quality, much smaller" },
        { value: "strong", label: "Strong — smallest, visibly softer" },
      ],
      help: "Balanced and Strong re-render the pages as images, so selectable text is lost.",
    },
    {
      id: "grayscale",
      type: "boolean",
      label: "Convert to grayscale",
      default: false,
      showWhen: { option: "level", equals: ["balanced", "strong"] },
    },
  ],
  "resize-pdf": [
    {
      id: "size",
      type: "select",
      label: "Page size",
      default: "a4",
      choices: [
        { value: "a4", label: "A4" },
        { value: "letter", label: "Letter" },
        { value: "legal", label: "Legal" },
        { value: "a3", label: "A3" },
        { value: "a5", label: "A5" },
        { value: "tabloid", label: "Tabloid" },
      ],
    },
    {
      id: "orientation",
      type: "select",
      label: "Orientation",
      default: "auto",
      choices: [
        { value: "auto", label: "Match each page" },
        { value: "portrait", label: "Portrait" },
        { value: "landscape", label: "Landscape" },
      ],
    },
    {
      id: "mode",
      type: "select",
      label: "Fit",
      default: "fit",
      choices: [
        { value: "fit", label: "Keep proportions" },
        { value: "stretch", label: "Stretch to fill" },
      ],
    },
  ],

  // ---- 06-pdf-tools-advanced.md ---------------------------------------------------------------
  "pdf-to-pdfa": [
    {
      id: "mode",
      type: "select",
      label: "Conversion",
      default: "auto",
      choices: [
        { value: "auto", label: "Keep pages as they are where possible" },
        { value: "image", label: "Rebuild every page as an image" },
      ],
      help: "Pages using fonts the file does not embed are always rebuilt as images, with searchable text kept.",
    },
  ],
  "pdf-to-html": [
    {
      id: "mode",
      type: "select",
      label: "Layout",
      default: "layout",
      choices: [
        { value: "layout", label: "Exact — looks like the PDF, text selectable" },
        { value: "flow", label: "Reflowable — clean headings and paragraphs" },
        { value: "text", label: "Positioned text only (no images)" },
      ],
    },
    pageSelection(),
  ],
  "add-watermark-to-pdf": [
    {
      id: "text",
      type: "text",
      label: "Watermark text",
      default: "CONFIDENTIAL",
      help: "To use an image instead, upload a PNG or JPG together with the PDF.",
    },
    {
      id: "position",
      type: "select",
      label: "Position",
      default: "center",
      choices: [
        { value: "center", label: "Centre" },
        { value: "tile", label: "Tiled across the page" },
        { value: "top-center", label: "Top" },
        { value: "bottom-center", label: "Bottom" },
      ],
    },
    {
      id: "angle",
      type: "select",
      label: "Angle",
      default: "diagonal",
      choices: [
        { value: "diagonal", label: "Diagonal" },
        { value: "horizontal", label: "Horizontal" },
        { value: "vertical", label: "Vertical" },
      ],
    },
    {
      id: "opacity",
      type: "number",
      label: "Opacity",
      default: 25,
      min: 5,
      max: 100,
      step: 5,
      unit: "%",
    },
    {
      id: "fontSize",
      type: "number",
      label: "Text size",
      default: 60,
      min: 6,
      max: 300,
      unit: "pt",
      help: "Shrunk automatically if it would not fit the page.",
    },
    {
      id: "color",
      type: "select",
      label: "Text colour",
      default: "gray",
      choices: [
        { value: "gray", label: "Grey" },
        { value: "red", label: "Red" },
        { value: "blue", label: "Blue" },
        { value: "black", label: "Black" },
      ],
    },
    {
      id: "imageScale",
      type: "number",
      label: "Image width",
      default: 40,
      min: 5,
      max: 100,
      step: 5,
      unit: "% of page",
      help: "Only used with an image watermark.",
    },
    pageSelection(),
    packaging,
  ],
  "add-page-numbers-to-pdf": [
    {
      id: "format",
      type: "select",
      label: "Format",
      default: "number",
      choices: [
        { value: "number", label: "1" },
        { value: "page", label: "Page 1" },
        { value: "page-of", label: "Page 1 of 10" },
        { value: "slash", label: "1 / 10" },
      ],
    },
    {
      id: "position",
      type: "select",
      label: "Position",
      default: "bottom-center",
      choices: positionChoices,
    },
    { id: "start", type: "number", label: "Start at", default: 1, min: 0, max: 100000 },
    { id: "fontSize", type: "number", label: "Size", default: 11, min: 6, max: 72, unit: "pt" },
    {
      id: "margin",
      type: "number",
      label: "Distance from edge",
      default: 28,
      min: 0,
      max: 200,
      unit: "pt",
    },
    {
      id: "skipFirst",
      type: "boolean",
      label: "Leave the first page (cover) unnumbered",
      default: false,
    },
    pageSelection({ help: "Only these pages get a number, counted from the start value." }),
  ],
  "password-protect-pdf": [
    {
      id: "password",
      type: "text",
      label: "Open password",
      default: "",
      secret: true,
      help: "At least 4 characters. It cannot be recovered if you lose it.",
    },
    {
      id: "ownerPassword",
      type: "text",
      label: "Owner password (optional)",
      default: "",
      secret: true,
      help: "Lets you change the permissions later. Leave blank for a random one.",
    },
    {
      id: "algorithm",
      type: "select",
      label: "Encryption",
      default: "AES-256",
      choices: [
        { value: "AES-256", label: "AES-256 (recommended)" },
        { value: "AES-128", label: "AES-128 (very old readers)" },
      ],
    },
    { id: "allowPrinting", type: "boolean", label: "Allow printing", default: true },
    { id: "allowCopying", type: "boolean", label: "Allow copying text", default: false },
    {
      id: "allowEditing",
      type: "boolean",
      label: "Allow editing and form filling",
      default: false,
    },
  ],
  "remove-pdf-password": [
    {
      id: "password",
      type: "text",
      label: "Current password",
      default: "",
      secret: true,
      help: "Only for PDFs you are allowed to open. It is checked once and never stored.",
    },
  ],
  "sign-pdf": [
    {
      id: "source",
      type: "select",
      label: "Signature",
      default: "draw",
      choices: [
        { value: "draw", label: "Draw it" },
        { value: "type", label: "Type my name" },
        { value: "upload", label: "Use an uploaded image" },
      ],
      help: "To upload, add a PNG or JPG of your signature together with the PDF.",
    },
    {
      id: "signature",
      type: "signature",
      label: "Draw your signature",
      default: "",
      showWhen: { option: "source", equals: ["draw"] },
    },
    {
      id: "signerName",
      type: "text",
      label: "Your name",
      default: "",
      placeholder: "Ada Lovelace",
      help: "Used for a typed signature, the caption and the certificate.",
    },
    {
      id: "page",
      type: "text",
      label: "Page",
      default: "last",
      placeholder: "last",
      help: "A page number, first or last.",
    },
    {
      id: "position",
      type: "select",
      label: "Position",
      default: "bottom-right",
      choices: [...positionChoices, { value: "center", label: "Centre" }],
    },
    {
      id: "width",
      type: "number",
      label: "Signature width",
      default: 160,
      min: 40,
      max: 500,
      unit: "pt",
    },
    {
      id: "caption",
      type: "boolean",
      label: "Add “Signed by … on (date)” under it",
      default: true,
    },
    {
      id: "certify",
      type: "boolean",
      label: "Seal with a self-signed digital certificate",
      default: false,
      help: "Detects any later change to the file. Readers show it as an unverified identity — it is not a paid, trusted certificate.",
    },
  ],
  "fill-pdf-forms": [
    {
      id: "values",
      type: "text",
      label: "Field values",
      default: "",
      multiline: true,
      placeholder: "Name = Ada Lovelace\nSubscribe = yes",
      help: "Leave empty and run once to list the form's fields. One Field = value per line, or a JSON object.",
    },
    {
      id: "flatten",
      type: "boolean",
      label: "Flatten (make the answers permanent)",
      default: false,
    },
  ],
  "edit-pdf-metadata": [
    metadataField("title", "Title"),
    metadataField("author", "Author"),
    metadataField("subject", "Subject"),
    metadataField("keywords", "Keywords"),
    metadataField("creator", "Creator application"),
    {
      ...metadataField("producer", "Producer"),
      help: "Leave a field blank to keep it; enter a single - to clear it.",
    },
  ],
  "remove-pdf-metadata": [packaging],
  "compare-pdfs": [
    {
      id: "output",
      type: "select",
      label: "Results",
      default: "both",
      choices: [
        { value: "both", label: "Report and highlighted PDF" },
        { value: "report", label: "Text report (HTML)" },
        { value: "pdf", label: "Highlighted PDF" },
      ],
      help: "Choose the original first, then the changed version.",
    },
  ],
  "ocr-pdf": [
    {
      id: "output",
      type: "select",
      label: "Output",
      default: "both",
      choices: [
        { value: "both", label: "Searchable PDF and text file" },
        { value: "pdf", label: "Searchable PDF" },
        { value: "txt", label: "Text file" },
      ],
    },
    {
      id: "language",
      type: "select",
      label: "Language",
      default: "eng",
      choices: [{ value: "eng", label: "English" }],
    },
    {
      id: "dpi",
      type: "number",
      label: "Scan resolution",
      default: 300,
      min: 100,
      max: 400,
      step: 50,
      unit: "DPI",
      help: "300 reads small print best; 200 is faster.",
    },
    { id: "skipText", type: "boolean", label: "Skip pages that already have text", default: true },
    pageSelection(),
  ],
  "pdf-to-word": [
    {
      id: "layout",
      type: "select",
      label: "Layout",
      default: "editable",
      choices: [
        { value: "editable", label: "Editable text, headings and paragraphs" },
        { value: "exact", label: "Exact look (pages as pictures)" },
      ],
    },
    {
      id: "engine",
      type: "select",
      label: "Converter",
      default: "builtin",
      choices: [
        { value: "builtin", label: "Built-in (works everywhere)" },
        { value: "libreoffice", label: "LibreOffice, if installed" },
      ],
      showWhen: { option: "layout", equals: ["editable"] },
    },
    pageSelection(),
  ],
  "pdf-to-excel": [
    {
      id: "sheets",
      type: "select",
      label: "Worksheets",
      default: "per-page",
      choices: [
        { value: "per-page", label: "One sheet per page" },
        { value: "single", label: "Everything on one sheet" },
      ],
    },
    pageSelection(),
  ],
  "pdf-to-powerpoint": [
    {
      id: "layout",
      type: "select",
      label: "Slides",
      default: "exact",
      choices: [
        { value: "exact", label: "Exact look (page images, text in notes)" },
        { value: "editable", label: "Editable text boxes" },
      ],
    },
    pageSelection(),
  ],

  // ---- 07-word-ppt-tools.md -------------------------------------------------------------------
  "word-to-pdf": [officeEngine, packaging],
  "document-to-pdf": [officeEngine, packaging],
  "powerpoint-to-pdf": [officeEngine, packaging],
  "document-to-images": imageExport("page", 150),
  "powerpoint-to-images": imageExport("slide", 96),
  "word-to-html": [
    {
      id: "images",
      type: "select",
      label: "Pictures",
      default: "embed",
      choices: [
        { value: "embed", label: "Embed in the page" },
        { value: "omit", label: "Leave out" },
      ],
    },
  ],
  "word-to-excel": [
    {
      id: "content",
      type: "select",
      label: "Move into Excel",
      default: "tables",
      choices: [
        { value: "tables", label: "Tables only (one sheet each)" },
        { value: "all", label: "Tables and all text" },
      ],
      help: "A document without tables always gets its paragraphs as rows.",
    },
  ],
  "split-documents": [
    {
      id: "mode",
      type: "select",
      label: "Split at",
      default: "auto",
      choices: [
        { value: "auto", label: "Headings, or page breaks if there are none" },
        { value: "headings", label: "Headings" },
        { value: "breaks", label: "Page and section breaks" },
      ],
    },
    {
      id: "level",
      type: "select",
      label: "Heading level",
      default: "1",
      choices: [
        { value: "1", label: "Heading 1" },
        { value: "2", label: "Heading 1–2" },
        { value: "3", label: "Heading 1–3" },
      ],
      showWhen: { option: "mode", equals: ["auto", "headings"] },
    },
    packaging,
  ],
  "compress-documents": [compressLevel, packaging],
  "compress-presentation": [compressLevel, packaging],
  "ocr-to-word": [
    {
      id: "includeImage",
      type: "boolean",
      label: "Put the original page image above the text",
      default: false,
    },
    {
      id: "keepLines",
      type: "boolean",
      label: "Keep the original line breaks",
      default: false,
      help: "Off joins wrapped lines back into paragraphs.",
    },
    pageSelection({ help: "PDFs only. Leave blank for every page." }),
  ],
  "document-translator": [
    {
      id: "from",
      type: "select",
      label: "From",
      default: "en",
      choices: translatorLanguages,
    },
    {
      id: "to",
      type: "select",
      label: "To",
      default: "es",
      choices: translatorLanguages,
      help: "Offline word-by-word translation with a built-in dictionary: rough, literal results. Better quality arrives with the AI Assistant.",
    },
  ],
  "grammar-checker": [
    { id: "spelling", type: "boolean", label: "Check spelling", default: true },
    {
      id: "style",
      type: "boolean",
      label: "Style suggestions",
      default: true,
      help: "Passive voice, wordy phrases, weasel words and clichés.",
    },
    {
      id: "output",
      type: "select",
      label: "Results",
      default: "both",
      choices: [
        { value: "both", label: "Report and corrected copy" },
        { value: "report", label: "Report only" },
        { value: "corrected", label: "Corrected copy only" },
      ],
      help: "The corrected copy applies only the safe fixes; spelling guesses stay in the report.",
    },
  ],
  "text-formatter": [
    {
      id: "case",
      type: "select",
      label: "Letter case",
      default: "none",
      choices: [
        { value: "none", label: "Keep as is" },
        { value: "sentence", label: "Sentence case" },
        { value: "title", label: "Title Case" },
        { value: "capitalize", label: "Capitalize Each Word" },
        { value: "lower", label: "lower case" },
        { value: "upper", label: "UPPER CASE" },
      ],
    },
    {
      id: "blankLines",
      type: "select",
      label: "Blank lines",
      default: "single",
      choices: [
        { value: "single", label: "At most one in a row" },
        { value: "keep", label: "Keep" },
        { value: "remove", label: "Remove all" },
      ],
    },
    { id: "trimLines", type: "boolean", label: "Trim spaces at line ends", default: true },
    { id: "collapseSpaces", type: "boolean", label: "Collapse repeated spaces", default: true },
    {
      id: "unwrap",
      type: "boolean",
      label: "Join wrapped lines into paragraphs",
      default: false,
      help: "Useful for text copied from a PDF or an email.",
    },
    { id: "tabsToSpaces", type: "boolean", label: "Turn tabs into spaces", default: false },
    { id: "straightQuotes", type: "boolean", label: "Use straight quotes", default: false },
    {
      id: "lineEndings",
      type: "select",
      label: "Line endings",
      default: "lf",
      choices: [
        { value: "lf", label: "LF (macOS, Linux, web)" },
        { value: "crlf", label: "CRLF (Windows)" },
      ],
    },
  ],
  "document-summarizer": [
    {
      id: "length",
      type: "select",
      label: "Summary length",
      default: "medium",
      choices: [
        { value: "short", label: "Short (2–4 sentences)" },
        { value: "medium", label: "Medium (3–7 sentences)" },
        { value: "long", label: "Long (5–12 sentences)" },
      ],
    },
  ],
  "document-metadata": [
    {
      id: "mode",
      type: "select",
      label: "Action",
      default: "view",
      choices: [
        { value: "view", label: "View metadata" },
        { value: "remove", label: "Remove metadata" },
      ],
    },
    {
      id: "authors",
      type: "boolean",
      label: "Also anonymise names on comments and tracked changes",
      default: true,
      showWhen: { option: "mode", equals: ["remove"] },
    },
  ],
  "powerpoint-to-text": [
    { id: "notes", type: "boolean", label: "Include speaker notes", default: true },
  ],
  "split-presentation": [
    {
      id: "mode",
      type: "select",
      label: "Split",
      default: "every",
      choices: [
        { value: "every", label: "Every N slides" },
        { value: "ranges", label: "Into ranges" },
      ],
    },
    {
      id: "size",
      type: "number",
      label: "Slides per file",
      default: 1,
      min: 1,
      max: 500,
      unit: "slides",
      showWhen: { option: "mode", equals: ["every"] },
    },
    {
      id: "ranges",
      type: "text",
      label: "Ranges",
      default: "",
      placeholder: "1-3, 4-6, 7-",
      help: "Each comma-separated range becomes one presentation.",
      showWhen: { option: "mode", equals: ["ranges"] },
    },
    packaging,
  ],
  "extract-slides": [
    {
      id: "slides",
      type: "text",
      label: "Slides to extract",
      default: "",
      placeholder: "2-4, 7",
      help: "Accepts 1-3, 5, 9- and the words odd, even, first, last.",
    },
  ],
  "rearrange-slides": [
    {
      id: "order",
      type: "text",
      label: "New order",
      default: "",
      placeholder: "3, 1, 2",
      help: "List slides in the order you want; any you leave out keep their order at the end. Type reverse to flip the deck.",
    },
  ],
  "remove-slides": [
    {
      id: "slides",
      type: "text",
      label: "Slides to remove",
      default: "",
      placeholder: "2, 5-6",
      help: "Accepts 1-3, 5, 9- and the words odd, even, first, last.",
    },
  ],
};

export function getToolOptions(toolId: string): ToolOption[] {
  return TOOL_OPTIONS[toolId] ?? [];
}

export function defaultOptionValues(toolId: string): Record<string, string | number | boolean> {
  const values: Record<string, string | number | boolean> = {};
  for (const option of getToolOptions(toolId)) values[option.id] = option.default;
  return values;
}

/** Whether an option's `showWhen` condition is met by the current values. */
export function isOptionVisible(option: ToolOption, values: Record<string, unknown>): boolean {
  if (!option.showWhen) return true;
  return option.showWhen.equals.includes(String(values[option.showWhen.option]));
}

/**
 * Option values safe to keep in a job record (06-pdf-tools-advanced.md). Passwords (`secret`)
 * never leave the executor call: they are replaced with a marker, as is a drawn signature, which
 * is personal and large. Everything else is kept so a job still says what it was asked to do.
 */
export function redactOptionValues(
  toolId: string,
  values: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...values };
  for (const option of getToolOptions(toolId)) {
    if (!(option.id in out)) continue;
    if (option.type === "text" && option.secret) out[option.id] = "[redacted]";
    else if (option.type === "signature" && out[option.id]) out[option.id] = "[signature]";
    else if (option.type === "image" && out[option.id]) out[option.id] = "[image]";
  }
  return out;
}

/** The values actually sent to the server: visible options only, so hidden ones never confuse a tool. */
export function visibleOptionValues(
  toolId: string,
  values: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const option of getToolOptions(toolId)) {
    if (isOptionVisible(option, values)) out[option.id] = values[option.id] ?? option.default;
  }
  return out;
}
