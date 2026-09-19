// A real round trip against a locally running Ollama.
//
// PROGRESS.md records this as phase 16's biggest gap: "the four providers are tested against
// mocked HTTP, never a live service", and the phase 19 manual checklist carried it forward. The
// rest of `ai.test.ts` stays on mocks on purpose - it has to be deterministic and offline - so
// this file is the one place that talks to a real model, and it skips itself when there is none.
//
// It never contacts a hosted provider: only Ollama, only on this machine, only when it answers.
// That keeps CLAUDE.md's free-first and local-first rules intact in CI, where it simply skips.
import { describe, expect, it } from "vitest";
import { getExecutor, getTool } from "@onestop/tool-registry";
import type { ExecContext, ExecResult, FileRef } from "@onestop/types";

import { chat, getAiStatus, probeOllama, resetAiProbes } from "./modelRuntime.ts";
import "@onestop/api";

const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "http://localhost:11434";

async function ollamaIsUp(): Promise<boolean> {
  try {
    resetAiProbes();
    const probe = await probeOllama(OLLAMA_HOST, AbortSignal.timeout(2000));
    return probe.ok && probe.models.length > 0;
  } catch {
    return false;
  }
}

const describeLive = (await ollamaIsUp()) ? describe : describe.skip;

function ctx(bytes: Uint8Array): ExecContext {
  return {
    jobId: "live-ollama",
    readFile: async () => Buffer.from(bytes),
    signal: AbortSignal.timeout(300_000),
  };
}

function inputOf(name: string, bytes: Uint8Array): FileRef[] {
  return [{ name, size: bytes.byteLength, type: "text/plain" }];
}

async function runTool(
  id: string,
  options: Record<string, unknown>,
  text: string,
): Promise<ExecResult> {
  const tool = getTool(id);
  expect(tool, `${id} is not in the registry`).toBeTruthy();
  const executor = getExecutor(tool!);
  const bytes = new TextEncoder().encode(text);
  return executor(inputOf("live.txt", bytes), options, ctx(bytes));
}

describeLive("live Ollama runtime", () => {
  it("reports itself available and local in the status the UI shows", async () => {
    resetAiProbes();
    const status = await getAiStatus();
    expect(status.available).toBe(true);
    expect(status.provider).toBe("ollama");
    expect(status.local).toBe(true);
    expect(status.model).toBeTruthy();
  }, 60_000);

  it("completes a chat through the real provider adapter", async () => {
    const { text, config } = await chat(
      [
        { role: "system", content: "Answer with one word and nothing else." },
        { role: "user", content: "What is the capital of France?" },
      ],
      { temperature: 0, maxTokens: 24 },
    );
    expect(config.provider).toBe("ollama");
    expect(config.info.local).toBe(true);
    expect(text.toLowerCase()).toContain("paris");
  }, 180_000);

  it("runs ai-summarizer end to end on the model, not the built-in method", async () => {
    const result = await runTool(
      "ai-summarizer",
      { method: "ai", length: "short" },
      [
        "OneStop is a single web application for file conversion, PDF editing, image work,",
        "data formats, QR codes, media processing and developer utilities.",
        "Everything runs locally where it can, and nothing costs money to use.",
        "The AI assistant plans a chain of those tools from a plain-English request.",
      ].join(" "),
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect((result.output as { runtime?: string }).runtime).toMatch(/Ollama/i);
    expect((result.summary ?? "").length).toBeGreaterThan(0);
  }, 300_000);

  it("translates a document through the model runtime, not the offline glossary", async () => {
    // The exact gap phase 19 logged: document-translator (phase 07) now uses phase 16's runtime.
    const result = await runTool(
      "document-translator",
      { from: "en", to: "es", method: "ai" },
      "Good morning. The report is ready.",
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(result.output).toMatchObject({ engine: "model", local: true });
    expect((result.output as { runtime: string }).runtime).toMatch(/Ollama/i);
    const out = Buffer.from(result.files![0]!.bytes).toString("utf8");
    expect(out.trim().length).toBeGreaterThan(0);
    // Whatever the model chose, it must not simply have echoed the English back.
    expect(out).not.toBe("Good morning. The report is ready.");
  }, 300_000);
});
