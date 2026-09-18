// Shared helpers for the auth API routes (13-auth-database.md).
//
// Every route answers in the same shape as the rest of the app: { ok, ... } with a short,
// actionable message. Technical detail is logged server-side and never sent to the browser
// (CLAUDE.md §7).
import { AuthError, DatabaseUnavailableError, isConnectionError } from "@onestop/api";
import { NextResponse } from "next/server";

export const NO_DATABASE_MESSAGE =
  "Accounts are unavailable right now. Every tool still works without signing in.";

export function fail(status: number, code: string, message: string, field?: string) {
  return NextResponse.json(
    { ok: false, error: { code, message, ...(field ? { field } : {}) } },
    { status, headers: { "cache-control": "no-store" } },
  );
}

export function ok(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(
    { ok: true, ...body },
    { status, headers: { "cache-control": "no-store" } },
  );
}

/** Reads a JSON body, returning null (not a throw) when it is missing or malformed. */
export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return null;
    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function str(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === "string" ? value : "";
}

/** Maps an error from the auth services onto a response. Unknown errors become a 500. */
export function toErrorResponse(err: unknown, where: string) {
  if (err instanceof AuthError) {
    const status = err.code === "EMAIL_TAKEN" ? 409 : err.code === "NOT_FOUND" ? 404 : 400;
    return fail(
      err.code === "INVALID_CREDENTIALS" ? 401 : status,
      err.code,
      err.message,
      err.field,
    );
  }
  if (err instanceof DatabaseUnavailableError || isConnectionError(err)) {
    console.error(`[${where}] the database is unreachable`, err);
    return fail(503, "DATABASE_UNAVAILABLE", NO_DATABASE_MESSAGE);
  }
  console.error(`[${where}] unexpected failure`, err);
  return fail(500, "FAILED", "Something went wrong. Please try again.");
}
