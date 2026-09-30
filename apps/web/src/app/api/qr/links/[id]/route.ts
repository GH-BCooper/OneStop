// PATCH /api/qr/links/:id — re-point, rename or pause a dynamic QR code.
// DELETE /api/qr/links/:id — retire it. The printed code then shows "no longer active".
//
// The id is what the QR image holds, so it is never changed by anything here: that is the whole
// promise of a dynamic code (11-qr-tools.md).
import { getQrStore, isQrLinkId, statsFor } from "@onestop/api";
import { NextResponse } from "next/server";
import { currentUserId } from "@/auth";
import { authIsConfigured } from "@/lib/auth-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TITLE = 120;

function problem(status: number, code: string, message: string) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status });
}

function notFound() {
  return problem(404, "NOT_FOUND", "That QR code no longer exists.");
}

/**
 * Whether the caller may change this code. The id is printed into every scan URL (`/q/<id>`), so
 * knowing it proves nothing: only the account that made a code can re-point, pause or delete it.
 * A code with no owner predates accounts; once accounts are configured it is read-only rather than
 * up for grabs by whoever signs up next. With no accounts at all there is one person, who owns
 * everything.
 */
async function mayEdit(
  owner: string | null,
): Promise<{ ok: true; userId: string | null } | { ok: false; response: Response }> {
  const userId = await currentUserId();
  if (!authIsConfigured()) return { ok: true, userId: null };
  if (!userId) {
    return {
      ok: false,
      response: problem(401, "AUTH_REQUIRED", "Sign in to change your QR codes."),
    };
  }
  if (owner === null) {
    return {
      ok: false,
      response: problem(
        403,
        "FORBIDDEN",
        "This code was made before accounts existed, so it can't be edited here.",
      ),
    };
  }
  if (owner !== userId) {
    return {
      ok: false,
      response: problem(403, "FORBIDDEN", "That QR code belongs to someone else."),
    };
  }
  return { ok: true, userId };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!isQrLinkId(id)) return notFound();

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return problem(400, "UNSUPPORTED_INPUT", "The change could not be read.");
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return problem(400, "UNSUPPORTED_INPUT", "The change could not be read.");
  }

  const patch: { title?: string; target?: string; active?: boolean } = {};
  if (typeof body.title === "string") patch.title = body.title.slice(0, MAX_TITLE);
  if (typeof body.active === "boolean") patch.active = body.active;
  if (typeof body.target === "string") {
    // A QR code is opened by a phone the moment it is scanned, so only plain web links are
    // accepted here — never javascript:, data: or a custom scheme (master plan §15).
    if (!/^https?:\/\/[^\s/$.?#][^\s]*$/i.test(body.target)) {
      return problem(
        400,
        "UNSUPPORTED_INPUT",
        "Enter a full link starting with http:// or https://.",
      );
    }
    patch.target = body.target;
  }
  if (Object.keys(patch).length === 0) {
    return problem(400, "UNSUPPORTED_INPUT", "Nothing to change.");
  }

  const store = getQrStore();
  const existing = await store.get(id);
  if (!existing) return notFound();
  const allowed = await mayEdit(existing.ownerToken);
  if (!allowed.ok) return allowed.response;
  try {
    const link = await store.update(id, patch, allowed.userId);
    return NextResponse.json(
      { ok: true, code: statsFor(link) },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    console.error(`[api/qr/links] could not update ${id}`, err);
    return problem(500, "FAILED", "That change could not be saved. Please try again.");
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!isQrLinkId(id)) return notFound();
  const existing = await getQrStore().get(id);
  if (!existing) return notFound();
  const allowed = await mayEdit(existing.ownerToken);
  if (!allowed.ok) return allowed.response;
  try {
    const removed = await getQrStore().remove(id, allowed.userId);
    if (!removed) return notFound();
    return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error(`[api/qr/links] could not delete ${id}`, err);
    return problem(500, "FAILED", "That code could not be deleted. Please try again.");
  }
}
