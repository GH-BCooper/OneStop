// Finance & Math utilities (21-roadmap-expansion.md, roadmap §1.10).
//
// Four of the five are pure arithmetic and never touch the network. The Currency Converter is
// Internet-required by nature: it uses a free, keyless rate API and caches the last rate it saw, so
// when the network is gone it still answers — clearly labelled as possibly stale (§22).
import type { Executor } from "@onestop/tool-registry";
import type { OutputFile } from "@onestop/types";
import {
  MIME,
  csvFile,
  failed,
  jsonFile,
  optEnum,
  optNumber,
  optString,
  plural,
  round,
  runToolkitTool,
  textFile,
  unsupported,
} from "./common.ts";

function money(n: number, currency = ""): string {
  const text = n.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency ? `${currency} ${text}` : text;
}

// ---- loan / mortgage --------------------------------------------------------------------------

export interface LoanRow {
  period: number;
  payment: number;
  interest: number;
  principal: number;
  balance: number;
}

export interface LoanResult {
  payment: number;
  totalPaid: number;
  totalInterest: number;
  periods: number;
  schedule: LoanRow[];
}

/**
 * The standard annuity formula, with the zero-interest case handled separately (the general form
 * divides by zero there).
 */
export function amortize(principal: number, annualRatePercent: number, years: number, perYear: number): LoanResult {
  const periods = Math.max(1, Math.round(years * perYear));
  const rate = annualRatePercent / 100 / perYear;
  const payment =
    rate === 0
      ? principal / periods
      : (principal * rate) / (1 - Math.pow(1 + rate, -periods));
  const schedule: LoanRow[] = [];
  let balance = principal;
  let totalInterest = 0;
  for (let period = 1; period <= periods; period += 1) {
    const interest = balance * rate;
    // The last row absorbs the rounding drift so the balance really lands on zero.
    const principalPart = period === periods ? balance : payment - interest;
    balance = Math.max(0, balance - principalPart);
    totalInterest += interest;
    schedule.push({
      period,
      payment: round(interest + principalPart),
      interest: round(interest),
      principal: round(principalPart),
      balance: round(balance),
    });
  }
  return {
    payment: round(payment),
    totalPaid: round(principal + totalInterest),
    totalInterest: round(totalInterest),
    periods,
    schedule,
  };
}

const FREQUENCIES = { monthly: 12, fortnightly: 26, weekly: 52, quarterly: 4, yearly: 1 } as const;

export const loanCalculatorExecutor: Executor = (_input, options) =>
  runToolkitTool("loan-calculator", async () => {
    const principal = optNumber(options, "principal", 250_000, { min: 1, max: 1_000_000_000 });
    const rate = optNumber(options, "rate", 6.5, { min: 0, max: 100 });
    const years = optNumber(options, "years", 25, { min: 0.1, max: 60 });
    const frequency = optEnum(options, "frequency", Object.keys(FREQUENCIES) as (keyof typeof FREQUENCIES)[], "monthly");
    const currency = optString(options, "currency", "").trim().slice(0, 4);
    const result = amortize(principal, rate, years, FREQUENCIES[frequency]);
    const files: OutputFile[] = [
      csvFile("amortisation-schedule.csv", [
        ["Period", "Payment", "Interest", "Principal", "Balance"],
        ...result.schedule.map((r) => [r.period, r.payment, r.interest, r.principal, r.balance]),
      ]),
    ];
    return {
      ok: true,
      output: { ...result, frequency, result: `${money(result.payment, currency)} per ${frequency === "yearly" ? "year" : frequency.replace("ly", "")}` },
      summary: `${money(result.payment, currency)} per payment, ${result.periods} payments. Total paid ${money(result.totalPaid, currency)}, of which ${money(result.totalInterest, currency)} is interest.`,
      files,
    };
  });

// ---- compound interest -----------------------------------------------------------------------

export interface GrowthRow {
  year: number;
  contributed: number;
  interest: number;
  balance: number;
}

export function projectGrowth(
  initial: number,
  monthlyContribution: number,
  annualRatePercent: number,
  years: number,
  compoundsPerYear: number,
): { rows: GrowthRow[]; finalBalance: number; totalContributed: number; totalInterest: number } {
  const rows: GrowthRow[] = [];
  const periodsPerYear = compoundsPerYear;
  const rate = annualRatePercent / 100 / periodsPerYear;
  // Contributions are monthly, compounding may not be: spread the year's contributions evenly over
  // however many compounding periods there are, which is what a bank actually does.
  const perPeriodContribution = (monthlyContribution * 12) / periodsPerYear;
  let balance = initial;
  let contributed = initial;
  let interestTotal = 0;
  for (let year = 1; year <= Math.round(years); year += 1) {
    let yearInterest = 0;
    for (let p = 0; p < periodsPerYear; p += 1) {
      const interest = balance * rate;
      yearInterest += interest;
      balance += interest + perPeriodContribution;
      contributed += perPeriodContribution;
    }
    interestTotal += yearInterest;
    rows.push({ year, contributed: round(contributed), interest: round(yearInterest), balance: round(balance) });
  }
  return {
    rows,
    finalBalance: round(balance),
    totalContributed: round(contributed),
    totalInterest: round(interestTotal),
  };
}

