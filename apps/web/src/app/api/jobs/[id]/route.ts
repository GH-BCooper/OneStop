// GET /api/jobs/:id — the status and metadata of one job (master plan §16).
// Jobs live in memory until phase 13 gives them a Postgres table, so they do not survive a
// server restart. They never contain file contents, only metadata.
import { getJobStore } from "@onestop/api";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const job = await getJobStore().get(id);
  if (!job) {
    return NextResponse.json(
      { ok: false, error: { code: "NOT_FOUND", message: "This job is no longer available." } },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true, job }, { headers: { "cache-control": "no-store" } });
}
