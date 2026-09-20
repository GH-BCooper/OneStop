// Generates the PWA icon set from the real OneStop logo (18-pwa-offline.md).
//
// Run with `node scripts/build-icons.mjs`. The output is committed, so the app needs neither this
// script nor sharp at build or run time - the script exists so the icons can be regenerated when
// the logo changes, without a design tool or a paid service (CLAUDE.md §2).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const outDir = path.resolve(import.meta.dirname, "../apps/web/public/icons");
const logoPath = path.resolve(import.meta.dirname, "../apps/web/public/images/Logo.png");

const BG = "#0a0716"; // dark "royal" theme bg token - the icon canvas colour in every context

function canvasSvg(size, round) {
  const r = round ? Math.round(size * 0.22) : 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="${BG}"/></svg>`;
}

/** The logo, contained within `size * (1 - inset*2)`, centered on the dark canvas. */
async function iconBuffer(size, inset, { round = true } = {}) {
  const logoSize = Math.max(1, Math.round(size * (1 - inset * 2)));
  const logo = await sharp(logoPath)
    .resize(logoSize, logoSize, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();
  return sharp(Buffer.from(canvasSvg(size, round)))
    .composite([{ input: logo, gravity: "center" }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

const targets = [
  { file: "icon-192.png", size: 192, round: true, inset: 0.14 },
  { file: "icon-512.png", size: 512, round: true, inset: 0.14 },
  { file: "maskable-192.png", size: 192, round: false, inset: 0.24 },
  { file: "maskable-512.png", size: 512, round: false, inset: 0.24 },
  { file: "apple-touch-icon.png", size: 180, round: false, inset: 0.14 },
];

await mkdir(outDir, { recursive: true });
for (const t of targets) {
  const buf = await iconBuffer(t.size, t.inset, { round: t.round });
  await writeFile(path.join(outDir, t.file), buf);
  console.log(`wrote ${t.file} (${t.size}x${t.size})`);
}

// "monochrome" purpose: a greyscale rendition, which launchers that want a single-tint badge can
// still use sensibly even though it is not a pure alpha silhouette.
const monoLogo = await sharp(logoPath)
  .resize(512 - Math.round(512 * 0.28), 512 - Math.round(512 * 0.28), { fit: "contain" })
  .greyscale()
  .toBuffer();
await sharp(Buffer.from(canvasSvg(512, false)))
  .composite([{ input: monoLogo, gravity: "center" }])
  .png({ compressionLevel: 9 })
  .toFile(path.join(outDir, "icon-monochrome.png"));
console.log("wrote icon-monochrome.png (512x512)");

// Favicon: small PNG, no separate .ico toolchain needed.
await writeFile(path.join(outDir, "favicon-32.png"), await iconBuffer(32, 0.1));
console.log("wrote favicon-32.png (32x32)");

// Vector fallback: the same canvas + logo, with the PNG embedded as a data URI so one file works
// as `type="image/svg+xml"` without tracing the logo into real vector paths.
const logoDataUrl = `data:image/png;base64,${(await readFile(logoPath)).toString("base64")}`;
const svgSize = 512;
const svgInset = svgSize * 0.14;
const svgLogoSize = svgSize - svgInset * 2;
const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgSize}" height="${svgSize}" viewBox="0 0 ${svgSize} ${svgSize}">
  <rect width="${svgSize}" height="${svgSize}" rx="${Math.round(svgSize * 0.22)}" fill="${BG}"/>
  <image x="${svgInset}" y="${svgInset}" width="${svgLogoSize}" height="${svgLogoSize}" href="${logoDataUrl}" preserveAspectRatio="xMidYMid meet"/>
</svg>`;
await writeFile(path.join(outDir, "icon.svg"), iconSvg, "utf8");
console.log("wrote icon.svg");
