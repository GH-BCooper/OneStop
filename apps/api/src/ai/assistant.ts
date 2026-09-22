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
import { buildCatalogueAnswer, catalogueMessage, type WorkflowSummary } from "./catalogue.ts";
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
  "You are the OneStop Assistant, built into OneStop: a free, local-first web app for file conversion, PDF, image, data, QR, media and developer-utility tasks, made for personal / small-trusted-group use. It has two front doors: this AI Assistant, which plans and runs chains of OneStop's own tools from a plain-language request, and All Tools, a searchable catalogue where any tool can be opened and used directly. Every core feature works with $0 spent and processes files locally whenever practical.",
  "OneStop was founded and built by Brett Cooper. If asked who made, built, created, owns or runs OneStop (or who made you), credit Brett Cooper by name rather than a vague 'the OneStop team'.",
  "Chat naturally and helpfully, in a few short sentences unless asked for more. Answer general-knowledge questions and small talk directly - never refuse a plain question just because it is not about OneStop, and never ask the person to attach a file unless the question is actually about a file's contents.",
  "You specialise in OneStop's own tools. If what the person actually wants is a file task (convert, merge, compress, OCR, resize, translate a document, and so on), say you can do that and ask them to describe the task or attach the file, rather than trying to do it in this reply.",
  "You cannot run code, browse the web, access the internet, or do anything outside OneStop's own registered tools - be upfront about that rather than pretending otherwise.",
  "Earlier turns of this same chat, when given, are the real conversation history - use them to answer follow-ups (\"what did I just ask\", \"my name\", and so on) instead of claiming you have no memory of them.",
  "Format every reply in short, clean Markdown: **bold** for key terms, bullet or numbered lists where they help scanability, short paragraphs. Keep it brief and to the point - no filler.",
  "End every reply with one short line nudging the person back to OneStop's own tools (e.g. asking what they'd like to convert, merge or clean up) - vary the wording each time, but always steer back to OneStop.",
].join("\n");

/** The signed-in user's own profile facts, offered to the model as-is - never fetched or guessed. */
export interface AssistantProfile {
  name?: string | null;
  email?: string | null;
  birthday?: string | null;
}

/** Prior turns of the same chat thread, oldest first. Round-tripped by the client; never stored server-side. */
export type AssistantHistory = ChatMessage[];

export const MAX_HISTORY_TURNS = 12;

export interface AssistantRequest {
  request: string;
  /** Names of the files the user attached, used for type-compatibility and for the prompt. */
  fileNames: string[];
  /** Earlier user/assistant turns from this same thread, oldest first - see `AssistantHistory`. */
  history?: AssistantHistory;
  /** The signed-in user's own name/email/birthday, when known - never another user's. */
  profile?: AssistantProfile;
  /** The caller's own saved workflows, exactly as the Workflows page already has them (account or
   *  this device) - never fetched server-side, so a guest's device-only list still shows up. */
  workflows?: WorkflowSummary[];
  /** The caller's own starred tool ids, same source as the star icon elsewhere in the app. */
  favoriteToolIds?: string[];
  credentials?: AiCredentials;
  signal?: AbortSignal;
}

function profileSystemLine(profile?: AssistantProfile): string | null {
  if (!profile) return null;
  const facts: string[] = [];
  if (profile.name) facts.push(`name is ${profile.name}`);
  if (profile.email) facts.push(`email is ${profile.email}`);
  if (profile.birthday) facts.push(`birthday is ${profile.birthday}`);
  if (facts.length === 0) return null;
  return `The signed-in user's own ${facts.join(", ")}. Only share this back with them, never imply it is about anyone else.`;
}

export const MAX_REQUEST_CHARS = 4000;

/**
 * A plain-words reply from the model - used for genuine small talk/general knowledge, and for a
 * "question" intent that has no file to read (still a real question, just not RAG). Never fails
 * the request: with no runtime configured, or on any AI error, it says so in words instead.
 */
async function chatAnswer(
  request: string,
  intent: AssistantPlan["intent"],
  input: Pick<AssistantRequest, "profile" | "credentials" | "signal">,
  recentHistory: ChatMessage[],
): Promise<AssistantPlan> {
  const profileLine = profileSystemLine(input.profile);
  const messages: ChatMessage[] = [
    { role: "system", content: CHAT_SYSTEM },
    ...(profileLine ? [{ role: "system" as const, content: profileLine }] : []),
    ...recentHistory,
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
      intent: { ...intent, kind: "chat", needsFiles: false },
      plan: null,
      message: text.trim(),
      rejected: [],
      recommendations: null,
      catalogue: null,
      runtime: { provider: config.provider, model: config.model, local: config.info.local },
    };
  } catch (err) {
    if (err instanceof AiError) {
      return {
        ok: true,
        intent: { ...intent, kind: "chat", needsFiles: false },
        plan: null,
        message: assistantFailureMessage(err),
        rejected: [],
        recommendations: null,
        catalogue: null,
        runtime: null,
      };
    }
    throw err;
  }
}

function unsupported(request: string, message: string): AssistantPlan {
  return {
    ok: false,
    intent: { kind: "unsupported", request, confidence: 1, needsFiles: false, source: "rules" },
    plan: null,
    message,
    rejected: [],
    recommendations: recommendationsFor(request),
    catalogue: null,
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
      catalogue: null,
      runtime: null,
    };
  }

  const recentHistory = (input.history ?? []).slice(-MAX_HISTORY_TURNS);

  const intent = await detectIntent(request, {
    hasFiles: input.fileNames.length > 0,
    ...(recentHistory.length > 0 ? { history: recentHistory } : {}),
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

  // "List all the pdf tools" et al. — answered straight from the registry, never the model, so
  // it is instant, free and works fully offline like the registry itself (CLAUDE.md §2).
  if (intent.kind === "catalogue") {
    const catalogue = buildCatalogueAnswer(request, {
      workflows: input.workflows,
      favoriteToolIds: input.favoriteToolIds,
    });
    return {
      ok: true,
      intent,
      plan: null,
      message: catalogueMessage(catalogue),
      rejected: [],
      recommendations: null,
      catalogue,
      runtime: null,
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
    // No file to read: this is still a genuine question, just not RAG - answer it as
    // conversation (general knowledge, small talk) rather than blocking on an attachment.
    if (input.fileNames.length === 0) {
      return chatAnswer(request, intent, input, recentHistory);
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
      catalogue: null,
      runtime: null,
    };
  }

  // Plain conversation never touches the planner or the tool registry - it is a reply in words,
  // never a run (CLAUDE.md §2.6: the assistant may only ever call a registered tool, and a chat
  // answer calls none). With no runtime configured this still never fails the request: it says so
  // and points back at the tools, which all have their own non-AI path regardless.
  if (intent.kind === "chat") {
    return chatAnswer(request, intent, input, recentHistory);
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
        catalogue: null,
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
    catalogue: null,
    runtime: result.runtime
      ? {
          provider: result.runtime.provider,
          model: result.runtime.model,
          local: result.runtime.info.local,
        }
      : null,
  };
}
