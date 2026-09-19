// Basic retrieval for "Ask Questions About a File" (16-ai-assistant.md).
//
// Deliberately small: no vector database, no embedding service, no extra dependency. Text is
// chunked, chunks are scored against the question with plain TF-IDF term overlap, and the best
// few are pasted into the prompt inside a context window the caller controls. That is enough for
// the documents a personal toolbox actually sees, it costs nothing, and it works offline.
//
// The answer is grounded twice over:
//   * the prompt tells the model to answer only from the context and to say so when it cannot;
//   * with no model at all, the extractive fallback returns the document's own sentences, so the
//     tool still answers from the real content instead of guessing.
import { AiError, chat, type ChatMessage } from "./modelRuntime.ts";
import type { AiCredentials } from "./providers.ts";

export interface Chunk {
  index: number;
  text: string;
  /** Character offset in the source text, so an answer can point back at the document. */
  start: number;
}

export const DEFAULT_CHUNK_CHARS = 1200;
export const DEFAULT_OVERLAP_CHARS = 150;
/** How much document text one prompt may carry. Small models have small context windows. */
export const DEFAULT_CONTEXT_CHARS = 6000;

/** Splits text into overlapping chunks, preferring paragraph then sentence boundaries. */
export function chunkText(
  text: string,
  {
    size = DEFAULT_CHUNK_CHARS,
    overlap = DEFAULT_OVERLAP_CHARS,
  }: { size?: number; overlap?: number } = {},
): Chunk[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (clean === "") return [];
  const chunks: Chunk[] = [];
  let cursor = 0;
  while (cursor < clean.length) {
    let end = Math.min(clean.length, cursor + size);
    if (end < clean.length) {
      const window = clean.slice(cursor, end);
      const paragraph = window.lastIndexOf("\n\n");
      const sentence = Math.max(window.lastIndexOf(". "), window.lastIndexOf("\n"));
      const cut = paragraph > size * 0.4 ? paragraph : sentence > size * 0.4 ? sentence + 1 : -1;
      if (cut > 0) end = cursor + cut;
    }
    const slice = clean.slice(cursor, end).trim();
    if (slice !== "") chunks.push({ index: chunks.length, text: slice, start: cursor });
    if (end >= clean.length) break;
    cursor = Math.max(end - overlap, cursor + 1);
  }
  return chunks;
}

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "can",
  "did",
  "do",
  "does",
  "for",
  "from",
  "had",
  "has",
  "have",
  "how",
  "i",
  "in",
  "is",
  "it",
  "its",
  "me",
  "my",
  "of",
  "on",
  "or",
  "that",
  "the",
  "their",
  "then",
  "there",
  "these",
  "this",
  "to",
  "was",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "will",
  "with",
  "you",
  "your",
  "about",
  "tell",
]);

export function terms(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) ?? []).filter(
    (t) => t.length > 1 && !STOP_WORDS.has(t),
  );
}

/** Scores every chunk against the question; higher is more relevant. */
export function scoreChunks(chunks: Chunk[], question: string): { chunk: Chunk; score: number }[] {
  const wanted = new Set(terms(question));
  if (wanted.size === 0) return chunks.map((chunk) => ({ chunk, score: 0 }));
  const tokenised = chunks.map((c) => terms(c.text));
  const df = new Map<string, number>();
  for (const tokens of tokenised) {
    for (const token of new Set(tokens)) df.set(token, (df.get(token) ?? 0) + 1);
  }
  const n = Math.max(1, chunks.length);
  return chunks.map((chunk, i) => {
    const tokens = tokenised[i]!;
    if (tokens.length === 0) return { chunk, score: 0 };
    const counts = new Map<string, number>();
    for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
    let score = 0;
    for (const term of wanted) {
      const tf = counts.get(term);
      if (!tf) continue;
      const idf = Math.log((1 + n) / (1 + (df.get(term) ?? 0))) + 1;
      score += (tf / tokens.length) * idf;
    }
    return { chunk, score };
  });
}

export interface ContextSelection {
  chunks: Chunk[];
  /** The prompt-ready text, each chunk numbered so the model can cite it. */
  context: string;
  /** True when the document did not fit and only part of it was used. */
  truncated: boolean;
}

