// Cron Expression Builder/Explainer (21-roadmap-expansion.md, roadmap §1.8).
//
// A self-contained five-field cron parser: it explains an expression in plain English and works out
// the next runs by walking minutes forward from "now", which is small, obviously correct and cannot
// loop forever (the walk is bounded). The automation scheduler in `apps/api/src/automation/` does
// its own cadence maths for fixed intervals; this is the general case, for people writing crontabs.
import type { Executor } from "@onestop/tool-registry";
import { MIME, optNumber, optString, requireText, runUtilTool, textFile, unsupported } from "./common.ts";

export interface CronField {
  name: string;
  min: number;
  max: number;
  values: number[];
  /** True when the field matches everything ("*"). */
  any: boolean;
}

export interface CronSpec {
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  dayOfWeek: CronField;
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_ALIASES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DAY_ALIASES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** The shorthands every cron implementation understands. */
export const CRON_MACROS: Record<string, string> = {
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
  "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@hourly": "0 * * * *",
};

function parseField(raw: string, name: string, min: number, max: number, aliases: string[] = []): CronField {
  const text = raw.trim().toLowerCase();
  if (text === "") throw unsupported(`The ${name} field is empty.`);
  const values = new Set<number>();
  const resolve = (token: string): number => {
    const aliasIndex = aliases.indexOf(token.slice(0, 3));
    const n = aliasIndex >= 0 ? aliasIndex + (name === "month" ? 1 : 0) : Number(token);
    if (!Number.isInteger(n) || n < min || n > max) {
      // Sunday is both 0 and 7 in every real cron, so accept it rather than being pedantic.
      if (name === "day of week" && n === 7) return 0;
      throw unsupported(`"${token}" is not a valid ${name} (${min}-${max}).`);
    }
    return n;
  };
  for (const part of text.split(",")) {
    const [range, stepText] = part.split("/");
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) throw unsupported(`"${part}" has an invalid step in the ${name} field.`);
    let from = min;
    let to = max;
    if (range !== "*" && range !== "?") {
      const [a, b] = range!.split("-");
      from = resolve(a!);
      to = b === undefined ? (stepText === undefined ? from : max) : resolve(b);
      if (to < from) throw unsupported(`"${part}" counts backwards in the ${name} field.`);
    }
    for (let v = from; v <= to; v += step) values.add(v);
  }
  if (values.size === 0) throw unsupported(`The ${name} field matches nothing.`);
  const list = [...values].sort((a, b) => a - b);
  return { name, min, max, values: list, any: list.length === max - min + 1 };
}

export function parseCron(expression: string): CronSpec {
  const text = (CRON_MACROS[expression.trim().toLowerCase()] ?? expression).trim().replace(/\s+/g, " ");
  const parts = text.split(" ");
  if (parts.length === 6) parts.shift(); // tolerate a leading seconds field (Quartz/node-cron style)
  if (parts.length !== 5) {
    throw unsupported(
      "A cron expression has five fields: minute hour day-of-month month day-of-week. For example 30 6 * * 1-5.",
    );
  }
  return {
    minute: parseField(parts[0]!, "minute", 0, 59),
    hour: parseField(parts[1]!, "hour", 0, 23),
    dayOfMonth: parseField(parts[2]!, "day of month", 1, 31),
    month: parseField(parts[3]!, "month", 1, 12, MONTH_ALIASES),
    dayOfWeek: parseField(parts[4]!, "day of week", 0, 6, DAY_ALIASES),
  };
}