const COMPOUNDING = { monthly: 12, quarterly: 4, yearly: 1, daily: 365 } as const;

export const compoundInterestExecutor: Executor = (_input, options) =>
  runToolkitTool("compound-interest-calculator", async () => {
    const initial = optNumber(options, "initial", 1000, { min: 0, max: 1_000_000_000 });
    const monthly = optNumber(options, "monthly", 200, { min: 0, max: 10_000_000 });
    const rate = optNumber(options, "rate", 7, { min: -50, max: 100 });
    const years = optNumber(options, "years", 20, { min: 1, max: 80 });
    const compounding = optEnum(options, "compounding", Object.keys(COMPOUNDING) as (keyof typeof COMPOUNDING)[], "monthly");
    const currency = optString(options, "currency", "").trim().slice(0, 4);
    const result = projectGrowth(initial, monthly, rate, years, COMPOUNDING[compounding]);
    return {
      ok: true,
      output: { ...result, result: money(result.finalBalance, currency) },
      summary: `After ${years} years: ${money(result.finalBalance, currency)}. You put in ${money(result.totalContributed, currency)}; interest added ${money(result.totalInterest, currency)}.`,
      files: [
        csvFile("growth.csv", [
          ["Year", "Contributed so far", "Interest that year", "Balance"],
          ...result.rows.map((r) => [r.year, r.contributed, r.interest, r.balance]),
        ]),
      ],
    };
  });

// ---- tip splitter ----------------------------------------------------------------------------

export const tipSplitterExecutor: Executor = (_input, options) =>
  runToolkitTool("tip-splitter", async () => {
    const bill = optNumber(options, "bill", 100, { min: 0, max: 10_000_000 });
    const tipPercent = optNumber(options, "tipPercent", 15, { min: 0, max: 100 });
    const people = optNumber(options, "people", 2, { min: 1, max: 200 });
    const rounding = optEnum(options, "rounding", ["none", "up", "nearest"] as const, "none");
    const currency = optString(options, "currency", "").trim().slice(0, 4);
    const tip = (bill * tipPercent) / 100;
    const total = bill + tip;
    let each = total / people;
    if (rounding === "up") each = Math.ceil(each);
    if (rounding === "nearest") each = Math.round(each);
    const collected = each * people;
    return {
      ok: true,
      output: {
        bill: round(bill),
        tip: round(tip),
        total: round(total),
        people,
        each: round(each),
        collected: round(collected),
        extra: round(collected - total),
        result: money(each, currency),
      },
      summary: `${money(each, currency)} each for ${plural(people, "person").replace("persons", "people")} — ${money(bill, currency)} bill plus ${money(tip, currency)} tip (${tipPercent}%)${collected - total > 0.004 ? `, leaving ${money(collected - total, currency)} over` : ""}.`,
      files: [],
    };
  });

// ---- currency converter ----------------------------------------------------------------------

export const RATE_URL = "https://open.er-api.com/v6/latest/";

interface CachedRates {
  base: string;
  rates: Record<string, number>;
  fetchedAt: number;
}

/** Last known rates, kept in memory so an offline lookup still answers (roadmap §4, §22). */
const rateCache = new Map<string, CachedRates>();

export function _seedRateCache(base: string, rates: Record<string, number>, fetchedAt = Date.now()): void {
  rateCache.set(base.toUpperCase(), { base: base.toUpperCase(), rates, fetchedAt });
}

export function _clearRateCache(): void {
  rateCache.clear();
}

