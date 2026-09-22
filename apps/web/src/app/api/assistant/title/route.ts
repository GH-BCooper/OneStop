// POST /api/assistant/title — a short chat-thread title for the sidebar, from the first message.
//
// Best-effort only: with no AI runtime configured this falls back to a plain truncation of the
// request text, exactly like the assistant's other AI-optional paths (16-ai-assistant.md, §2).
// Never a hard failure — a title is cosmetic, never a blocker.
import { AiError, chat } from "@onestop/api";
import { readAiCredentials } from "@/lib/ai-request";
import { fail, ok, readJson } from "@/lib/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_CHARS = 2000;

function fallbackTitle(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean === "") return "New chat";
  return clean.length <= 48 ? clean : `${clean.slice(0, 45).trimEnd()}…`;
}

export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request);
  if (!body) return fail(400, "INVALID_INPUT", "That request could not be read.");

  const text = typeof body.request === "string" ? body.request.trim() : "";
  if (text === "") return fail(400, "INVALID_INPUT", "Nothing to title.");
  const clipped = text.slice(0, MAX_CHARS);
  const credentials = readAiCredentials(request, body.provider);

  try {
    const { text: answer } = await chat(
      [
        {
          role: "system",
          content:
            "Reply with a short chat title only: 3-6 words, plain text, no quotes, no punctuation " +
            "at the end, summarising the user's message below.",
        },
        { role: "user", content: clipped },
      ],
      { temperature: 0.3, maxTokens: 20 },
      credentials,
    );
    const cleaned = answer.replace(/^["'“”]+|["'“”]+$/g, "").replace(/\s+/g, " ").trim();
    return ok({ title: cleaned !== "" ? cleaned.slice(0, 80) : fallbackTitle(clipped) });
  } catch (err) {
    if (err instanceof AiError) return ok({ title: fallbackTitle(clipped) });
    console.error("[api/assistant/title] unexpected failure", err);
    return ok({ title: fallbackTitle(clipped) });
  }
}
