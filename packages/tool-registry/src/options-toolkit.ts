// Options for the five toolkit categories added in 21-roadmap-expansion.md: Security & Privacy,
// Finance & Math, Education & Reference, Calendar & Time and Fun & Personal.
//
// Defaults are chosen so every one of these tools does something sensible the moment the page
// opens — a loan calculator with no numbers in it is not much use as a demonstration of itself.
import type { SelectOption, ToolOption } from "./options";

function choice(value: string, label: string) {
  return { value, label };
}

const packaging: SelectOption = {
  id: "packaging",
  type: "select",
  label: "Deliver as",
  default: "zip",
  choices: [choice("zip", "One ZIP archive"), choice("files", "Separate downloads")],
  help: "Only applies when there is more than one result.",
};

const currency: ToolOption = {
  id: "currency",
  type: "text",
  label: "Currency symbol or code",
  default: "",
  placeholder: "$, £, USD…",
  help: "Cosmetic only — it is printed beside the numbers, never used to convert them.",
};

export const TOOLKIT_TOOL_OPTIONS: Record<string, ToolOption[]> = {
  // ---- Security & Privacy ---------------------------------------------------------------------
  "password-strength-meter": [
    {
      id: "note",
      type: "boolean",
      label: "Show the reasoning behind the score",
      default: true,
      help: "Lists which patterns lowered the score, so the result is arguable rather than a black box.",
    },
  ],
  "totp-code-generator": [
    {
      id: "mode",
      type: "select",
      label: "What to do",
      default: "generate",
      choices: [
        choice("generate", "Show the current code"),
        choice("verify", "Check a code from my app"),
        choice("new-secret", "Create a new secret"),
      ],
    },
    {
      id: "code",
      type: "text",
      label: "Code to check",
      default: "",
      placeholder: "123456",
      showWhen: { option: "mode", equals: ["verify"] },
    },
    {
      id: "window",
      type: "number",
      label: "Allowed clock drift",
      default: 1,
      min: 0,
      max: 5,
      unit: "steps",
      showWhen: { option: "mode", equals: ["verify"] },
      help: "How many 30-second steps either side of now still count as valid.",
    },
    {
      id: "label",
      type: "text",
      label: "Account label",
      default: "OneStop",
      showWhen: { option: "mode", equals: ["new-secret"] },
    },
    { id: "digits", type: "number", label: "Code length", default: 6, min: 6, max: 8, unit: "digits" },
    { id: "step", type: "number", label: "Step", default: 30, min: 15, max: 120, unit: "seconds" },
    {
      id: "algorithm",
      type: "select",
      label: "Hash",
      default: "sha1",
      choices: [choice("sha1", "SHA-1 (what almost every app uses)"), choice("sha256", "SHA-256"), choice("sha512", "SHA-512")],
    },
  ],
  "diceware-passphrase-generator": [
    { id: "words", type: "number", label: "Words", default: 5, min: 3, max: 12 },
    { id: "count", type: "number", label: "How many to generate", default: 5, min: 1, max: 50 },
    {
      id: "separator",
      type: "select",
      label: "Join words with",
      default: "dash",
      choices: [choice("dash", "Hyphens"), choice("space", "Spaces"), choice("dot", "Dots"), choice("none", "Nothing")],
    },
    { id: "capitalize", type: "boolean", label: "Capitalise each word", default: false },
    { id: "digit", type: "boolean", label: "Add a two-digit number", default: false },
  ],
  "file-encryptor": [
    {
      id: "password",
      type: "text",
      label: "Password",
      default: "",
      secret: true,
      help: "AES-256-GCM with a PBKDF2 key. OneStop never stores this — if you lose it, the file is gone.",
    },
    packaging,
  ],
  "file-decryptor": [
    { id: "password", type: "text", label: "Password", default: "", secret: true },
    packaging,
  ],
  "breach-check": [
    {
      id: "note",
      type: "boolean",
      label: "I understand only a hash prefix is sent",
      default: true,
      help: "Five characters of the password's SHA-1 hash go to the breach database. The password itself never leaves this machine.",
    },
  ],

  // ---- Finance & Math -------------------------------------------------------------------------
  "loan-calculator": [
    { id: "principal", type: "number", label: "Amount borrowed", default: 250000, min: 1, max: 1000000000, step: 1000 },
    { id: "rate", type: "number", label: "Interest rate", default: 6.5, min: 0, max: 100, step: 0.05, unit: "% per year" },
    { id: "years", type: "number", label: "Term", default: 25, min: 1, max: 60, unit: "years" },
    {
      id: "frequency",
      type: "select",
      label: "Payments",
      default: "monthly",
      choices: [
        choice("monthly", "Monthly"),
        choice("fortnightly", "Fortnightly"),
        choice("weekly", "Weekly"),
        choice("quarterly", "Quarterly"),
        choice("yearly", "Yearly"),
      ],
    },
    currency,
  ],
  "compound-interest-calculator": [
    { id: "initial", type: "number", label: "Starting amount", default: 1000, min: 0, max: 1000000000, step: 100 },
    { id: "monthly", type: "number", label: "Added each month", default: 200, min: 0, max: 10000000, step: 50 },
    { id: "rate", type: "number", label: "Growth rate", default: 7, min: -50, max: 100, step: 0.1, unit: "% per year" },
    { id: "years", type: "number", label: "For", default: 20, min: 1, max: 80, unit: "years" },
    {
      id: "compounding",
      type: "select",
      label: "Compounded",
      default: "monthly",
      choices: [choice("monthly", "Monthly"), choice("quarterly", "Quarterly"), choice("yearly", "Yearly"), choice("daily", "Daily")],
    },
    currency,
  ],
  "tip-splitter": [
    { id: "bill", type: "number", label: "Bill total", default: 100, min: 0, max: 10000000, step: 1 },
    { id: "tipPercent", type: "number", label: "Tip", default: 15, min: 0, max: 100, step: 1, unit: "%" },
    { id: "people", type: "number", label: "Split between", default: 2, min: 1, max: 200, unit: "people" },
    {
      id: "rounding",
      type: "select",
      label: "Round each share",
      default: "none",
      choices: [choice("none", "Exactly"), choice("nearest", "To the nearest whole"), choice("up", "Up to the next whole")],
    },
    currency,
  ],
  "currency-converter": [
    { id: "from", type: "text", label: "From", default: "USD", placeholder: "USD" },
    { id: "to", type: "text", label: "To", default: "EUR", placeholder: "EUR" },
    { id: "amount", type: "number", label: "Amount", default: 1, min: -1000000000, max: 1000000000, step: 1 },
  ],
  "invoice-generator": [
    {
      id: "items",
      type: "text",
      label: "Line items",
      default: "Design work | 3 | 450\nHosting (annual) | 1 | 120",
      multiline: true,
      help: "One per line: description | quantity | unit price.",
    },
    { id: "number", type: "text", label: "Invoice number", default: "", placeholder: "INV-20260401" },
    { id: "from", type: "text", label: "From", default: "", placeholder: "Your name or business" },
    { id: "to", type: "text", label: "Bill to", default: "", placeholder: "Client name" },
    { id: "taxPercent", type: "number", label: "Tax", default: 0, min: 0, max: 100, step: 0.5, unit: "%" },
    { id: "dueDays", type: "number", label: "Due in", default: 14, min: 0, max: 365, unit: "days" },
    { id: "currency", type: "text", label: "Currency", default: "USD", placeholder: "USD" },
    { id: "notes", type: "text", label: "Notes", default: "", multiline: true, placeholder: "Payment details, thanks, terms…" },
    {
      id: "format",
      type: "select",
      label: "Download as",
      default: "pdf",
      choices: [choice("pdf", "PDF"), choice("docx", "Word"), choice("both", "Both")],
    },
  ],

  // ---- Education & Reference ------------------------------------------------------------------
  "flashcard-maker": [
    { id: "title", type: "text", label: "Title", default: "Flashcards" },
    { id: "shuffle", type: "boolean", label: "Shuffle the order", default: false },
    {
      id: "printBacks",
      type: "boolean",
      label: "Include answer sheets in the printable file",
      default: true,
      help: "Print double-sided so each answer lands behind its question.",
    },
  ],
  "typing-speed-test": [
    {
      id: "passage",
      type: "text",
      label: "Passage",
      default: "",
      multiline: true,
      placeholder: "Leave blank to be given one",
    },
    {
      id: "seconds",
      type: "number",
      label: "Seconds taken",
      default: 0,
      min: 0,
      max: 3600,
      help: "The page fills this in for you when you run the test.",
    },
  ],

  // ---- Calendar & Time ------------------------------------------------------------------------
  "world-clock-converter": [
    {
      id: "fromZone",
      type: "text",
      label: "The time you entered is in",
      default: "UTC",
      placeholder: "Europe/London",
      help: "An IANA zone name. Leave the box above blank to use right now instead.",
    },
    {
      id: "zones",
      type: "text",
      label: "Show these zones",
      default: "",
      multiline: true,
      placeholder: "One per line — blank for a sensible spread",
    },
    { id: "timeZone", type: "client", source: "timeZone", label: "Your time zone", default: "", visible: true },
  ],
  "calendar-event-generator": [
    { id: "title", type: "text", label: "Event title", default: "", placeholder: "Project kick-off" },
    { id: "start", type: "text", label: "Starts", default: "", placeholder: "2026-03-14 15:00" },
    { id: "durationMinutes", type: "number", label: "Lasts", default: 60, min: 5, max: 10080, unit: "minutes" },
    { id: "allDay", type: "boolean", label: "All-day event", default: false },
    { id: "location", type: "text", label: "Location", default: "", placeholder: "Room 2, or a meeting link" },
    { id: "description", type: "text", label: "Description", default: "", multiline: true },
    { id: "url", type: "text", label: "Link", default: "", placeholder: "https://…" },
    { id: "organizer", type: "text", label: "Organiser email", default: "" },
    { id: "attendees", type: "text", label: "Attendee emails", default: "", multiline: true, placeholder: "One per line" },
    { id: "reminderMinutes", type: "number", label: "Remind me", default: 10, min: 0, max: 10080, unit: "minutes before" },
    {
      id: "repeat",
      type: "select",
      label: "Repeats",
      default: "none",
      choices: [
        choice("none", "Does not repeat"),
        choice("daily", "Daily"),
        choice("weekly", "Weekly"),
        choice("monthly", "Monthly"),
        choice("yearly", "Yearly"),
      ],
    },
  ],
  "countdown-page-generator": [
    { id: "title", type: "text", label: "Title", default: "", placeholder: "Launch day" },
    { id: "target", type: "text", label: "Counting down to", default: "", placeholder: "2026-12-31 23:59" },
    { id: "message", type: "text", label: "Message", default: "", multiline: true },
  ],

  // ---- Fun & Personal -------------------------------------------------------------------------
  "decision-maker": [
    {
      id: "mode",
      type: "select",
      label: "What to do",
      default: "pick",
      choices: [
        choice("pick", "Pick one at random"),
        choice("shuffle", "Shuffle the whole list"),
        choice("teams", "Split into teams"),
        choice("dice", "Roll dice"),
        choice("coin", "Flip a coin"),
      ],
    },
    { id: "pick", type: "number", label: "How many to pick", default: 1, min: 1, max: 100, showWhen: { option: "mode", equals: ["pick"] } },
    {
      id: "allowRepeats",
      type: "boolean",
      label: "Allow the same option twice",
      default: false,
      showWhen: { option: "mode", equals: ["pick"] },
    },
    { id: "teams", type: "number", label: "Teams", default: 2, min: 1, max: 50, showWhen: { option: "mode", equals: ["teams"] } },
    { id: "dice", type: "number", label: "Dice", default: 2, min: 1, max: 100, showWhen: { option: "mode", equals: ["dice"] } },
    { id: "sides", type: "number", label: "Sides each", default: 6, min: 2, max: 1000, showWhen: { option: "mode", equals: ["dice"] } },
    { id: "count", type: "number", label: "Flips", default: 1, min: 1, max: 1000, showWhen: { option: "mode", equals: ["coin"] } },
  ],
  "year-in-onestop": [
    { id: "year", type: "number", label: "Year", default: new Date().getUTCFullYear(), min: 2024, max: 2100 },
    {
      id: "localHistory",
      type: "client",
      source: "localHistory",
      label: "On-device history",
      default: "",
      visible: false,
      help: "Used only when no database is configured, so a guest's own wrap-up still works.",
    },
  ],
};
