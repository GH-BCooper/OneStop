// Phase 16's tests (16-ai-assistant.md, "Test Cases").
//
// Every test here runs with the network replaced: `setAiFetch` swaps the runtime's `fetch`, so a
// "Groq" test is a Groq-shaped response this file wrote, and a machine with no Ollama and no keys
// gets exactly the same results as one with both. That is deliberate — the acceptance criterion
// this phase cares most about is that OneStop works with *nothing* configured, and a test that
// quietly depended on a running model would hide the one failure that matters.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getExecutor, getTool, validateWorkflow } from "@onestop/tool-registry";
import { loadFileCoreConfig, type FileCoreConfig } from "../file-processing/config.ts";
import { createInMemoryJobStore, type JobStore } from "../file-processing/job.ts";
import { createTempStore, type TempStore } from "../file-processing/tempStore.ts";
import { makeTextPdf } from "../pdf/fixtures.ts";
import { runWorkflow } from "../workflows/run.ts";
import { planAssistantRequest } from "./assistant.ts";
import { PlanRejectedError, assertPlanIsRunnable, executePlan } from "./executor.ts";
import { detectIntentRules, parseJsonObject } from "./intent.ts";
import type { AiError } from "./modelRuntime.ts";
import {
  chat,
  getAiStatus,
  resetAiProbes,
  setAiFetch,
  NO_RUNTIME_MESSAGE,
} from "./modelRuntime.ts";
import { parsePlanAnswer, pageSpec, planWithRules, splitClauses } from "./planner.ts";
import { AI_PROVIDERS, availableConfigs } from "./providers.ts";
import { answerFromText, chunkText, selectContext } from "./ragContext.ts";
import { recommendationsFor } from "./recommendations.ts";
// Registering every real executor is what makes the end-to-end sections real.
import "../index.ts";

const bytes = (value: string) => new TextEncoder().encode(value);
const decode = (value: Uint8Array) => new TextDecoder().decode(value);

/** A fetch that refuses everything — a machine with no Ollama and no internet. */
const offlineFetch = (() => Promise.reject(new Error("ECONNREFUSED"))) as typeof fetch;

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

/** A Groq-shaped (OpenAI-shaped) answer. */
function groqFetch(content: string): typeof fetch {
  return ((url: string) => {
    if (!String(url).includes("api.groq.com")) return Promise.reject(new Error("ECONNREFUSED"));
    return Promise.resolve(jsonResponse({ choices: [{ message: { content } }] }));
  }) as unknown as typeof fetch;
}

/**
 * A Groq-shaped fetch that records every request body it receives (`capture.calls`) and answers
 * the intent-classification call (recognised by `INTENT_SYSTEM`'s own wording) with a fixed
 * "chat" verdict, so a test can assert on what the *conversation* call was actually sent.
 */
function capturingGroqFetch(
  replyText: string,
  capture: { calls: Array<{ messages: { role: string; content: string }[] }> },
): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    if (!String(url).includes("api.groq.com")) return Promise.reject(new Error("ECONNREFUSED"));
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      messages: { role: string; content: string }[];
    };
    capture.calls.push(body);
    const isIntentCall = body.messages.some((m) => m.content.includes("You classify a request"));
    const content = isIntentCall ? JSON.stringify({ kind: "chat", confidence: 0.95 }) : replyText;
    return jsonResponse({ choices: [{ message: { content } }] });
  }) as unknown as typeof fetch;
}

let restoreFetch: (() => void) | null = null;

beforeEach(() => {
  resetAiProbes();
  // Nothing configured, nothing reachable: the default state of a fresh install.
  vi.stubEnv("GROQ_API_KEY", "");
  vi.stubEnv("OPENROUTER_API_KEY", "");
  vi.stubEnv("GOOGLE_AI_API_KEY", "");
  vi.stubEnv("AI_IMAGE_URL", "");
  restoreFetch = setAiFetch(offlineFetch);
});

afterEach(() => {
  restoreFetch?.();
  restoreFetch = null;
  vi.unstubAllEnvs();
  resetAiProbes();
});

// ---- intent detection ---------------------------------------------------------------------------

