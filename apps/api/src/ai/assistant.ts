// The assistant pipeline, end to end (master plan §7.2; 16-ai-assistant.md).
//
//   user request
//     → intent detection            intent.ts
//     → tool discovery + validation  planner.ts (registry allow-list, `validateWorkflow`)
//     → execution plan               planner.ts
//     → execute                      executor.ts → phase 15's runWorkflow → phase 04's pipeline
//     → validate outputs             executor.ts
//     → progress + result            the route and the page
//
// Planning and running are two calls on purpose: the user sees the plan, in their own terms,
// before a single file is touched. Nothing here executes anything.
import type { AssistantPlan } from "@onestop/types";
import { detectIntent } from "./intent.ts";
import { AiError, assistantFailureMessage, chat, type ChatMessage } from "./modelRuntime.ts";
import { buildPlan, type PlanContext } from "./planner.ts";
import type { AiCredentials } from "./providers.ts";
import { recommendationsFor } from "./recommendations.ts";

const GREETING_SYSTEM = [
  "You are the OneStop Assistant, a friendly helper built into OneStop: a free, local-first file/PDF/image/data/media/QR/developer toolbox.",
  "Write exactly one short, warm, upbeat welcome message (under 20 words) inviting the person to describe a task or attach a file.",
  "Be genuinely playful and inventive - vary your wording, tone and any wordplay every time so it never reads like a fixed script.",
  "No quotation marks, no markdown, no emoji spam (at most one), just the one sentence.",
].join("\n");

const FALLBACK_GREETINGS: ((label: string, timeOfDay: string) => string)[] = [
  (label) => `Welcome back, ${label}! What would you like to convert, merge or clean up today?`,
  (label) => `Hey ${label} — ready when you are. Drop a file or tell me what you need done.`,
  (label, t) => `Good ${t}, ${label}! Pick a task and let's get it done.`,
  (label) => `Hi ${label}! Files, PDFs, images, data — what are we tackling today?`,
  (label) => `${label}, what shall we transform today? I'm all ears.`,
  (label) => `Back for more, ${label}? Tell me what to do and I'll line up the right tool.`,
];

/**
 * A short, personalised hello for the assistant's empty chat screen. When a runtime is
 * available the model itself writes the line (so it genuinely varies visit to visit, per the
 * build file's "let the assistant decide" ask); with no runtime configured - which must always
 * keep working, CLAUDE.md §2 - a small pool of hand-written lines stands in, picked at random
 * rather than a single fixed string.
 */
