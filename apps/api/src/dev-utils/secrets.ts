// Secrets Scanner (21-roadmap-expansion.md, roadmap §1.8).
//
// Scans uploaded files, or the contents of an uploaded ZIP, for the shapes API keys and tokens take,
// plus high-entropy strings that look like credentials. It is a *finder*, not a judge: every finding
// says which rule matched and shows only a masked fragment, so a report can be shared without
// leaking the very thing it found.
import type { Executor } from "@onestop/tool-registry";
import {
  MIME,
  decodeText,
  optBool,
  optNumber,
  plural,
  readFiles,
  runUtilTool,
  textFile,
} from "./common.ts";
import { readZip } from "./zip.ts";

export interface SecretRule {
  id: string;
  name: string;
  severity: "high" | "medium" | "low";
  pattern: RegExp;
  note?: string;
}

/**
 * Patterns for credentials whose *shape* is distinctive enough to match without false positives
 * everywhere. Anything vaguer than this is left to the entropy pass below, which is clearly
 * labelled as a guess.
 */
export const SECRET_RULES: readonly SecretRule[] = [
  { id: "aws-access-key", name: "AWS access key id", severity: "high", pattern: /\b((?:A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16})\b/g },
  { id: "aws-secret", name: "AWS secret access key", severity: "high", pattern: /aws_?secret_?access_?key["'\s:=]+([A-Za-z0-9/+=]{40})/gi },
  { id: "github-token", name: "GitHub token", severity: "high", pattern: /\b((?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{22,255})\b/g },
  { id: "gitlab-token", name: "GitLab token", severity: "high", pattern: /\b(glpat-[A-Za-z0-9_-]{20,})\b/g },
  { id: "slack-token", name: "Slack token", severity: "high", pattern: /\b(xox[abposr]-[A-Za-z0-9-]{10,})\b/g },
  { id: "slack-webhook", name: "Slack webhook URL", severity: "medium", pattern: /(https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_+=-]{20,})/g },
  { id: "stripe-key", name: "Stripe secret key", severity: "high", pattern: /\b((?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,})\b/g },
  { id: "google-api-key", name: "Google API key", severity: "high", pattern: /\b(AIza[0-9A-Za-z_-]{35})\b/g },
  { id: "openai-key", name: "OpenAI-style API key", severity: "high", pattern: /\b(sk-(?:proj-)?[A-Za-z0-9_-]{20,})\b/g },
  { id: "groq-key", name: "Groq API key", severity: "high", pattern: /\b(gsk_[A-Za-z0-9]{20,})\b/g },
  { id: "openrouter-key", name: "OpenRouter API key", severity: "high", pattern: /\b(sk-or-v1-[a-f0-9]{32,})\b/g },
  { id: "sendgrid-key", name: "SendGrid API key", severity: "high", pattern: /\b(SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,})\b/g },
  { id: "twilio-sid", name: "Twilio account SID", severity: "medium", pattern: /\b(AC[a-f0-9]{32})\b/g },
  { id: "npm-token", name: "npm access token", severity: "high", pattern: /\b(npm_[A-Za-z0-9]{36})\b/g },
  { id: "private-key", name: "Private key block", severity: "high", pattern: /(-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----)/g },
  { id: "jwt", name: "JSON Web Token", severity: "medium", pattern: /\b(eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})\b/g, note: "Decode it with the JWT Decoder to see whether it is still valid." },
  { id: "db-url", name: "Database connection string with a password", severity: "high", pattern: /\b((?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s:/@"']+:[^\s:/@"']+@[^\s"']+)/gi },
  { id: "basic-auth-url", name: "URL with inline credentials", severity: "medium", pattern: /\b(https?:\/\/[^\s:/@"']+:[^\s:/@"']+@[^\s"']+)/gi },
  { id: "generic-secret", name: "Assignment to a secret-looking name", severity: "low", pattern: /\b(?:api[_-]?key|secret|passwd|password|token|auth|credential|private[_-]?key)["'\s]*[:=]\s*["']([^"'\s]{12,})["']/gi, note: "Check by hand — this rule matches placeholders and examples too." },
];

/** Files worth scanning as text. Binaries and lock files are noise. */
const SKIP_PATH = /(^|\/)(node_modules|\.git|dist|build|\.next|vendor|__pycache__|\.venv)\//i;
const SKIP_NAME = /\.(png|jpe?g|gif|webp|avif|ico|bmp|tiff?|pdf|zip|gz|tar|7z|rar|mp[34]|wav|flac|ogg|mov|mp4|webm|woff2?|ttf|otf|eot|so|dll|exe|bin|wasm|class|jar|pyc|lock)$/i;
const MAX_TEXT_BYTES = 4 * 1024 * 1024;

export interface Finding {
  file: string;
  line: number;
  rule: string;
  ruleId: string;
  severity: SecretRule["severity"];
  /** First and last few characters only — the middle is always masked. */
  masked: string;
  context: string;
  note?: string;
}

export function mask(value: string): string {
  if (value.length <= 10) return `${value.slice(0, 2)}${"•".repeat(Math.max(2, value.length - 2))}`;
  return `${value.slice(0, 4)}${"•".repeat(Math.min(16, value.length - 8))}${value.slice(-4)}`;
}

/** Shannon entropy per character — the usual "does this look like a random key?" measure. */
export function shannonEntropy(text: string): number {
  if (text.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const ch of text) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let bits = 0;
  for (const n of counts.values()) {
    const p = n / text.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

const PLACEHOLDER = /^(?:x{4,}|y{4,}|0{4,}|1{4,}|your[_-]?|example|placeholder|changeme|test|dummy|sample|todo|redacted|<|\$\{)/i;

export function scanText(
  path: string,
  text: string,
  { entropy = true, entropyThreshold = 4.2 }: { entropy?: boolean; entropyThreshold?: number } = {},
): Finding[] {
  const findings: Finding[] = [];
  const lines = text.split(/\r?\n/);
  const seen = new Set<string>();
  for (const [index, line] of lines.entries()) {
    if (line.length > 4000) continue; // minified bundles produce nothing but noise
    for (const rule of SECRET_RULES) {
      rule.pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = rule.pattern.exec(line)) !== null) {
        const value = match[1] ?? match[0];
        if (PLACEHOLDER.test(value)) continue;
        const key = `${rule.id}:${value}`;
        if (seen.has(key)) continue;
        seen.add(key);
        findings.push({
          file: path,
          line: index + 1,
          rule: rule.name,
          ruleId: rule.id,
          severity: rule.severity,
          masked: mask(value),
          context: line.trim().slice(0, 160).replace(value, mask(value)),
          ...(rule.note ? { note: rule.note } : {}),
        });
      }
    }
    if (entropy) {
      for (const candidate of line.match(/[A-Za-z0-9+/=_-]{24,}/g) ?? []) {
        if (PLACEHOLDER.test(candidate)) continue;
        // A long hex or base64 string with high entropy and no vowel pattern is usually a key,
        // a hash, or a bundled asset digest — all worth a human glance, none worth panicking over.
        if (shannonEntropy(candidate) < entropyThreshold) continue;
        const key = `entropy:${candidate}`;
        if (seen.has(key)) continue;
        seen.add(key);
        findings.push({
          file: path,
          line: index + 1,
          rule: "High-entropy string",
          ruleId: "entropy",
          severity: "low",
          masked: mask(candidate),
          context: line.trim().slice(0, 160).replace(candidate, mask(candidate)),
          note: "Only a guess from randomness — it may just as easily be a hash or a build id.",
        });
      }
    }
  }
  return findings;
}

export function reportText(findings: Finding[], filesScanned: number): string {
  if (findings.length === 0) {
    return `Scanned ${filesScanned} file${filesScanned === 1 ? "" : "s"}. Nothing that looks like a credential was found.\n`;
  }
  const bySeverity = { high: 0, medium: 0, low: 0 };
  for (const f of findings) bySeverity[f.severity] += 1;
  const lines = [
    `Secrets scan — ${findings.length} finding${findings.length === 1 ? "" : "s"} in ${filesScanned} file${filesScanned === 1 ? "" : "s"}`,
    `High ${bySeverity.high} · Medium ${bySeverity.medium} · Low ${bySeverity.low}`,
    "",
    "Values are masked. Rotate anything real: a committed key stays in the git history even after you delete the line.",
    "",
  ];
  for (const f of findings) {
    lines.push(`[${f.severity.toUpperCase()}] ${f.file}:${f.line} — ${f.rule}: ${f.masked}`);
    lines.push(`    ${f.context}`);
    if (f.note) lines.push(`    note: ${f.note}`);
  }
  return lines.join("\n") + "\n";
}

export const secretsScannerExecutor: Executor = (input, options, ctx) =>
  runUtilTool("secrets-scanner", async () => {
    const files = await readFiles(input, ctx, { what: "file" });
    const entropy = optBool(options, "entropy", true);
    const entropyThreshold = optNumber(options, "entropyThreshold", 4.2, { min: 3, max: 6 });
    const findings: Finding[] = [];
    let scanned = 0;
    let skipped = 0;

    for (const file of files) {
      if (file.ext === "zip") {
        for (const entry of await readZip(file.bytes)) {
          if (SKIP_PATH.test(entry.originalName) || SKIP_NAME.test(entry.originalName) || entry.bytes.length > MAX_TEXT_BYTES) {
            skipped += 1;
            continue;
          }
          scanned += 1;
          findings.push(...scanText(entry.originalName, decodeText(entry.bytes), { entropy, entropyThreshold }));
        }
        continue;
      }
      if (SKIP_NAME.test(file.ref.name) || file.bytes.length > MAX_TEXT_BYTES) {
        skipped += 1;
        continue;
      }
      scanned += 1;
      findings.push(...scanText(file.ref.name, decodeText(file.bytes), { entropy, entropyThreshold }));
    }

    const order = { high: 0, medium: 1, low: 2 };
    findings.sort((a, b) => order[a.severity] - order[b.severity] || a.file.localeCompare(b.file) || a.line - b.line);
    const high = findings.filter((f) => f.severity === "high").length;
    return {
      ok: true,
      output: {
        findings,
        filesScanned: scanned,
        filesSkipped: skipped,
        high,
        medium: findings.filter((f) => f.severity === "medium").length,
        low: findings.filter((f) => f.severity === "low").length,
        result: `${findings.length} findings in ${scanned} files`,
      },
      summary:
        findings.length === 0
          ? `Scanned ${plural(scanned, "file")} and found nothing that looks like a credential.${skipped > 0 ? ` ${skipped} binary or vendored file${skipped === 1 ? "" : "s"} skipped.` : ""}`
          : `${plural(findings.length, "finding")} in ${plural(scanned, "file")}${high > 0 ? `, ${high} of them high-confidence` : ""}. Values in the report are masked — rotate anything real, because a committed key stays in the git history even after the line goes.`,
      files: [
        textFile("secrets-report.txt", MIME.txt, reportText(findings, scanned)),
        textFile("secrets-report.json", MIME.json, JSON.stringify({ filesScanned: scanned, findings }, null, 2) + "\n"),
      ],
    };
  });
