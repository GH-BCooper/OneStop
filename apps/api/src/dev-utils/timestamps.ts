// Timestamp conversion (12-dev-utility-tools.md §12.18).
//
// One box, both directions: paste a Unix timestamp and get readable dates, paste a date and get
// the timestamp. Seconds and milliseconds are told apart by magnitude (a 10-digit value is
// seconds, a 13-digit one milliseconds), and "now" is accepted because that is what half the
// uses of this tool actually are.
//
// The user's own time zone arrives as a `client` option filled in by the browser (the executor
// runs on the server, which may be anywhere); when it is missing, UTC is used and the summary
// says so.
import type { Executor } from "@onestop/tool-registry";
import {
  MIME,
  optEnum,
  optString,
  requireText,
  runUtilTool,
  textFile,
  unsupported,
} from "./common.ts";

export type TimestampUnit = "auto" | "seconds" | "milliseconds";

export interface ParsedTimestamp {
  date: Date;
  /** How the input was read, for the summary. */
  interpretation: string;
}

const NUMERIC = /^-?\d{1,19}(\.\d+)?$/;

export function parseTimestampInput(raw: string, unit: TimestampUnit = "auto"): ParsedTimestamp {
  const text = raw.trim();
  if (text === "") throw unsupported("Enter a timestamp or a date first.");
  if (/^now$/i.test(text)) return { date: new Date(), interpretation: "the current time" };

  if (NUMERIC.test(text)) {
    const value = Number(text);
    if (!Number.isFinite(value)) throw unsupported("That number is too large to be a timestamp.");
    const digits = text.replace(/[^0-9]/g, "").length;
    const resolved =
      unit === "seconds"
        ? { ms: value * 1000, label: "seconds" }
        : unit === "milliseconds"
          ? { ms: value, label: "milliseconds" }
          : digits >= 16
            ? { ms: value / 1000, label: "microseconds" }
            : digits >= 12
              ? { ms: value, label: "milliseconds" }
              : { ms: value * 1000, label: "seconds" };
    const date = new Date(resolved.ms);
    if (Number.isNaN(date.getTime())) {
      throw unsupported("That is not a timestamp any calendar can represent.");
    }
    return { date, interpretation: `Unix time in ${resolved.label}` };
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    throw unsupported(
      "That is not a timestamp or a date OneStop recognises. Try 1700000000, 2023-11-14T22:13:20Z or “now”.",
    );
  }
  return { date: parsed, interpretation: "a calendar date" };
}

export interface TimestampViews {
  unixSeconds: number;
  unixMilliseconds: number;
  iso8601: string;
  utc: string;
  local: string;
  timeZone: string;
  rfc2822: string;
  dayOfWeek: string;
  relative: string;
  /** Excel/Sheets serial number, because spreadsheets are where these values usually end up. */
  excelSerial: number;
}

export function relativeTo(date: Date, now = new Date()): string {
  const diff = date.getTime() - now.getTime();
  const abs = Math.abs(diff);
  const units: [number, string][] = [
    [1000, "second"],
    [60_000, "minute"],
    [3_600_000, "hour"],
    [86_400_000, "day"],
    [2_629_800_000, "month"],
    [31_557_600_000, "year"],
  ];
  if (abs < 1000) return "just now";
  let chosen = units[0]!;
  for (const unit of units) if (abs >= unit[0]) chosen = unit;
  const n = Math.round(abs / chosen[0]);
  const label = `${n} ${chosen[1]}${n === 1 ? "" : "s"}`;
  return diff < 0 ? `${label} ago` : `in ${label}`;
}

function formatIn(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      dateStyle: "full",
      timeStyle: "long",
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

export function timestampViews(date: Date, timeZone: string, now = new Date()): TimestampViews {
  const ms = date.getTime();
  return {
    unixSeconds: Math.floor(ms / 1000),
    unixMilliseconds: ms,
    iso8601: date.toISOString(),
    utc: formatIn(date, "UTC"),
    local: formatIn(date, timeZone),
    timeZone,
    rfc2822: date.toUTCString(),
    dayOfWeek: new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long" }).format(date),
    relative: relativeTo(date, now),
    // Excel's epoch is 1899-12-30 (its 1900 leap-year bug included).
    excelSerial: Math.round((ms / 86_400_000 + 25_569) * 1e6) / 1e6,
  };
}

function validTimeZone(candidate: string): string {
  if (candidate === "") return "UTC";
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: candidate });
    return candidate;
  } catch {
    return "UTC";
  }
}

export const timestampConverterExecutor: Executor = (input, options) =>
  runUtilTool("timestamp-converter", async () => {
    const raw = requireText(input, "a timestamp, a date or “now”");
    const unit = optEnum(options, "unit", ["auto", "seconds", "milliseconds"] as const, "auto");
    const timeZone = validTimeZone(optString(options, "timeZone", ""));
    const { date, interpretation } = parseTimestampInput(raw, unit);
    const views = timestampViews(date, timeZone);
    const lines = Object.entries(views).map(([k, v]) => `${k}: ${v}`);
    return {
      ok: true,
      output: { input: raw.trim(), read: interpretation, ...views },
      summary: `Read "${raw.trim()}" as ${interpretation}: ${views.iso8601} (${views.relative}), shown in ${timeZone}.`,
      files: [textFile("timestamp.txt", MIME.txt, lines.join("\n") + "\n")],
    };
  });
