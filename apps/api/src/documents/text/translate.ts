// Document Translator engine (Features 2.11) — 07-word-ppt-tools.md.
//
// There is no practical *offline* machine-translation package for Node that works without a large
// model download, so the default engine is an honest one: a built-in glossary (glossary.ts) applied
// phrase-first, word by word, preserving capitalisation, punctuation and layout. Words it does not
// know are left as they are and counted, and the tool says the result is rough. Phase 16 can swap
// in an LLM (Ollama locally, or a free hosted model with the user's key) behind `translateText`.
import { GLOSSARY, GLOSSARY_LANGUAGES, type GlossaryLanguage } from "./glossary.ts";

interface Dictionary {
  entries: Map<string, string>;
  maxWords: number;
}

const cache = new Map<string, Dictionary>();

function dictionary(from: GlossaryLanguage, to: GlossaryLanguage): Dictionary {
  const key = `${from}>${to}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const fi = GLOSSARY_LANGUAGES.indexOf(from);
  const ti = GLOSSARY_LANGUAGES.indexOf(to);
  const entries = new Map<string, string>();
  let maxWords = 1;
  for (const line of GLOSSARY.split("\n")) {
    const cells = line.split("|");
    if (cells.length !== GLOSSARY_LANGUAGES.length) continue;
    const source = cells[fi]!.trim().toLowerCase();
    // First row wins, so the most common sense of an ambiguous word is used.
    if (!source || entries.has(source)) continue;
    entries.set(source, cells[ti]!.trim());
    maxWords = Math.max(maxWords, source.split(" ").length);
  }
  const dict = { entries, maxWords };
  cache.set(key, dict);
  return dict;
}

function matchCase(source: string, target: string): string {
  if (source.length > 1 && source === source.toUpperCase() && /\p{L}/u.test(source)) {
    return target.toUpperCase();
  }
  if (/^\p{Lu}/u.test(source)) return target.charAt(0).toUpperCase() + target.slice(1);
  return target;
}

export interface TranslationStats {
  words: number;
  translated: number;
}

export function translateText(
  text: string,
  from: GlossaryLanguage,
  to: GlossaryLanguage,
  stats: TranslationStats = { words: 0, translated: 0 },
): string {
  if (from === to) return text;
  const { entries, maxWords } = dictionary(from, to);
  const tokens = text.match(/\p{L}[\p{L}'’-]*|[^\p{L}]+/gu) ?? [];
  const isWord = (t: string | undefined) => t !== undefined && /^\p{L}/u.test(t);
  const out: string[] = [];
  for (let i = 0; i < tokens.length;) {
    const token = tokens[i]!;
    if (!isWord(token)) {
      out.push(token);
      i += 1;
      continue;
    }
    let done = false;
    // Longest phrase first: words joined by single spaces only.
    for (let n = maxWords; n >= 1 && !done; n -= 1) {
      const parts: string[] = [];
      let j = i;
      for (let k = 0; k < n; k += 1) {
        if (!isWord(tokens[j])) break;
        parts.push(tokens[j]!);
        if (k < n - 1) {
          if (tokens[j + 1] !== " ") break;
          j += 2;
        }
      }
      if (parts.length !== n) continue;
      const hit = entries.get(parts.join(" ").toLowerCase().replace(/’/g, "'"));
      if (hit === undefined) continue;
      out.push(matchCase(parts[0]!, hit));
      stats.words += n;
      stats.translated += n;
      i = j + 1;
      done = true;
    }
    if (!done) {
      out.push(token);
      stats.words += 1;
      i += 1;
    }
  }
  return out.join("");
}
