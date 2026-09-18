// Fill PDF Forms (Features 1.21).
//
// Two steps through the same tool: run it with no values and it lists the form's fields (name,
// type, current value, choices); run it with `Field name = value` lines (or a JSON object) and it
// fills them, optionally flattening the form so the answers can no longer be edited. The same
// contract works for a person, a workflow step (phase 15) and the AI Assistant (phase 16).
import {
  PDFCheckBox,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  PDFSignature,
  PDFTextField,
  type PDFField,
  type PDFForm,
} from "@cantoo/pdf-lib";
import type { Executor } from "@onestop/tool-registry";
import {
  baseName,
  loadPdf,
  optBool,
  optString,
  outputName,
  PDF_MIME,
  readSinglePdf,
  savePdf,
} from "./document.ts";
import { runPdfTool, unsupported } from "./errors.ts";
import { embedUnicodeFont } from "./fonts.ts";
import { plural } from "./inputs.ts";

export const FILL_FORM_TOOL_ID = "fill-pdf-forms";

export type FieldType = "text" | "checkbox" | "radio" | "dropdown" | "list" | "signature" | "other";

export interface FormFieldInfo {
  name: string;
  type: FieldType;
  value: string | boolean | string[] | null;
  options?: string[];
  readOnly: boolean;
  required: boolean;
}

function describe(field: PDFField): FormFieldInfo {
  const base = {
    name: field.getName(),
    readOnly: field.isReadOnly(),
    required: field.isRequired(),
  };
  if (field instanceof PDFTextField) return { ...base, type: "text", value: field.getText() ?? "" };
  if (field instanceof PDFCheckBox) return { ...base, type: "checkbox", value: field.isChecked() };
  if (field instanceof PDFRadioGroup) {
    return {
      ...base,
      type: "radio",
      value: field.getSelected() ?? null,
      options: field.getOptions(),
    };
  }
  if (field instanceof PDFDropdown) {
    return { ...base, type: "dropdown", value: field.getSelected(), options: field.getOptions() };
  }
  if (field instanceof PDFOptionList) {
    return { ...base, type: "list", value: field.getSelected(), options: field.getOptions() };
  }
  if (field instanceof PDFSignature) return { ...base, type: "signature", value: null };
  return { ...base, type: "other", value: null };
}

export function listFields(form: PDFForm): FormFieldInfo[] {
  return form.getFields().map(describe);
}

/** Parses `Name = value` lines, or a JSON object, into a name → value map. */
export function parseFieldValues(raw: string): Map<string, string> {
  const text = raw.trim();
  const values = new Map<string, string>();
  if (text === "") return values;
  if (text.startsWith("{")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw unsupported(
        'The field values are not valid JSON. Use {"Field": "value"} or Field = value lines.',
      );
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw unsupported('Use a JSON object such as {"Name": "Ada"}.');
    }
    for (const [key, value] of Object.entries(parsed)) {
      values.set(key, Array.isArray(value) ? value.map(String).join(", ") : String(value));
    }
    return values;
  }
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "" || line.trim().startsWith("#")) continue;
    const eq = line.search(/[=:]/);
    if (eq <= 0)
      throw unsupported(`"${line.trim()}" needs a field name and a value, like Name = Ada.`);
    values.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim());
  }
  return values;
}

const TRUE_WORDS = new Set(["yes", "true", "1", "on", "x", "checked", "check", "y"]);
const FALSE_WORDS = new Set(["no", "false", "0", "off", "", "unchecked", "n"]);

function pickOption(options: string[], wanted: string, field: string): string {
  const exact = options.find((o) => o === wanted);
  const loose = exact ?? options.find((o) => o.toLowerCase() === wanted.toLowerCase());
  if (loose === undefined) {
    throw unsupported(`"${wanted}" is not a choice for ${field}. Choices: ${options.join(", ")}.`);
  }
  return loose;
}

