// Per-tool options (introduced in 05-pdf-tools-core.md).
//
// Options live in the registry, next to the rest of a tool's metadata, so all three consumers
// read the same source of truth: the generic tool page renders the controls, the pipeline hands
// the values to the executor, and phases 15/16 (workflows and the AI assistant) can discover what
// a tool can be asked to do without a human writing it down twice.
//
// Keep this declarative: no React, no `node:` imports. `showWhen` is the only bit of logic, and
// it is a plain equality test so a form can evaluate it without running arbitrary code.

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

export type ToolOption = SelectOption | TextOption | NumberOption | BooleanOption;

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

/** Tool id → its options. A tool with no entry simply has none. */
export const TOOL_OPTIONS: Record<string, ToolOption[]> = {
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
