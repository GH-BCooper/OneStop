// GET /api/qr/links — every dynamic QR code this OneStop instance holds, with its scan counts.
//
// Editing lives in `[id]/route.ts`. Storage is the interim JSON store (11-qr-tools.md); phase 14
// swaps it for Postgres without changing this response shape.
//
// A signed-in visitor sees only the codes they made. With no accounts configured there is only one
// person, so a guest sees every code on the instance. Once accounts exist an anonymous caller sees
// nothing: a code's destination and scan counts belong to its owner.
import { qrAnalytics } from "@onestop/api";
import { NextResponse } from "next/server";
import { currentUserId } from "@/auth";
import { authIsConfigured } from "@/lib/auth-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const userId = await currentUserId();
    if (!userId && authIsConfigured()) {
      return NextResponse.json(
        { ok: false, error: { code: "AUTH_REQUIRED", message: "Sign in to see your QR codes." } },
        { status: 401, headers: { "cache-control": "no-store" } },
      );
    }
    const codes = await qrAnalytics(userId);
    return NextResponse.json({ ok: true, codes }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[api/qr/links] could not list codes", err);
    return NextResponse.json(
      { ok: false, error: { code: "FAILED", message: "Your QR codes could not be loaded." } },
      { status: 500 },
    );
  }
}
