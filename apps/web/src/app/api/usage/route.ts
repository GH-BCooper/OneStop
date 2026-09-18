// GET /api/usage - what this account has actually run (14-history-favorites.md).
//
// The registry's "popularity" and "recently used" sorts were hand-set numbers and a localStorage
// list in phase 03. With real history behind them they can be derived: this route hands back the
// per-tool run counts and the most recent tool ids, and the explorer merges them with the
// device's own counts so a guest still gets a useful ordering.
import { getPrisma, recentToolIds, toolUsage } from "@onestop/api";
import { currentUserId } from "@/auth";
import { ok } from "@/lib/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const prisma = getPrisma();
  const userId = prisma ? await currentUserId() : null;
  // A guest (or an instance with no database) is not an error here - there is simply no
  // account-wide usage to add to what the device already knows.
  if (!prisma || !userId) return ok({ usage: {}, recent: [], synced: false });
  try {
    const [usage, recent] = await Promise.all([
      toolUsage(userId, prisma),
      recentToolIds(userId, 12, prisma),
    ]);
    return ok({ usage, recent, synced: true });
  } catch (err) {
    console.error("[api/usage] could not read usage", err);
    return ok({ usage: {}, recent: [], synced: false });
  }
}