describe("intent detection", () => {
  it("routes a tool request, a file question and a writing request differently", () => {
    expect(detectIntentRules("Convert this PDF to Excel and compress it").kind).toBe("tool-chain");
    expect(detectIntentRules("What is the notice period?", { hasFiles: true }).kind).toBe(
      "question",
    );
    expect(detectIntentRules("Draft an email asking for an invoice").kind).toBe("generate");
  });

  it("routes 'list/how many/what tools' questions to the registry catalogue, not the model", () => {
    expect(detectIntentRules("can you list me all the pdf tools?").kind).toBe("catalogue");
    expect(detectIntentRules("how many image tools do you have").kind).toBe("catalogue");
    expect(detectIntentRules("what tools are there for QR codes").kind).toBe("catalogue");
    expect(detectIntentRules("show me all the tools").kind).toBe("catalogue");
    // An actual action verb always wins over the word "tool" showing up in the sentence.
    expect(
      detectIntentRules("what tool should I use to compress this pdf", { hasFiles: true }).kind,
    ).toBe("tool-chain");
  });

  it("routes 'my workflows' / 'my favourites' to the catalogue too, without needing the word tool", () => {
    expect(detectIntentRules("list my workflows").kind).toBe("catalogue");
    expect(detectIntentRules("what workflows do I have").kind).toBe("catalogue");
    expect(detectIntentRules("show my favourite tools").kind).toBe("catalogue");
    expect(detectIntentRules("what are my favorites").kind).toBe("catalogue");
  });

  it("marks genuinely out-of-scope requests as unsupported", () => {
    expect(detectIntentRules("generate a 3D model of a house").kind).toBe("unsupported");
    expect(detectIntentRules("send an email to my supplier").kind).toBe("unsupported");
  });

  it("reads JSON out of a model answer wrapped in prose or a code fence", () => {
    expect(parseJsonObject('```json\n{"kind":"question"}\n```')?.kind).toBe("question");
    expect(parseJsonObject('Sure! {"kind":"generate"} hope that helps')?.kind).toBe("generate");
    expect(parseJsonObject("not json at all")).toBeNull();
  });
});

// ---- the planner --------------------------------------------------------------------------------

describe("clause splitting and option extraction", () => {
  it("splits the master plan §7.1 request into its three clauses", () => {
    expect(
      splitClauses("Convert this PDF to Excel, remove the first 2 pages, then compress the result"),
    ).toEqual(["Convert this PDF to Excel", "remove the first 2 pages", "compress the result"]);
  });

  it("reads page selections out of plain words", () => {
    expect(pageSpec("remove the first 2 pages")).toBe("1-2");
    expect(pageSpec("delete pages 3-5")).toBe("3-5");
    expect(pageSpec("drop the last page")).toBe("last");
    expect(pageSpec("compress it")).toBeNull();
  });
});

describe("the rule planner", () => {
  it("plans the master plan §7.1 example with registered tools only", () => {
    const result = planWithRules({
      request: "Convert this PDF to Excel, remove the first 2 pages, then compress the result",
      fileNames: ["report.pdf"],
    });

    expect(result.message).toBeNull();
    expect(result.plan).not.toBeNull();
    const steps = result.plan!.steps;
    expect(steps).toHaveLength(3);
    // Every id is a real registry tool — the whole point of the allow-list.
    for (const step of steps) expect(getTool(step.toolId)).toBeDefined();
    expect(steps.map((s) => s.toolId)).toEqual([
      "delete-pdf-pages",
      "pdf-to-excel",
      "file-compressor",
    ]);
    expect(steps[0]!.options.pages).toBe("1-2");
    // Written literally the chain is impossible (a PDF tool cannot read a spreadsheet), so the
    // planner reorders and says so rather than producing something that cannot run.
    expect(result.plan!.explanation).toContain("different order");
    expect(validateWorkflow(steps).valid).toBe(true);
  });

  it("plans a simple two-step request in the user's own order", () => {
    const result = planWithRules({
      request: "Merge these PDFs then compress the result",
      fileNames: ["a.pdf", "b.pdf"],
    });
    expect(result.plan?.steps.map((s) => s.toolId)).toEqual(["merge-pdf", "compress-pdf"]);
    expect(result.plan?.explanation).not.toContain("different order");
  });

  it("refuses to plan a request no registered tool matches", () => {
    const result = planWithRules({ request: "zzzz qqqq", fileNames: [] });
    expect(result.plan).toBeNull();
    expect(result.message).toBeTruthy();
  });
});

// ---- the allow-list -------------------------------------------------------------------------------

