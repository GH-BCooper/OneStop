// POST /api/assistant/plan — turn a request into a plan (master plan §7.2; 16-ai-assistant.md).
//
// This endpoint never touches a file and never runs anything. It takes the request text and the
// *names* of the attached files (enough to check type compatibility) and answers with the plan,
// or with the reason there is none plus the Free/Paid external recommendations from §7.3.
//
// Splitting planning from running is what lets the user read the plan before any bytes move.
import {
  findUserById,
  getPrisma,
  MAX_HISTORY_TURNS,
  MAX_REQUEST_CHARS,
  planAssistantRequest,
  type AssistantHistory,
  type AssistantProfile,
} from "@onestop/api";
import { auth } from "@/auth";
import { readAiCredentials } from "@/lib/ai-request";
import { fail, ok, readJson } from "@/lib/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_NAMES = 50;
const MAX_HISTORY_CHARS = 4000;
const MAX_WORKFLOWS = 100;

interface WorkflowSummary {
  id: string;
  name: string;
  favorite: boolean;
  useCount: number;
  lastUsedAt: string | null;
}
const MAX_FAVORITES = 300;

// Round-tripped from the client exactly like `fileNames` — the assistant never fetches a user's
// workflows/favourites itself, so a guest's device-only lists still work with no server data.
function readWorkflowSummaries(body: Record<string, unknown>): WorkflowSummary[] {
  if (!Array.isArray(body.workflows)) return [];
  const out: WorkflowSummary[] = [];
  for (const raw of body.workflows.slice(0, MAX_WORKFLOWS)) {
    if (!raw || typeof raw !== "object") continue;
    const id = (raw as { id?: unknown }).id;
    const name = (raw as { name?: unknown }).name;
    if (typeof id === "string" && id !== "" && typeof name === "string" && name !== "") {
      const { favorite, useCount, lastUsedAt } = raw as Record<string, unknown>;
      out.push({
        id,
        name: name.slice(0, 200),
        favorite: favorite === true,
        useCount:
          typeof useCount === "number" && Number.isFinite(useCount) && useCount > 0
            ? Math.floor(useCount)
            : 0,
        lastUsedAt: typeof lastUsedAt === "string" ? lastUsedAt.slice(0, 40) : null,
      });
    }
  }
  return out;
}

function readFavoriteToolIds(body: Record<string, unknown>): string[] {
  if (!Array.isArray(body.favoriteToolIds)) return [];
  return body.favoriteToolIds
    .filter((id): id is string => typeof id === "string" && id !== "")
    .slice(0, MAX_FAVORITES);
}

function readHistory(body: Record<string, unknown>): AssistantHistory {
  if (!Array.isArray(body.history)) return [];
  const turns: AssistantHistory = [];
  for (const raw of body.history.slice(-MAX_HISTORY_TURNS * 2)) {
    if (!raw || typeof raw !== "object") continue;
    const role = (raw as { role?: unknown }).role;
    const content = (raw as { content?: unknown }).content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") continue;
    const trimmed = content.trim();
    if (trimmed === "") continue;
    turns.push({ role, content: trimmed.slice(0, MAX_HISTORY_CHARS) });
  }
  return turns.slice(-MAX_HISTORY_TURNS * 2);
}

// The signed-in user's own name/email/birthday - so "what is my name?" can be answered without
// a file, and so a chat reply never learns anything about anyone but the person asking.
async function readProfile(): Promise<AssistantProfile | undefined> {
  try {
    const session = await auth();
    const id = session?.user?.id;
    if (!id) return undefined;
    const prisma = getPrisma();
    const user = prisma ? await findUserById(id, prisma) : null;
    if (!user) return undefined;
    return { name: user.name, email: user.email, birthday: user.birthday };
  } catch (err) {
    console.error("[api/assistant/plan] could not read the profile", err);
    return undefined;
  }
}

export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request);
  if (!body) return fail(400, "INVALID_INPUT", "That request could not be read.");

  const text = typeof body.request === "string" ? body.request.trim() : "";
  if (text === "")
    return fail(400, "INVALID_INPUT", "Tell the assistant what you would like done.");
  if (text.length > MAX_REQUEST_CHARS) {
    return fail(400, "INVALID_INPUT", `Keep the request under ${MAX_REQUEST_CHARS} characters.`);
  }

  const fileNames = (Array.isArray(body.fileNames) ? body.fileNames : [])
    .filter((n): n is string => typeof n === "string" && n.trim() !== "")
    .slice(0, MAX_FILE_NAMES)
    .map((n) => n.slice(0, 260));

  // The runtime choice (and the user's own keys) ride in a header, as they do for /status, so
  // they are never in a URL.
  const credentials = readAiCredentials(request, body.provider);
  const history = readHistory(body);
  const profile = await readProfile();
  const workflows = readWorkflowSummaries(body);
  const favoriteToolIds = readFavoriteToolIds(body);

  try {
    const plan = await planAssistantRequest({
      request: text,
      fileNames,
      ...(history.length > 0 ? { history } : {}),
      ...(profile ? { profile } : {}),
      ...(workflows.length > 0 ? { workflows } : {}),
      ...(favoriteToolIds.length > 0 ? { favoriteToolIds } : {}),
      credentials,
    });
    return ok({ plan });
  } catch (err) {
    console.error("[api/assistant/plan] unexpected failure", err);
    return fail(500, "FAILED", "The assistant could not plan that. Please try again.");
  }
}
