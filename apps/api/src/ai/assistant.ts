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
import { AiError, chat, NO_RUNTIME_MESSAGE, type ChatMessage } from "./modelRuntime.ts";
import { buildPlan, type PlanContext } from "./planner.ts";
import type { AiCredentials } from "./providers.ts";
import { recommendationsFor } from "./recommendations.ts";

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
          message: `${NO_RUNTIME_MESSAGE} I can still run any OneStop tool directly — just describe the task.`,
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
      // A rate limit or a rejected key is shown as itself, not as "something went wrong".
      return {
        ok: false,
        intent,
        plan: null,
        message: err.message,
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