describe("the registry allow-list", () => {
  it("drops planned steps naming a tool that does not exist, and says which", () => {
    const answer = JSON.stringify({
      steps: [
        { toolId: "merge-pdf", options: {} },
        { toolId: "magic-pdf-fixer", options: {} },
        { toolId: "compress-pdf", options: { level: "strong" } },
      ],
      explanation: "…",
    });
    const parsed = parsePlanAnswer(answer);
    expect(parsed.steps.map((s) => s.toolId)).toEqual(["merge-pdf", "compress-pdf"]);
    expect(parsed.rejected).toEqual([
      { toolId: "magic-pdf-fixer", reason: "There is no such tool in the OneStop registry." },
    ]);
  });

  it("drops option keys and values the registry does not declare", () => {
    const parsed = parsePlanAnswer(
      JSON.stringify({
        steps: [
          {
            toolId: "delete-pdf-pages",
            options: { pages: "1-2", level: "nuclear", shell: "rm -rf /", nested: { a: 1 } },
          },
        ],
      }),
    );
    // "pages" is real; "level" is not an option of this tool, and neither are the other two.
    expect(parsed.steps[0]!.options).toEqual({ pages: "1-2" });

    // An undeclared *value* is dropped just as an undeclared key is.
    const bad = parsePlanAnswer(
      JSON.stringify({ steps: [{ toolId: "compress-pdf", options: { level: "nuclear" } }] }),
    );
    expect(bad.steps[0]!.options).toEqual({});
  });

  it("refuses to execute a plan naming an unknown tool, before anything runs", async () => {
    const plan = {
      steps: [
        { toolId: "merge-pdf", options: {} },
        { toolId: "definitely-not-a-tool", options: {} },
      ],
      explanation: "a bad model answer",
    };
    expect(() => assertPlanIsRunnable(plan)).toThrow(PlanRejectedError);
    try {
      assertPlanIsRunnable(plan);
    } catch (err) {
      expect((err as PlanRejectedError).message).toContain("definitely-not-a-tool");
      expect((err as PlanRejectedError).message).toContain("Nothing was run");
    }

    // And the same check guards the executor itself.
    await expect(
      executePlan({
        plan,
        files: [{ name: "a.pdf", mimeType: "application/pdf", bytes: bytes("x") }],
      }),
    ).rejects.toBeInstanceOf(PlanRejectedError);
  });

  it("refuses a chain whose tools cannot pass files to each other", () => {
    expect(() =>
      assertPlanIsRunnable({
        steps: [
          { toolId: "background-removal", options: {} },
          { toolId: "audio-converter", options: {} },
        ],
        explanation: "",
      }),
    ).toThrow(PlanRejectedError);
  });
});

// ---- external recommendations (master plan §7.3) ----------------------------------------------------

describe("external recommendations", () => {
  it("answers an impossible request with grouped Free and Paid lists instead of a fake tool", async () => {
    const result = await planAssistantRequest({
      request: "generate a 3D model of a house",
      fileNames: [],
    });

    expect(result.ok).toBe(false);
    expect(result.plan).toBeNull();
    expect(result.intent.kind).toBe("unsupported");
    const groups = result.recommendations!;
    expect(groups.free.length).toBeGreaterThan(0);
    expect(groups.paid.length).toBeGreaterThan(0);
    for (const item of [...groups.free, ...groups.paid]) {
      expect(item.name).toBeTruthy();
      expect(item.url.startsWith("https://")).toBe(true);
      expect(item.purpose).toBeTruthy();
      expect(item.limitation).toBeTruthy();
    }
    expect(groups.free.every((r) => r.pricing === "free")).toBe(true);
    expect(groups.paid.every((r) => r.pricing === "paid")).toBe(true);
  });

  it("picks the topic from the request, and always has a fallback", () => {
    expect(recommendationsFor("transcribe this podcast").topic).toContain("speech");
    expect(recommendationsFor("something entirely unheard of").free.length).toBeGreaterThan(0);
  });
});

// ---- the model runtime ------------------------------------------------------------------------------