async function loadRates(base: string): Promise<{ data: CachedRates; stale: boolean }> {
  const key = base.toUpperCase();
  try {
    const response = await fetch(`${RATE_URL}${encodeURIComponent(key)}`, {
      headers: { "User-Agent": "OneStop" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = (await response.json()) as { result?: string; rates?: Record<string, number> };
    if (body.result !== "success" || !body.rates) throw new Error("unexpected response");
    const fresh: CachedRates = { base: key, rates: body.rates, fetchedAt: Date.now() };
    rateCache.set(key, fresh);
    return { data: fresh, stale: false };
  } catch (err) {
    const cached = rateCache.get(key);
    if (cached) return { data: cached, stale: true };
    throw failed(
      "Exchange rates could not be fetched and none are cached yet. This tool needs an internet connection the first time you use it.",
      err,
    );
  }
}

export const currencyConverterExecutor: Executor = (input, options) =>
  runToolkitTool("currency-converter", async () => {
    const from = (optString(options, "from", "USD") || "USD").toUpperCase().trim();
    const to = (optString(options, "to", "EUR") || "EUR").toUpperCase().trim();
    if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) {
      throw unsupported("Use three-letter currency codes, like USD or EUR.");
    }
    const typed = typeof input === "string" ? Number(input.replace(/[^\d.-]/g, "")) : NaN;
    const amount = Number.isFinite(typed) && typed !== 0 ? typed : optNumber(options, "amount", 1, { min: -1e12, max: 1e12 });
    const { data, stale } = await loadRates(from);
    const rate = data.rates[to];
    if (rate === undefined) throw unsupported(`"${to}" is not a currency this rate source knows.`);
    const converted = amount * rate;
    const age = Math.round((Date.now() - data.fetchedAt) / 60_000);
    return {
      ok: true,
      output: {
        amount,
        from,
        to,
        rate,
        converted: round(converted, 4),
        stale,
        fetchedAt: new Date(data.fetchedAt).toISOString(),
        result: `${round(converted, 2)} ${to}`,
      },
      summary: `${amount} ${from} = ${round(converted, 2)} ${to} (1 ${from} = ${round(rate, 6)} ${to})${stale ? `. This is the last rate OneStop saw, about ${age} minute${age === 1 ? "" : "s"} ago — it may be out of date.` : "."}`,
      files: [],
    };
  });

// ---- invoice generator -----------------------------------------------------------------------

export interface InvoiceLine {
  description: string;
  quantity: number;
  unitPrice: number;
}

/** "Design work | 3 | 450" per line — the smallest thing that is still a real invoice. */
export function parseInvoiceLines(text: string): InvoiceLine[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "" && !/^#/.test(l));
  if (lines.length === 0) throw unsupported('Add at least one line, like "Design work | 3 | 450".');
  return lines.map((line) => {
    const parts = line.split(/\s*[|\t]\s*/);
    const quantity = Number(parts[1] ?? 1);
    const unitPrice = Number(parts[2] ?? 0);
    if (!Number.isFinite(quantity) || !Number.isFinite(unitPrice)) {
      throw unsupported(`"${line}" is not a line item. Use: description | quantity | unit price.`);
    }
    return { description: parts[0]!.slice(0, 200), quantity, unitPrice };
  });
}

export const invoiceGeneratorExecutor: Executor = (input, options) =>
  runToolkitTool("invoice-generator", async () => {
    const lines = parseInvoiceLines(typeof input === "string" && input.trim() !== "" ? input : optString(options, "items", ""));
    const currency = optString(options, "currency", "USD").trim().slice(0, 4) || "USD";
    const taxPercent = optNumber(options, "taxPercent", 0, { min: 0, max: 100 });
    const number = optString(options, "number", "").trim() || `INV-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;
    const from = optString(options, "from", "").trim() || "Your business";
    const to = optString(options, "to", "").trim() || "Client";
    const notes = optString(options, "notes", "").trim();
    const dueDays = optNumber(options, "dueDays", 14, { min: 0, max: 365 });
    const issued = new Date();
    const due = new Date(issued.getTime() + dueDays * 86_400_000);

    const subtotal = lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);
    const tax = (subtotal * taxPercent) / 100;
    const total = subtotal + tax;
    const format = optEnum(options, "format", ["pdf", "docx", "both"] as const, "pdf");

    const { renderInvoicePdf, renderInvoiceDocx } = await import("./invoice.ts");
    const data = {
      number,
      from,
      to,
      issued: issued.toISOString().slice(0, 10),
      due: due.toISOString().slice(0, 10),
      currency,
      lines,
      subtotal: round(subtotal),
      taxPercent,
      tax: round(tax),
      total: round(total),
      notes,
    };
    const files: OutputFile[] = [];
    if (format !== "docx") {
      files.push({ name: `${number}.pdf`, mimeType: MIME.pdf, bytes: await renderInvoicePdf(data) });
    }
    if (format !== "pdf") {
      files.push({ name: `${number}.docx`, mimeType: MIME.docx, bytes: await renderInvoiceDocx(data) });
    }
    return {
      ok: true,
      output: { ...data, result: `${currency} ${money(total)}` },
      summary: `Invoice ${number}: ${plural(lines.length, "line item")}, total ${currency} ${money(total)}, due ${data.due}.`,
      files,
    };
  });

export { jsonFile, textFile };
