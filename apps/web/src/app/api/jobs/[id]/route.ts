// GET /api/jobs/:id — the status and metadata of one job (master plan §16).
// Jobs live in memory until phase 13 gives them a Postgres table, so they do not survive a
// server restart. They never contain file contents, only metadata.
import { getJobStore } from "@onestop/api";
import { NextResponse } from "next/server";
import { currentUserId } from "@/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const job = await getJobStore().get(id);
  // A job belongs to whoever ran it: it names the tool, the options and the output file ids, so it
  // is answered only to its owner - and to nobody else, exactly as if it did not exist. A job with
  // no owner is a guest run on an instance with no accounts, where there is nobody else to hide it from.
  if (!job || (job.userId && job.userId !== (await currentUserId()))) {
    return NextResponse.json(
      { ok: false, error: { code: "NOT_FOUND", message: "This job is no longer available." } },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true, job }, { headers: { "cache-control": "no-store" } });
}
