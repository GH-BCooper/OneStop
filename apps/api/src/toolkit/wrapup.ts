// "Your Year in OneStop" (21-roadmap-expansion.md, roadmap §1.10 and §7.8).
//
// Built entirely from the signed-in user's *own* job history — no new table, no tracking, nothing
// sent anywhere. When there is no database configured the tool says so plainly instead of failing:
// guest history lives in IndexedDB on the device, and the UI hands that in as `localHistory`.
import type { Executor } from "@onestop/tool-registry";
import { CATEGORIES, getTool } from "@onestop/tool-registry";
import { getPrisma } from "../db/index.ts";
import { optNumber, optString, plural, round, runToolkitTool, unsupported } from "./common.ts";

export interface WrapUpRun {
  toolId: string;
  createdAt: string;
  status?: string;
}

export interface WrapUp {
  year: number;
  totalRuns: number;
  successfulRuns: number;
  distinctTools: number;
  topTools: { toolId: string; name: string; runs: number }[];
  topCategories: { category: string; name: string; runs: number }[];
  busiestMonth: { month: string; runs: number } | null;
  busiestDay: { date: string; runs: number } | null;
  weekdayRuns: number;
  weekendRuns: number;
  estimatedMinutesSaved: number;
  longestStreakDays: number;
  firstRun: string | null;
  lastRun: string | null;
}

/**
 * Minutes a run of each *kind* of tool plausibly saves versus doing it by hand. Deliberately
 * conservative, and shown as an estimate — the point is a sense of scale, not a billing claim.
 */
