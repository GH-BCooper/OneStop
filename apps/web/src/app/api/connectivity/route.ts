// GET /api/connectivity - the server answering both halves of "are we online?" (18-pwa-offline.md).
//
// Reaching this route at all proves the app is reachable; `internet` says whether the server's own
// uplink works, which is what decides an online-only tool's fate. `?force=1` skips the short cache
// for the /status page's "Check again" button.
import { checkInternet, checkTargets } from "@/lib/internet-check";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const force = new URL(request.url).searchParams.get("force") === "1";
  let body: Record<string, unknown>;
  try {
    const check = await checkInternet({ force });
    body = { ok: true, app: true, ...check };
  } catch (err) {
    // A failing probe is an answer, not a 500: the page needs a usable state either way.
    console.error("[api/connectivity] probe failed", err);
    body = {
      ok: true,
      app: true,
      internet: false,
      target: checkTargets()[0] ?? "",
      checkedAt: new Date().toISOString(),
      detail: "The connection check could not be completed.",
      cached: false,
    };
  }
  return Response.json(body, { headers: { "cache-control": "no-store" } });
}
