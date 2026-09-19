// GET|HEAD /api/ping - "is the OneStop server reachable from this browser?" (18-pwa-offline.md).
//
// Deliberately the cheapest route in the app: no database, no registry, no network of its own. It
// is what tells a locally hosted instance apart from a dead one when the uplink is down, so it
// must answer even when everything else is unavailable.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "cache-control": "no-store, no-cache, must-revalidate" };

export function GET(): Response {
  return Response.json({ ok: true, app: "onestop", now: new Date().toISOString() }, { headers });
}

export function HEAD(): Response {
  return new Response(null, { status: 204, headers });
}
