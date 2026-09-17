# Phase 16 — AI Assistant & AI Tools

## Objective
Build the `/assistant` page and the full tool-calling pipeline from master plan §7.2, backed by a local, free model runtime by default, plus the AI-flavored tools from the Feature & Tool List, plus the External Recommendations feature (§7.3).

## Depends On
03-tool-registry.md through 15-workflows.md (the assistant must only call tools/workflows that already exist and are registered)

## Scope — In
- **Model runtime — two supported paths, both free, user picks in Settings:**
  1. **Local (Ollama)** — fully offline, no data leaves the machine, but needs the user's hardware to run a model (e.g. Llama 3 8B or similar; model name configurable via env). This is the default for a fresh install with no configuration.
  2. **Free hosted API (Groq, and/or OpenRouter's free models, Google AI Studio's free Gemini tier)** — zero hardware requirement, fast, and free, but requires (a) an internet connection and (b) the user's own free API key entered in Settings — never a bundled/shared key. Because file content is sent to a third-party server for this path, label it clearly in the UI (e.g. "Runs on Groq's servers — your files are sent to Groq for processing" vs. "Runs entirely on your device — nothing leaves your machine" for Ollama) so the user is choosing knowingly, not assuming both are equivalent.
  - Handle free-tier rate limits (e.g. Groq's per-minute request/token caps) as an expected, recoverable condition — show a clear "rate limit reached, try again in a moment" message, never a crash.
  - A true paid API (hosted Claude/OpenAI/etc.) may still be offered as a further opt-in, user-supplied-key option for people who want it — same rules apply: never required, never bundled, app fully usable without it.
  - Whichever path is active, the app must remain fully usable with **zero cost** — Ollama or a free-tier hosted key both satisfy this; only the fully-paid option is truly optional/extra.
- **Pipeline** (§7.2, implemented literally): user request → intent detection → tool discovery from the registry → validate inputs/permissions → build execution plan → execute tool(s) → validate outputs → show progress → return result.
- **Hard allow-list rule:** the planner may only reference tool ids that exist in `packages/tool-registry`. Validate every planned step against the registry before executing anything; reject and explain if the plan references an unknown tool. The AI must never be allowed to execute a raw shell command.
- **AI tools:** AI Email Drafter, AI Text Generator, AI Text Rewriter, AI Summarizer (can now upgrade phase 07's extractive summarizer to a real LLM-based one behind the same interface), AI Grammar Checker, AI Translator (same upgrade path for phase 07's fallback), AI OCR (can delegate to phase 06's Tesseract OCR unless a local vision-capable model is configured), AI Document Analyzer, AI PDF Summarizer, Ask Questions About a File (basic RAG: extract text via existing tools, chunk, feed relevant chunks + question to the local model, manage context window size), Extract Information from Documents, Convert Unstructured → Structured Data, AI Image Generator/Editor/Background-Object Removal (local diffusion model, hardware-gated and explicitly optional/experimental — reuses the `requiresLocalModel` flag pattern from phase 09).
- **External Recommendations** (§7.3): when the assistant (or a direct tool page) can't fulfill a request, show two grouped lists — Free and Paid — each recommendation with site name, link, purpose, and limitation. A curated static list is sufficient; no live scraping of third-party sites (avoids SSRF/security risk per §15).

## Scope — Out
- No agentic arbitrary code execution.
- No mandatory paid AI dependency of any kind.
- No complex multi-agent orchestration framework — a single planning step + sequential execution is enough.

## Modules / Files
`apps/api/ai/{intent.ts, planner.ts, executor.ts, modelRuntime.ts, ragContext.ts, recommendations.ts}`; `apps/web/app/assistant/page.tsx`.

## Interfaces
```ts
interface ExecutionStep { toolId: string; options: Record<string, unknown>; }
interface ExecutionPlan { steps: ExecutionStep[]; explanation: string; }
// planner MUST validate every ExecutionStep.toolId against the tool registry before returning a plan
```

## Acceptance Criteria
- [ ] The exact example from master plan §7.1 ("Convert this PDF to Excel, remove the first 2 pages, then compress the result") produces a correct 3-step plan using only registered tools, and executes it end-to-end.
- [ ] A request for something OneStop genuinely can't do (e.g. "generate a 3D model") does not hallucinate a fake tool — it explains the limitation and shows Free/Paid external recommendations.
- [ ] The planner rejects any plan step referencing a tool id not present in the registry, with the rejection logged and surfaced clearly rather than silently retried into something wrong.
- [ ] The app remains 100% functional with no external AI API configured — only the local Ollama runtime.
- [ ] Switching to the free hosted API path (e.g. Groq) in Settings with a valid user-supplied key works end-to-end, and the UI clearly discloses that files are sent to that third-party service.
- [ ] A rate-limit response from the hosted free tier is caught and shown as a clear, specific message, not a generic error or crash.
- [ ] "Ask Questions About a File" answers correctly about a small test document's actual content (not a hallucinated answer).

## Test Cases
- The §7.1 example, verified end-to-end.
- Unsupported-task test: confirm recommendation UI appears, grouped correctly into Free/Paid, each with link+purpose+limitation.
- Allow-list test: inject a fake tool id into a plan (simulate a bad model response) and confirm it's rejected before execution.
- No-external-API test: confirm every AI tool still functions (possibly at lower quality) with only Ollama configured and no external key set.
- Free-hosted-API test: configure a Groq (or equivalent) key, confirm the same AI tools work through that path, and confirm the third-party-disclosure notice appears in the UI before it's used.
- Rate-limit test: mock a 429 from the hosted API, confirm the app surfaces the specific "rate limit reached" message rather than a generic failure.
- RAG test: ask a factual question about a known small fixture document, confirm the answer reflects the actual content.

## Notes
Log in PROGRESS.md which local model you tested against and its rough hardware requirements, so the deployment phase (20) can document minimum recommended specs for users who want local AI.
