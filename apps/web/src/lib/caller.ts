// Who is calling an API route, decided once and the same way everywhere.
//
// When accounts are configured the pages are behind sign-in, and the routes that do real work (run a
// tool, run a workflow, call the AI) now say the same thing instead of only the page saying it: an
// anonymous script can no longer use the server as free compute or spend the owner's AI quota. With
// no database there are no accounts and nobody could ever sign in, so the app stays open - guest
// mode is a supported deployment, not a loophole.
//
// Three ways in, in order: a session cookie; a personal access token (`Authorization: Bearer osk_…`
// or `X-OneStop-Token`), which is checked only when there is no session so a header can never
// re-attribute a browser request; or, with no accounts configured, nothing at all.
import { getPrisma, looksLikeAccessToken, tokenFromHeaders, verifyAccessToken } from "@onestop/api";
import { NextResponse } from "next/server";
import { currentUserId } from "@/auth";
import { authIsConfigured } from "@/lib/auth-config";

export type Caller = { userId: string | null };

/** Why a caller was turned away. Data rather than a Response, so a streaming route can phrase it its own way. */
export interface Refusal {
  refused: true;
  status: number;
  code: string;
  message: string;
}

function refuse(status: number, code: string, message: string): Refusal {
  return { refused: true, status, code, message };
}

/** The ordinary JSON error envelope for a refusal. */
export function refusalResponse(refusal: Refusal): Response {
  return NextResponse.json(
    { ok: false, error: { code: refusal.code, message: refusal.message } },
    { status: refusal.status, headers: { "cache-control": "no-store" } },
  );
}

/** True when the request carries *something* that is trying to be an access token. */
function presentsToken(headers: Headers): boolean {
  const bearer = /^Bearer\s+(\S+)$/i.exec((headers.get("authorization") ?? "").trim());
  if (bearer) return true;
  return (headers.get("x-onestop-token") ?? "").trim() !== "";
}

/**
 * Resolves the caller, or answers with the refusal to send back. `what` finishes the sentence
 * "Sign in to …" so the message says what was being attempted. Only `POST /api/tools/run` accepts
 * a personal access token (`allowToken`): it is documented as a way to run tools from a script,
 * not as a key to everything else.
 */
export async function resolveCaller(
  request: Request,
  what: string,
  { allowToken = false }: { allowToken?: boolean } = {},
): Promise<Caller | Refusal> {
  const userId = await currentUserId();
  if (userId) return { userId };

  if (allowToken && presentsToken(request.headers)) {
    // A token that is present but wrong is an error, never a quiet downgrade to "guest".
    const presented = tokenFromHeaders(request.headers);
    if (!presented || !looksLikeAccessToken(presented)) {
      return refuse(401, "AUTH_REQUIRED", "That access token is not valid, or has been revoked.");
    }
    const prisma = getPrisma();
    if (!prisma) {
      return refuse(
        503,
        "DATABASE_UNAVAILABLE",
        "Access tokens need a database, and none is configured here.",
      );
    }
    const identity = await verifyAccessToken(presented, prisma).catch(() => null);
    if (!identity) {
      return refuse(401, "AUTH_REQUIRED", "That access token is not valid, or has been revoked.");
    }
    return { userId: identity.userId };
  }

  if (authIsConfigured()) return refuse(401, "AUTH_REQUIRED", `Sign in to ${what}.`);
  return { userId: null };
}

export function isRefusal(value: Caller | Refusal): value is Refusal {
  return "refused" in value;
}