function fill(field: PDFField, value: string): void {
  const name = field.getName();
  if (field instanceof PDFTextField) {
    const max = field.getMaxLength();
    if (max !== undefined && value.length > max) {
      throw unsupported(`${name} allows at most ${max} characters.`);
    }
    field.setText(value);
  } else if (field instanceof PDFCheckBox) {
    const v = value.trim().toLowerCase();
    if (TRUE_WORDS.has(v)) field.check();
    else if (FALSE_WORDS.has(v)) field.uncheck();
    else throw unsupported(`Use yes or no for the checkbox ${name}.`);
  } else if (field instanceof PDFRadioGroup) {
    field.select(pickOption(field.getOptions(), value.trim(), name));
  } else if (field instanceof PDFDropdown) {
    const options = field.getOptions();
    if (options.length === 0 || field.isEditable()) field.select(value.trim());
    else field.select(pickOption(options, value.trim(), name));
  } else if (field instanceof PDFOptionList) {
    const options = field.getOptions();
    const wanted = value
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
    field.select(wanted.map((w) => pickOption(options, w, name)));
  } else {
    throw unsupported(
      `${name} cannot be filled in here (signature fields are filled with Sign PDF).`,
    );
  }
}

export const fillFormExecutor: Executor = async (input, options, ctx) =>
  runPdfTool(FILL_FORM_TOOL_ID, async () => {
    const file = await readSinglePdf(input, ctx);
    const doc = await loadPdf(file.bytes);
    const form = doc.getForm();
    const fields = listFields(form);
    if (fields.length === 0) throw unsupported("This PDF has no form fields to fill.");

    const values = parseFieldValues(optString(options, "values"));
    const flatten = optBool(options, "flatten", false);

    if (values.size === 0) {
      const listing = fields
        .map(
          (f) =>
            `${f.name} = ${Array.isArray(f.value) ? f.value.join(", ") : (f.value ?? "")}${f.options?.length ? `    # ${f.type}: ${f.options.join(" | ")}` : `    # ${f.type}`}`,
        )
        .join("\n");
      return {
        ok: true,
        output: { fields, filled: [], template: listing },
        summary: `Found ${plural(fields.length, "field")}. Copy the template into "Field values", fill it in and run again.`,
        files: [
          {
            name: `${baseName(file.ref.name)}-fields.txt`,
            mimeType: "text/plain",
            bytes: new TextEncoder().encode(`${listing}\n`),
          },
        ],
      };
    }

    const byName = new Map(form.getFields().map((f) => [f.getName(), f]));
    const lower = new Map(form.getFields().map((f) => [f.getName().toLowerCase(), f]));
    const unknown: string[] = [];
    const filled: string[] = [];
    for (const [name, value] of values) {
      const field = byName.get(name) ?? lower.get(name.toLowerCase());
      if (!field) {
        unknown.push(name);
        continue;
      }
      if (field.isReadOnly())
        throw unsupported(`${field.getName()} is read-only and cannot be changed.`);
      fill(field, value);
      filled.push(field.getName());
    }
    if (filled.length === 0) {
      throw unsupported(
        `None of those fields exist. This form has: ${fields.map((f) => f.name).join(", ")}.`,
      );
    }

    // A Unicode font for the appearances, so "Zoë" or "Łukasz" never breaks the save.
    const font = await embedUnicodeFont(doc);
    form.updateFieldAppearances(font);
    if (flatten) form.flatten();

    const missingRequired = fields
      .filter(
        (f) =>
          f.required &&
          !filled.includes(f.name) &&
          (f.value === "" || f.value === null || f.value === false),
      )
      .map((f) => f.name);

    return {
      ok: true,
      output: {
        fields: listFields(doc.getForm()),
        filled,
        unknown,
        missingRequired,
        flattened: flatten,
      },
      summary:
        `Filled ${plural(filled.length, "field")}${flatten ? " and flattened the form" : ""}.` +
        (unknown.length ? ` Skipped unknown: ${unknown.join(", ")}.` : "") +
        (missingRequired.length ? ` Still empty but required: ${missingRequired.join(", ")}.` : ""),
      files: [
        {
          name: outputName(file.ref.name, "filled"),
          mimeType: PDF_MIME,
          bytes: await savePdf(doc),
        },
      ],
    };
  });
