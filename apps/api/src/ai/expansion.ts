// AI additions from 21-roadmap-expansion.md (roadmap §1.7): the Flashcard Generator, the Code
// Explainer, the Resume ↔ Job Description Matcher, the Alt-Text Generator and the Meeting Summarizer.
//
// All five run on the existing four-provider runtime (Ollama local, or Groq / OpenRouter / Google AI
// Studio with the visitor's own key) — no new provider, and never Claude or any Anthropic service
// (`CLAUDE.md` §2.8). Three of them have a genuinely useful built-in path so they still do something
// with no runtime at all, and each result says which method produced it.
import type { Executor } from "@onestop/tool-registry";
import type { OutputFile } from "@onestop/types";
import { baseName, optBool, optEnum, optNumber, optString, plural, readTextInput } from "../documents/common.ts";
import { summarize } from "../documents/text/summarize.ts";
import { readImages } from "../images/common.ts";
import {
  AI_REQUIRED_MESSAGE,
  BUILTIN_NOTE,
  aiUnsupported,
  cleanAnswer,
  clip,
  complete,
  jsonOutput,
  methodOf,
  requireComplete,
  runAi,
  textOutput,
} from "./common.ts";
import type { ChatMessage } from "./modelRuntime.ts";

export const AI_FLASHCARD_TOOL_ID = "ai-flashcard-generator";
export const AI_CODE_EXPLAINER_TOOL_ID = "ai-code-explainer";
export const AI_RESUME_MATCHER_TOOL_ID = "ai-resume-matcher";
export const AI_ALT_TEXT_TOOL_ID = "ai-alt-text-generator";
export const AI_MEETING_SUMMARIZER_TOOL_ID = "ai-meeting-summarizer";

const STRICT_SYSTEM =
  "Never invent facts, names, numbers or dates that are not in the material you were given. If something is not there, say so.";

// ---- flashcard / quiz generator -----------------------------------------------------------------

export interface Flashcard {
  question: string;
  answer: string;
  /** Wrong-but-plausible options, for the multiple-choice format. */
  distractors?: string[];
}

/**
 * Pulls cards out of whatever shape the model answered in — a JSON array if it obliged, otherwise
 * "Q:"/"A:" pairs. Being forgiving here is what keeps small local models usable for this.
 */
export function parseFlashcardAnswer(text: string): Flashcard[] {
  const body = cleanAnswer(text);
  const jsonStart = body.indexOf("[");
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(body.slice(jsonStart, body.lastIndexOf("]") + 1)) as unknown[];
      const cards = parsed
        .map((row) => {
          if (!row || typeof row !== "object") return null;
          const r = row as Record<string, unknown>;
          const question = String(r.question ?? r.q ?? r.front ?? "").trim();
          const answer = String(r.answer ?? r.a ?? r.back ?? "").trim();
          if (question === "" || answer === "") return null;
          const distractors = Array.isArray(r.distractors ?? r.options)
            ? ((r.distractors ?? r.options) as unknown[]).map((d) => String(d).trim()).filter((d) => d !== "" && d !== answer)
            : undefined;
          return { question, answer, ...(distractors && distractors.length > 0 ? { distractors } : {}) };
        })
        .filter((c): c is Flashcard => c !== null);
      if (cards.length > 0) return cards;
    } catch {
      // Not JSON after all; fall through to the line-based reader.
    }
  }
  const cards: Flashcard[] = [];
  let question = "";
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "") continue;
    const q = /^(?:\d+[.)]\s*)?(?:q(?:uestion)?)\s*[:.-]\s*(.+)$/i.exec(line);
    const a = /^(?:a(?:nswer)?)\s*[:.-]\s*(.+)$/i.exec(line);
    if (q) {
      question = q[1]!.trim();
      continue;
    }
    if (a && question !== "") {
      cards.push({ question, answer: a[1]!.trim() });
      question = "";
      continue;
    }
    if (line.includes("|")) {
      const [front, ...rest] = line.split("|");
      if (front!.trim() !== "" && rest.join("|").trim() !== "") cards.push({ question: front!.trim(), answer: rest.join("|").trim() });
    }
  }
  return cards;
}

