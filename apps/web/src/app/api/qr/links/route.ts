// GET /api/qr/links — every dynamic QR code this OneStop instance holds, with its scan counts.
//
// Editing lives in `[id]/route.ts`. Storage is the interim JSON store (11-qr-tools.md); phase 14
// swaps it for Postgres without changing this response shape.
//
// TODO(13-auth-database.md): filter by the signed-in user. Until accounts exist every code is
// owned by nobody, which is the honest behaviour for a personal instance.
import { qrAnalytics } from "@onestop/api";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const codes = await qrAnalytics();
    return NextResponse.json({ ok: true, codes }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[api/qr/links] could not list codes", err);
    return NextResponse.json(
      { ok: false, error: { code: "FAILED", message: "Your QR codes could not be loaded." } },
      { status: 500 },
    );
  }
}