export async function greetUser(
  name: string | null,
  credentials: AiCredentials = {},
  signal?: AbortSignal,
): Promise<{ message: string; runtime: AssistantPlan["runtime"] }> {
  const label = name?.trim() || "there";
  const hour = new Date().getHours();
  const timeOfDay =
    hour < 5 ? "night" : hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  try {
    const { text, config } = await chat(
      [
        { role: "system", content: GREETING_SYSTEM },
        {
          role: "user",
          content: `Greet ${label}. It is currently the ${timeOfDay} where they are.`,
        },
      ],
      { temperature: 1, maxTokens: 60, ...(signal ? { signal } : {}) },
      credentials,
    );
    const message = text.trim().replace(/^["']|["']$/g, "");
    return {
      message: message === "" ? FALLBACK_GREETINGS[0]!(label, timeOfDay) : message,
      runtime: { provider: config.provider, model: config.model, local: config.info.local },
    };
  } catch {
    const pick = FALLBACK_GREETINGS[Math.floor(Math.random() * FALLBACK_GREETINGS.length)]!;
    return { message: pick(label, timeOfDay), runtime: null };
  }
}

const CHAT_SYSTEM = [
  "You are the OneStop Assistant, built into OneStop: a free, local-first file/PDF/image/data/media/QR/developer toolbox.",
  "Chat naturally and helpfully, in a few short sentences unless asked for more.",
  "You specialise in OneStop's own tools. If what the person actually wants is a file task (convert, merge, compress, OCR, resize, translate a document, and so on), say you can do that and ask them to describe the task or attach the file, rather than trying to do it in this reply.",
  "You cannot run code, browse the web, access the internet, or do anything outside OneStop's own registered tools - be upfront about that rather than pretending otherwise.",
].join("\n");

export interface AssistantRequest {
  request: string;
  /** Names of the files the user attached, used for type-compatibility and for the prompt. */
  fileNames: string[];
  credentials?: AiCredentials;
  signal?: AbortSignal;
}

export const MAX_REQUEST_CHARS = 4000;

function unsupported(request: string, message: string): AssistantPlan {
  return {
    ok: false,
    intent: { kind: "unsupported", request, confidence: 1, needsFiles: false, source: "rules" },
    plan: null,
    message,
    rejected: [],
    recommendations: recommendationsFor(request),
    runtime: null,
  };
}

/**
 * Plans one request. Never throws for anything a user can cause: an unplannable request comes
 * back as `ok: false` with a plain-words reason and, where OneStop genuinely cannot help, the
 * Free/Paid recommendations from master plan §7.3.
 */
export async function planAssistantRequest(input: AssistantRequest): Promise<AssistantPlan> {
  const request = input.request.trim().slice(0, MAX_REQUEST_CHARS);
  if (request === "") {
    return {
      ok: false,
      intent: {
        kind: "unsupported",
        request: "",
        confidence: 1,
        needsFiles: false,
        source: "rules",
      },
      plan: null,
      message: "Tell the assistant what you would like done.",
      rejected: [],
      recommendations: null,
      runtime: null,
    };
  }

  const intent = await detectIntent(request, {
    hasFiles: input.fileNames.length > 0,
    ...(input.credentials ? { credentials: input.credentials } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
  });

  if (intent.kind === "unsupported") {
    return {
      ...unsupported(
        request,
        "OneStop cannot do that itself. Here are tools that can — the free ones first.",
      ),
      intent,
    };
  }

  // A question about a file and a "write me something" request are both single-tool plans: the
  // registry already has the right tool for each, so they go through the same allow-list.
  const context: PlanContext = {
    request,
    fileNames: input.fileNames,
    ...(input.credentials ? { credentials: input.credentials } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
  };

  if (intent.kind === "question") {
    if (input.fileNames.length === 0) {
      return {
        ok: false,
        intent,
        plan: null,
        message: "Attach the file you would like the assistant to read, then ask again.",
        rejected: [],
        recommendations: null,
        runtime: null,
      };
    }
    return {
      ok: true,
      intent,
      plan: {
        steps: [{ toolId: "ask-questions-about-a-file", options: { question: request } }],
        explanation: `The assistant will read the file and answer: "${request}"`,
      },
      message: null,
      rejected: [],
      recommendations: null,
      runtime: null,
    };
  }

  // Plain conversation never touches the planner or the tool registry - it is a reply in words,
  // never a run (CLAUDE.md §2.6: the assistant may only ever call a registered tool, and a chat
  // answer calls none). With no runtime configured this still never fails the request: it says so
  // and points back at the tools, which all have their own non-AI path regardless.
  if (intent.kind === "chat") {
    const messages: ChatMessage[] = [
      { role: "system", content: CHAT_SYSTEM },
      { role: "user", content: request },
    ];
    try {
      const { text, config } = await chat(
        messages,
        {
          temperature: 0.6,
          maxTokens: 400,
          ...(input.signal ? { signal: input.signal } : {}),
        },
        input.credentials ?? {},
      );
      return {
        ok: true,
        intent,
        plan: null,
        message: text.trim(),
        rejected: [],
        recommendations: null,
        runtime: { provider: config.provider, model: config.model, local: config.info.local },
      };
    } catch (err) {
      if (err instanceof AiError) {
        return {
          ok: true,
          intent,
          plan: null,
          message: assistantFailureMessage(err),
          rejected: [],
          recommendations: null,
          runtime: null,
        };
      }
      throw err;
    }
  }

  let result;
  try {
    result = await buildPlan(context);
  } catch (err) {
    if (err instanceof AiError) {
      // Out of credits is shown as itself; anything else is one short "out of service" line.
      return {
        ok: false,
        intent,
        plan: null,
        message: assistantFailureMessage(err),
        rejected: [],
        recommendations: null,
        runtime: null,
      };
    }
    throw err;
  }

  if (!result.plan) {
    return {
      ...unsupported(
        request,
        result.message ??
          "No OneStop tool matches that request. Here are tools that can help — the free ones first.",
      ),
      intent,
      rejected: result.rejected,
      runtime: result.runtime
        ? {
            provider: result.runtime.provider,
            model: result.runtime.model,
            local: result.runtime.info.local,
          }
        : null,
    };
  }

  return {
    ok: true,
    intent,
    plan: result.plan,
    message: null,
    rejected: result.rejected,
    recommendations: null,
    runtime: result.runtime
      ? {
          provider: result.runtime.provider,
          model: result.runtime.model,
          local: result.runtime.info.local,
        }
      : null,
  };
}
