// GET /api/assistant/status — which AI runtime would answer right now (16-ai-assistant.md).
//
// The page calls this before it shows the assistant, so the disclosure the user sees ("runs
// entirely on your device" vs. "your files are sent to Groq") always describes the runtime that
// will actually be used, not the one that was configured last week.
//
// The user's own key arrives in the `x-onestop-ai-key` header rather than the query string, so it
// never lands in a URL, a log line or a browser history entry. It is used for this one request
// and never stored.
import { getAiStatus, isAiProviderId } from "@onestop/api";
import { fail, ok } from "@/lib/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const provider = url.searchParams.get("provider");
  const apiKey = request.headers.get("x-onestop-ai-key");
  try {
    const status = await getAiStatus({
      provider: isAiProviderId(provider) ? provider : null,
      apiKey: apiKey && apiKey.trim() !== "" ? apiKey : null,
    });
    return ok({ status });
  } catch (err) {
    console.error("[api/assistant/status] unexpected failure", err);
    return fail(500, "FAILED", "The AI runtime could not be checked. Please try again.");
  }
}
