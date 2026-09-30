// YAML Formatter & Validator: tidy a YAML file, or just check that it is valid.
//
// Uses js-yaml's safe loader (no custom tags, so a file can never construct anything but plain data)
// and writes it back with consistent indentation. js-yaml does not keep comments, and pretending it
// does would lose someone's notes without telling them, so the summary says so whenever the input
// had any.
import type { Executor } from "@onestop/tool-registry";
import { dump, loadAll, YAMLException } from "js-yaml";
import {
  MIME,
  optBool,
  optEnum,
  plural,
  readTextSource,
  runDataTool,
  textOutput,
  unsupported,
} from "./common.ts";

export const yamlFormatterExecutor: Executor = async (input, options, ctx) =>
  runDataTool("yaml-formatter-and-validator", async () => {
    const { text, name } = await readTextSource(input, ctx, "YAML");
    let docs: unknown[];
    try {
      docs = loadAll(text.replace(/^\uFEFF/, ""));
    } catch (err) {
      if (err instanceof YAMLException) {
        const where = err.mark ? `Line ${err.mark.line + 1}, column ${err.mark.column + 1}: ` : "";
        const reason = err.reason
          ? err.reason[0]!.toUpperCase() + err.reason.slice(1)
          : "It could not be read";
        throw unsupported(`This YAML is not valid. ${where}${reason}.`, err.message);
      }
      throw unsupported("This YAML could not be read.", err);
    }
    if (docs.length === 0) throw unsupported("This YAML file is empty.");
    const validateOnly = optBool(options, "validateOnly", false);
    const hadComments = /(^|\s)#/m.test(text);
    if (validateOnly) {
      return {
        ok: true,
        output: { valid: true, documents: docs.length },
        summary: `Valid YAML with ${plural(docs.length, "document")}.`,
        files: [],
      };
    }
    const indent = Number(optEnum(options, "indent", ["2", "4"] as const, "2"));
    const sortKeys = optBool(options, "sortKeys", false);
    const out = docs
      .map((doc) =>
        dump(doc === undefined ? null : doc, { indent, sortKeys, lineWidth: -1, noRefs: true }),
      )
      .join("---\n");
    return {
      ok: true,
      output: { valid: true, documents: docs.length, bytes: out.length },
      summary:
        `Formatted ${plural(docs.length, "YAML document")}.` +
        (hadComments ? " Comments in the original are not kept." : ""),
      files: [textOutput(`${name}.formatted.yaml`, MIME.yaml, out)],
    };
  });
