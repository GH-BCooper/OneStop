// User-Agent Viewer (12-dev-utility-tools.md §12.20).
//
// "What am I browsing with?" — so the string has to come from the browser, not from the server
// that runs the executor. It arrives as a `client` option (a registry option type whose value the
// page fills in from `navigator`), which keeps the tool page free of per-tool knowledge.
//
// The parser is a small table of patterns rather than a downloaded device database: it stays
// offline and covers what people actually use. It is exported on its own so 17's User-Agent
// Lookup (any string, not just your own) can reuse it instead of writing a second one.
import type { Executor } from "@onestop/tool-registry";
import { MIME, optString, runUtilTool, textFile, unsupported } from "./common.ts";

export interface ParsedUserAgent {
  browser: { name: string; version: string } | null;
  engine: { name: string; version: string } | null;
  os: { name: string; version: string } | null;
  device: { type: "desktop" | "mobile" | "tablet" | "tv" | "bot"; vendor?: string; model?: string };
  /** True when the string looks like a crawler rather than a person's browser. */
  bot: boolean;
  raw: string;
}

type Rule = [RegExp, string, number?];

// Order matters: Edge and Opera both claim to be Chrome, Chrome claims to be Safari.
const BROWSERS: Rule[] = [
  [/\bEdg(?:e|A|iOS)?\/([\d.]+)/, "Microsoft Edge"],
  [/\bOPR\/([\d.]+)/, "Opera"],
  [/\bOpera[ /]([\d.]+)/, "Opera"],
  [/\bVivaldi\/([\d.]+)/, "Vivaldi"],
  [/\bBrave\/([\d.]+)/, "Brave"],
  [/\bSamsungBrowser\/([\d.]+)/, "Samsung Internet"],
  [/\bYaBrowser\/([\d.]+)/, "Yandex Browser"],
  [/\bDuckDuckGo\/([\d.]+)/, "DuckDuckGo"],
  [/\bFxiOS\/([\d.]+)/, "Firefox"],
  [/\bCriOS\/([\d.]+)/, "Chrome"],
  [/\bFirefox\/([\d.]+)/, "Firefox"],
  [/\bChrome\/([\d.]+)/, "Chrome"],
  [/\bVersion\/([\d.]+).*\bSafari\//, "Safari"],
  [/\bSafari\/([\d.]+)/, "Safari"],
  [/\bMSIE ([\d.]+)/, "Internet Explorer"],
  [/\bTrident\/.*\brv:([\d.]+)/, "Internet Explorer"],
  [/\bcurl\/([\d.]+)/, "curl"],
  [/\bWget\/([\d.]+)/, "Wget"],
  [/\bnode\b.*\bundici\/([\d.]+)/, "Node.js"],
];

const ENGINES: Rule[] = [
  [/\bEdgeHTML\/([\d.]+)/, "EdgeHTML"],
  [/\bGecko\/\d+ Firefox\/([\d.]+)/, "Gecko"],
  [/\bAppleWebKit\/([\d.]+)/, "WebKit"],
  [/\bTrident\/([\d.]+)/, "Trident"],
  [/\bPresto\/([\d.]+)/, "Presto"],
];

const OSES: Rule[] = [
  [/\bWindows NT ([\d.]+)/, "Windows"],
  [/\bWindows Phone(?: OS)? ([\d.]+)/, "Windows Phone"],
  [/\bAndroid[ /]([\d.]+)/, "Android"],
  [/\b(?:iPhone )?OS ([\d_]+) like Mac OS X/, "iOS"],
  [/\bCPU iPhone OS ([\d_]+)/, "iOS"],
  [/\bMac OS X ([\d_.]+)/, "macOS"],
  [/\bMacintosh\b()/, "macOS"],
  [/\bCrOS \S+ ([\d.]+)/, "ChromeOS"],
  [/\bUbuntu\b()/, "Ubuntu"],
  [/\bFedora\b()/, "Fedora"],
  [/\bLinux\b()/, "Linux"],
  [/\bFreeBSD\b()/, "FreeBSD"],
];

/** Windows reports a kernel version; this is the marketing name people expect to see. */
const WINDOWS_NAMES: Record<string, string> = {
  "10.0": "10 or 11",
  "6.3": "8.1",
  "6.2": "8",
  "6.1": "7",
  "6.0": "Vista",
  "5.1": "XP",
};

const BOT =
  /\b(bot|crawler|spider|crawling|slurp|facebookexternalhit|bingpreview|headlesschrome|lighthouse|pingdom|monitoring)\b/i;

function firstMatch(ua: string, rules: Rule[]): { name: string; version: string } | null {
  for (const [re, name] of rules) {
    const m = re.exec(ua);
    if (m) return { name, version: (m[1] ?? "").replace(/_/g, ".") };
  }
  return null;
}

export function parseUserAgent(raw: string): ParsedUserAgent {
  const ua = raw.trim();
  const browser = firstMatch(ua, BROWSERS);
  const engine = firstMatch(ua, ENGINES);
  const os = firstMatch(ua, OSES);
  if (os?.name === "Windows") os.version = WINDOWS_NAMES[os.version] ?? os.version;

  const bot = BOT.test(ua);
  const tablet =
    /\biPad\b/.test(ua) ||
    (/\bAndroid\b/.test(ua) && !/\bMobile\b/.test(ua)) ||
    /\bTablet\b/i.test(ua);
  const mobile = /\bMobi|iPhone|iPod|Windows Phone|Android\b/i.test(ua);
  const tv = /\b(SmartTV|GoogleTV|AppleTV|HbbTV|NetCast|Roku)\b/i.test(ua);

  const model = /\bAndroid [\d.]+; ([^;)]+?)(?: Build\/|\))/.exec(ua)?.[1]?.trim();
  const vendor = /\biPhone|iPad|iPod\b/.test(ua)
    ? "Apple"
    : /\bMacintosh\b/.test(ua)
      ? "Apple"
      : /\bSamsung|SM-/.test(ua)
        ? "Samsung"
        : /\bPixel\b/.test(ua)
          ? "Google"
          : undefined;

  return {
    browser,
    engine,
    os,
    device: {
      type: bot ? "bot" : tv ? "tv" : tablet ? "tablet" : mobile ? "mobile" : "desktop",
      ...(vendor ? { vendor } : {}),
      ...(model ? { model } : {}),
    },
    bot,
    raw: ua,
  };
}