const MINUTES_SAVED: Record<string, number> = {
  pdf: 4,
  documents: 5,
  data: 6,
  images: 3,
  audio: 6,
  video: 9,
  "online-media": 3,
  qr: 2,
  ai: 7,
  "dev-utility": 2,
  network: 2,
  "file-utility": 3,
  security: 2,
  finance: 3,
  education: 4,
  time: 1,
  fun: 1,
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function summariseYear(runs: WrapUpRun[], year: number): WrapUp {
  const inYear = runs.filter((r) => new Date(r.createdAt).getUTCFullYear() === year);
  const byTool = new Map<string, number>();
  const byCategory = new Map<string, number>();
  const byMonth = new Array<number>(12).fill(0);
  const byDate = new Map<string, number>();
  let minutes = 0;
  let weekday = 0;
  let weekend = 0;
  let successful = 0;

  for (const run of inYear) {
    byTool.set(run.toolId, (byTool.get(run.toolId) ?? 0) + 1);
    const category = getTool(run.toolId)?.category ?? "unknown";
    byCategory.set(category, (byCategory.get(category) ?? 0) + 1);
    minutes += MINUTES_SAVED[category] ?? 2;
    const at = new Date(run.createdAt);
    byMonth[at.getUTCMonth()] = (byMonth[at.getUTCMonth()] ?? 0) + 1;
    const date = at.toISOString().slice(0, 10);
    byDate.set(date, (byDate.get(date) ?? 0) + 1);
    const day = at.getUTCDay();
    if (day === 0 || day === 6) weekend += 1;
    else weekday += 1;
    if (run.status === undefined || run.status === "succeeded" || run.status === "success") successful += 1;
  }

  const top = <T>(map: Map<string, number>, make: (id: string, runs: number) => T, limit: number): T[] =>
    [...map.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([id, runs]) => make(id, runs));

  const bestMonthIndex = byMonth.reduce((best, n, i) => (n > (byMonth[best] ?? 0) ? i : best), 0);
  const dates = [...byDate.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const sortedDates = [...byDate.keys()].sort();

  // Longest run of consecutive days with at least one job.
  let streak = 0;
  let best = 0;
  let previous: number | null = null;
  for (const date of sortedDates) {
    const day = Date.parse(`${date}T00:00:00Z`) / 86_400_000;
    streak = previous !== null && day - previous === 1 ? streak + 1 : 1;
    previous = day;
    best = Math.max(best, streak);
  }

  const times = inYear.map((r) => Date.parse(r.createdAt)).filter((t) => Number.isFinite(t)).sort((a, b) => a - b);
  return {
    year,
    totalRuns: inYear.length,
    successfulRuns: successful,
    distinctTools: byTool.size,
    topTools: top(byTool, (toolId, runs) => ({ toolId, name: getTool(toolId)?.name ?? toolId, runs }), 5),
    topCategories: top(
      byCategory,
      (category, runs) => ({ category, name: CATEGORIES.find((c) => c.id === category)?.name ?? category, runs }),
      5,
    ),
    busiestMonth: inYear.length > 0 ? { month: MONTHS[bestMonthIndex]!, runs: byMonth[bestMonthIndex]! } : null,
    busiestDay: dates.length > 0 ? { date: dates[0]![0], runs: dates[0]![1] } : null,
    weekdayRuns: weekday,
    weekendRuns: weekend,
    estimatedMinutesSaved: Math.round(minutes),
    longestStreakDays: best,
    firstRun: times.length > 0 ? new Date(times[0]!).toISOString() : null,
    lastRun: times.length > 0 ? new Date(times[times.length - 1]!).toISOString() : null,
  };
}

function hours(minutes: number): string {
  if (minutes < 90) return `${minutes} minutes`;
  return `${round(minutes / 60, 1)} hours`;
}

export const yearInOnestopExecutor: Executor = (input, options, ctx) =>
  runToolkitTool("year-in-onestop", async () => {
    const year = optNumber(options, "year", new Date().getUTCFullYear(), { min: 2024, max: 2100 });

    // The browser can hand in a guest's own device history as JSON, so the tool works without a
    // database too — that is the same local-first split favourites and history already use.
    const handed = optString(options, "localHistory", "") || (typeof input === "string" ? input : "");
    let runs: WrapUpRun[];
    if (handed.trim().startsWith("[")) {
      try {
        const parsed = JSON.parse(handed) as WrapUpRun[];
        runs = parsed.filter((r) => typeof r?.toolId === "string" && typeof r?.createdAt === "string");
      } catch {
        throw unsupported("That history data could not be read.");
      }
    } else {
      const prisma = getPrisma();
      if (!prisma) {
        throw unsupported(
          "Your wrap-up is built from your history, and no database is configured on this OneStop. Sign in on a OneStop with Postgres, or run this from the History page so your on-device history can be used.",
        );
      }
      if (!ctx?.userId) throw unsupported("Sign in to see your own OneStop year.");
      const rows = (await prisma.job.findMany({
        where: {
          userId: ctx.userId,
          createdAt: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) },
        },
        select: { toolId: true, createdAt: true, status: true },
        take: 50_000,
      })) as { toolId: string; createdAt: Date; status: string }[];
      runs = rows.map((r) => ({ toolId: r.toolId, createdAt: r.createdAt.toISOString(), status: r.status }));
    }

    const wrap = summariseYear(runs, year);
    if (wrap.totalRuns === 0) {
      return {
        ok: true,
        output: { ...wrap, result: "no runs yet" },
        summary: `Nothing recorded for ${year} yet — run a few tools and come back.`,
        files: [],
      };
    }
    const headline = wrap.topTools[0]!;
    const category = wrap.topCategories[0]!;
    return {
      ok: true,
      output: { ...wrap, result: `${wrap.totalRuns} runs in ${year}` },
      summary: `In ${year} you ran ${plural(wrap.totalRuns, "job")} across ${plural(wrap.distinctTools, "tool")}. Your favourite was ${headline.name} (${plural(headline.runs, "run")}), mostly ${category.name}. Busiest month: ${wrap.busiestMonth?.month}. That is roughly ${hours(wrap.estimatedMinutesSaved)} of manual work you did not have to do.`,
      files: [],
    };
  });
