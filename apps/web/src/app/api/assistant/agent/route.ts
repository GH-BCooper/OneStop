// POST /api/assistant/agent — the agentic assistant (see apps/api/src/ai/agent.ts).
//
// multipart/form-data: `message`, optional `history` / `workflows` / `favoriteToolIds` (JSON),
// and any number of `files`. The answer is a stream of newline-delimited JSON events, so the chat
// can show each tool as it runs instead of one long silence:
//   {"type":"step",...}  {"type":"final",...}  {"type":"error","code","message"}
import {
  AiError,
  assistantFailureMessage,
  consumeRate,
  findUserById,
  getPrisma,
  loadFileCoreConfig,
  MAX_HISTORY_TURNS,
  MAX_REQUEST_CHARS,
  RUN_RATE_LIMIT,
  runAgent,
  type AgentWorkflow,
  type AssistantHistory,
  type AssistantProfile,
} from "@onestop/api";
import { auth, currentUserId } from "@/auth";
import { readAiCredentials } from "@/lib/ai-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const line = (value: unknown) => new TextEncoder().encode(`${JSON.stringify(value)}\n`);

function json<T>(raw: FormDataEntryValue | null, fallback: T): T {
  if (typeof raw !== "string" || raw === "") return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function history(raw: unknown): AssistantHistory {
  if (!Array.isArray(raw)) return [];
  const turns: AssistantHistory = [];
  for (const item of raw.slice(-MAX_HISTORY_TURNS * 2)) {
    const role = (item as { role?: unknown })?.role;
    const content = (item as { content?: unknown })?.content;
    if ((role === "user" || role === "assistant") && typeof content === "string" && content.trim()) {
      turns.push({ role, content: content.trim().slice(0, 4000) });
    }
  }
  return turns;
}

async function profile(): Promise<AssistantProfile | undefined> {
  try {
    const id = (await auth())?.user?.id;
    const prisma = id ? getPrisma() : null;
    const user = id && prisma ? await findUserById(id, prisma) : null;
    return user ? { name: user.name, email: user.email, birthday: user.birthday } : undefined;
  } catch {
    return undefined;
  }
}

function stream(events: (send: (e: unknown) => void) => Promise<void>): Response {
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: unknown) => {
        try {
          controller.enqueue(line(e));
        } catch {
          /* client went away */
        }
      };
      try {
        await events(send);
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });
  return new Response(body, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" },
  });
}

export async function POST(request: Request): Promise<Response> {
  const config = loadFileCoreConfig();
  const wait = consumeRate(`agent:${request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local"}`, RUN_RATE_LIMIT);
  if (wait !== null) {
    return stream(async (send) => send({ type: "error", code: "RATE", message: `Too many requests in a row. Wait ${wait} seconds.` }));
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return stream(async (send) => send({ type: "error", code: "INVALID", message: "That request could not be read." }));
  }
  const message = String(form.get("message") ?? "").trim();
  if (message === "" || message.length > MAX_REQUEST_CHARS) {
    return stream(async (send) =>
      send({ type: "error", code: "INVALID", message: message === "" ? "Tell the assistant what you would like done." : `Keep the message under ${MAX_REQUEST_CHARS} characters.` }),
    );
  }
  const uploads = form.getAll("files").filter((v): v is File => v instanceof File);
  let total = 0;
  const files: { name: string; mimeType: string; bytes: Uint8Array }[] = [];
  for (const upload of uploads.slice(0, config.maxFilesPerRequest)) {
    total += upload.size;
    if (upload.size > config.maxUploadBytes || total > config.maxRequestBytes) {
      return stream(async (send) => send({ type: "error", code: "INVALID", message: "That file is too large." }));
    }
    files.push({ name: upload.name, mimeType: upload.type, bytes: new Uint8Array(await upload.arrayBuffer()) });
  }

  const credentials = readAiCredentials(request, form.get("provider"));
  const [userId, who] = await Promise.all([currentUserId(), profile()]);
  const workflows = json<AgentWorkflow[]>(form.get("workflows"), []).slice(0, 100);
  const favoriteToolIds = json<string[]>(form.get("favoriteToolIds"), []).filter((x) => typeof x === "string").slice(0, 300);

  return stream(async (send) => {
    try {
      await runAgent({
        request: message,
        history: history(json<unknown>(form.get("history"), [])),
        files,
        userId,
        ...(who ? { profile: who } : {}),
        workflows,
        favoriteToolIds,
        credentials,
        signal: request.signal,
        onEvent: send,
      });
    } catch (err) {
      if (err instanceof AiError) {
        send({ type: "error", code: err.code, message: assistantFailureMessage(err) });
      } else {
        console.error("[api/assistant/agent] unexpected failure", err);
        send({ type: "error", code: "FAILED", message: "The assistant hit a problem. Please try again." });
      }
    }
  });
}