describe("the model runtime", () => {
  it("reports 'not configured' clearly when nothing is available", async () => {
    const status = await getAiStatus();
    expect(status.available).toBe(false);
    expect(status.message).toBe(NO_RUNTIME_MESSAGE);
    // The default disclosure is still the local one: Ollama is what a fresh install would use.
    expect(status.disclosure).toBe(AI_PROVIDERS.ollama.disclosure);
  });

  it("uses a user-supplied free-tier key and discloses that data leaves the device", async () => {
    restoreFetch?.();
    restoreFetch = setAiFetch(groqFetch("Hello from the hosted runtime."));

    const { text, config } = await chat(
      [{ role: "user", content: "hi" }],
      {},
      {
        provider: "groq",
        apiKey: "gsk_test_key",
      },
    );
    expect(text).toBe("Hello from the hosted runtime.");
    expect(config.provider).toBe("groq");

    const status = await getAiStatus({ provider: "groq", apiKey: "gsk_test_key" });
    expect(status.available).toBe(true);
    expect(status.local).toBe(false);
    expect(status.disclosure).toContain("Groq's servers");
    expect(status.disclosure).toContain("internet connection");
  });

  it("turns a free-tier 429 into a specific, recoverable message", async () => {
    restoreFetch?.();
    restoreFetch = setAiFetch((() =>
      Promise.resolve(
        new Response("rate limited", { status: 429, headers: { "retry-after": "17" } }),
      )) as unknown as typeof fetch);

    await expect(
      chat([{ role: "user", content: "hi" }], {}, { provider: "groq", apiKey: "gsk_test_key" }),
    ).rejects.toMatchObject({ code: "AI_RATE_LIMIT" });

    try {
      await chat(
        [{ role: "user", content: "hi" }],
        {},
        { provider: "groq", apiKey: "gsk_test_key" },
      );
    } catch (err) {
      const error = err as AiError;
      expect(error.message).toContain("Out of credits.");
      expect(error.message).toContain("https://console.groq.com/settings/billing");
      expect(error.message).not.toContain("rate limited"); // the provider body never leaks
    }
  });

  it("moves on to another runtime when one runs out of credits or rejects its key", async () => {
    restoreFetch?.();
    restoreFetch = setAiFetch(((url: string) => {
      if (String(url).includes("api.groq.com")) {
        return Promise.resolve(new Response("limit", { status: 429 }));
      }
      if (String(url).includes("openrouter.ai")) {
        return Promise.resolve(new Response("bad key", { status: 401 }));
      }
      if (String(url).includes("generativelanguage.googleapis.com")) {
        return Promise.resolve(
          jsonResponse({ candidates: [{ content: { parts: [{ text: "Answered by Gemini." }] } }] }),
        );
      }
      return Promise.reject(new Error("ECONNREFUSED"));
    }) as unknown as typeof fetch);

    // OneStop's own service holds all three keys: the two that fail hand the request on, and the
    // one that works answers - every time, not just on a lucky ordering.
    vi.stubEnv("GROQ_API_KEY", "g");
    vi.stubEnv("OPENROUTER_API_KEY", "o");
    vi.stubEnv("GOOGLE_AI_API_KEY", "k");
    for (let i = 0; i < 6; i++) {
      const { text, config } = await chat(
        [{ role: "user", content: "hi" }],
        {},
        { mode: "hosted" },
      );
      expect(text).toBe("Answered by Gemini.");
      expect(config.provider).toBe("google");
    }
  });

  it("tries the next model of the same provider when one is retired or overloaded", async () => {
    restoreFetch?.();
    const tried: string[] = [];
    restoreFetch = setAiFetch(((url: string, init: RequestInit) => {
      const model = JSON.parse(String(init.body)).model as string;
      tried.push(model);
      // Groq retired its first-choice model; the second one answers.
      if (tried.length === 1) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ error: { message: `The model \`${model}\` does not exist` } }),
            { status: 404 },
          ),
        );
      }
      return Promise.resolve(
        jsonResponse({ choices: [{ message: { content: "Second model answered." } }] }),
      );
    }) as unknown as typeof fetch);

    vi.stubEnv("GROQ_API_KEY", "g");
    const { text, config } = await chat(
      [{ role: "user", content: "hi" }],
      {},
      { mode: "own", provider: "groq", keys: { groq: "g" } },
    );
    expect(text).toBe("Second model answered.");
    expect(tried.length).toBe(2);
    expect(config.model).toBe(tried[1]);
  });

  it("stays on the provider the visitor picked, even when another of their keys would work", async () => {
    restoreFetch?.();
    restoreFetch = setAiFetch(((url: string) => {
      if (String(url).includes("api.groq.com")) {
        return Promise.resolve(new Response("limit", { status: 429 }));
      }
      return Promise.resolve(
        jsonResponse({ candidates: [{ content: { parts: [{ text: "Answered by Gemini." }] } }] }),
      );
    }) as unknown as typeof fetch);

    await expect(
      chat(
        [{ role: "user", content: "hi" }],
        {},
        { mode: "own", provider: "groq", keys: { groq: "g", google: "k" } },
      ),
    ).rejects.toMatchObject({ code: "AI_RATE_LIMIT" });
  });

  it("says 'Out of credits' with every link when all of them are used up", async () => {
    restoreFetch?.();
    restoreFetch = setAiFetch((() =>
      Promise.resolve(new Response("{}", { status: 429 }))) as unknown as typeof fetch);
    vi.stubEnv("GROQ_API_KEY", "g");
    vi.stubEnv("OPENROUTER_API_KEY", "o");
    await expect(
      chat([{ role: "user", content: "hi" }], {}, { mode: "hosted" }),
    ).rejects.toMatchObject({
      code: "AI_RATE_LIMIT",
      message: expect.stringMatching(
        /^Out of credits\. Visit https:\/\/\S+ or https:\/\/\S+ to increase your credits usage\.$/,
      ),
    });
  });

  it("uses only the server's keys for the hosted service, and only the visitor's for their own", () => {
    vi.stubEnv("GROQ_API_KEY", "server-groq");
    const hosted = availableConfigs({ mode: "hosted", keys: { openrouter: "browser-key" } });
    expect(hosted.map((c) => c.provider).sort()).toEqual(["groq", "ollama"]);
    expect(hosted.find((c) => c.provider === "groq")?.apiKey).toBe("server-groq");

    const own = availableConfigs({
      mode: "own",
      provider: "openrouter",
      keys: { openrouter: "browser-key" },
    });
    expect(own.map((c) => c.provider)[0]).toBe("openrouter");
    expect(own.some((c) => c.provider === "groq")).toBe(false);
  });

  it("reports the hosted service as unavailable when its key is rejected", async () => {
    vi.stubEnv("GROQ_API_KEY", "server-groq");
    restoreFetch?.();
    restoreFetch = setAiFetch((() =>
      Promise.resolve(new Response("nope", { status: 401 }))) as unknown as typeof fetch);
    const status = await getAiStatus({ mode: "hosted" });
    expect(status.available).toBe(false);
    expect(status.ollamaReachable).toBe(false);
    expect(status.checks?.find((c) => c.provider === "groq")?.ok).toBe(false);
  });

  it("turns a rejected key into a message that says what to do", async () => {
    restoreFetch?.();
    restoreFetch = setAiFetch((() =>
      Promise.resolve(new Response("bad key", { status: 401 }))) as unknown as typeof fetch);
    await expect(
      chat([{ role: "user", content: "hi" }], {}, { provider: "groq", apiKey: "nope" }),
    ).rejects.toMatchObject({ code: "AI_AUTH" });
  });

  it("throws the one catchable 'nothing is available' error when nothing answers", async () => {
    await expect(chat([{ role: "user", content: "hi" }])).rejects.toMatchObject({
      code: "AI_UNAVAILABLE",
    });
  });
});

