// AI Assistant contracts (16-ai-assistant.md; master plan §7).
//
// Everything here is plain data: the web app, the API routes and the tests all share these
// shapes, and none of them may depend on which model runtime happens to be configured.

/** The four free runtimes OneStop supports. `ollama` is the only fully local one. */
export type AiProviderId = "ollama" | "groq" | "openrouter" | "google";

export interface AiProviderInfo {
  id: AiProviderId;
  label: string;
  /** Whether the model runs on the user's own machine. */
  local: boolean;
  /** Whether the user must supply their own key. Never a bundled/shared one (CLAUDE.md §2). */
  needsKey: boolean;
  /** The one-line, plain-words privacy disclosure shown before the runtime is used. */
  disclosure: string;
  /** Where to get a free key / install the runtime. */
  setupUrl: string;
  defaultModel: string;
  /**
   * Models to try for this provider, best first. A free tier retires and rate-limits models
   * without warning, so one dead model must never mean "this provider does not work".
   */
  fallbackModels?: string[];
  /** Free tier, or a paid account. Every provider here is free; the field keeps that explicit. */
  cost: "free" | "paid";
  /** Where to raise a quota or add credits once the free allowance is used up. Not for local runtimes. */
  creditsUrl?: string;
}

/** How the assistant chooses its runtime: OneStop's own hosted keys, or the visitor's own. */
export type AiSource = "onestop" | "own";

/** The result of one cheap liveness/key check against a single runtime. */
export interface AiProviderCheck {
  provider: AiProviderId;
  /** True when this runtime would answer a request right now. */
  ok: boolean;
  /** Plain-words explanation, safe to show. */
  message: string;
}

/** What `/api/assistant/status` reports, and what the Settings page renders. */
export interface AiStatus {
  /** True when a runtime answered. False is a normal state, never an error. */
  available: boolean;
  provider: AiProviderId | null;
  providerLabel: string | null;
  model: string | null;
  local: boolean;
  disclosure: string;
  /** Plain-words explanation, always set — it is what the UI shows when `available` is false. */
  message: string;
  /** Providers that have a key (or a reachable host) configured right now. */
  configured: AiProviderId[];
  /** The provider the user picked in Settings, when they picked one. */
  preferred: AiProviderId | null;
  /** Every runtime that would answer right now (a request is spread across these at random). */
  usable?: AiProviderId[];
  /** One entry per runtime that was considered, with the reason when it is not usable. */
  checks?: AiProviderCheck[];
  /** Whether an Ollama server answers from *this* server - false on a hosted deployment. */
  ollamaReachable?: boolean;
}

/** 16-ai-assistant.md, "Interfaces". */
export interface ExecutionStep {
  toolId: string;
  options: Record<string, unknown>;
}

export interface ExecutionPlan {
  steps: ExecutionStep[];
  explanation: string;
}

export type AssistantIntentKind =
  /** Run one or more OneStop tools over the uploaded files. */
  | "tool-chain"
  /** Ask something about an uploaded file (RAG). */
  | "question"
  /** Produce text with the model alone (write/rewrite/translate/summarise a pasted text). */
  | "generate"
  /** Plain conversation - greetings, small talk, general questions with nothing to run. */
  | "chat"
  /** Asking what OneStop's own tools are — counts and listings straight from the registry. */
  | "catalogue"
  /** OneStop genuinely cannot do this — answer with external recommendations. */
  | "unsupported";

export interface AssistantIntent {
  kind: AssistantIntentKind;
  /** The user's request, trimmed. */
  request: string;
  /** 0–1. Low confidence makes the assistant ask rather than guess. */
  confidence: number;
  /** Whether the request needs the uploaded files. */
  needsFiles: boolean;
  /** How the intent was decided, for the "why" line and the server log. */
  source: "rules" | "model";
}

/** One line of master plan §7.3's Free / Paid lists. */
export interface ExternalRecommendation {
  name: string;
  url: string;
  purpose: string;
  limitation: string;
  pricing: "free" | "paid";
}

export interface RecommendationGroups {
  topic: string;
  free: ExternalRecommendation[];
  paid: ExternalRecommendation[];
}

/** Why a planned step was thrown away. Surfaced to the user and logged server-side. */
export interface PlanRejection {
  toolId: string;
  reason: string;
}

/** One tool in a catalogue listing, ready to link straight to its page. */
export interface ToolCatalogueEntry {
  id: string;
  name: string;
  href: string;
}

/** One catalogue group ("PDF", "Images", …) with its tools, for a "list the X tools" answer. */
export interface ToolCatalogueGroup {
  id: string;
  name: string;
  icon: string;
  /** The group's page in All Tools. */
  href: string;
  count: number;
  tools: ToolCatalogueEntry[];
}

/** The answer to "how many / list the … tools", read straight from the registry — never the AI. */
export interface ToolCatalogueAnswer {
  /** "all", or the matched group id (e.g. "pdf", "media"). */
  scope: string;
  totalTools: number;
  groups: ToolCatalogueGroup[];
}

/** The answer to "plan this request" — never executes anything by itself. */
export interface AssistantPlan {
  ok: boolean;
  intent: AssistantIntent;
  plan: ExecutionPlan | null;
  /** Filled when `ok` is false: the plain-words reason. */
  message: string | null;
  /** Steps the planner refused (unknown tool id, unavailable tool, incompatible chain). */
  rejected: PlanRejection[];
  /** Present when OneStop cannot do this at all (master plan §7.3). */
  recommendations: RecommendationGroups | null;
  /** Present for a "catalogue" intent: counts and clickable listings from the registry. */
  catalogue: ToolCatalogueAnswer | null;
  /** Which runtime produced the plan; null when the rule-based planner did it alone. */
  runtime: { provider: AiProviderId; model: string; local: boolean } | null;
}