/**
 * The built-in path: no model at all. It turns the document's own sentences into cloze-deletion
 * cards — "the ___ was signed in 1215" — which is a real study aid, not a placeholder, and works
 * entirely offline.
 */
export function clozeCards(text: string, count: number): Flashcard[] {
  const sentences = text
    .replace(/\s+/g, " ")
    .match(/[^.!?]{40,300}[.!?]/g)
    ?.map((s) => s.trim()) ?? [];
  const stop = new Set(
    "the a an and or but if then than that this these those of in on at to for from by with without is are was were be been being it its as not no also more most very can could would should may might will".split(" "),
  );
  const cards: Flashcard[] = [];
  for (const sentence of sentences) {
    // Blank the longest distinctive word: the one most likely to be the thing worth remembering.
    const words = sentence.match(/\b[A-Za-z][A-Za-z'-]{3,}\b|\b\d{2,4}\b/g) ?? [];
    const target = words
      .filter((w) => !stop.has(w.toLowerCase()))
      .sort((a, b) => (/^\d+$/.test(b) ? 1 : 0) - (/^\d+$/.test(a) ? 1 : 0) || b.length - a.length)[0];
    if (!target) continue;
    cards.push({
      question: sentence.replace(new RegExp(`\\b${target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`), "______"),
      answer: target,
    });
    if (cards.length >= count) break;
  }
  return cards;
}

export const aiFlashcardExecutor: Executor = (input, options, ctx) =>
  runAi(AI_FLASHCARD_TOOL_ID, async () => {
    const source = await readTextInput(input, ctx);
    if (source.text.trim().length < 60) {
      throw aiUnsupported("There is not enough text here to make flashcards from. Paste a few paragraphs, or choose a document.");
    }
    const count = optNumber(options, "count", 12, { min: 1, max
: 60 });
    const format = optEnum(options, "format", ["qa", "multiple-choice", "cloze"] as const, "qa");
    const difficulty = optEnum(options, "difficulty", ["recall", "understanding", "mixed"] as const, "mixed");
    const method = methodOf(options);
    const { text, clipped } = clip(source.text);

    let cards: Flashcard[] = [];
    let runtime: string | null = null;
    if (format !== "cloze") {
      const messages: ChatMessage[] = [
        {
          role: "system",
          content: [
            "You write study flashcards from source material.",
            `Produce exactly ${count} cards aimed at ${difficulty === "recall" ? "factual recall" : difficulty === "understanding" ? "understanding and application, not rote facts" : "a mix of recall and understanding"}.`,
            format === "multiple-choice"
              ? 'Answer with a JSON array of {"question","answer","distractors":[three plausible wrong answers]}.'
              : 'Answer with a JSON array of {"question","answer"}.',
            "Keep each question under 25 words and each answer under 40.",
            "Return only the JSON array, with no prose around it.",
            STRICT_SYSTEM,
          ].join(" "),
        },
        { role: "user", content: text },
      ];
      const result = await complete(messages, method, options, { temperature: 0.4, maxTokens: 2400 });
      if (result) {
        cards = parseFlashcardAnswer(result.text).slice(0, count);
        runtime = result.runtime;
      }
    }
    if (cards.length === 0) {
      if (method === "ai" && format !== "cloze") throw aiUnsupported(AI_REQUIRED_MESSAGE);
      cards = clozeCards(text, count);
      if (cards.length === 0) {
        throw aiUnsupported("No usable sentences were found to build cards from. This works best on prose, not on tables or lists.");
      }
    }

    const files: OutputFile[] = [
      {
        name: `${source.name}-flashcards.csv`,
        mimeType: "text/csv; charset=utf-8",
        bytes: new TextEncoder().encode(
          ["Front,Back", ...cards.map((c) => `"${c.question.replace(/"/g, '""')}","${c.answer.replace(/"/g, '""')}"`)].join("\r\n") + "\r\n",
        ),
      },
      jsonOutput(`${source.name}-flashcards.json`, cards),
    ];
    return {
      ok: true,
      output: { cards, count: cards.length, runtime, result: cards.map((c) => `${c.question}\n— ${c.answer}`).join("\n\n") },
      summary: `${plural(cards.length, "flashcard")} from ${source.name}${runtime ? ` using ${runtime}` : ` using the built-in cloze method — ${BUILTIN_NOTE}`}.${clipped ? " The document was long, so only the first part was used." : ""} The CSV imports straight into Anki or Quizlet.`,
      files,
    };
  });

// ---- code explainer ----------------------------------------------------------------------------

/** Language guessed from the file extension, and from the code itself for pasted text. */
export function guessLanguage(name: string, code: string): string {
  const byExt: Record<string, string> = {
    ts: "TypeScript", tsx: "TypeScript (React)", js: "JavaScript", jsx: "JavaScript (React)",
    py: "Python", rb: "Ruby", go: "Go", rs: "Rust", java: "Java", kt: "Kotlin", swift: "Swift",
    c: "C", h: "C", cpp: "C++", cc: "C++", cs: "C#", php: "PHP", sh: "Shell", ps1: "PowerShell",
    sql: "SQL", html: "HTML", css: "CSS", scss: "SCSS", yml: "YAML", yaml: "YAML", json: "JSON",
    toml: "TOML", lua: "Lua", r: "R", m: "Objective-C", dart: "Dart", ex: "Elixir", clj: "Clojure",
  };
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  if (byExt[ext]) return byExt[ext]!;
  if (/^\s*(?:import|export|const|let|function|class)\b/m.test(code) && /=>|: \w+[;)]/.test(code)) return "TypeScript or JavaScript";
  if (/^\s*def \w+\(|^\s*import \w+$/m.test(code)) return "Python";
  if (/^\s*(?:package|func) /m.test(code)) return "Go";
  if (/^\s*(?:fn|let mut) /m.test(code)) return "Rust";
  if (/^\s*(?:SELECT|INSERT|UPDATE|CREATE TABLE)\b/im.test(code)) return "SQL";
  return "code";
}

export const aiCodeExplainerExecutor: Executor = (input, options, ctx) =>
  runAi(AI_CODE_EXPLAINER_TOOL_ID, async () => {
    const source = await readTextInput(input, ctx);
    const code = source.text;
    if (code.trim() === "") throw aiUnsupported("Paste some code, or choose a file.");
    const mode = optEnum(options, "mode", ["explain", "review", "comment", "tests", "simplify"] as const, "explain");
    const audience = optEnum(options, "audience", ["new", "developer", "expert"] as const, "developer");
    const language = optString(options, "language", "") || guessLanguage(source.name, code);
    const { text, clipped } = clip(code, 18_000);

    const instruction: Record<typeof mode, string> = {
      explain: `Explain what this ${language} does, in order: a one-sentence summary, then what each significant part is for, then anything surprising or subtle about it.`,
      review: `Review this ${language}. List concrete problems, worst first, each with the line or function it is in and why it matters. Then note what is done well. Do not rewrite the file.`,
      comment: `Return the same ${language} with comments added where they genuinely help. Change nothing else — no reformatting, no renaming, no refactoring.`,
      tests: `Suggest the test cases this ${language} needs, grouped by behaviour, including the edge cases most likely to be missed. Sketch them in the testing style the code itself implies.`,
      simplify: `Suggest how this ${language} could be simplified without changing what it does. Show the key before/after fragments rather than rewriting the whole file.`,
    };
    const level: Record<typeof audience, string> = {
      new: "Write for someone new to programming: define the jargon you use, and do not assume they know the libraries involved.",
      developer: "Write for a working developer: be direct, skip the basics.",
      expert: "Write for an expert: focus on the non-obvious — invariants, failure modes, complexity and edge cases.",
    };

    const result = await requireComplete(
      [
        {
          role: "system",
          content: [
            "You are a careful code reviewer.",
            instruction[mode],
            level[audience],
            "Use Markdown with short sections. Quote code in fenced blocks.",
            "Be honest about what you cannot tell from this file alone.",
            STRICT_SYSTEM,
          ].join(" "),
        },
        { role: "user", content: `File: ${source.name}\n\n\`\`\`\n${text}\n\`\`\`` },
      ],
      options,
      { temperature: 0.2, maxTokens: 2600 },
    );
    const answer = cleanAnswer(result.text);
    const lines = code.split(/\r?\n/).length;
    return {
      ok: true,
      output: { mode, language, lines, runtime: result.runtime, result: answer },
      summary: `${mode === "explain" ? "Explained" : mode === "review" ? "Reviewed" : mode === "comment" ? "Commented" : mode === "tests" ? "Suggested tests for" : "Simplified"} ${lines} lines of ${language} with ${result.runtime}${result.local ? " (running locally)" : ""}.${clipped ? " The file was long, so only the first part was read." : ""} Check anything it asserts about behaviour against the code itself.`,
      files: [textOutput(`${source.name}-${mode}.md`, answer)],
    };
  });

// ---- resume ↔ job description matcher ----------------------------------------------------------

const RESUME_STOP = new Set(
  "the a an and or but if then with without for from into over under about above below between within across during before after while of in on at to by as is are was were be been being have has had do does did will would can could should may might must i we you they it this that these those our your their its more most other such than then also very own same so no not only just".split(
    " ",
  ),
);

/** Frequency-ranked keywords, so the offline path can still say what the posting stresses. */
export function keywordSet(text: string, limit = 60): { term: string; count: number }[] {
  const counts = new Map<string, number>();
  const words = text.toLowerCase().match(/\b[a-z][a-z+#.-]{2,}\b/g) ?? [];
  for (const [index, word] of words.entries()) {
    if (RESUME_STOP.has(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
    // Two-word phrases catch "machine learning" and "project management", which single words miss.
    const next = words[index + 1];
    if (next && !RESUME_STOP.has(next)) {
      const phrase = `${word} ${next}`;
      counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([term, count]) => count > 1 || term.includes(" ") === false)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([term, count]) => ({ term, count }));
}

export interface MatchReport {
  matched: string[];
  missing: string[];
  score: number;
}

export function compareKeywords(resume: string, job: string): MatchReport {
  const resumeText = resume.toLowerCase();
  const jobTerms = keywordSet(job, 45);
  const matched: string[] = [];
  const missing: string[] = [];
  for (const { term } of jobTerms) {
    if (resumeText.includes(term)) matched.push(term);
    else missing.push(term);
  }
  const weighted = jobTerms.reduce((sum, t) => sum + t.count, 0) || 1;
  const hit = jobTerms.filter((t) => resumeText.includes(t.term)).reduce((sum, t) => sum + t.count, 0);
  return { matched, missing, score: Math.round((hit / weighted) * 100) };
}

export const aiResumeMatcherExecutor: Executor = (input, options, ctx) =>
  runAi(AI_RESUME_MATCHER_TOOL_ID, async () => {
    const jobText = optString(options, "jobDescription", "").trim();
    if (jobText === "") throw aiUnsupported("Paste the job posting into the Job description box as well as the resume.");
    const source = await readTextInput(input, ctx);
    if (source.text.trim() === "") throw aiUnsupported("Choose a resume, or paste it in.");

    const keywords = compareKeywords(source.text, jobText);
    const method = methodOf(options);
    const resume = clip(source.text, 12_000);
    const job = clip(jobText, 8000);

    const result = await complete(
      [
        {
          role: "system",
          content: [
            "You compare a resume with a job posting for the candidate's own benefit.",
            "Answer in Markdown with four sections: Strong matches, Gaps, Wording to borrow from the posting, and Honest verdict.",
            "Under Gaps, separate things that can be fixed by rewording from things that need experience the candidate does not have.",
            "Never suggest claiming experience the resume does not support.",
            STRICT_SYSTEM,
          ].join(" "),
        },
        { role: "user", content: `## Job posting\n${job.text}\n\n## Resume\n${resume.text}` },
      ],
      method,
      options,
      { temperature: 0.3, maxTokens: 2200 },
    );

    const offlineReport = [
      `# Resume vs job posting`,
      "",
      `Keyword overlap: **${keywords.score}%** of the terms the posting stresses appear in the resume.`,
      "",
      "## Terms found in both",
      "",
      keywords.matched.length > 0 ? keywords.matched.map((t) => `- ${t}`).join("\n") : "_none_",
      "",
      "## Terms from the posting that are missing",
      "",
      keywords.missing.length > 0 ? keywords.missing.map((t) => `- ${t}`).join("\n") : "_none_",
      "",
      "Keyword overlap is a crude measure — many screening systems use one, which is why it is worth knowing, but it is not the same as being a good fit.",
      "",
    ].join("\n");
    const answer = result ? cleanAnswer(result.text) : offlineReport;

    return {
      ok: true,
      output: { ...keywords, runtime: result?.runtime ?? null, result: answer },
      summary: result
        ? `Compared the resume with the posting using ${result.runtime}. Keyword overlap is ${keywords.score}%, with ${plural(keywords.missing.length, "term")} from the posting missing entirely.`
        : `Keyword overlap is ${keywords.score}%; ${plural(keywords.missing.length, "term")} from the posting are missing. ${BUILTIN_NOTE} — set up an AI runtime for a real read of the gaps rather than a word count.`,
      files: [
        textOutput(`${source.name}-job-match.md`, answer),
        jsonOutput(`${source.name}-job-match.json`, keywords),
      ],
    };
  });

// ---- alt-text generator ------------------------------------------------------------------------

export const aiAltTextExecutor: Executor = (input, options, ctx) =>
  runAi(AI_ALT_TEXT_TOOL_ID, async () => {
    const images = await readImages(input, ctx, { max: 20 });
    const purpose = optEnum(options, "purpose", ["informative", "decorative", "complex", "functional"] as const, "informative");
    const maxLength = optNumber(options, "maxLength", 125, { min: 40, max: 400 });
    const { describeImage, visionConfigured } = await import("./vision.ts");

    const results: { name: string; altText: string; describedBy: string }[] = [];
    for (const image of images) {
      if (purpose === "decorative") {
        // The correct alt text for a purely decorative image is an empty one, and saying that is
        // more useful than inventing a description a screen reader would have to sit through.
        results.push({ name: image.ref.name, altText: "", describedBy: "rule" });
        continue;
      }
      if (visionConfigured()) {
        const described = await describeImage(image, { maxLength, purpose, signal: ctx?.signal });
        results.push({ name: image.ref.name, altText: described.text.trim().slice(0, maxLength), describedBy: described.runtime });
        continue;
      }
      throw aiUnsupported(
        "Describing an image needs a vision model. Install Ollama and pull one (e.g. `ollama pull llava` or `moondream`), then try again — or write the alt text by hand, which is often better anyway.",
      );
    }

    const lines = results.map((r) => `${r.name}\t${r.altText}`);
    const withText = results.filter((r) => r.altText !== "").length;
    return {
      ok: true,
      output: { results, result: results.map((r) => `${r.name}: ${r.altText || "(decorative — use alt=\"\")"}`).join("\n") },
      summary:
        purpose === "decorative"
          ? `Marked ${plural(images.length, "image")} as decorative: use alt="" so screen readers skip them. That is the right answer for a divider or a background flourish.`
          : `Drafted alt text for ${plural(withText, "image")} with ${results[0]!.describedBy}. **AI-generated — read it before you use it.** A model cannot know what the picture is doing on your page, and that is what alt text is really for.`,
      files: [
        textOutput("alt-text.tsv", `file\talt text\n${lines.join("\n")}`),
        jsonOutput("alt-text.json", results),
      ],
    };
  });

// ---- meeting / lecture summarizer ---------------------------------------------------------------

/** Strips SRT/VTT timing so a subtitle file can be summarised as prose. */
export function transcriptToProse(text: string): string {
  const stripped = text
    .replace(/^WEBVTT.*$/gm, "")
    .replace(/^\d+$/gm, "")
    .replace(/^[\d:.,]+\s*-->\s*[\d:.,]+.*$/gm, "")
    .replace(/<[^>]+>/g, "")
    .replace(/^\s*NOTE .*$/gm, "");
  // Subtitle files repeat lines across cues; collapsing consecutive duplicates keeps it readable.
  const lines = stripped.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "");
  const out: string[] = [];
  for (const line of lines) if (out[out.length - 1] !== line) out.push(line);
  return out.join(" ").replace(/\s+/g, " ").trim();
}

export const aiMeetingSummarizerExecutor: Executor = (input, options, ctx) =>
  runAi(AI_MEETING_SUMMARIZER_TOOL_ID, async () => {
    const wantTranscribe = Array.isArray(input) && input.some((ref) => /\.(mp3|wav|m4a|aac|flac|ogg|opus|mp4|mov|mkv|webm|avi)$/i.test(ref.name));
    let transcript: string;
    let transcribedWith: string | null = null;
    let stem: string;

    if (wantTranscribe) {
      // Chain the local Auto-Subtitle tool rather than reimplementing anything: whisper.cpp does the
      // transcription on this machine, and its own "not installed" message is the right one to show.
      const { getExecutor } = await import("@onestop/tool-registry");
      const result = await getExecutor({ id: "auto-subtitle-generator", name: "Auto Subtitle Generator", phase: "21" })(
        input,
        { format: "txt", language: optString(options, "language", "auto") || "auto" },
        ctx,
      );
      if (!result.ok) return result;
      const file = result.files?.[0];
      if (!file) throw aiUnsupported("The recording produced no transcript.");
      transcript = transcriptToProse(new TextDecoder().decode(file.bytes));
      transcribedWith = "whisper.cpp (on this machine)";
      stem = baseName((input as { name: string }[])[0]!.name);
    } else {
      const source = await readTextInput(input, ctx);
      transcript = transcriptToProse(source.text);
      stem = source.name;
    }
    if (transcript.trim().length < 80) {
      throw aiUnsupported("There is not enough transcript here to summarise. Choose a recording, or paste the transcript.");
    }

    const style = optEnum(options, "style", ["minutes", "brief", "study-notes", "decisions"] as const, "minutes");
    const method = methodOf(options);
    const { text, clipped } = clip(transcript);

    const shape: Record<typeof style, string> = {
      minutes: "Write meeting minutes: a short summary, then Decisions, then Action items (with who owns each one, if it is stated), then Open questions.",
      brief: "Write a brief: five to eight bullet points covering only what someone who missed this actually needs to know.",
      "study-notes": "Write study notes: the key concepts as headed sections, each with the points made about it, then a short list of terms worth remembering.",
      decisions: "List only the decisions made and the action items agreed, each with its owner and any deadline mentioned. Nothing else.",
    };

    const result = await complete(
      [
        {
          role: "system",
          content: [
            "You summarise transcripts of meetings and lectures.",
            shape[style],
            "The transcript comes from automatic speech recognition, so expect misheard words — do not repeat an obvious mis-transcription as fact.",
            "Attribute an action item to someone only if the transcript names them.",
            "Use Markdown. Be concise.",
            STRICT_SYSTEM,
          ].join(" "),
        },
        { role: "user", content: text },
      ],
      method,
      options,
      { temperature: 0.25, maxTokens: 2400 },
    );

    const answer = result
      ? cleanAnswer(result.text)
      : [
          "# Summary",
          "",
          summarize(transcript, { length: "long" })
            .sentences.map((sentence) => `- ${sentence}`)
            .join("\n"),
          "",
          `_Extracted without a model: these are the transcript's own most central sentences. ${BUILTIN_NOTE}_`,
          "",
        ].join("\n");
    const words = transcript.split(/\s+/).length;

    const files: OutputFile[] = [textOutput(`${stem}-summary.md`, answer)];
    if (optBool(options, "includeTranscript", true)) files.push(textOutput(`${stem}-transcript.txt`, transcript));
    return {
      ok: true,
      output: { style, words, runtime: result?.runtime ?? null, transcribedWith, result: answer },
      summary: `${transcribedWith ? `Transcribed with ${transcribedWith}, then summarised` : "Summarised"} ${words} words${result ? ` using ${result.runtime}${result.local ? " (running locally)" : ""}` : " with the built-in extractive summariser"}.${clipped ? " The transcript was long, so only the first part was summarised." : ""} Automatic transcripts mishear things — check anything that matters against the recording.`,
      files,
    };
  });