// ---- retrieval ----------------------------------------------------------------------------------------

const FIXTURE_DOC = [
  "Acme Services Agreement",
  "",
  "1. Term. This agreement begins on 1 March 2026 and runs for twelve months.",
  "",
  "2. Notice. Either party may terminate this agreement by giving 45 days written notice.",
  "",
  "3. Fees. The monthly fee is 1,250 euros, invoiced on the first working day of each month.",
  "",
  "4. Support. Support is available on working days between 09:00 and 17:00 CET.",
].join("\n");

describe("retrieval for Ask Questions About a File", () => {
  it("chunks a document and picks the passage that answers the question", () => {
    const chunks = chunkText(FIXTURE_DOC, { size: 120, overlap: 20 });
    expect(chunks.length).toBeGreaterThan(1);
    const selection = selectContext(chunks, "What is the notice period?", { maxChars: 200 });
    expect(selection.context).toContain("45 days");
  });

  it("answers from the document's own words with no model configured", async () => {
    const result = await answerFromText(FIXTURE_DOC, "What is the notice period?");
    expect(result.extractive).toBe(true);
    expect(result.answer).toContain("45 days");
    expect(result.runtime).toBeNull();
  });

  it("answers about the fee too, and says so when the document is silent", async () => {
    expect((await answerFromText(FIXTURE_DOC, "What is the monthly fee?")).answer).toContain(
      "1,250",
    );
    const missing = await answerFromText(FIXTURE_DOC, "Which courier delivers the hardware?");
    expect(missing.answer).toBe("The document does not say.");
  });
});

