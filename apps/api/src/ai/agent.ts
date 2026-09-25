// The agentic assistant: one loop in which the model may search the registry, read a tool's
// options, run tools (with typed text and/or files, chaining one tool's output into the next),
// design and save workflows, and steer the app (open a page, star a tool).
//
// It keeps every rule the plan/run pipeline keeps (CLAUDE.md §2.6):
//   * the model can only *name* actions from the fixed list below - it has no shell and no way to
//     express "run a command";
//   * a tool id that is not in the registry (or is not available) is refused, never "fixed";
//   * a tool runs through phase 04's `runPipeline`, so uploads are validated, jobs are recorded,
//     and outputs land in the temp store and expire, exactly like a tool a human clicked;
//   * a page link is only ever an in-app path from an allow-list.
// It talks JSON through the ordinary `chat()`, so it works identically on all four free runtimes.
import {
  acceptsFileName,
  describeIssues,
  fileInputTypes,
  getTool,
  getToolOptions,
  inputKind,
  scoreTool,
  toolHref,
  tools,
  validateWorkflow,
  type ToolMeta,
} from "@onestop/tool-registry";
import type { OutputFileRef } from "@onestop/types";
import { getTempStore } from "../file-processing/tempStore.ts";
import { runPipeline, type PipelineFileInput } from "../file-processing/pipeline.ts";
import { parseJsonObject } from "./intent.ts";
import { splitClauses } from "./planner.ts";
import { AiError, chat, type ChatMessage } from "./modelRuntime.ts";
import type { AiCredentials } from "./providers.ts";
import type { AssistantHistory, AssistantProfile } from "./assistant.ts";
import type { WorkflowSummary } from "./catalogue.ts";

export const MAX_AGENT_TURNS = 14;
const MAX_RESULT_CHARS = 1400;

export type AgentClientAction =
  | { type: "navigate"; href: string; label: string }
  | { type: "favorite"; toolId: string; on: boolean }
  | {
      type: "save_workflow";
      name: string;
      steps: { toolId: string; options: Record<string, unknown> }[];
    };

export type AgentEvent =
  | {
      type: "step";
      id: number;
      label: string;
      toolId?: string;
      status: "running" | "done" | "failed";
      detail?: string;
    }
  | {
      type: "final";
      message: string;
      files: OutputFileRef[];
      actions: AgentClientAction[];
      outputs: AgentOutput[];
      runtime: { provider: string; model: string; local: boolean } | null;
    };

export interface AgentOutput {
  toolId: string;
  toolName: string;
  summary: string | null;
  text: string | null;
}

export interface AgentWorkflow extends WorkflowSummary {
  steps?: { toolId: string; options?: Record<string, unknown> }[];
}

export interface AgentInput {
  request: string;
  history?: AssistantHistory;
  files: PipelineFileInput[];
  userId?: string | null;
  profile?: AssistantProfile;
  workflows?: AgentWorkflow[];
  favoriteToolIds?: string[];
  credentials?: AiCredentials;
  signal?: AbortSignal;
  onEvent?: (event: AgentEvent) => void;
}

const PAGES = [
  ["/assistant", "this chat"],
  ["/tools", "the searchable catalogue of every tool"],
  ["/workflows", "build, save and run multi-step workflows"],
  ["/history", "past runs and downloads"],
  ["/settings", "theme, AI provider and keys, preferences"],
  ["/account", "profile and account"],
  ["/status", "offline / connectivity status"],
] as const;

const ALLOWED_PATHS = new Set<string>(PAGES.map(([p]) => p));

function categoryIndex(): string {
  const counts = new Map<string, number>();
  for (const t of tools)
    if (t.status === "available") counts.set(t.category, (counts.get(t.category) ?? 0) + 1);
  return [...counts].map(([c, n]) => `${c} (${n})`).join(", ");
}

/**
 * The tools most likely to matter for this request, found before the model is even asked. It saves
 * the model two or three "search" round trips (each one a slow, quota-eating call on a free tier)
 * and puts the real option ids in front of it, so it does not have to guess them.
 */
