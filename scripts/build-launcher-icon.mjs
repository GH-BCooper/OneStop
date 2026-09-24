// Generates `launcher/onestop.ico`, the icon baked into OneStop.exe (see launcher/README.md).
//
// Run with `node scripts/build-launcher-icon.mjs`. The .ico is committed, so building the launcher
// needs neither this script nor sharp - it exists so the icon can follow the logo when that changes.
// Windows (Vista+) accepts PNG-compressed images inside an .ico, so each size is simply a PNG.
import { writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const logoPath = path.resolve(import.meta.dirname, "../apps/web/public/images/Logo.png");
const outFile = path.resolve(import.meta.dirname, "../launcher/onestop.ico");
const BG = "#08090b"; // same canvas colour as the PWA icons (scripts/build-icons.mjs)
const SIZES = [16, 24, 32, 48, 64, 128, 256];

async function png(size) {
  const r = Math.round(size * 0.22);
  const canvas = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="${BG}"/></svg>`;
  const logoSize = Math.max(1, Math.round(size * (size <= 32 ? 0.9 : 0.76)));
  const logo = await sharp(logoPath)
    .resize(logoSize, logoSize, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();
  return sharp(Buffer.from(canvas))
    .composite([{ input: logo, gravity: "center" }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

const images = await Promise.all(SIZES.map(png));

// ICONDIR (6 bytes) + one ICONDIRENTRY (16 bytes) per image, then the PNG data.
const header = Buffer.alloc(6 + 16 * images.length);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(images.length, 4);
let offset = header.length;
images.forEach((img, i) => {
  const e = 6 + 16 * i;
  const size = SIZES[i];
  header.writeUInt8(size >= 256 ? 0 : size, e); // 0 means 256
  header.writeUInt8(size >= 256 ? 0 : size, e + 1);
  header.writeUInt8(0, e + 2); // no palette
  header.writeUInt8(0, e + 3); // reserved
  header.writeUInt16LE(1, e + 4); // colour planes
  header.writeUInt16LE(32, e + 6); // bits per pixel
  header.writeUInt32LE(img.length, e + 8);
  header.writeUInt32LE(offset, e + 12);
  offset += img.length;
});

await writeFile(outFile, Buffer.concat([header, ...images]));
console.log(`wrote ${path.relative(process.cwd(), outFile)} (${SIZES.join(", ")} px)`);
