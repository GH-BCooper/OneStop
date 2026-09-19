// Per-tool options for the online media and network/info tools (17-online-media-network-tools.md).
// Same declarative rules as options.ts: no React, no `node:` imports; `showWhen` is the only logic.
import type { BooleanOption, NumberOption, SelectOption, TextOption, ToolOption } from "./options";

const choice = (value: string, label: string) => ({ value, label });

// ---- Online Media (Features §9) ----------------------------------------------------------------

const videoQuality: SelectOption = {
  id: "quality",
  type: "select",
  label: "Highest quality to accept",
  default: "1080",
  choices: [
    choice("best", "Best available"),
    choice("2160", "4K (2160p)"),
    choice("1440", "1440p"),
    choice("1080", "1080p"),
    choice("720", "720p"),
    choice("480", "480p"),
    choice("360", "360p"),
  ],
  help: "The best format at or below this height is used. A bigger picture means a much bigger file.",
};

const videoFormat: SelectOption = {
  id: "format",
  type: "select",
  label: "Save as",
  default: "mp4",
  choices: [
    choice("mp4", "MP4 (H.264) — plays everywhere"),
    choice("webm", "WebM — for the web"),
    choice("mkv", "MKV — keeps every track"),
  ],
};

const audioFormat: SelectOption = {
  id: "format",
  type: "select",
  label: "Save as",
  default: "mp3",
  choices: [
    choice("mp3", "MP3 — plays everywhere"),
    choice("m4a", "M4A (AAC) — smaller at the same quality"),
    choice("opus", "Opus — best at low bitrates"),
    choice("wav", "WAV — uncompressed"),
    choice("flac", "FLAC — lossless"),
  ],
};

const audioBitrate: NumberOption = {
  id: "bitrate",
  type: "number",
  label: "Bitrate",
  default: 192,
  min: 64,
  max: 320,
  step: 32,
  unit: "kbps",
  help: "Ignored for WAV and FLAC, which are not compressed that way.",
};

const formatId: TextOption = {
  id: "formatId",
  type: "text",
  label: "Exact format id",
  default: "",
  placeholder: "Leave blank to pick automatically",
  help: "Run the Quality Selector first to see the ids this link offers. Overrides the quality choice.",
};

const audioDownload: ToolOption[] = [audioFormat, audioBitrate, formatId];
const videoDownload: ToolOption[] = [videoQuality, videoFormat, formatId];

// ---- Network / Information (Features §13) ------------------------------------------------------

const reverseDns: BooleanOption = {
  id: "reverseDns",
  type: "boolean",
  label: "Look up the host name too",
  default: true,
  help: "Asks which names the address claims (its PTR record).",
};

const whoisStep: BooleanOption = {
  id: "whois",
  type: "boolean",
  label: "Include the registry record",
  default: true,
  help: "Who the address block is allocated to. Adds a second or two.",
};

const dnsRecords: SelectOption = {
  id: "records",
  type: "select",
  label: "Records to look up",
  default: "common",
  choices: [
    choice("common", "The usual ones (A, AAAA, MX, NS, TXT, SOA)"),
    choice("all", "Everything, including CNAME, SRV, CAA and PTR"),
    choice("one", "Just one type"),
  ],
};

const dnsRecordType: SelectOption = {
  id: "recordType",
  type: "select",
  label: "Record type",
  default: "A",
  choices: ["A", "AAAA", "CNAME", "MX", "NS", "TXT", "SOA", "SRV", "CAA", "PTR"].map((t) =>
    choice(t, t),
  ),
  showWhen: { option: "records", equals: ["one"] },
};

export const NETWORK_TOOL_OPTIONS: Record<string, ToolOption[]> = {
  // Online Media.
  "youtube-to-mp3": audioDownload,
  "youtube-to-mp4": videoDownload,
  "instagram-reel-to-mp3": audioDownload,
  "instagram-reel-to-mp4": videoDownload,
  // The two selectors take no options: listing what a link offers is the whole job.

  // Network / Information.
  "ip-address-lookup": [reverseDns, whoisStep],
  "location-lookup": [
    {
      id: "results",
      type: "number",
      label: "Matches to return",
      default: 5,
      min: 1,
      max: 10,
      help: "The best match is always shown first.",
    },
  ],
  "dns-lookup": [dnsRecords, dnsRecordType],
  "whois-lookup": [
    {
      id: "raw",
      type: "boolean",
      label: "Include the full raw record",
      default: true,
      help: "The registry's own text, below the fields OneStop picked out.",
    },
  ],
  "website-information-lookup": [
    {
      id: "certificate",
      type: "boolean",
      label: "Check the security certificate",
      default: true,
      help: "Who issued it and when it expires. Needs a second connection to the site.",
    },
    {
      id: "dns",
      type: "boolean",
      label: "Include the site's DNS records",
      default: false,
    },
  ],
};
