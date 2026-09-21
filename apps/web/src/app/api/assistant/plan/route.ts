// POST /api/assistant/plan — turn a request into a plan (master plan §7.2; 16-ai-assistant.md).
//
// This endpoint never touches a file and never runs anything. It takes the request text and the
// *names* of the attached files (enough to check type compatibility) and answers with the plan,
// or with the reason there is none plus the Free/Paid external recommendations from §7.3.
//
// Splitting planning from running is what lets the user read the plan before any bytes move.
import { MAX_REQUEST_CHARS, planAssistantRequest } from "@onestop/api";
import { readAiCredentials } from "@/lib/ai-request";
import { fail, ok, readJson } from "@/lib/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_NAMES = 50;

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

  try {
    const plan = await planAssistantRequest({
      request: text,
      fileNames,
      credentials,
    });
    return ok({ plan });
  } catch (err) {
    console.error("[api/assistant/plan] unexpected failure", err);
    return fail(500, "FAILED", "The assistant could not plan that. Please try again.");
  }
}