// ---- the AI tools, end to end through the real pipeline ---------------------------------------------

describe("the AI tools", () => {
  let dir: string;
  let temp: TempStore;
  let jobs: JobStore;
  let config: FileCoreConfig;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "onestop-ai-test-"));
    temp = createTempStore({ tempDir: dir, ttlMs: 120_000, autoSweep: false });
    jobs = createInMemoryJobStore();
    config = { ...loadFileCoreConfig(), tempDir: dir };
  });

  afterEach(async () => {
    await temp.dispose();
    await fs.rm(dir, { recursive: true, force: true });
  });

  const runTool = (
    toolId: string,
    options: Record<string, unknown>,
    files: { name: string; mimeType: string; bytes: Uint8Array }[],
  ) => runWorkflow({ steps: [{ toolId, options }], files, name: toolId }, { jobs, temp, config });

  /**
   * The text-only tools (Text Generator, Grammar Checker, Image Generator) take typed text, not a
   * file, so they cannot start a workflow — the tool page calls them directly and so does this.
   */
  const runTyped = (toolId: string, input: string, options: Record<string, unknown> = {}) => {
    const tool = getTool(toolId)!;
    return getExecutor(tool)(input, options, {
      jobId: "test",
      readFile: async () => {
        throw new Error("no files in a typed-text run");
      },
    });
  };

  it("summarises with the built-in method when no AI runtime is configured", async () => {
    const result = await runTool(
      "ai-summarizer",
      { length: "short", style: "bullets", method: "auto" },
      [{ name: "contract.txt", mimeType: "text/plain", bytes: bytes(FIXTURE_DOC) }],
    );
    expect(result.error).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.steps[0]!.summary).toContain("built-in offline method");
    // The summary is built from the document's own sentences, so it names its actual subjects.
    expect(decode(await temp.read(result.files[0]!.id)).toLowerCase()).toContain("notice");
  }, 120_000);

  it("checks grammar with the built-in method and produces both outputs", async () => {
    const result = await runTyped("ai-grammar-checker", "teh cat sat on teh mat .", {
      output: "both",
      method: "auto",
    });
    if (!result.ok) throw new Error(result.message);
    expect(result.files).toHaveLength(2);
    expect(decode(result.files![1]!.bytes)).not.toContain("teh cat");
    expect(result.summary).toContain("built-in offline method");
  }, 120_000);

  it("translates with the offline dictionary, and refuses a language it cannot do offline", async () => {
    const ok = await runTool("ai-translator", { from: "en", to: "es", method: "builtin" }, [
      { name: "note.txt", mimeType: "text/plain", bytes: bytes("The invoice number is 4821.") },
    ]);
    expect(ok.ok).toBe(true);
    expect(decode(await temp.read(ok.files[0]!.id))).not.toContain("The invoice number");

    const unsupported = await runTool(
      "ai-translator",
      { from: "en", to: "ja", method: "builtin" },
      [{ name: "note.txt", mimeType: "text/plain", bytes: bytes("Hello.") }],
    );
    expect(unsupported.ok).toBe(false);
    expect(unsupported.error).toContain("Japanese");
  }, 120_000);

  it("answers a question about a real file, from the file's own content", async () => {
    const result = await runTool(
      "ask-questions-about-a-file",
      { question: "What is the notice period?", showSources: true, method: "auto" },
      [{ name: "agreement.txt", mimeType: "text/plain", bytes: bytes(FIXTURE_DOC) }],
    );
    expect(result.error).toBeNull();
    expect(result.ok).toBe(true);
    const answer = decode(await temp.read(result.files[0]!.id));
    expect(answer).toContain("45 days");
  }, 120_000);

  it("extracts information with patterns when no model is configured", async () => {
    const result = await runTool("extract-information", { fields: "", method: "auto" }, [
      {
        name: "invoice.txt",
        mimeType: "text/plain",
        bytes: bytes(
          "Invoice 4821\nDate: 2026-03-01\nTotal: 1,250.00 EUR\nContact: ada@example.com",
        ),
      },
    ]);
    expect(result.ok).toBe(true);
    const json = JSON.parse(decode(await temp.read(result.files[0]!.id))) as Record<
      string,
      string[]
    >;
    expect(json.emails).toContain("ada@example.com");
    expect(json.dates).toContain("2026-03-01");
  }, 120_000);

  it("structures 'Field: value' text without a model", async () => {
    const result = await runTool(
      "unstructured-to-structured-data",
      { format: "csv", method: "auto" },
      [
        {
          name: "people.txt",
          mimeType: "text/plain",
          bytes: bytes("Name: Ada\nCity: London\n\nName: Grace\nCity: New York\n"),
        },
      ],
    );
    expect(result.ok).toBe(true);
    const csv = decode(await temp.read(result.files[0]!.id));
    expect(csv).toContain("name,city");
    expect(csv).toContain("Grace");
  }, 120_000);

  it("says what it needs — rather than failing oddly — when a tool has no offline path", async () => {
    const result = await runTyped("ai-text-generator", "Write about lighthouses.", {
      format: "paragraph",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("OFFLINE");
    expect(result.message).toContain("Ollama");
    expect(result.message).toContain("Settings");
  }, 120_000);

  it("image generation is gated on a local model and says so", async () => {
    const result = await runTyped("ai-image-generator", "a lighthouse", {
      prompt: "a lighthouse",
      size: "512",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.message).toContain("AI_IMAGE_URL");
  }, 120_000);

  it("works through a free hosted runtime when the user supplies their own key", async () => {
    restoreFetch?.();
    restoreFetch = setAiFetch(groqFetch("The agreement can be ended with 45 days written notice."));

    const result = await runTool(
      "ai-summarizer",
      {
        length: "short",
        style: "paragraph",
        method: "ai",
        aiProvider: "groq",
        aiKey: "gsk_test_key",
      },
      [{ name: "contract.txt", mimeType: "text/plain", bytes: bytes(FIXTURE_DOC) }],
    );
    expect(result.error).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.steps[0]!.summary).toContain("Groq");
    expect(decode(await temp.read(result.files[0]!.id))).toContain("45 days");
  }, 120_000);

  it("surfaces a hosted rate limit as itself, not as a generic failure", async () => {
    restoreFetch?.();
    restoreFetch = setAiFetch((() =>
      Promise.resolve(new Response("{}", { status: 429 }))) as unknown as typeof fetch);
    const result = await runTool(
      "ai-summarizer",
      { method: "ai", aiProvider: "groq", aiKey: "gsk_test_key" },
      [{ name: "contract.txt", mimeType: "text/plain", bytes: bytes(FIXTURE_DOC) }],
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Out of credits.");
  }, 120_000);
});

// ---- the master plan §7.1 example, end to end ----------------------------------------------------------

describe("master plan §7.1, end to end", () => {
  let dir: string;
  let temp: TempStore;
  let jobs: JobStore;
  let config: FileCoreConfig;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "onestop-ai-e2e-"));
    temp = createTempStore({ tempDir: dir, ttlMs: 120_000, autoSweep: false });
    jobs = createInMemoryJobStore();
    config = { ...loadFileCoreConfig(), tempDir: dir };
  });

  afterEach(async () => {
    await temp.dispose();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('plans and runs "Convert this PDF to Excel, remove the first 2 pages, then compress the result"', async () => {
    const planned = await planAssistantRequest({
      request: "Convert this PDF to Excel, remove the first 2 pages, then compress the result",
      fileNames: ["report.pdf"],
    });
    expect(planned.ok).toBe(true);
    expect(planned.plan!.steps).toHaveLength(3);
    expect(planned.recommendations).toBeNull();

    const pdf = await makeTextPdf({ pages: 4, title: "Quarterly" });
    const result = await executePlan(
      {
        plan: planned.plan!,
        files: [{ name: "report.pdf", mimeType: "application/pdf", bytes: pdf }],
      },
      { jobs, temp, config },
    );

    expect(result.run.error).toBeNull();
    expect(result.run.ok).toBe(true);
    expect(result.outputsValid).toBe(true);
    expect(result.run.steps.map((s) => s.status)).toEqual(["success", "success", "success"]);

    // Step 1 really dropped two of the four pages, and the last step really produced an archive.
    const afterDelete = result.run.steps[0]!.files[0]!;
    expect(afterDelete.name.endsWith(".pdf")).toBe(true);
    const finalFile = result.run.files[0]!;
    expect(finalFile.name.endsWith(".zip")).toBe(true);
    const archive = await temp.read(finalFile.id);
    expect(decode(archive.slice(0, 2))).toBe("PK");
  }, 300_000);
});

