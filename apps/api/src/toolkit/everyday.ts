// Education & Reference, Calendar & Time, and Fun & Personal (21-roadmap-expansion.md, roadmap
// §1.10). Every tool in this file is pure computation with no network and no new dependency; the
// only platform features leaned on are `Intl` (time zones) and `node:crypto` (fair randomness).
import { randomInt } from "node:crypto";
import type { Executor } from "@onestop/tool-registry";
import type { OutputFile } from "@onestop/types";
import {
  MIME,
  csvFile,
  optBool,
  optEnum,
  optNumber,
  optString,
  plural,
  requireText,
  round,
  runToolkitTool,
  textFile,
  unsupported,
} from "./common.ts";

// ---- flashcard maker --------------------------------------------------------------------------

export interface Flashcard {
  front: string;
  back: string;
}

/** Accepts "Q | A" per line, "Q -- A", a two-column CSV, or Q and A on alternating lines. */
export function parseFlashcards(text: string): Flashcard[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "");
  if (lines.length === 0) throw unsupported('Add some cards, one per line, like "Question | Answer".');
  const delimited = lines.filter((l) => /\s\|\s|\t|\s--\s/.test(l));
  if (delimited.length >= Math.max(1, Math.floor(lines.length / 2))) {
    return delimited.map((line) => {
      const [front, ...rest] = line.split(/\s*(?:\||\t|--)\s*/);
      return { front: front!.trim(), back: rest.join(" ").trim() };
    });
  }
  if (lines.length % 2 !== 0) {
    throw unsupported('Use "Question | Answer" on each line, or an even number of lines (question, answer, question, answer…).');
  }
  const cards: Flashcard[] = [];
  for (let i = 0; i < lines.length; i += 2) cards.push({ front: lines[i]!, back: lines[i + 1]! });
  return cards;
}