/** One readable sentence: what the string says, in the order a person would ask. */
export function describeUserAgent(parsed: ParsedUserAgent): string {
  if (parsed.raw === "") return "There is no user-agent string to read.";
  const parts: string[] = [];
  if (parsed.browser) {
    parts.push(
      parsed.browser.version
        ? `${parsed.browser.name} ${parsed.browser.version.split(".").slice(0, 2).join(".")}`
        : parsed.browser.name,
    );
  } else parts.push("an unrecognised browser");
  if (parsed.os)
    parts.push(`on ${parsed.os.name}${parsed.os.version ? ` ${parsed.os.version}` : ""}`);
  const device = parsed.device.model ?? parsed.device.vendor;
  if (device) parts.push(`(${device})`);
  const kind = parsed.bot
    ? "This looks like a bot or crawler"
    : `This is a ${parsed.device.type} browser`;
  return `${kind}: ${parts.join(" ")}.`;
}

export const userAgentViewerExecutor: Executor = (_input, options) =>
  runUtilTool("user-agent-viewer", async () => {
    const raw = optString(options, "userAgent", "").trim();
    if (raw === "") {
      throw unsupported(
        "Your browser did not share a user-agent string. Reload the page and try again.",
      );
    }
    const parsed = parseUserAgent(raw);
    const lines = [
      `User agent: ${parsed.raw}`,
      `Browser: ${parsed.browser ? `${parsed.browser.name} ${parsed.browser.version}` : "unknown"}`,
      `Engine: ${parsed.engine ? `${parsed.engine.name} ${parsed.engine.version}` : "unknown"}`,
      `Operating system: ${parsed.os ? `${parsed.os.name} ${parsed.os.version}` : "unknown"}`,
      `Device: ${parsed.device.type}${parsed.device.model ? ` (${parsed.device.model})` : ""}`,
    ];
    return {
      ok: true,
      output: parsed as unknown as Record<string, unknown>,
      summary: describeUserAgent(parsed),
      files: [textFile("user-agent.txt", MIME.txt, lines.join("\n") + "\n")],
    };
  });