describe("the catalogue: a user's own workflows and favourite tools", () => {
  it("lists the caller's saved workflows, linked straight to their 'use' view", async () => {
    const planned = await planAssistantRequest({
      request: "list my workflows",
      fileNames: [],
      workflows: [{ id: "wf-1", name: "convert csv to image" }],
    });
    expect(planned.catalogue?.scope).toBe("workflows");
    expect(planned.catalogue?.groups).toEqual([
      {
        id: "workflows",
        name: "Workflows",
        icon: "🧩",
        href: "/workflows",
        count: 1,
        tools: [{ id: "wf-1", name: "convert csv to image", href: "/workflows/wf-1?use=1" }],
      },
    ]);
  });

  it("says so, rather than showing an empty listing, when the caller has no saved workflows", async () => {
    const planned = await planAssistantRequest({ request: "list my workflows", fileNames: [] });
    expect(planned.catalogue?.groups[0]?.count).toBe(0);
    expect(planned.message).toContain("don't have any saved workflows yet");
  });

  it("resolves the caller's favourite tool ids back to real, clickable registry entries", async () => {
    const planned = await planAssistantRequest({
      request: "what are my favourite tools",
      fileNames: [],
      favoriteToolIds: ["merge-pdf", "compress-pdf", "not-a-real-tool"],
    });
    expect(planned.catalogue?.scope).toBe("favorites");
    const tool = getTool("merge-pdf")!;
    expect(planned.catalogue?.groups[0]?.tools).toEqual([
      { id: "merge-pdf", name: tool.name, href: expect.any(String) },
      { id: "compress-pdf", name: getTool("compress-pdf")!.name, href: expect.any(String) },
    ]);
  });
});

