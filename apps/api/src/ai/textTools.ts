// The text-shaped AI tools (Features §11.2–§11.7): Email Drafter, Text Generator, Text Rewriter,
// Summarizer, Grammar Checker, Translator (16-ai-assistant.md).
//
// Three of these are the LLM half of a phase-07 tool. Rather than rewriting phase 07, they reuse
// its engine as their built-in method, behind the same option names and the same output shape:
// Summarizer falls back to the extractive `summarize()`, Grammar Checker to `checkGrammar()`,
// Translator to the offline dictionary `translateText()`. So "AI Summarizer" is never broken — it
// is the offline summarizer until a runtime is there, and says which one produced the result.
import { applyFixes, checkGrammar } from "../documents/text/grammar.ts";
import { summarize, type SummaryLength } from "../documents/text/summarize.ts";
import { translateText } from "../documents/text/translate.ts";
import { GLOSSARY_LANGUAGES, LANGUAGE_NAMES } from "../documents/text/glossary.ts";
import {
  baseName,
  optBool,
  optEnum,
  optString,
  plural,
  readTextInput,
  textFile,
} from "../documents/common.ts";
import type { Executor } from "@onestop/tool-registry";
import type { OutputFile } from "@onestop/types";
import {
  AI_REQUIRED_MESSAGE,
  BUILTIN_NOTE,
  cleanAnswer,
  clip,
  complete,
  methodOf,
  requireComplete,
  runAi,
  aiUnsupported,
} from "./common.ts";
import type { ChatMessage } from "./modelRuntime.ts";

const LENGTHS = ["short", "medium", "long"] as const;
const STYLES = ["paragraph", "bullets"] as const;

const LENGTH_WORDS: Record<(typeof LENGTHS)[number], string> = {
  short: "two to four sentences",
  medium: "one tight paragraph",
  long: "three or four short paragraphs",
};

function systemFor(role: string): ChatMessage {
  return {
    role: "system",
    content: [
      role,
      "Write in plain, natural English unless the user's text is in another language, in which case answer in that language.",
      "Return only the finished text. No preamble, no explanation, no markdown fences.",
      "Never invent facts, names, numbers or dates that are not in what you were given.",
    ].join(" "),
  };
}

// ---- AI Email Drafter (§11.2) --------------------------------------------------------------------

export const AI_EMAIL_DRAFTER_TOOL_ID = "ai-email-drafter";

const EMAIL_LENGTHS: Record<string, string> = {
  short: "three or four lines",
  medium: "two short paragraphs",
  long: "a thorough email of three or four paragraphs",
};

