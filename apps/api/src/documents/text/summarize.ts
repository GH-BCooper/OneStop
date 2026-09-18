// Document Summarizer engine (Features 2.14) — 07-word-ppt-tools.md.
//
// Local extractive summary, no AI: sentences are scored by TF-IDF (each sentence is a "document"),
// with a small bonus for sentences near the start and for ones sharing words with the title, and
// the best ones are returned in their original order. Phase 16 can upgrade `summarize` to the local
// LLM (Ollama) or a free hosted model without changing this contract or the tool's options.

export interface Summary {
  sentences: string[];
  keywords: string[];
  totalSentences: number;
}

export type SummaryLength = "short" | "medium" | "long";

const STOPWORDS = new Set(
  `a about above after again against all also am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers herself him himself his how however i if in into is it its itself just let may me might more most must my myself no nor not now of off on once only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through thus to too under until up upon us very was we were what when where which while who whom why will with would you your yours yourself yourselves one two also new use used using within without via per etc`.split(
    /\s+/,
  ),
);

const ABBREV = /\b(?:e\.g|i\.e|etc|vs|mr|mrs|ms|dr|prof|st|no|fig|inc|ltd|jr|sr|approx)\.$/i;

export function splitSentences(text: string): string[] {
  const out: string[] = [];
  for (const block of text.replace(/\r\n?/g, "\n").split(/\n\s*\n|\n(?=\s*(?:[-•*]|\d+[.)])\s)/)) {
    const flat = block.replace(/\s*\n\s*/g, " ").trim();
    if (!flat) continue;
    let start = 0;
    const re = /[.!?]+["')\]]*\s+(?=["'([]?[A-Z0-9])/g;
    for (let m = re.exec(flat); m; m = re.exec(flat)) {
      const candidate = flat.slice(start, m.index + m[0].trimEnd().length);
      if (ABBREV.test(candidate) || /\b[A-Z]\.$/.test(candidate)) continue;
      out.push(candidate.trim());
      start = m.index + m[0].length;
    }
    const tail = flat.slice(start).trim();
    if (tail) out.push(tail);
  }
  return out.filter((s) => /\p{L}/u.test(s));
}

function stem(word: string): string {
  return word.replace(/(?:ies)$/, "y").replace(/(?<=\w{3})(?:ing|ed|es|s|ly)$/, "");
}

export function terms(sentence: string): string[] {
  return (sentence.toLowerCase().match(/\p{L}[\p{L}\p{N}'’-]*/gu) ?? [])
    .map((w) => w.replace(/['’]s$/, ""))
    .filter((w) => w.length > 2 && !STOPWORDS.has(w))
    .map(stem);
}

const RATIOS: Record<SummaryLength, { ratio: number; min: number; max: number }> = {
  short: { ratio: 0.1, min: 2, max: 4 },
  medium: { ratio: 0.2, min: 3, max: 7 },
  long: { ratio: 0.33, min: 5, max: 12 },
};

export function summarize(
  text: string,
  { length = "medium", title = "" }: { length?: SummaryLength; title?: string } = {},
): Summary {
  const sentences = splitSentences(text);
  const tokenized = sentences.map(terms);
  const df = new Map<string, number>();
  for (const tokens of tokenized) for (const t of new Set(tokens)) df.set(t, (df.get(t) ?? 0) + 1);
  const n = sentences.length;
  const idf = (t: string) => Math.log((1 + n) / (1 + (df.get(t) ?? 0))) + 1;
  const docTf = new Map<string, number>();
  for (const tokens of tokenized) for (const t of tokens) docTf.set(t, (docTf.get(t) ?? 0) + 1);
  const titleTerms = new Set(terms(title));

  const scores = tokenized.map((tokens, i) => {
    if (tokens.length === 0) return 0;
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    // Sentence weight: how central its words are to the whole document, not just rare words.
    let score = 0;
    for (const [t, count] of tf) score += (count / tokens.length) * (docTf.get(t) ?? 0) * idf(t);
    score /= Math.sqrt(tf.size);
    if (tokens.some((t) => titleTerms.has(t))) score *= 1.2;
    score *= 1 + 0.25 * Math.max(0, 1 - i / Math.max(4, n * 0.2));
    const words = sentences[i]!.split(/\s+/).length;
    if (words < 5 || words > 60) score *= 0.6;
    return score;
  });

  const { ratio, min, max } = RATIOS[length];
  const k = Math.min(n, Math.max(min, Math.min(max, Math.round(n * ratio))));
  const picked = scores
    .map((score, i) => ({ score, i }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, k)
    .sort((a, b) => a.i - b.i)
    .map(({ i }) => sentences[i]!);

  const surface = new Map<string, string>();
  for (const w of text.toLowerCase().match(/\p{L}[\p{L}\p{N}'’-]*/gu) ?? []) {
    const s = stem(w);
    if (!surface.has(s) && w.length > 2 && !STOPWORDS.has(w)) surface.set(s, w);
  }
  const keywords = [...docTf]
    .filter(([t, c]) => c > 1 && t.length > 3)
    .sort((a, b) => b[1] * idf(b[0]) - a[1] * idf(a[0]))
    .slice(0, 8)
    .map(([t]) => surface.get(t) ?? t);

  return { sentences: picked, keywords, totalSentences: n };
}
