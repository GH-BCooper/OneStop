// POST /api/history/import - merge this device's guest history into the account.
//
// The build file calls this a nice-to-have: a guest who used OneStop before signing up can keep
// the record of what they ran. Only metadata crosses over - the result files were deleted from
// the server within the retention window, long before the account existed - and re-running the
// import changes nothing, because entries are matched on tool + timestamp.
import {
  getPrisma,
  importHistory,
  mergeFavorites,
  MAX_IMPORT_ENTRIES,
  type ImportableEntry,
} from "@onestop/api";
import type { JobStatus } from "@onestop/types";
import { currentUserId } from "@/auth";
import { fail, NO_DATABASE_MESSAGE, ok, readJson, toErrorResponse } from "@/lib/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = new Set<JobStatus>(["pending", "validating", "processing", "success", "failed"]);

/** Nothing from the browser is trusted: each field is re-read, clamped and defaulted here. */
function toEntries(value: unknown): ImportableEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: ImportableEntry[] = [];
  for (const raw of value.slice(0, MAX_IMPORT_ENTRIES)) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    if (typeof row.toolId !== "string" || row.toolId.trim() === "") continue;
    const status = typeof row.status === "string" ? (row.status as JobStatus) : "success";
    entries.push({
      toolId: row.toolId.slice(0, 100),
      status: STATUSES.has(status) ? status : "success",
      createdAt: typeof row.createdAt === "string" ? row.createdAt : new Date().toISOString(),
      summary: typeof row.summary === "string" ? row.summary.slice(0, 500) : null,
      inputs: Array.isArray(row.inputs)
        ? row.inputs.filter((n): n is string => typeof n === "string").slice(0, 20)
        : [],
    });
  }
  return entries;
}

export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request);
  if (!body) return fail(400, "INVALID_INPUT", "That request could not be read.");
  const prisma = getPrisma();
  if (!prisma) return fail(503, "DATABASE_UNAVAILABLE", NO_DATABASE_MESSAGE);
  const userId = await currentUserId();
  if (!userId) return fail(401, "AUTH_REQUIRED", "Sign in first, then import your history.");
  try {
    const { imported, skipped } = await importHistory(userId, toEntries(body.entries), prisma);
    const favorites = await mergeFavorites(
      userId,
      Array.isArray(body.favorites)
        ? body.favorites.filter((id): id is string => typeof id === "string").slice(0, 300)
        : [],
      prisma,
    );
    return ok({ imported, skipped, favorites });
  } catch (err) {
    return toErrorResponse(err, "api/history/import");
  }
}