export const aiEmailDrafterExecutor: Executor = async (input, options, ctx) =>
  runAi(AI_EMAIL_DRAFTER_TOOL_ID, async () => {
    const purpose = optString(options, "purpose").trim();
    const fromInput =
      typeof input === "string" && input.trim() !== ""
        ? { text: input.trim(), name: "email" }
        : Array.isArray(input) && input.length > 0
          ? await readTextInput(input, ctx, ctx?.signal)
          : null;
    const brief = [purpose, fromInput?.text].filter(Boolean).join("\n\n").trim();
    if (brief === "") {
      throw aiUnsupported("Say what the email is for, or upload the notes it should be based on.");
    }
    const recipient = optString(options, "recipient").trim();
    const signOff = optString(options, "signOff").trim();
    const tone = optString(options, "tone", "neutral");
    const size = EMAIL_LENGTHS[optString(options, "emailLength", "medium")] ?? EMAIL_LENGTHS.medium;

    const { text, runtime, local } = await requireComplete(
      [
        systemFor(
          "You draft emails. Produce a subject line on the first line as 'Subject: …', then a blank line, then the body.",
        ),
        {
          role: "user",
          content: [
            `Tone: ${tone}. Length: ${size}.`,
            recipient ? `Recipient: ${recipient}.` : "",
            signOff
              ? `Sign off as: ${signOff}.`
              : "Do not invent a sender name; end with a neutral sign-off.",
            "",
            "What the email needs to say:",
            clip(brief).text,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
      options,
      { temperature: 0.4, maxTokens: 900, ...(ctx?.signal ? { signal: ctx.signal } : {}) },
    );

    const draft = cleanAnswer(text);
    const subject = draft.match(/^Subject:\s*(.+)$/im)?.[1]?.trim() ?? "";
    return {
      ok: true,
      output: { subject, body: draft.replace(/^Subject:.*\n+/i, ""), runtime, local },
      summary: `Drafted an email${subject ? ` — "${subject}"` : ""} with ${runtime}.`,
      files: [textFile(`${baseName(fromInput?.name ?? "email")}-draft.txt`, draft)],
    };
  });

// ---- AI Text Generator (§11.3) -------------------------------------------------------------------

export const AI_TEXT_GENERATOR_TOOL_ID = "ai-text-generator";

const FORMATS: Record<string, string> = {
  paragraph: "flowing paragraphs",
  bullets: "a bulleted list",
  outline: "a nested outline with headings",
  list: "a numbered list",
};

export const aiTextGeneratorExecutor: Executor = async (input, options, ctx) =>
  runAi(AI_TEXT_GENERATOR_TOOL_ID, async () => {
    const { text: prompt } = await readTextInput(input, ctx, ctx?.signal);
    if (prompt.trim() === "") throw aiUnsupported("Enter a prompt first.");
    const format = FORMATS[optString(options, "format", "paragraph")] ?? FORMATS.paragraph;
    const length = optEnum(options, "length", LENGTHS, "medium");
    const tone = optString(options, "tone", "neutral");

    const { text, runtime, local } = await requireComplete(
      [
        systemFor("You write text to order."),
        {
          role: "user",
          content: `Write ${format}, about ${LENGTH_WORDS[length]}, in a ${tone} tone.\n\n${clip(prompt).text}`,
        },
      ],
      options,
      { temperature: 0.6, maxTokens: 1400, ...(ctx?.signal ? { signal: ctx.signal } : {}) },
    );
    const written = cleanAnswer(text);
    return {
      ok: true,
      output: { text: written, runtime, local },
      summary: `Wrote ${plural(written.split(/\s+/).filter(Boolean).length, "word")} with ${runtime}.`,
      files: [textFile("generated-text.txt", written)],
    };
  });

// ---- AI Text Rewriter (§11.4) --------------------------------------------------------------------

export const AI_TEXT_REWRITER_TOOL_ID = "ai-text-rewriter";

const GOALS: Record<string, string> = {
  clearer: "clearer and easier to follow, without changing the meaning",
  shorter: "significantly shorter while keeping every point",
  longer: "more detailed, expanding each point without padding",
  formal: "more formal and professional",
  friendly: "warmer and friendlier",
  simple: "plain English a non-specialist can read",
};

export const aiTextRewriterExecutor: Executor = async (input, options, ctx) =>
  runAi(AI_TEXT_REWRITER_TOOL_ID, async () => {
    const { text: original, name } = await readTextInput(input, ctx, ctx?.signal);
    if (original.trim() === "") throw aiUnsupported("Enter the text to rewrite first.");
    const goal = GOALS[optString(options, "goal", "clearer")] ?? GOALS.clearer;
    const keep = optBool(options, "keepMeaning", true);

    const { text, runtime, local } = await requireComplete(
      [
        systemFor("You rewrite text."),
        {
          role: "user",
          content: [
            `Rewrite the text below so it is ${goal}.`,
            keep ? "Every fact, name, number and date must survive unchanged." : "",
            "",
            clip(original).text,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
      options,
      { temperature: 0.4, maxTokens: 2000, ...(ctx?.signal ? { signal: ctx.signal } : {}) },
    );
    const rewritten = cleanAnswer(text);
    return {
      ok: true,
      output: { text: rewritten, runtime, local },
      summary: `Rewrote ${plural(original.split(/\s+/).filter(Boolean).length, "word")} with ${runtime}.`,
      files: [textFile(`${name}-rewritten.txt`, rewritten)],
    };
  });

// ---- AI Summarizer (§11.5) -----------------------------------------------------------------------

export const AI_SUMMARIZER_TOOL_ID = "ai-summarizer";

export interface SummaryOutcome {
  summary: string;
  runtime: string | null;
  note: string | null;
}

/** Shared by the Summarizer and the PDF Summarizer: model when available, extractive when not. */
export async function summariseText(
  text: string,
  options: Record<string, unknown>,
  { title = "", signal }: { title?: string; signal?: AbortSignal } = {},
): Promise<SummaryOutcome> {
  const length = optEnum(options, "length", LENGTHS, "medium");
  const style = optEnum(options, "style", STYLES, "paragraph");
  const method = methodOf(options);
  const clipped = clip(text);

  const answered = await complete(
    [
      systemFor("You summarise documents faithfully."),
      {
        role: "user",
        content: [
          `Summarise the text below in ${LENGTH_WORDS[length]}, as ${style === "bullets" ? "bullet points" : "prose"}.`,
          "Cover only what the text actually says.",
          "",
          clipped.text,
        ].join("\n"),
      },
    ],
    method,
    options,
    { temperature: 0.2, maxTokens: 900, ...(signal ? { signal } : {}) },
  );

  if (answered) {
    return {
      summary: cleanAnswer(answered.text),
      runtime: answered.runtime,
      note: clipped.clipped
        ? "Only the first part of the document was read — it is very long."
        : null,
    };
  }
  if (method === "ai") throw aiUnsupported(AI_REQUIRED_MESSAGE);

  const extractive = summarize(text, { length: length as SummaryLength, title });
  const sentences = extractive.sentences;
  return {
    summary: style === "bullets" ? sentences.map((s) => `• ${s}`).join("\n") : sentences.join(" "),
    runtime: null,
    note: BUILTIN_NOTE,
  };
}

export const aiSummarizerExecutor: Executor = async (input, options, ctx) =>
  runAi(AI_SUMMARIZER_TOOL_ID, async () => {
    const { text, name } = await readTextInput(input, ctx, ctx?.signal);
    if (text.trim() === "") throw aiUnsupported("There is no text to summarise.");
    const outcome = await summariseText(text, options, {
      title: name,
      ...(ctx?.signal ? { signal: ctx.signal } : {}),
    });
    return {
      ok: true,
      output: { summary: outcome.summary, runtime: outcome.runtime, note: outcome.note },
      summary: [
        `Summarised ${plural(text.split(/\s+/).filter(Boolean).length, "word")}${outcome.runtime ? ` with ${outcome.runtime}` : ""}.`,
        outcome.note,
      ]
        .filter(Boolean)
        .join(" "),
      files: [textFile(`${name}-summary.txt`, outcome.summary)],
    };
  });

// ---- AI Grammar Checker (§11.6) ------------------------------------------------------------------

export const AI_GRAMMAR_CHECKER_TOOL_ID = "ai-grammar-checker";

interface ModelCorrection {
  before?: unknown;
  after?: unknown;
  why?: unknown;
}

export const aiGrammarCheckerExecutor: Executor = async (input, options, ctx) =>
  runAi(AI_GRAMMAR_CHECKER_TOOL_ID, async () => {
    const { text, name } = await readTextInput(input, ctx, ctx?.signal);
    if (text.trim() === "") throw aiUnsupported("Enter the text to check first.");
    const output = optEnum(options, "output", ["both", "report", "corrected"] as const, "both");
    const method = methodOf(options);
    const files: OutputFile[] = [];

    const answered = await complete(
      [
        {
          role: "system",
          content: [
            "You are a careful copy-editor.",
            'Answer with JSON only: {"corrected":"the full corrected text","changes":[{"before":"","after":"","why":""}]}',
            "Fix spelling, grammar and punctuation. Keep the author's voice, structure and every fact.",
            "If nothing needs changing, return the text unchanged and an empty changes list.",
          ].join(" "),
        },
        { role: "user", content: clip(text).text },
      ],
      method,
      options,
      {
        json: true,
        temperature: 0,
        maxTokens: 2500,
        ...(ctx?.signal ? { signal: ctx.signal } : {}),
      },
    );

    if (answered) {
      const { parseJsonObject } = await import("./intent.ts");
      const parsed = parseJsonObject(answered.text);
      const corrected =
        typeof parsed?.corrected === "string" && parsed.corrected.trim() !== ""
          ? parsed.corrected
          : cleanAnswer(answered.text);
      const changes = (Array.isArray(parsed?.changes) ? (parsed.changes as ModelCorrection[]) : [])
        .filter((c) => typeof c?.before === "string" && typeof c?.after === "string")
        .slice(0, 200)
        .map((c) => ({
          before: String(c.before),
          after: String(c.after),
          why: typeof c.why === "string" ? c.why : "",
        }));
      if (output !== "corrected") {
        files.push(
          textFile(
            `${name}-grammar-report.txt`,
            [
              `Grammar check — ${plural(changes.length, "change")} suggested (${answered.runtime})`,
              "",
              ...(changes.length > 0
                ? changes.map((c) => `"${c.before}" → "${c.after}"${c.why ? ` — ${c.why}` : ""}`)
                : ["No problems found."]),
            ].join("\n"),
          ),
        );
      }
      if (output !== "report") files.push(textFile(`${name}-corrected.txt`, corrected));
      return {
        ok: true,
        output: { changes, corrected, runtime: answered.runtime },
        summary:
          changes.length > 0
            ? `Suggested ${plural(changes.length, "change")} with ${answered.runtime}.`
            : `No problems found (${answered.runtime}).`,
        files,
      };
    }
    if (method === "ai") throw aiUnsupported(AI_REQUIRED_MESSAGE);

    // Built-in: phase 07's rule-based checker, unchanged.
    const issues = checkGrammar(text, { spelling: true, style: true });
    const { text: corrected, applied } = applyFixes(text, issues);
    if (output !== "corrected") {
      files.push(
        textFile(
          `${name}-grammar-report.txt`,
          [
            `Grammar check — ${plural(issues.length, "issue")} found`,
            "",
            ...(issues.length > 0
              ? issues.map(
                  (i) =>
                    `Line ${i.line}, col ${i.column} [${i.kind}] "${i.text}": ${i.message}${
                      i.suggestions.length ? ` → ${i.suggestions.join(" / ")}` : ""
                    }`,
                )
              : ["No problems found."]),
            "",
            BUILTIN_NOTE,
          ].join("\n"),
        ),
      );
    }
    if (output !== "report") files.push(textFile(`${name}-corrected.txt`, corrected));
    return {
      ok: true,
      output: {
        issues: issues.slice(0, 200),
        corrected,
        autoFixed: applied,
        runtime: null,
        note: BUILTIN_NOTE,
      },
      summary: `Found ${plural(issues.length, "issue")}, ${applied} fixed automatically. ${BUILTIN_NOTE}`,
      files,
    };
  });

// ---- AI Translator (§11.7) -----------------------------------------------------------------------

export const AI_TRANSLATOR_TOOL_ID = "ai-translator";

const LANGUAGE_LABELS: Record<string, string> = {
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  nl: "Dutch",
  pl: "Polish",
  ro: "Romanian",
  sv: "Swedish",
  tr: "Turkish",
  ru: "Russian",
  uk: "Ukrainian",
  ar: "Arabic",
  hi: "Hindi",
  te: "Telugu",
  ta: "Tamil",
  zh: "Chinese (Simplified)",
  ja: "Japanese",
  ko: "Korean",
};

function languageName(code: string): string {
  return LANGUAGE_LABELS[code] ?? LANGUAGE_NAMES[code as keyof typeof LANGUAGE_NAMES] ?? code;
}

export const aiTranslatorExecutor: Executor = async (input, options, ctx) =>
  runAi(AI_TRANSLATOR_TOOL_ID, async () => {
    const { text, name } = await readTextInput(input, ctx, ctx?.signal);
    if (text.trim() === "") throw aiUnsupported("Enter the text to translate first.");
    const from = optString(options, "from", "auto");
    const to = optString(options, "to", "es");
    const method = methodOf(options);
    if (!LANGUAGE_LABELS[to]) throw aiUnsupported("That is not a language OneStop offers.");

    const answered = await complete(
      [
        systemFor(`You translate text into ${languageName(to)}.`),
        {
          role: "user",
          content: [
            from === "auto"
              ? `Translate the text below into ${languageName(to)}.`
              : `Translate the text below from ${languageName(from)} into ${languageName(to)}.`,
            "Keep the layout, line breaks and any numbers exactly as they are.",
            "",
            clip(text).text,
          ].join("\n"),
        },
      ],
      method,
      options,
      { temperature: 0.2, maxTokens: 2500, ...(ctx?.signal ? { signal: ctx.signal } : {}) },
    );

    if (answered) {
      const translated = cleanAnswer(answered.text);
      return {
        ok: true,
        output: { text: translated, to, runtime: answered.runtime },
        summary: `Translated into ${languageName(to)} with ${answered.runtime}.`,
        files: [textFile(`${name}-${to}.txt`, translated)],
      };
    }
    if (method === "ai") throw aiUnsupported(AI_REQUIRED_MESSAGE);

    // Built-in: phase 07's offline dictionary, which only covers six languages.
    const offline = GLOSSARY_LANGUAGES as readonly string[];
    const source = from === "auto" ? "en" : from;
    if (!offline.includes(source) || !offline.includes(to)) {
      throw aiUnsupported(
        `Without an AI runtime OneStop can only translate between ${offline
          .map((c) => languageName(c))
          .join(
            ", ",
          )}. Set up Ollama or add a free API key in Settings to translate into ${languageName(to)}.`,
      );
    }
    const stats = { words: 0, translated: 0 };
    const translated = translateText(
      text,
      source as (typeof GLOSSARY_LANGUAGES)[number],
      to as (typeof GLOSSARY_LANGUAGES)[number],
      stats,
    );
    return {
      ok: true,
      output: { text: translated, to, runtime: null, note: BUILTIN_NOTE, ...stats },
      summary: `Translated ${stats.translated} of ${plural(stats.words, "word")} into ${languageName(to)}. ${BUILTIN_NOTE}`,
      files: [textFile(`${name}-${to}.txt`, translated)],
    };
  });
