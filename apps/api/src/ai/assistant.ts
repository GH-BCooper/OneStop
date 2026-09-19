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
import { AiError } from "./modelRuntime.ts";
import { buildPlan, type PlanContext } from "./planner.ts";
import type { AiCredentials } from "./providers.ts";
import { recommendationsFor } from "./recommendations.ts";

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