describe("chat memory and the signed-in user's own profile", () => {
  it("carries prior turns of the thread and the user's own name/email into the model prompt", async () => {
    const capture: { calls: Array<{ messages: { role: string; content: string }[] }> } = {
      calls: [],
    };
    restoreFetch?.();
    restoreFetch = setAiFetch(capturingGroqFetch("Your name is Brett.", capture));

    const result = await planAssistantRequest({
      request: "what was the above question I just asked",
      fileNames: [],
      history: [
        { role: "user", content: "what is my name?" },
        { role: "assistant", content: "I don't have that on file." },
      ],
      profile: { name: "Brett", email: "brett@example.com", birthday: null },
      credentials: { provider: "groq", apiKey: "gsk_test_key" },
    });

    expect(result.ok).toBe(true);
    expect(result.intent.kind).toBe("chat");
    expect(result.message).toBe("Your name is Brett.");

    // The intent classifier saw the recap, not just the one ambiguous line — this is what stops
    // a bare follow-up like "what was the above question" from being misread as a file question.
    const intentCall = capture.calls.find((c) =>
      c.messages.some((m) => m.content.includes("You classify a request")),
    )!;
    expect(intentCall.messages[1]!.content).toContain("Recent conversation");
    expect(intentCall.messages[1]!.content).toContain("what is my name?");

    // The actual reply call got the real conversation history and the user's own profile facts —
    // never fabricated, never another user's.
    const chatCall = capture.calls.find((c) =>
      c.messages.some((m) => m.content.includes("Chat naturally")),
    )!;
    expect(chatCall.messages).toContainEqual({ role: "user", content: "what is my name?" });
    expect(chatCall.messages).toContainEqual({
      role: "assistant",
      content: "I don't have that on file.",
    });
    const profileLine = chatCall.messages.find(
      (m) => m.content.includes("Brett") && m.content.includes("brett@example.com"),
    );
    expect(profileLine).toBeTruthy();
  });

  it("works with no history and no profile, exactly as before", async () => {
    restoreFetch?.();
    restoreFetch = setAiFetch(groqFetch("Hi there!"));

    const result = await planAssistantRequest({
      request: "hello there, how are you today",
      fileNames: [],
      credentials: { provider: "groq", apiKey: "gsk_test_key" },
    });

    expect(result.ok).toBe(true);
    expect(result.message).toBe("Hi there!");
  });
});
