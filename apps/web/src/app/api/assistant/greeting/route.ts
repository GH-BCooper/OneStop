// GET /api/assistant/greeting — one personalised hello for the assistant's empty chat screen.
//
// Never blocks the assistant on this: whatever runtime is (or isn't) configured, `greetUser`
// always resolves to a usable line (the model's own, or a varied local fallback), so a slow or
// broken AI call never keeps the page from being usable.
import { greetUser } from "@onestop/api";
import { auth } from "@/auth";
import { readAiCredentials } from "@/lib/ai-request";
import { fail, ok } from "@/lib/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const credentials = readAiCredentials(request, url.searchParams.get("provider"));

  let name: string | null = null;
  try {
    const session = await auth();
    name = session?.user?.name ?? null;
  } catch (err) {
    console.error("[api/assistant/greeting] could not read the session", err);
  }

  try {
    const greeting = await greetUser(name, credentials);
    return ok({ greeting });
  } catch (err) {
    console.error("[api/assistant/greeting] unexpected failure", err);
    return fail(500, "FAILED", "The greeting could not be generated.");
  }
}
