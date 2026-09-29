// Chart Generator (21-roadmap-expansion.md, roadmap §1.3).
//
// SVG is built as a string — no charting library, no canvas, no headless browser. A PNG is produced
// by handing that SVG to `sharp`, which phase 09 already depends on, so the PNG path costs nothing
// extra either. The palette is the app's own graphite-on-silver language rather than a rainbow.
import type { Executor } from "@onestop/tool-registry";
import type { OutputFile } from "@onestop/types";
import {
  cellText,
  optBool,
  optEnum,
  optNumber,
  optString,
  plural,
  readDataInputs,
  runDataTool,
  textOutput,
  unsupported,
  type Table,
} from "./common.ts";
import { findColumn } from "./pivot.ts";
import { delimiterOption, readTabular, sheetOption } from "./tabular.ts";

export const CHART_TYPES = ["bar", "column", "line", "area", "pie", "doughnut", "scatter"] as const;
export type ChartType = (typeof CHART_TYPES)[number];

/**
 * Categorical series colours: one hue family, varied in lightness and chroma so the chart still
 * reads in greyscale and for colour-blind viewers — the reason not to reach for a rainbow.
 */
export const SERIES_COLORS = [
  "#5b6b7c", "#8fa2b4", "#c2cedb", "#3d4a57", "#a8b6c4", "#6e8091", "#d6dee7", "#4d5c6b",
];

export interface ChartPoint {
  label: string;
  value: number;
}