/** Picks the chunks that fit the budget, then puts them back in document order. */
export function selectContext(
  chunks: Chunk[],
  question: string,
  { maxChars = DEFAULT_CONTEXT_CHARS }: { maxChars?: number } = {},
): ContextSelection {
  if (chunks.length === 0) return { chunks: [], context: "", truncated: false };
  const ranked = scoreChunks(chunks, question).sort(
    (a, b) => b.score - a.score || a.chunk.index - b.chunk.index,
  );
  const picked: Chunk[] = [];
  let used = 0;
  for (const { chunk } of ranked) {
    if (used + chunk.text.length > maxChars && picked.length > 0) continue;
    picked.push(chunk);
    used += chunk.text.length;
    if (used >= maxChars) break;
  }
  picked.sort((a, b) => a.index - b.index);
  return {
    chunks: picked,
    context: picked.map((c, i) => `[${i + 1}] ${c.text}`).join("\n\n"),
    truncated: picked.length < chunks.length,
  };
}

const RAG_SYSTEM = [
  "You answer questions about one document, using ONLY the numbered excerpts you are given.",
  "Quote or paraphrase the excerpts. Cite the excerpt numbers you used, like [2].",
  'If the excerpts do not contain the answer, say exactly: "The document does not say."',
  "Never use outside knowledge, and never guess at a number, name or date that is not shown.",
  "Keep the answer short — a sentence or two unless the question asks for a list.",
].join("\n");

export const NO_ANSWER = "The document does not say.";

export interface AnswerResult {
  answer: string;
  /** 1-based excerpt numbers the answer draws on. */
  cited: number[];
  /** The excerpt text, so the UI can show what the answer was based on. */
  excerpts: string[];
  /** True when the answer came from the document's own sentences, with no model involved. */
  extractive: boolean;
  truncated: boolean;
  runtime: { provider: string; model: string; local: boolean } | null;
}

/** The no-model answer: the document's own most relevant sentences, never an invention. */
export function extractiveAnswer(context: string, question: string, limit = 3): string {
  const sentences = context
    .replace(/\[\d+\]\s*/g, "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 15);
  if (sentences.length === 0) return NO_ANSWER;
  const wanted = new Set(terms(question));
  const scored = sentences
    .map((sentence) => {
      const tokens = new Set(terms(sentence));
      let hits = 0;
      for (const term of wanted) if (tokens.has(term)) hits += 1;
      return { sentence, score: wanted.size === 0 ? 0 : hits / wanted.size };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) return NO_ANSWER;
  return scored
    .slice(0, limit)
    .map((s) => s.sentence)
    .join(" ");
}

function citedNumbers(answer: string): number[] {
  const found = new Set<number>();
  for (const match of answer.matchAll(/\[(\d{1,2})\]/g)) found.add(Number(match[1]));
  return [...found].sort((a, b) => a - b);
}

/**
 * Answers a question about a document. Uses the configured runtime when there is one and falls
 * back to the extractive answer when there is not, so the tool works with no AI configured at all.
 */
export async function answerFromText(
  text: string,
  question: string,
  options: {
    credentials?: AiCredentials;
    signal?: AbortSignal;
    maxChars?: number;
    /** Skip the model entirely (the "built-in" method, and the offline tests). */
    extractiveOnly?: boolean;
  } = {},
): Promise<AnswerResult> {
  const chunks = chunkText(text);
  const selection = selectContext(chunks, question, {
    maxChars: options.maxChars ?? DEFAULT_CONTEXT_CHARS,
  });
  const base = {
    excerpts: selection.chunks.map((c) => c.text),
    truncated: selection.truncated,
  };
  if (selection.context === "") {
    return { ...base, answer: NO_ANSWER, cited: [], extractive: true, runtime: null };
  }

  if (!options.extractiveOnly) {
    const messages: ChatMessage[] = [
      { role: "system", content: RAG_SYSTEM },
      {
        role: "user",
        content: `Excerpts from the document:\n\n${selection.context}\n\nQuestion: ${question.trim()}`,
      },
    ];
    try {
      const { text: answer, config } = await chat(
        messages,
        {
          temperature: 0,
          maxTokens: 500,
          ...(options.signal ? { signal: options.signal } : {}),
        },
        options.credentials ?? {},
      );
      return {
        ...base,
        answer: answer.trim(),
        cited: citedNumbers(answer),
        extractive: false,
        runtime: { provider: config.provider, model: config.model, local: config.info.local },
      };
    } catch (err) {
      // A rate limit or a rejected key is the user's business: those are re-thrown by the caller
      // that knows whether a fallback is acceptable. Everything else quietly degrades.
      if (err instanceof AiError && err.code !== "AI_UNAVAILABLE") throw err;
    }
  }

  return {
    ...base,
    answer: extractiveAnswer(selection.context, question),
    cited: [],
    extractive: true,
    runtime: null,
  };
}
