// Generates the PWA icon set from one inline SVG (18-pwa-offline.md).
//
// Run with `node scripts/build-icons.mjs`. The output is committed, so the app needs neither
// this script nor sharp at build or run time - the script exists so the icons can be regenerated
// when the mark changes, without a design tool or a paid service (CLAUDE.md §2).
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const outDir = path.resolve(import.meta.dirname, "../apps/web/public/icons");

const BG = "#0b1120"; // dark theme bg token
const FG = "#818cf8"; // dark theme primary token

/**
 * The OneStop mark: the header's diamond, on the dark background.
 * `inset` leaves room for a maskable icon's safe zone (the outer 10% may be cropped by the
 * launcher, so the glyph stays inside the middle 80%).
 */
function svg(size, { round, inset }) {
  const r = round ? Math.round(size * 0.22) : 0;
  const c = size / 2;
  const half = (size * (1 - inset * 2)) / 2;
  const bar = Math.max(2, Math.round(size * 0.055));
  const inner = half * 0.42;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="${BG}"/>
  <path d="M ${c} ${c - half} L ${c + half} ${c} L ${c} ${c + half} L ${c - half} ${c} Z"
        fill="none" stroke="${FG}" stroke-width="${bar}" stroke-linejoin="round"/>
  <path d="M ${c} ${c - inner} L ${c + inner} ${c} L ${c} ${c + inner} L ${c - inner} ${c} Z"
        fill="${FG}"/>
</svg>`;
}

const targets = [
  { file: "icon-192.png", size: 192, round: true, inset: 0.22 },
  { file: "icon-512.png", size: 512, round: true, inset: 0.22 },
  { file: "maskable-192.png", size: 192, round: false, inset: 0.28 },
  { file: "maskable-512.png", size: 512, round: false, inset: 0.28 },
  { file: "apple-touch-icon.png", size: 180, round: false, inset: 0.22 },
  { file: "icon-monochrome.png", size: 512, round: false, inset: 0.24 },
];

await mkdir(outDir, { recursive: true });
for (const t of targets) {
  const buf = Buffer.from(svg(t.size, { round: t.round, inset: t.inset }));
  await sharp(buf).png({ compressionLevel: 9 }).toFile(path.join(outDir, t.file));
  console.log(`wrote ${t.file} (${t.size}x${t.size})`);
}
// A favicon the browser tab can use without a separate .ico toolchain: 32px PNG.
await sharp(Buffer.from(svg(32, { round: true, inset: 0.2 })))
  .png({ compressionLevel: 9 })
  .toFile(path.join(outDir, "favicon-32.png"));
console.log("wrote favicon-32.png (32x32)");
await writeFile(path.join(outDir, "icon.svg"), svg(512, { round: true, inset: 0.22 }), "utf8");
console.log("wrote icon.svg");