export function readSeries(table: Table, labelColumn: number, valueColumn: number, limit: number): ChartPoint[] {
  const points: ChartPoint[] = [];
  for (const row of table.rows) {
    const raw = row[valueColumn];
    const value =
      typeof raw === "number"
        ? raw
        : Number(String(raw ?? "").replace(/[\s,%]/g, "").replace(/^[$£€¥]/, ""));
    if (!Number.isFinite(value)) continue;
    points.push({ label: cellText(row[labelColumn]) || "(blank)", value });
    if (points.length >= limit) break;
  }
  if (points.length === 0) {
    throw unsupported(`Column "${table.headers[valueColumn]}" has no numbers in it, so there is nothing to plot.`);
  }
  return points;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function niceTicks(min: number, max: number, count = 5): number[] {
  if (min === max) return [min];
  const span = max - min;
  const rawStep = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rawStep) ?? magnitude * 10;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

function tickLabel(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${Math.round((n / 1e9) * 10) / 10}B`;
  if (abs >= 1e6) return `${Math.round((n / 1e6) * 10) / 10}M`;
  if (abs >= 1e4) return `${Math.round(n / 1000)}k`;
  return String(Math.round(n * 100) / 100);
}

export interface ChartOptions {
  type: ChartType;
  title: string;
  width: number;
  height: number;
  valueLabel: string;
  categoryLabel: string;
  showValues: boolean;
  dark: boolean;
}

/** One self-contained SVG. No external fonts, no scripts, no network reference of any kind. */
export function renderChartSvg(points: ChartPoint[], o: ChartOptions): string {
  const ink = o.dark ? "#eef1f5" : "#0e141a";
  const muted = o.dark ? "#a3acb8" : "#3d4b57";
  const grid = o.dark ? "#2f353d" : "#cbd5df";
  const bg = o.dark ? "#111417" : "#ffffff";
  const { width, height } = o;
  const pad = { top: o.title ? 46 : 22, right: 20, bottom: 54, left: 62 };
  const plotW = Math.max(40, width - pad.left - pad.right);
  const plotH = Math.max(40, height - pad.top - pad.bottom);
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(o.title || "chart")}">`,
    `<rect width="${width}" height="${height}" fill="${bg}"/>`,
    `<style>text{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}</style>`,
  ];
  if (o.title) {
    parts.push(`<text x="${width / 2}" y="26" fill="${ink}" font-size="16" font-weight="600" text-anchor="middle">${esc(o.title)}</text>`);
  }

  if (o.type === "pie" || o.type === "doughnut") {
    const total = points.reduce((sum, p) => sum + Math.max(0, p.value), 0);
    if (total <= 0) throw unsupported("A pie chart needs positive values to divide up.");
    const cx = width / 2 - 70;
    const cy = pad.top + plotH / 2;
    const r = Math.min(plotH, plotW - 150) / 2;
    const inner = o.type === "doughnut" ? r * 0.55 : 0;
    let angle = -Math.PI / 2;
    points.forEach((point, i) => {
      const slice = (Math.max(0, point.value) / total) * Math.PI * 2;
      const [x1, y1] = [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
      const [x2, y2] = [cx + r * Math.cos(angle + slice), cy + r * Math.sin(angle + slice)];
      const large = slice > Math.PI ? 1 : 0;
      const path = inner
        ? `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} L ${cx + inner * Math.cos(angle + slice)} ${cy + inner * Math.sin(angle + slice)} A ${inner} ${inner} 0 ${large} 0 ${cx + inner * Math.cos(angle)} ${cy + inner * Math.sin(angle)} Z`
        : `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
      parts.push(`<path d="${path}" fill="${SERIES_COLORS[i % SERIES_COLORS.length]}" stroke="${bg}" stroke-width="1.5"/>`);
      angle += slice;
    });
    const legendX = cx + r + 34;
    points.slice(0, 14).forEach((point, i) => {
      const y = pad.top + 12 + i * 20;
      const percent = Math.round((Math.max(0, point.value) / total) * 1000) / 10;
      parts.push(`<rect x="${legendX}" y="${y - 9}" width="11" height="11" rx="2" fill="${SERIES_COLORS[i % SERIES_COLORS.length]}"/>`);
      parts.push(`<text x="${legendX + 17}" y="${y}" fill="${muted}" font-size="11.5">${esc(point.label.slice(0, 22))} · ${percent}%</text>`);
    });
    parts.push("</svg>");
    return parts.join("\n");
  }

  const values = points.map((p) => p.value);
  const rawMin = Math.min(0, ...values);
  const rawMax = Math.max(0, ...values);
  const ticks = niceTicks(rawMin, rawMax === rawMin ? rawMin + 1 : rawMax);
  const min = Math.min(...ticks);
  const max = Math.max(...ticks);
  const horizontal = o.type === "bar";
  const scale = (v: number) => ((v - min) / (max - min || 1));

  // Axes and gridlines.
  for (const tick of ticks) {
    const p = scale(tick);
    if (horizontal) {
      const x = pad.left + p * plotW;
      parts.push(`<line x1="${x}" y1="${pad.top}" x2="${x}" y2="${pad.top + plotH}" stroke="${grid}" stroke-width="1"/>`);
      parts.push(`<text x="${x}" y="${pad.top + plotH + 18}" fill="${muted}" font-size="11" text-anchor="middle">${tickLabel(tick)}</text>`);
    } else {
      const y = pad.top + plotH - p * plotH;
      parts.push(`<line x1="${pad.left}" y1="${y}" x2="${pad.left + plotW}" y2="${y}" stroke="${grid}" stroke-width="1"/>`);
      parts.push(`<text x="${pad.left - 8}" y="${y + 4}" fill="${muted}" font-size="11" text-anchor="end">${tickLabel(tick)}</text>`);
    }
  }

  const slot = (horizontal ? plotH : plotW) / points.length;
  const thickness = Math.max(2, Math.min(48, slot * 0.68));

  if (o.type === "bar" || o.type === "column") {
    points.forEach((point, i) => {
      const zero = scale(0);
      const value = scale(point.value);
      const color = SERIES_COLORS[i % SERIES_COLORS.length]!;
      if (horizontal) {
        const y = pad.top + i * slot + (slot - thickness) / 2;
        const x = pad.left + Math.min(zero, value) * plotW;
        const w = Math.abs(value - zero) * plotW;
        parts.push(`<rect x="${x}" y="${y}" width="${Math.max(1, w)}" height="${thickness}" rx="2" fill="${color}"/>`);
        parts.push(`<text x="${pad.left - 8}" y="${y + thickness / 2 + 4}" fill="${muted}" font-size="11" text-anchor="end">${esc(point.label.slice(0, 16))}</text>`);
        if (o.showValues) parts.push(`<text x="${x + w + 5}" y="${y + thickness / 2 + 4}" fill="${ink}" font-size="11">${tickLabel(point.value)}</text>`);
      } else {
        const x = pad.left + i * slot + (slot - thickness) / 2;
        const yTop = pad.top + plotH - Math.max(zero, value) * plotH;
        const h = Math.abs(value - zero) * plotH;
        parts.push(`<rect x="${x}" y="${yTop}" width="${thickness}" height="${Math.max(1, h)}" rx="2" fill="${color}"/>`);
        // Rotate the category labels when there are too many to fit upright.
        const labelY = pad.top + plotH + 16;
        const label = esc(point.label.slice(0, 18));
        parts.push(
          slot < 44
            ? `<text x="${x + thickness / 2}" y="${labelY}" fill="${muted}" font-size="10.5" text-anchor="end" transform="rotate(-42 ${x + thickness / 2} ${labelY})">${label}</text>`
            : `<text x="${x + thickness / 2}" y="${labelY}" fill="${muted}" font-size="11" text-anchor="middle">${label}</text>`,
        );
        if (o.showValues) parts.push(`<text x="${x + thickness / 2}" y="${yTop - 5}" fill="${ink}" font-size="11" text-anchor="middle">${tickLabel(point.value)}</text>`);
      }
    });
  } else {
    const step = points.length > 1 ? plotW / (points.length - 1) : 0;
    const at = (i: number, v: number) => [pad.left + i * step, pad.top + plotH - scale(v) * plotH] as const;
    const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${at(i, p.value).join(" ")}`).join(" ");
    if (o.type === "area") {
      const zeroY = pad.top + plotH - scale(0) * plotH;
      parts.push(`<path d="${path} L ${pad.left + (points.length - 1) * step} ${zeroY} L ${pad.left} ${zeroY} Z" fill="${SERIES_COLORS[1]}" fill-opacity="0.35"/>`);
    }
    if (o.type !== "scatter") {
      parts.push(`<path d="${path}" fill="none" stroke="${SERIES_COLORS[0]}" stroke-width="2.25" stroke-linejoin="round" stroke-linecap="round"/>`);
    }
    points.forEach((point, i) => {
      const [x, y] = at(i, point.value);
      parts.push(`<circle cx="${x}" cy="${y}" r="${o.type === "scatter" ? 4 : 3}" fill="${SERIES_COLORS[0]}"/>`);
      const every = Math.ceil(points.length / Math.max(1, Math.floor(plotW / 70)));
      if (i % every === 0) {
        parts.push(`<text x="${x}" y="${pad.top + plotH + 17}" fill="${muted}" font-size="10.5" text-anchor="middle">${esc(point.label.slice(0, 14))}</text>`);
      }
      if (o.showValues && points.length <= 20) {
        parts.push(`<text x="${x}" y="${y - 8}" fill="${ink}" font-size="10.5" text-anchor="middle">${tickLabel(point.value)}</text>`);
      }
    });
  }

  if (o.valueLabel) {
    parts.push(
      horizontal
        ? `<text x="${pad.left + plotW / 2}" y="${height - 12}" fill="${muted}" font-size="11.5" text-anchor="middle">${esc(o.valueLabel)}</text>`
        : `<text x="14" y="${pad.top + plotH / 2}" fill="${muted}" font-size="11.5" text-anchor="middle" transform="rotate(-90 14 ${pad.top + plotH / 2})">${esc(o.valueLabel)}</text>`,
    );
  }
  if (o.categoryLabel && !horizontal) {
    parts.push(`<text x="${pad.left + plotW / 2}" y="${height - 8}" fill="${muted}" font-size="11.5" text-anchor="middle">${esc(o.categoryLabel)}</text>`);
  }
  parts.push("</svg>");
  return parts.join("\n");
}

export const chartGeneratorExecutor: Executor = (input, options, ctx) =>
  runDataTool("chart-generator", async () => {
    const [file] = await readDataInputs(input, ctx, { what: "spreadsheet" });
    const source = await readTabular(file!, { sheet: sheetOption(options, ""), delimiter: delimiterOption(options) }, ctx?.signal);
    const table = source.tables[0];
    if (!table || table.rows.length === 0) throw unsupported("This sheet has no data rows to chart.");

    const labelColumn = findColumn(table, optString(options, "labels", table.headers[0] ?? ""), "the labels");
    const valueColumn = findColumn(table, optString(options, "values", table.headers[1] ?? table.headers[0] ?? ""), "the values");
    const limit = optNumber(options, "maxPoints", 60, { min: 2, max: 500 });
    const points = readSeries(table, labelColumn, valueColumn, limit);

    const chart: ChartOptions = {
      type: optEnum(options, "type", CHART_TYPES, "column"),
      title: optString(options, "title", "") || `${table.headers[valueColumn]} by ${table.headers[labelColumn]}`,
      width: optNumber(options, "width", 900, { min: 240, max: 3000 }),
      height: optNumber(options, "height", 520, { min: 180, max: 3000 }),
      valueLabel: table.headers[valueColumn] ?? "",
      categoryLabel: table.headers[labelColumn] ?? "",
      showValues: optBool(options, "showValues", points.length <= 20),
      dark: optBool(options, "dark", false),
    };
    const svg = renderChartSvg(points, chart);
    const files: OutputFile[] = [textOutput(`${file!.name}-chart.svg`, "image/svg+xml", svg)];
    if (optEnum(options, "format", ["svg", "png", "both"] as const, "svg") !== "svg") {
      // `sharp` is already a dependency (phase 09), so the PNG costs nothing new.
      const sharp = (await import("sharp")).default;
      const png = await sharp(Buffer.from(svg), { density: 144 }).png({ compressionLevel: 9 }).toBuffer();
      files.push({ name: `${file!.name}-chart.png`, mimeType: "image/png", bytes: new Uint8Array(png) });
    }
    if (optEnum(options, "format", ["svg", "png", "both"] as const, "svg") === "png") files.shift();

    const total = points.reduce((sum, p) => sum + p.value, 0);
    return {
      ok: true,
      output: {
        type: chart.type,
        points: points.slice(0, 200),
        plotted: points.length,
        total: Math.round(total * 1e6) / 1e6,
        result: `${chart.type} chart of ${points.length} points`,
      },
      summary: `${chart.type[0]!.toUpperCase()}${chart.type.slice(1)} chart of ${plural(points.length, "point")} from "${table.headers[valueColumn]}"${points.length >= limit ? ` (the first ${limit})` : ""}.`,
      files,
    };
  });
