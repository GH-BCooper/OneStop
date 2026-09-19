// Phase 16's implementation of phase 07's text-model contract (`documents/text/runtime.ts`).
//
// Phase 19's audit called this out: `ai-translator` used the model runtime while phase 07's
// `document-translator` — the one the §8 "PDF → OCR → Translate → PDF" workflow chains — still
// translated word by word. Registering this runtime is what closes that gap, and it does it the
// way phase 09/16 already did for images: phase 07 keeps its offline fallback and depends on
// nothing here, while the AI module supplies the better engine when one is reachable.
import {
  TEXT_LANGUAGES,
  textLanguageLabel,
  setTextModelRuntime,
  type TextModelRuntime,
  type TextModelTranslation,
  type TextTranslateParams,
} from "../documents/text/runtime.ts";
import { AiError, chat } from "./modelRuntime.ts";
import { cleanAnswer, credentialsFrom } from "./common.ts";

export { TEXT_LANGUAGES as LANGUAGE_LABELS, textLanguageLabel as languageLabel };

function promptFor(text: string, from: string, to: string): string {
  return [
    from === "auto"
      ? `Translate the text below into ${textLanguageLabel(to)}.`
      : `Translate the text below from ${textLanguageLabel(from)} into ${textLanguageLabel(to)}.`,
    "Reply with the translation only: no preamble, no notes, no quotation marks around it.",
    "Keep the line breaks, numbers, names and any placeholder markers exactly as they are.",
    "",
    text,
  ].join("\n");
}

class ModelTextRuntime implements TextModelRuntime {
  readonly name = "OneStop AI runtime";

  available(): boolean {
    // Ollama's default host always counts as configured; whether it answers is `translate`'s job.
    return true;
  }

  async translate(text: string, params: TextTranslateParams): Promise<TextModelTranslation | null> {
    if (text.trim() === "") return { text, runtime: "unused", local: true };
    try {
      const { text: answer, config } = await chat(
        [
          {
            role: "system",
            content: `You are a translator. You translate into ${textLanguageLabel(params.to)} and reply with nothing but the translation.`,
          },
          { role: "user", content: promptFor(text, params.from, params.to) },
        ],
        {
          temperature: 0.2,
          maxTokens: 3000,
          ...(params.signal ? { signal: params.signal } : {}),
        },
        credentialsFrom(params.credentials ?? {}),
      );
      return {
        text: cleanAnswer(answer),
        runtime: `${config.info.label} (${config.model})`,
        local: config.info.local,
      };
    } catch (err) {
      // No runtime reachable is not a failure: the caller falls back to the glossary.
      if (err instanceof AiError && err.code === "AI_UNAVAILABLE") return null;
      throw err;
    }
  }
}

let registered: TextModelRuntime | null = null;

/** Called once when the AI module is imported. Safe to call again. */
export function registerTextRuntime(): TextModelRuntime {
  if (registered === null) {
    registered = new ModelTextRuntime();
    setTextModelRuntime(registered);
  }
  return registered;
}