function listNames(values: number[], names: string[], offset = 0): string {
  const parts = values.map((v) => names[v - offset] ?? String(v));
  if (parts.length === 1) return parts[0]!;
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function everyOrList(field: CronField, unit: string): string {
  if (field.any) return `every ${unit}`;
  const step = field.values.length > 2 ? field.values[1]! - field.values[0]! : 0;
  const even = step > 1 && field.values.every((v, i) => i === 0 || v - field.values[i - 1]! === step);
  if (even && field.values[0] === field.min) return `every ${step} ${unit}s`;
  return `${unit} ${field.values.join(", ")}`;
}

export function explainCron(spec: CronSpec): string {
  const bits: string[] = [];
  if (spec.minute.any && spec.hour.any) bits.push("Every minute");
  else if (spec.minute.values.length === 1 && spec.hour.any) {
    bits.push(`At ${spec.minute.values[0]} minutes past every hour`);
  } else if (spec.minute.values.length === 1 && spec.hour.values.length <= 4) {
    const times = spec.hour.values.map((h) => `${String(h).padStart(2, "0")}:${String(spec.minute.values[0]).padStart(2, "0")}`);
    bits.push(`At ${listNames(times.map((_, i) => i), times)}`);
  } else {
    bits.push(`At ${everyOrList(spec.minute, "minute")}, ${everyOrList(spec.hour, "hour")}`);
  }

  if (!spec.dayOfWeek.any) bits.push(`on ${listNames(spec.dayOfWeek.values, DAY_NAMES)}`);
  if (!spec.dayOfMonth.any) bits.push(`on day ${spec.dayOfMonth.values.join(", ")} of the month`);
  if (!spec.month.any) bits.push(`in ${listNames(spec.month.values, MONTH_NAMES, 1)}`);
  if (!spec.dayOfWeek.any && !spec.dayOfMonth.any) {
    // POSIX cron ORs the two day fields when both are restricted — a classic trap worth naming.
    bits.push("(cron treats the two day fields as *or*, so it runs when either matches)");
  }
  return `${bits.join(" ")}.`;
}

function matches(spec: CronSpec, date: Date): boolean {
  const dayOk =
    spec.dayOfMonth.any && spec.dayOfWeek.any
      ? true
      : spec.dayOfMonth.any
        ? spec.dayOfWeek.values.includes(date.getUTCDay())
        : spec.dayOfWeek.any
          ? spec.dayOfMonth.values.includes(date.getUTCDate())
          : spec.dayOfMonth.values.includes(date.getUTCDate()) || spec.dayOfWeek.values.includes(date.getUTCDay());
  return (
    spec.minute.values.includes(date.getUTCMinutes()) &&
    spec.hour.values.includes(date.getUTCHours()) &&
    spec.month.values.includes(date.getUTCMonth() + 1) &&
    dayOk
  );
}

/** The next `count` matching times at or after `from`, in UTC. Bounded so it always terminates. */
export function nextRuns(spec: CronSpec, from: Date, count: number): Date[] {
  const out: Date[] = [];
  const cursor = new Date(Math.ceil(from.getTime() / 60_000) * 60_000);
  // Four years of minutes is more than enough for any five-field expression that matches at all.
  const limit = 4 * 366 * 24 * 60;
  for (let i = 0; i < limit && out.length < count; i += 1) {
    if (matches(spec, cursor)) out.push(new Date(cursor));
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }
  return out;
}

export const cronBuilderExecutor: Executor = (input, options) =>
  runUtilTool("cron-expression-builder", async () => {
    const raw = typeof input === "string" && input.trim() !== "" ? input : optString(options, "expression", "");
    const expression = requireText(raw, "a cron expression, like 30 6 * * 1-5");
    const spec = parseCron(expression);
    const count = optNumber(options, "runs", 5, { min: 1, max: 50 });
    const runs = nextRuns(spec, new Date(), count);
    const explanation = explainCron(spec);
    const normalised = [
      spec.minute.any ? "*" : spec.minute.values.join(","),
      spec.hour.any ? "*" : spec.hour.values.join(","),
      spec.dayOfMonth.any ? "*" : spec.dayOfMonth.values.join(","),
      spec.month.any ? "*" : spec.month.values.join(","),
      spec.dayOfWeek.any ? "*" : spec.dayOfWeek.values.join(","),
    ].join(" ");
    return {
      ok: true,
      output: {
        expression: expression.trim(),
        normalised,
        explanation,
        nextRuns: runs.map((d) => d.toISOString()),
        result: explanation,
      },
      summary: `${explanation}${runs.length > 0 ? ` Next run: ${runs[0]!.toISOString().replace("T", " ").slice(0, 16)} UTC.` : " It never matches a real date."}`,
      files: [
        textFile(
          "cron.json",
          MIME.json,
          JSON.stringify({ expression: expression.trim(), normalised, explanation, nextRuns: runs.map((d) => d.toISOString()) }, null, 2) + "\n",
        ),
      ],
    };
  });
