// One per-process, per-key rate limit, shared by everything that needs one.
//
// Phase 17 built this for the network tools, where every run reaches a third party that will block
// an instance that hammers it. Phases 04, 12, 13 and 16 each logged "no per-IP limit yet" as tech
// debt, and phase 19 left "decide before exposing the app publicly" to phase 20. This is that
// decision: the bucket logic moves here so an HTTP route can use it as well as a tool, and
// `POST /api/tools/run` is now limited per caller.
//
// In-memory on purpose (CLAUDE.md §3: no architecture bloat). That means the limit is per server
// process, which is exactly right for a personal instance and is documented as such in
// `docs/DEPLOYMENT.md` for anyone who puts several instances behind a load balancer.

const buckets = new Map<string, number[]>();

export interface RateLimit {
  /** Requests allowed inside the window. */
  limit: number;
  windowMs: number;
}

/**
 * Records one hit against `key`. Returns null when it is allowed, or the number of seconds to wait
 * when it is not. Nothing is recorded for a refused request, so a caller that keeps hammering does
 * not push its own window further out.
 */
export function consumeRate(key: string, { limit, windowMs }: RateLimit): number | null {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    buckets.set(key, hits);
    return Math.max(1, Math.ceil((windowMs - (now - hits[0]!)) / 1000));
  }
  hits.push(now);
  buckets.set(key, hits);
  // Keep the map from growing without bound on a long-lived server.
  if (buckets.size > 500) {
    for (const [k, v] of buckets) if (v.every((t) => now - t >= windowMs)) buckets.delete(k);
  }
  return null;
}

/** Tests reset the buckets so one case cannot rate-limit the next. */
export function resetRateLimits(): void {
  buckets.clear();
}

/** The limit `POST /api/tools/run` applies per caller. Generous: this is a personal toolbox. */
export const RUN_RATE_LIMIT: RateLimit = {
  limit: Number(process.env.RUN_RATE_LIMIT ?? 120),
  windowMs: Number(process.env.RUN_RATE_WINDOW_SECONDS ?? 60) * 1000,
};
