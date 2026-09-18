// GET /api/qr/links — every dynamic QR code this OneStop instance holds, with its scan counts.
//
// Editing lives in `[id]/route.ts`. Storage is the interim JSON store (11-qr-tools.md); phase 14
// swaps it for Postgres without changing this response shape.
//
// Since 13-auth-database.md a signed-in visitor sees only the codes they made; a guest still sees
// every code on the instance, which is the honest behaviour for a personal one (codes made before
// accounts existed have no owner).
import { qrAnalytics } from "@onestop/api";
import { NextResponse } from "next/server";
import { currentUserId } from "@/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const codes = await qrAnalytics(await currentUserId());
    return NextResponse.json({ ok: true, codes }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[api/qr/links] could not list codes", err);
    return NextResponse.json(
      { ok: false, error: { code: "FAILED", message: "Your QR codes could not be loaded." } },
      { status: 500 },
    );
  }
}
