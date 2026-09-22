// GET /api/progress/:token — polled by the browser while a tool/workflow run's original POST is
// still in flight (see apps/api/src/progress/store.ts for why this exists instead of a job queue).
// A token nobody has reported progress for yet (or ever) just reads as "still starting" — this is
// best-effort UI polish, never something a run's correctness depends on.
import { getProgress } from "@onestop/api";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;
  const state = getProgress(token);
  return NextResponse.json(
    { ok: true, progress: state ?? { percent: 0, label: "Starting…", done: false } },
    { headers: { "cache-control": "no-store" } },
  );
}
