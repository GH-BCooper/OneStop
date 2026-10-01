// Cron Expression Builder/Explainer (21-roadmap-expansion.md, roadmap §1.8).
//
// A self-contained five-field cron parser: it explains an expression in plain English and works out
// the next runs by walking minutes forward from "now", which is small, obviously correct and cannot
// loop forever (the walk is bounded). The automation scheduler in `apps/api/src/automation/` does
// its own cadence maths for fixed intervals; this is the general case, for people writing crontabs.
import type { Executor } from "@onestop/tool-registry";
import {
  MIME,
  optNumber,
  optString,
  requireText,
  runUtilTool,
  textFile,
  unsupported,
} from "./common.ts";

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

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_ALIASES = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];
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

function parseField(
  raw: string,
  name: string,
  min: number,
  max: number,
  aliases: string[] = [],
): CronField {
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
    if (!Number.isInteger(step) || step < 1)
      throw unsupported(`"${part}" has an invalid step in the ${name} field.`);
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
  const text = (CRON_MACROS[expression.trim().toLowerCase()] ?? expression)
    .trim()
    .replace(/\s+/g, " ");
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

function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** `*`/N style: evenly spaced, starting at the field's minimum, more than two hits. */
function evenStep(field: CronField): number {
  const { values } = field;
  if (values.length < 3 || values[0] !== field.min) return 0;
  const step = values[1]! - values[0]!;
  return step > 1 && values.every((v, i) => i === 0 || v - values[i - 1]! === step) ? step : 0;
}

/** True when the values are one unbroken run (1-5), so they read as "1 through 5". */
function isRun(values: number[]): boolean {
  return values.length >= 3 && values.every((v, i) => i === 0 || v - values[i - 1]! === 1);
}

/** "Monday through Friday", "January and July", "3, 9 and 15" - whichever reads best. */
function describeValues(values: number[], label: (v: number) => string): string {
  if (isRun(values)) return `${label(values[0]!)} through ${label(values[values.length - 1]!)}`;
  return joinList(values.map(label));
}

const pad2 = (n: number) => String(n).padStart(2, "0");

function hourPhrase(hour: CronField): string {
  if (hour.any) return "";
  const step = evenStep(hour);
  if (step) return `every ${step} hours`;
  if (isRun(hour.values))
    return `between ${pad2(hour.values[0]!)}:00 and ${pad2(hour.values[hour.values.length - 1]!)}:59`;
  return `during hour ${joinList(hour.values.map(String))}`;
}

export function explainCron(spec: CronSpec): string {
  const { minute, hour } = spec;
  const bits: string[] = [];
  const minuteStep = evenStep(minute);
  if (minute.any && hour.any) bits.push("Every minute");
  else if (minute.any) bits.push(`Every minute, ${hourPhrase(hour)}`);
  else if (minuteStep)
    bits.push(
      hour.any ? `Every ${minuteStep} minutes` : `Every ${minuteStep} minutes, ${hourPhrase(hour)}`,
    );
  else if (minute.values.length * hour.values.length <= 6 && !hour.any) {
    const times = hour.values.flatMap((h) => minute.values.map((m) => `${pad2(h)}:${pad2(m)}`));
    bits.push(`At ${joinList(times)}`);
  } else {
    const at =
      minute.values.length === 1 && minute.values[0] === 0 && hour.any
        ? "At the start of every hour"
        : `At minute${minute.values.length > 1 ? "s" : ""} ${joinList(minute.values.map(String))}${hour.any || isRun(hour.values) ? " past every hour" : ""}`;
    bits.push(hour.any ? at : `${at}, ${hourPhrase(hour)}`);
  }

  if (!spec.dayOfWeek.any)
    bits.push(`on ${describeValues(spec.dayOfWeek.values, (v) => DAY_NAMES[v] ?? String(v))}`);
  if (!spec.dayOfMonth.any) {
    const step = evenStep(spec.dayOfMonth);
    const days = spec.dayOfMonth.values;
    bits.push(
      step
        ? `on every ${step}${step === 2 ? "nd" : step === 3 ? "rd" : "th"} day of the month`
        : `on day${days.length > 1 ? "s" : ""} ${describeValues(days, String)} of the month`,
    );
  }
  if (!spec.month.any) {
    const step = evenStep(spec.month);
    bits.push(
      step
        ? `in every ${step === 2 ? "second" : step === 3 ? "third" : step + "th"} month`
        : `in ${describeValues(spec.month.values, (v) => MONTH_NAMES[v - 1] ?? String(v))}`,
    );
  }
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
          : spec.dayOfMonth.values.includes(date.getUTCDate()) ||
            spec.dayOfWeek.values.includes(date.getUTCDay());
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
    const raw =
      typeof input === "string" && input.trim() !== ""
        ? input
        : optString(options, "expression", "");
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
          JSON.stringify(
            {
              expression: expression.trim(),
              normalised,
              explanation,
              nextRuns: runs.map((d) => d.toISOString()),
            },
            null,
            2,
          ) + "\n",
        ),
      ],
    };
  });