/** A print sheet: eight cards a page, cut lines included, no dependency but string building. */
export function flashcardHtml(cards: Flashcard[], title: string, showBacks: boolean): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const cell = (c: Flashcard, side: "front" | "back") =>
    `<div class="card"><span class="side">${side === "front" ? "Q" : "A"}</span><p>${esc(side === "front" ? c.front : c.back)}</p></div>`;
  const pages: string[] = [];
  for (let i = 0; i < cards.length; i += 8) {
    const slice = cards.slice(i, i + 8);
    pages.push(`<section class="sheet">${slice.map((c) => cell(c, "front")).join("")}</section>`);
    if (showBacks) {
      pages.push(`<section class="sheet">${slice.map((c) => cell(c, "back")).join("")}</section>`);
    }
  }
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  @page { size: A4; margin: 10mm; }
  body { font: 16px/1.4 system-ui, sans-serif; margin: 0; color: #111; background: #fff; }
  .sheet { display: grid; grid-template-columns: 1fr 1fr; grid-auto-rows: 1fr; gap: 0; height: 277mm; page-break-after: always; }
  .card { border: 1px dashed #999; padding: 10mm; display: flex; flex-direction: column; justify-content: center; }
  .card p { margin: 0; font-size: 18px; }
  .side { font-size: 11px; letter-spacing: .08em; color: #888; margin-bottom: 6mm; }
  @media screen { body { padding: 16px; } .sheet { height: auto; } }
</style></head><body>${pages.join("")}</body></html>`;
}

export const flashcardMakerExecutor: Executor = (input, options) =>
  runToolkitTool("flashcard-maker", async () => {
    const cards = parseFlashcards(requireText(input, "your questions and answers"));
    const shuffle = optBool(options, "shuffle", false);
    const showBacks = optBool(options, "printBacks", true);
    const title = optString(options, "title", "Flashcards") || "Flashcards";
    const ordered = shuffle ? [...cards] : cards;
    if (shuffle) {
      for (let i = ordered.length - 1; i > 0; i -= 1) {
        const j = randomInt(i + 1);
        [ordered[i], ordered[j]] = [ordered[j]!, ordered[i]!];
      }
    }
    const files: OutputFile[] = [
      csvFile("flashcards.csv", [["Front", "Back"], ...ordered.map((c) => [c.front, c.back])]),
      textFile("flashcards-print.html", MIME.html, flashcardHtml(ordered, title, showBacks)),
    ];
    return {
      ok: true,
      output: { cards: ordered, count: ordered.length, result: `${ordered.length} cards` },
      summary: `Made ${plural(ordered.length, "flashcard")}. The CSV imports straight into Anki or Quizlet; the HTML file prints two-up for cutting out.`,
      files,
    };
  });

// ---- typing speed test ------------------------------------------------------------------------

/**
 * The test itself runs in the browser (it has to — it is measuring keystrokes), and this executor
 * scores the result it reports. Words-per-minute is the standard five-characters-to-a-word measure,
 * so a result here is comparable with every other typing test.
 */
export function scoreTyping(typed: string, target: string, seconds: number): {
  wpm: number;
  accuracy: number;
  correctChars: number;
  wrongChars: number;
  netWpm: number;
} {
  const minutes = Math.max(seconds, 1) / 60;
  let correct = 0;
  for (let i = 0; i < typed.length; i += 1) if (typed[i] === target[i]) correct += 1;
  const wrong = typed.length - correct;
  const gross = typed.length / 5 / minutes;
  return {
    wpm: round(gross, 1),
    accuracy: typed.length === 0 ? 0 : round((correct / typed.length) * 100, 1),
    correctChars: correct,
    wrongChars: wrong,
    netWpm: round(Math.max(0, gross - wrong / minutes / 5), 1),
  };
}

export const TYPING_PASSAGES: readonly string[] = [
  "The quick brown fox jumps over the lazy dog while the calm river carries a small paper boat past the old stone bridge.",
  "Every tool in this workshop earns its place, and the ones that do not are quietly put back in the drawer where they belong.",
  "Good software is mostly small decisions made carefully, one after another, until the whole thing feels obvious in hindsight.",
  "She packed her bag with maps and bread, locked the door behind her, and walked toward the hills before the sun was fully up.",
];

export const typingSpeedTestExecutor: Executor = (input, options) =>
  runToolkitTool("typing-speed-test", async () => {
    const target = optString(options, "passage", "") || TYPING_PASSAGES[randomInt(TYPING_PASSAGES.length)]!;
    const typed = typeof input === "string" ? input : "";
    const seconds = optNumber(options, "seconds", 0, { min: 0, max: 3600 });
    if (typed.trim() === "" || seconds <= 0) {
      // Nothing typed yet: hand the browser a passage to run the test against.
      return {
        ok: true,
        output: { passage: target, result: "ready" },
        summary: "Type the passage in the box, then run the test to score it.",
        files: [],
      };
    }
    const score = scoreTyping(typed, target, seconds);
    const band = score.netWpm < 25 ? "beginner" : score.netWpm < 45 ? "average" : score.netWpm < 70 ? "fast" : "very fast";
    return {
      ok: true,
      output: { ...score, seconds, band, result: `${score.netWpm} WPM` },
      summary: `${score.netWpm} words per minute net (${score.wpm} gross) at ${score.accuracy}% accuracy — ${band}.`,
      files: [],
    };
  });

// ---- world clock ------------------------------------------------------------------------------

export const COMMON_ZONES: readonly string[] = [
  "UTC",
  "America/Los_Angeles",
  "America/New_York",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Berlin",
  "Africa/Lagos",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland",
];

export function zoneOffsetMinutes(zone: string, at: Date): number {
  // `Intl` is the only thing in Node that knows the IANA database, and formatToParts is the
  // supported way to read a wall-clock time back out of it.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

export function formatInZone(zone: string, at: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(at);
}

function offsetLabel(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

export const worldClockExecutor: Executor = (input, options) =>
  runToolkitTool("world-clock-converter", async () => {
    const zonesText = optString(options, "zones", "");
    const zones = (zonesText.trim() === "" ? COMMON_ZONES.slice(0, 8) : zonesText.split(/[,\n]/))
      .map((z) => z.trim())
      .filter(Boolean)
      .slice(0, 24);
    const fromZone = optString(options, "fromZone", "UTC").trim() || "UTC";
    const raw = typeof input === "string" ? input.trim() : "";

    let at: Date;
    if (raw === "" || /^now$/i.test(raw)) {
      at = new Date();
    } else if (/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/.test(raw)) {
      // A bare date/time is a *wall clock* reading in `fromZone`, not UTC — that is the whole point
      // of the tool, so it has to be converted rather than parsed as an instant.
      const guess = new Date(`${raw.replace(" ", "T")}${raw.includes(":") ? "" : "T09:00"}Z`);
      if (Number.isNaN(guess.getTime())) throw unsupported(`"${raw}" is not a date and time.`);
      let candidate = guess;
      for (let i = 0; i < 3; i += 1) {
        const offset = zoneOffsetMinutes(fromZone, candidate);
        candidate = new Date(guess.getTime() - offset * 60_000);
      }
      at = candidate;
    } else {
      const parsed = new Date(raw);
      if (Number.isNaN(parsed.getTime())) {
        throw unsupported(`"${raw}" is not a date and time. Try 2026-03-14 15:00, or leave it blank for now.`);
      }
      at = parsed;
    }

    const rows = zones.map((zone) => {
      let offset: number;
      try {
        offset = zoneOffsetMinutes(zone, at);
      } catch {
        throw unsupported(`"${zone}" is not a known time zone. Use an IANA name like Europe/London.`);
      }
      return { zone, local: formatInZone(zone, at), offset: offsetLabel(offset), offsetMinutes: offset };
    });
    return {
      ok: true,
      output: { instant: at.toISOString(), fromZone, zones: rows, result: rows.map((r) => `${r.zone}: ${r.local}`).join("\n") },
      summary: `${at.toISOString().replace("T", " ").slice(0, 16)} UTC across ${plural(rows.length, "time zone")}.`,
      files: [csvFile("world-clock.csv", [["Time zone", "Local time", "UTC offset"], ...rows.map((r) => [r.zone, r.local, r.offset])])],
    };
  });

// ---- .ics calendar event ----------------------------------------------------------------------

/** RFC 5545 folds lines at 75 octets and escapes , ; \ and newlines. */
export function icsEscape(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

export function foldIcsLine(line: string): string {
  if (line.length <= 75) return line;
  const chunks = [line.slice(0, 75)];
  for (let i = 75; i < line.length; i += 74) chunks.push(` ${line.slice(i, i + 74)}`);
  return chunks.join("\r\n");
}

export interface IcsEvent {
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  location: string;
  description: string;
  url: string;
  organizer: string;
  attendees: string[];
  reminderMinutes: number;
  repeat: string;
  uid: string;
}

function icsStamp(date: Date, allDay: boolean): string {
  const iso = date.toISOString();
  return allDay ? iso.slice(0, 10).replace(/-/g, "") : `${iso.slice(0, 19).replace(/[-:]/g, "")}Z`;
}

export function buildIcs(event: IcsEvent): string {
  const dateType = event.allDay ? ";VALUE=DATE" : "";
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//OneStop//Calendar Event Generator//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${icsStamp(new Date(), false)}`,
    `DTSTART${dateType}:${icsStamp(event.start, event.allDay)}`,
    `DTEND${dateType}:${icsStamp(event.end, event.allDay)}`,
    `SUMMARY:${icsEscape(event.title)}`,
    ...(event.location ? [`LOCATION:${icsEscape(event.location)}`] : []),
    ...(event.description ? [`DESCRIPTION:${icsEscape(event.description)}`] : []),
    ...(event.url ? [`URL:${icsEscape(event.url)}`] : []),
    ...(event.organizer ? [`ORGANIZER:mailto:${event.organizer}`] : []),
    ...event.attendees.map((a) => `ATTENDEE;RSVP=TRUE:mailto:${a}`),
    ...(event.repeat !== "none" ? [`RRULE:FREQ=${event.repeat.toUpperCase()}`] : []),
    ...(event.reminderMinutes > 0
      ? [
          "BEGIN:VALARM",
          `TRIGGER:-PT${event.reminderMinutes}M`,
          "ACTION:DISPLAY",
          `DESCRIPTION:${icsEscape(event.title)}`,
          "END:VALARM",
        ]
      : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

export const calendarEventExecutor: Executor = (input, options) =>
  runToolkitTool("calendar-event-generator", async () => {
    const title = (typeof input === "string" && input.trim() !== "" ? input : optString(options, "title", "")).trim();
    if (title === "") throw unsupported("Give the event a title first.");
    const allDay = optBool(options, "allDay", false);
    const startText = optString(options, "start", "").trim();
    const start = startText === "" ? new Date(Date.now() + 3_600_000) : new Date(startText.replace(" ", "T"));
    if (Number.isNaN(start.getTime())) {
      throw unsupported(`"${startText}" is not a date and time. Use 2026-03-14 15:00.`);
    }
    const minutes = optNumber(options, "durationMinutes", 60, { min: 5, max: 10_080 });
    const end = new Date(start.getTime() + (allDay ? 86_400_000 : minutes * 60_000));
    const attendees = optString(options, "attendees", "")
      .split(/[,\s;]+/)
      .map((a) => a.trim())
      .filter(Boolean);
    const bad = attendees.find((a) => !EMAIL_RE.test(a));
    if (bad) throw unsupported(`"${bad}" is not an email address.`);
    const organizer = optString(options, "organizer", "").trim();
    if (organizer !== "" && !EMAIL_RE.test(organizer)) throw unsupported(`"${organizer}" is not an email address.`);

    const event: IcsEvent = {
      title: title.slice(0, 300),
      start,
      end,
      allDay,
      location: optString(options, "location", "").slice(0, 300),
      description: optString(options, "description", "").slice(0, 2000),
      url: optString(options, "url", "").slice(0, 500),
      organizer,
      attendees,
      reminderMinutes: optNumber(options, "reminderMinutes", 10, { min: 0, max: 10_080 }),
      repeat: optEnum(options, "repeat", ["none", "daily", "weekly", "monthly", "yearly"] as const, "none"),
      uid: `${Date.now().toString(36)}-${randomInt(1e9).toString(36)}@onestop.local`,
    };
    const ics = buildIcs(event);
    const stem = (title.replace(/[^A-Za-z0-9 -]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "event").slice(0, 60);
    return {
      ok: true,
      output: {
        title: event.title,
        start: start.toISOString(),
        end: end.toISOString(),
        attendees,
        result: ics,
      },
      summary: `Calendar invite for "${event.title}" on ${start.toISOString().replace("T", " ").slice(0, 16)} UTC${attendees.length ? `, ${plural(attendees.length, "attendee")}` : ""}. Open the .ics file to add it, or attach it to an email.`,
      files: [textFile(`${stem}.ics`, MIME.ics, ics)],
    };
  });

// ---- countdown page --------------------------------------------------------------------------

export function countdownHtml(title: string, targetIso: string, message: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  // A single self-contained file, deliberately: it can be hosted anywhere, opened from disk, or
  // pointed at by a QR code, and it keeps working with no network and no OneStop server.
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; text-align:center; padding:24px;
    font-family: ui-sans-serif, system-ui, sans-serif; color:#eef1f5;
    background:
      radial-gradient(60% 45% at 16% 6%, rgba(160,176,196,.34), transparent 70%),
      radial-gradient(45% 40% at 90% 30%, rgba(130,146,166,.3), transparent 70%),
      linear-gradient(160deg,#050506 0%,#0f1215 26%,#1e2328 44%,#08090b 60%,#171b20 80%,#050506 100%); }
  h1 { font-size: clamp(1.5rem, 5vw, 2.75rem); margin:0 0 .35em; font-weight:650; letter-spacing:-.02em;
    background:linear-gradient(100deg,#7f8d9d,#fff,#7f8d9d); -webkit-background-clip:text; background-clip:text; color:transparent; }
  p.msg { color:#a3acb8; margin:0 0 2em; max-width:44ch; }
  .clock { display:flex; gap:clamp(8px,3vw,24px); justify-content:center; flex-wrap:wrap; }
  .unit { min-width:clamp(64px,18vw,110px); padding:14px 10px; border:1px solid #2f353d; border-radius:16px;
    background:linear-gradient(150deg, rgba(255,255,255,.07), rgba(255,255,255,0)); }
  .unit b { display:block; font-size:clamp(1.6rem,7vw,2.75rem); font-variant-numeric:tabular-nums; line-height:1; }
  .unit span { font-size:.7rem; letter-spacing:.12em; text-transform:uppercase; color:#a3acb8; }
  .done { font-size:clamp(1.2rem,4vw,1.8rem); color:#4ade80; }
</style></head>
<body><main>
  <h1>${esc(title)}</h1>
  ${message ? `<p class="msg">${esc(message)}</p>` : ""}
  <div class="clock" id="clock"></div>
  <p class="done" id="done" hidden>It's time.</p>
</main>
<script>
  var target = new Date(${JSON.stringify(targetIso)}).getTime();
  var clock = document.getElementById("clock"), done = document.getElementById("done");
  function unit(value, label){ return '<div class="unit"><b>' + String(value).padStart(2,"0") + '</b><span>' + label + '</span></div>'; }
  function tick(){
    var left = target - Date.now();
    if (left <= 0) { clock.hidden = true; done.hidden = false; return; }
    var s = Math.floor(left/1000), d = Math.floor(s/86400), h = Math.floor(s%86400/3600), m = Math.floor(s%3600/60);
    clock.innerHTML = unit(d,"days") + unit(h,"hours") + unit(m,"minutes") + unit(s%60,"seconds");
  }
  tick(); setInterval(tick, 1000);
</script></body></html>`;
}

export const countdownPageExecutor: Executor = (input, options) =>
  runToolkitTool("countdown-page-generator", async () => {
    const title = ((typeof input === "string" && input.trim() !== "" ? input : optString(options, "title", "")) || "Countdown").trim();
    const targetText = optString(options, "target", "").trim();
    const target = targetText === "" ? new Date(Date.now() + 7 * 86_400_000) : new Date(targetText.replace(" ", "T"));
    if (Number.isNaN(target.getTime())) {
      throw unsupported(`"${targetText}" is not a date and time. Use 2026-12-31 23:59.`);
    }
    const message = optString(options, "message", "").slice(0, 300);
    const html = countdownHtml(title.slice(0, 120), target.toISOString(), message);
    const days = Math.round((target.getTime() - Date.now()) / 86_400_000);
    const stem = (title.replace(/[^A-Za-z0-9 -]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "countdown").slice(0, 60);
    return {
      ok: true,
      output: { title, target: target.toISOString(), daysAway: days, result: target.toISOString() },
      summary: `Countdown page to ${target.toISOString().replace("T", " ").slice(0, 16)} UTC (${days >= 0 ? `${days} days away` : "already passed"}). It is one self-contained HTML file — host it anywhere, or point a QR code at it.`,
      files: [textFile(`${stem}.html`, MIME.html, html)],
    };
  });

// ---- decision maker --------------------------------------------------------------------------

/** Fisher-Yates with the platform CSPRNG, so "random" here really is uniform. */
export function shuffled<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export function makeTeams<T>(items: readonly T[], teamCount: number): T[][] {
  const order = shuffled(items);
  const teams: T[][] = Array.from({ length: Math.max(1, teamCount) }, () => []);
  order.forEach((item, i) => teams[i % teams.length]!.push(item));
  return teams;
}

export const decisionMakerExecutor: Executor = (input, options) =>
  runToolkitTool("decision-maker", async () => {
    const mode = optEnum(options, "mode", ["pick", "shuffle", "teams", "dice", "coin"] as const, "pick");
    const items =
      typeof input === "string"
        ? input.split(/[\n,]/).map((s) => s.trim()).filter(Boolean).slice(0, 2000)
        : [];

    if (mode === "coin") {
      const count = optNumber(options, "count", 1, { min: 1, max: 1000 });
      const flips = Array.from({ length: count }, () => (randomInt(2) === 0 ? "heads" : "tails"));
      const heads = flips.filter((f) => f === "heads").length;
      return {
        ok: true,
        output: { flips, heads, tails: count - heads, result: flips.join(", ") },
        summary: count === 1 ? `${flips[0]![0]!.toUpperCase()}${flips[0]!.slice(1)}.` : `${heads} heads, ${count - heads} tails out of ${count} flips.`,
        files: [],
      };
    }

    if (mode === "dice") {
      const dice = optNumber(options, "dice", 2, { min: 1, max: 100 });
      const sides = optNumber(options, "sides", 6, { min: 2, max: 1000 });
      const rolls = Array.from({ length: dice }, () => randomInt(1, sides + 1));
      const total = rolls.reduce((a, b) => a + b, 0);
      return {
        ok: true,
        output: { rolls, total, dice, sides, result: String(total) },
        summary: `${dice}d${sides}: ${rolls.join(" + ")} = ${total}.`,
        files: [],
      };
    }

    if (items.length === 0) {
      throw unsupported("List the options first, one per line or separated by commas.");
    }

    if (mode === "teams") {
      const teamCount = optNumber(options, "teams", 2, { min: 1, max: Math.max(1, items.length) });
      const teams = makeTeams(items, teamCount);
      return {
        ok: true,
        output: { teams, result: teams.map((t, i) => `Team ${i + 1}: ${t.join(", ")}`).join("\n") },
        summary: `Split ${plural(items.length, "name")} into ${plural(teams.length, "team")}.`,
        files: [],
      };
    }

    if (mode === "shuffle") {
      const order = shuffled(items);
      return {
        ok: true,
        output: { order, result: order.join("\n") },
        summary: `Shuffled ${plural(items.length, "item")}.`,
        files: [],
      };
    }

    const pick = optNumber(options, "pick", 1, { min: 1, max: items.length });
    const allowRepeats = optBool(options, "allowRepeats", false);
    const chosen = allowRepeats
      ? Array.from({ length: pick }, () => items[randomInt(items.length)]!)
      : shuffled(items).slice(0, pick);
    return {
      ok: true,
      output: { chosen, fromCount: items.length, result: chosen.join("\n") },
      summary: pick === 1 ? `Picked "${chosen[0]}" out of ${items.length}.` : `Picked ${plural(pick, "item")} out of ${items.length}.`,
      files: [],
    };
  });