function likelyTools(request: string, fileNames: string[]): string {
  const clauses = [request, ...splitClauses(request)];
  const seen = new Map<string, { tool: ToolMeta; score: number }>();
  for (const tool of tools) {
    if (tool.status !== "available" || tool.id === "ai-assistant") continue;
    let best = 0;
    for (const clause of clauses) best = Math.max(best, scoreTool(tool, clause));
    if (best <= 0) continue;
    // A tool that can actually read the attached file beats one that cannot.
    if (
      fileNames.length > 0 &&
      inputKind(tool) === "file" &&
      fileNames.some((n) => acceptsFileName(tool, n))
    )
      best += 6;
    seen.set(tool.id, { tool, score: best });
  }
  const top = [...seen.values()].sort((a, b) => b.score - a.score).slice(0, 8);
  if (top.length === 0) return "";
  return top
    .map(({ tool }, i) => {
      const opts = getToolOptions(tool.id)
        .slice(0, 10)
        .map((o) =>
          o.type === "select" ? `${o.id}[${o.choices.map((c) => c.value).join("|")}]` : o.id,
        )
        .join(", ");
      return `${brief(tool)}${i < 5 && opts ? ` | options: ${opts}` : ""}`;
    })
    .join("\n");
}

function systemPrompt(input: AgentInput, attachments: string[], likely: string): string {
  const profile = input.profile;
  const facts = [
    profile?.name ? `name: ${profile.name}` : null,
    profile?.email ? `email: ${profile.email}` : null,
  ].filter(Boolean);
  const workflows = (input.workflows ?? [])
    .slice(0, 30)
    .map((w) => `${w.id}: "${w.name}"${w.favorite ? " ★" : ""}`);
  return [
    "You are the OneStop Assistant, the built-in AI of OneStop - a free, local-first web app (built by Brett Cooper) for file conversion, PDF, image, data, QR, media, document and developer-utility tasks. Everything in the app can be done from this chat: you can run any OneStop tool, chain tools, create and run workflows, open pages, and star favourites.",
    "You answer in short, clean Markdown. General knowledge and small-talk questions get a direct, friendly answer (never refuse a harmless question), then one brief line steering back to what OneStop can do for them. Questions about OneStop or its tools are answered from the registry - search first, never guess a tool's name or options.",
    "You cannot browse the web, run code or shell commands, or touch anything outside OneStop's registered tools. Say so plainly if asked.",
    "",
    "PROTOCOL: every reply must be ONE JSON object and nothing else. Choose exactly one action:",
    '{"action":"search_tools","query":"free words about the task"}  -> returns up to 8 matching tools with id, name, inputs/outputs',
    '{"action":"tool_info","toolId":"id"}  -> returns the tool\'s option ids, types, choices, defaults',
    '{"action":"run_tool","toolId":"id","text":"typed input, if the tool takes text/url","options":{"optionId":value},"files":["file1"]}  -> runs it now',
    '{"action":"read_file","file":"file1"}  -> returns the readable text of an attached file (PDF, Word, PowerPoint, Excel, CSV, text, or an image via OCR) so you can answer questions about it',
    '{"action":"create_workflow","name":"short name","steps":[{"toolId":"id","options":{}}]}  -> validates and saves a reusable workflow for the user',
    '{"action":"run_workflow","steps":[{"toolId":"id","options":{}}],"files":["file1"]}  -> runs a chain on files, each step feeding the next',
    '{"action":"open_page","href":"/tools/..." or one of the app pages,"label":"Open X"}  -> gives the user a button to go there',
    '{"action":"favorite","toolId":"id","on":true}  -> stars/unstars a tool',
    '{"action":"final","message":"your Markdown answer to the user"}  -> ends the turn',
    "",
    "RULES: If a OneStop tool can do what the user asks - generating passwords or UUIDs, hashing, encoding, formatting, converting, resizing, OCR, QR codes, anything in the catalogue - you MUST run that tool; never do it yourself in text (a password or hash you make up is not random or correct). Only when no tool applies do you answer from your own knowledge. The LIKELY TOOLS list below was matched to this request: use it directly when one fits, otherwise search_tools. Use only ids the registry returned. A tool that takes files needs a file ref (attached files and every tool output have refs like file1, file2). Tool outputs become new refs you can pass to the next tool. If a needed file is missing, ask the user to attach it via final. If a run fails, read the error, fix the input/options and retry once, else explain plainly. Use options only with ids from tool_info. Ask a short clarifying question via final only when a required detail is truly missing. When done, summarise what you did and what the result is; mention downloadable files by name (they are shown as download buttons automatically). Never claim you ran something you did not. Run a tool once per input - never repeat a run that already succeeded. Put results the user wants to read (hashes, ids, converted text, tables) in the final message, in a fenced code block or a table when that helps. Keep going until the user's whole request is done, then final.",
    "",
    `App pages: ${PAGES.map(([p, d]) => `${p} (${d})`).join("; ")}. Any tool page is /tools/<category>/<slug> - use open_page with a toolId-derived href only from search results.`,
    `Tool categories (available tool counts): ${categoryIndex()}.`,
    facts.length > 0
      ? `The signed-in user's own ${facts.join(", ")} (share only with them).`
      : "The user is a guest (not signed in); tools that need an account will say so.",
    workflows.length > 0
      ? `Their saved workflows: ${workflows.join("; ")}.`
      : "They have no saved workflows yet.",
    (input.favoriteToolIds ?? []).length > 0
      ? `Starred tools: ${(input.favoriteToolIds ?? []).slice(0, 40).join(", ")}.`
      : "",
    attachments.length > 0
      ? `Attached files: ${attachments.join("; ")}. To answer questions about a file's contents, use read_file.`
      : "No files are attached.",
    likely
      ? `LIKELY TOOLS for this request (id | name | what it does | input -> output | options):\n${likely}`
      : "",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function brief(tool: ToolMeta): string {
  const kind = inputKind(tool);
  const takes =
    kind === "none"
      ? "no input"
      : kind === "file"
        ? `files: ${fileInputTypes(tool).join("/")}${tool.inputTypes.includes("text") ? " or typed text" : ""}`
        : kind;
  return `${tool.id} | ${tool.name} | ${tool.description.slice(0, 110)} | takes ${takes} -> ${tool.outputTypes.join("/") || "text"}${tool.requiresAuth ? " | needs sign-in" : ""}${tool.network === "required" ? " | needs internet" : ""}`;
}

function searchTools(query: string): string {
  const q = query.trim();
  if (q === "") return "Give a non-empty query.";
  const ranked = tools
    .filter((t) => t.status === "available" && t.id !== "ai-assistant")
    .map((t) => ({ t, s: scoreTool(t, q) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 8);
  return ranked.length === 0
    ? "No tool matches. Try different words."
    : ranked.map((r) => brief(r.t)).join("\n");
}

function toolInfo(tool: ToolMeta): string {
  const options = getToolOptions(tool.id).map((o) => {
    const base = `${o.id} (${o.type}${"secret" in o && o.secret ? ", secret" : ""}) - ${o.label}`;
    if (o.type === "select")
      return `${base}; choices: ${o.choices.map((c) => c.value).join("|")}; default ${o.default}`;
    if (o.type === "number") return `${base}; ${o.min}..${o.max}; default ${o.default}`;
    if ("default" in o) return `${base}; default ${JSON.stringify(o.default)}`;
    return base;
  });
  return `${brief(tool)}\nOptions:\n${options.length > 0 ? options.join("\n") : "(none)"}`;
}

function cleanOptions(tool: ToolMeta, raw: unknown): Record<string, string | number | boolean> {
  const declared = new Set(getToolOptions(tool.id).map((o) => o.id));
  const out: Record<string, string | number | boolean> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!declared.has(key)) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
      out[key] = value;
  }
  return out;
}

const TEXTY = /^(text\/|application\/(json|xml|x-yaml|yaml|csv))/i;

function isTextName(name: string): boolean {
  return /\.(txt|md|csv|tsv|json|xml|ya?ml|html?|css|js|ts|log|sql|ini|svg)$/i.test(name);
}

class Files {
  private readonly byRef = new Map<string, PipelineFileInput>();
  private counter = 0;
  readonly produced: OutputFileRef[] = [];

  add(file: PipelineFileInput): string {
    this.counter += 1;
    const ref = `file${this.counter}`;
    this.byRef.set(ref, file);
    return ref;
  }

  resolve(refs: unknown): { files: PipelineFileInput[]; missing: string[] } {
    const files: PipelineFileInput[] = [];
    const missing: string[] = [];
    for (const raw of Array.isArray(refs) ? refs : []) {
      const ref = String(raw).trim();
      const found =
        this.byRef.get(ref) ?? [...this.byRef.entries()].find(([, f]) => f.name === ref)?.[1];
      if (found) files.push(found);
      else missing.push(ref);
    }
    return { files, missing };
  }
}

/** Runs one tool for the model and tells it, in a few lines, exactly what came back. */
async function runOne(
  tool: ToolMeta,
  args: { text: string | null; options: Record<string, unknown>; inputs: PipelineFileInput[] },
  ctx: { userId: string | null | undefined; files: Files; outputs: AgentOutput[] },
): Promise<{ ok: boolean; note: string }> {
  const input = { toolId: tool.id, files: args.inputs, text: args.text, options: args.options };
  // A stale session (an account that no longer exists) must not stop a tool: the job store rejects
  // the unknown user, so the run is repeated once as a guest, which every public tool allows.
  const outcome = await runPipeline({ ...input, userId: ctx.userId ?? null }).catch((err) => {
    if (!ctx.userId) throw err;
    console.error("[ai/agent] run failed for the signed-in user, retrying as a guest", err);
    return runPipeline({ ...input, userId: null });
  });
  if (!outcome.ok) {
    return { ok: false, note: `FAILED: ${outcome.error?.message ?? "the tool could not finish"}` };
  }
  const temp = getTempStore();
  const lines: string[] = [`OK${outcome.summary ? `: ${outcome.summary}` : ""}`];
  let text: string | null = null;
  if (typeof outcome.output === "string" && outcome.output.trim() !== "") {
    text = outcome.output;
  } else if (outcome.output && typeof outcome.output === "object") {
    try {
      text = JSON.stringify(outcome.output, null, 2);
    } catch {
      text = null;
    }
  }
  for (const file of outcome.files) {
    ctx.files.produced.push(file);
    const bytes: Uint8Array | null = await temp.read(file.id).catch(() => null);
    const ref = ctx.files.add({
      name: file.name,
      mimeType: file.mimeType,
      bytes: bytes ?? new Uint8Array(),
    });
    let preview = "";
    if (bytes && bytes.length > 0 && (TEXTY.test(file.mimeType) || isTextName(file.name))) {
      const body = new TextDecoder().decode(bytes.slice(0, MAX_RESULT_CHARS));
      preview = ` preview: ${body}${bytes.length > MAX_RESULT_CHARS ? "…" : ""}`;
      if (text === null && file.size <= 200_000) text = new TextDecoder().decode(bytes);
    }
    lines.push(`output ${ref}: ${file.name} (${file.size} bytes)${preview}`);
  }
  if (text)
    lines.push(
      `output text: ${text.slice(0, MAX_RESULT_CHARS)}${text.length > MAX_RESULT_CHARS ? "…" : ""}`,
    );
  ctx.outputs.push({
    toolId: tool.id,
    toolName: tool.name,
    summary: outcome.summary ?? null,
    text: text ? text.slice(0, 20_000) : null,
  });
  return { ok: true, note: lines.join("\n") };
}

function refuseTool(id: unknown): { tool: ToolMeta } | { error: string } {
  const toolId = typeof id === "string" ? id.trim() : "";
  const tool = toolId ? getTool(toolId) : undefined;
  if (!tool || tool.status !== "available" || tool.id === "ai-assistant") {
    return {
      error: `There is no available tool with id "${toolId}". Use search_tools and only ids it returns.`,
    };
  }
  return { tool };
}

function stepsOf(raw: unknown): { toolId: string; options: Record<string, unknown> }[] | string {
  if (!Array.isArray(raw) || raw.length === 0) return "steps must be a non-empty list.";
  const steps: { toolId: string; options: Record<string, unknown> }[] = [];
  for (const entry of raw.slice(0, 8)) {
    const guard = refuseTool((entry as { toolId?: unknown })?.toolId);
    if ("error" in guard) return guard.error;
    steps.push({
      toolId: guard.tool.id,
      options: cleanOptions(guard.tool, (entry as { options?: unknown }).options),
    });
  }
  return steps;
}

function safeHref(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const href = raw.trim().split("?")[0]!.replace(/\/+$/, "") || "/";
  if (ALLOWED_PATHS.has(href)) return href;
  const m = href.match(/^\/tools\/([a-z0-9-]+)\/([a-z0-9-]+)$/);
  if (m) {
    const tool = tools.find((t) => t.category === m[1] && t.slug === m[2]);
    if (tool) return toolHref(tool);
  }
  return null;
}

/** Which registry tool turns a file into plain text, by extension. */
const READERS: Record<string, string> = {
  pdf: "pdf-to-text",
  docx: "word-to-text",
  doc: "word-to-text",
  odt: "word-to-text",
  rtf: "word-to-text",
  pptx: "powerpoint-to-text",
  ppt: "powerpoint-to-text",
  xlsx: "excel-to-csv",
  xls: "excel-to-csv",
  png: "ai-ocr",
  jpg: "ai-ocr",
  jpeg: "ai-ocr",
  webp: "ai-ocr",
  gif: "ai-ocr",
  bmp: "ai-ocr",
};

const READ_LIMIT = 9000;

/** The readable text of one file, or an explanation of why there is none. */
async function readFileText(
  file: PipelineFileInput,
  userId: string | null | undefined,
): Promise<string> {
  const ext = file.name.includes(".") ? file.name.split(".").pop()!.toLowerCase() : "";
  const reader = READERS[ext];
  let bytes = file.bytes;
  if (reader) {
    const outcome = await runPipeline({
      toolId: reader,
      userId: null,
      files: [file],
      options: {},
    }).catch(() => null);
    void userId;
    if (!outcome?.ok)
      return `Could not read ${file.name}: ${outcome?.error?.message ?? "the reader failed"}`;
    const textFile = outcome.files.find((f) => /\.(txt|csv|md)$/i.test(f.name)) ?? outcome.files[0];
    if (textFile)
      bytes = await getTempStore()
        .read(textFile.id)
        .catch(() => new Uint8Array());
    else if (typeof outcome.output === "string") return outcome.output.slice(0, READ_LIMIT);
  }
  const text = new TextDecoder().decode(bytes.slice(0, READ_LIMIT * 4)).replace(/\0/g, "");
  if (text.trim() === "") return `${file.name} has no readable text.`;
  return text.length > READ_LIMIT
    ? `${text.slice(0, READ_LIMIT)}\n…(truncated, ${text.length} characters in all)`
    : text;
}

/** Models sometimes emit literal backslash-n pairs, or image links to files that only exist as download buttons. */
function tidyMessage(message: string): string {
  const text = message.includes("\n") ? message : message.replace(/\\n/g, "\n");
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Old tool results are cut down so a long run does not blow a free tier's tokens-per-minute cap. */
function pruneResults(messages: ChatMessage[]): void {
  const idx = messages
    .map((m, i) => (m.role === "user" && m.content.startsWith("RESULT:") ? i : -1))
    .filter((i) => i >= 0);
  for (const i of idx.slice(0, -2)) {
    const m = messages[i]!;
    if (m.content.length > 260)
      messages[i] = { ...m, content: `${m.content.slice(0, 240)} …(shortened)` };
  }
}

/** The whole turn. Throws `AiError` only when no model can be reached at all. */
export async function runAgent(input: AgentInput): Promise<void> {
  const files = new Files();
  const attachments = input.files.map((f) => `${files.add(f)} = ${f.name}`);
  const actions: AgentClientAction[] = [];
  const outputs: AgentOutput[] = [];
  const history = (input.history ?? []).slice(-12);
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: systemPrompt(
        input,
        attachments,
        likelyTools(
          input.request,
          input.files.map((f) => f.name),
        ),
      ),
    },
    ...history,
    { role: "user", content: input.request },
  ];
  let stepId = 0;
  let runtime: { provider: string; model: string; local: boolean } | null = null;
  let malformed = 0;
  let nudged = false;
  const emit = (event: AgentEvent) => input.onEvent?.(event);
  const finish = (message: string) =>
    emit({
      type: "final",
      message: tidyMessage(message),
      files: files.produced,
      actions,
      outputs,
      runtime,
    });

  for (let turn = 0; turn < MAX_AGENT_TURNS; turn += 1) {
    if (input.signal?.aborted) return;
    pruneResults(messages);
    if (turn === MAX_AGENT_TURNS - 2) {
      messages.push({
        role: "user",
        content:
          'RESULT: You are almost out of steps. Reply now with {"action":"final","message":"..."} summarising what was done and what is left.',
      });
    }
    const { text, config } = await chat(
      messages,
      {
        temperature: 0.2,
        maxTokens: 1400,
        json: true,
        budgetMs: 90_000,
        ...(input.signal ? { signal: input.signal } : {}),
      },
      input.credentials ?? {},
    );
    runtime = { provider: config.provider, model: config.model, local: config.info.local };
    const call = parseJsonObject(text);
    if (!call || typeof call.action !== "string") {
      malformed += 1;
      // A model that answered in plain words is answering the user; show it rather than looping.
      if (malformed >= 2 || (text.trim() !== "" && !text.includes("{"))) {
        finish(
          text.trim() !== ""
            ? text.trim()
            : "Sorry, I could not work that out. Could you rephrase?",
        );
        return;
      }
      messages.push(
        { role: "assistant", content: text },
        {
          role: "user",
          content:
            'Reply with ONE JSON object using the protocol (e.g. {"action":"final","message":"..."}).',
        },
      );
      continue;
    }
    messages.push({ role: "assistant", content: JSON.stringify(call) });
    const reply = (note: string) => messages.push({ role: "user", content: `RESULT: ${note}` });

    switch (call.action) {
      case "final": {
        const message = typeof call.message === "string" ? call.message.trim() : "";
        // "Done." after a tool ran tells the user nothing: ask once for the actual answer.
        if (message.length < 25 && outputs.length > 0 && !nudged) {
          nudged = true;
          reply(
            "Your final message is too short. Write the actual answer for the user: what you did, and the result itself (values, text, or a summary), in Markdown.",
          );
          break;
        }
        finish(message !== "" ? message : "Done.");
        return;
      }
      case "search_tools": {
        const id = ++stepId;
        emit({
          type: "step",
          id,
          label: `Looking for tools: ${String(call.query ?? "").slice(0, 60)}`,
          status: "done",
        });
        reply(searchTools(String(call.query ?? "")));
        break;
      }
      case "tool_info": {
        const guard = refuseTool(call.toolId);
        reply("error" in guard ? guard.error : toolInfo(guard.tool));
        break;
      }
      case "run_tool": {
        const guard = refuseTool(call.toolId);
        if ("error" in guard) {
          reply(guard.error);
          break;
        }
        const tool = guard.tool;
        const resolved = files.resolve(call.files);
        if (resolved.missing.length > 0) {
          reply(
            `Unknown file ref(s): ${resolved.missing.join(", ")}. Available: ${attachments.join("; ") || "none"}.`,
          );
          break;
        }
        const id = ++stepId;
        emit({
          type: "step",
          id,
          label: `Running ${tool.name}`,
          toolId: tool.id,
          status: "running",
        });
        const text = typeof call.text === "string" ? call.text : null;
        const result = await runOne(
          tool,
          { text, options: cleanOptions(tool, call.options), inputs: resolved.files },
          { userId: input.userId, files, outputs },
        );
        emit({
          type: "step",
          id,
          label: `${result.ok ? "Ran" : "Could not run"} ${tool.name}`,
          toolId: tool.id,
          status: result.ok ? "done" : "failed",
          detail: result.note.split("\n")[0]!.slice(0, 200),
        });
        reply(result.note);
        break;
      }
      case "read_file": {
        const resolved = files.resolve([call.file]);
        if (resolved.files.length === 0) {
          reply(
            `Unknown file "${String(call.file)}". Available: ${attachments.join("; ") || "none"}.`,
          );
          break;
        }
        const id = ++stepId;
        emit({ type: "step", id, label: `Reading ${resolved.files[0]!.name}`, status: "running" });
        const body = await readFileText(resolved.files[0]!, input.userId);
        emit({ type: "step", id, label: `Read ${resolved.files[0]!.name}`, status: "done" });
        reply(body);
        break;
      }
      case "run_workflow": {
        const steps = stepsOf(call.steps);
        if (typeof steps === "string") {
          reply(steps);
          break;
        }
        const check = validateWorkflow(steps);
        if (!check.valid) {
          reply(`Invalid chain: ${describeIssues(check.issues)}`);
          break;
        }
        const resolved = files.resolve(call.files);
        if (resolved.missing.length > 0) {
          reply(`Unknown file ref(s): ${resolved.missing.join(", ")}.`);
          break;
        }
        // Run step by step so each output can feed the next and every stage shows in the UI.
        let carried = resolved.files;
        const notes: string[] = [];
        let failed = false;
        for (const [i, step] of steps.entries()) {
          const tool = getTool(step.toolId)!;
          const id = ++stepId;
          emit({
            type: "step",
            id,
            label: `Step ${i + 1}/${steps.length}: ${tool.name}`,
            toolId: tool.id,
            status: "running",
          });
          const before = files.produced.length;
          const inputs = i === 0 ? carried : carried.filter((f) => acceptsFileName(tool, f.name));
          const result = await runOne(
            tool,
            { text: null, options: step.options, inputs: inputs.length > 0 ? inputs : carried },
            { userId: input.userId, files, outputs },
          );
          emit({
            type: "step",
            id,
            label: `${tool.name}`,
            toolId: tool.id,
            status: result.ok ? "done" : "failed",
            detail: result.note.split("\n")[0]!.slice(0, 200),
          });
          notes.push(`Step ${i + 1} (${tool.name}): ${result.note}`);
          if (!result.ok) {
            failed = true;
            break;
          }
          const fresh = files.produced.slice(before);
          if (fresh.length > 0) {
            const loaded: PipelineFileInput[] = [];
            for (const f of fresh) {
              try {
                loaded.push({
                  name: f.name,
                  mimeType: f.mimeType,
                  bytes: await getTempStore().read(f.id),
                });
              } catch {
                /* expired mid-run: the next step will report the missing input */
              }
            }
            carried = loaded;
          }
        }
        reply(`${failed ? "CHAIN STOPPED. " : "CHAIN DONE. "}${notes.join("\n")}`);
        break;
      }
      case "create_workflow": {
        const steps = stepsOf(call.steps);
        if (typeof steps === "string") {
          reply(steps);
          break;
        }
        const check = validateWorkflow(steps);
        if (!check.valid) {
          reply(`Invalid workflow: ${describeIssues(check.issues)}`);
          break;
        }
        const name =
          String(call.name ?? "")
            .trim()
            .slice(0, 80) || "Assistant workflow";
        actions.push({ type: "save_workflow", name, steps });
        const id = ++stepId;
        emit({
          type: "step",
          id,
          label: `Saved workflow "${name}" (${steps.length} steps)`,
          status: "done",
        });
        reply(`Workflow "${name}" saved for the user. It appears on the Workflows page.`);
        break;
      }
      case "open_page": {
        const href = safeHref(call.href);
        if (!href) {
          reply(
            `That page is not allowed. Use one of: ${[...ALLOWED_PATHS].join(", ")} or a /tools/<category>/<slug> path from search results.`,
          );
          break;
        }
        actions.push({
          type: "navigate",
          href,
          label: String(call.label ?? "Open").slice(0, 60) || "Open",
        });
        reply("A button to open it is shown to the user.");
        break;
      }
      case "favorite": {
        const guard = refuseTool(call.toolId);
        if ("error" in guard) {
          reply(guard.error);
          break;
        }
        const on = call.on !== false;
        actions.push({ type: "favorite", toolId: guard.tool.id, on });
        const id = ++stepId;
        emit({
          type: "step",
          id,
          label: `${on ? "Starred" : "Unstarred"} ${guard.tool.name}`,
          status: "done",
        });
        reply(`${guard.tool.name} ${on ? "starred" : "unstarred"}.`);
        break;
      }
      default:
        reply(`Unknown action "${String(call.action)}". Use one from the protocol.`);
    }
  }
  finish(
    "That took more steps than I am allowed in one go. Here is where things stand - tell me to continue and I will pick up from there.",
  );
}

export { AiError };
