// Installability audit for a running OneStop (18-pwa-offline.md).
//
// Lighthouse's "installable" audit is a fixed checklist, and every item on it can be checked with a
// few HTTP requests - which is what this does, against `next start`. It needs no Chrome, no npx
// download and no account, so it runs on any machine and in CI (CLAUDE.md §2). The one thing it
// cannot see is the live registration, which `tests/e2e/pwa.e2e.test.ts` checks in a real browser.
//
// Usage:  node scripts/pwa-audit.mjs [baseUrl]      (default http://127.0.0.1:3000)
// Exits non-zero when any required check fails, so it can gate a deploy.

const base = (process.argv[2] ?? process.env.PWA_AUDIT_URL ?? "http://127.0.0.1:3000").replace(
  /\/$/,
  "",
);

const results = [];
function record(required, name, pass, detail) {
  results.push({ required, name, pass, detail });
}

async function get(path) {
  const response = await fetch(`${base}${path}`, { redirect: "follow" });
  return { response, body: await response.text() };
}

/** PNG dimensions, straight out of the IHDR chunk - no image library needed. */
function pngSize(buffer) {
  if (buffer.length < 24) return null;
  const signature = buffer.subarray(0, 8).toString("hex");
  if (signature !== "89504e470d0a1a0a") return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

const home = await get("/");
record(true, "Home page responds", home.response.ok, `HTTP ${home.response.status}`);

const hasViewport = /<meta[^>]+name="viewport"/i.test(home.body);
record(true, "Has a viewport meta tag", hasViewport, "responsive layout requirement");

const linksManifest = /<link[^>]+rel="manifest"[^>]+href="([^"]+)"/i.exec(home.body);
record(
  true,
  "Home page links the manifest",
  Boolean(linksManifest),
  linksManifest?.[1] ?? "missing",
);

const hasThemeColor = /<meta[^>]+name="theme-color"/i.test(home.body);
record(false, "Declares a theme colour", hasThemeColor, "used for the app window chrome");

const manifestPath = linksManifest?.[1] ?? "/manifest.json";
const manifestRes = await get(manifestPath);
record(
  true,
  "Manifest is fetchable",
  manifestRes.response.ok,
  `HTTP ${manifestRes.response.status}`,
);

let manifest = null;
try {
  manifest = JSON.parse(manifestRes.body);
  record(true, "Manifest is valid JSON", true, "");
} catch (err) {
  record(true, "Manifest is valid JSON", false, String(err));
}

if (manifest) {
  record(
    true,
    "Manifest has name",
    typeof manifest.name === "string" && manifest.name.length > 0,
    manifest.name ?? "",
  );
  record(
    true,
    "Manifest has short_name",
    typeof manifest.short_name === "string" && manifest.short_name.length > 0,
    manifest.short_name ?? "",
  );
  const startRes = await get(manifest.start_url ?? "/");
  record(
    true,
    "start_url responds",
    startRes.response.ok,
    `${manifest.start_url} -> HTTP ${startRes.response.status}`,
  );
  record(
    true,
    "display is standalone-like",
    ["standalone", "fullscreen", "minimal-ui"].includes(manifest.display),
    String(manifest.display),
  );
  record(false, "Has a scope", typeof manifest.scope === "string", String(manifest.scope));
  record(
    false,
    "Has a background colour",
    typeof manifest.background_color === "string",
    String(manifest.background_color),
  );

  const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
  const pngIcons = [];
  for (const icon of icons) {
    if (!icon?.src || icon.type === "image/svg+xml") continue;
    const res = await fetch(`${base}${icon.src}`);
    if (!res.ok) {
      record(true, `Icon ${icon.src} responds`, false, `HTTP ${res.status}`);
      continue;
    }
    const size = pngSize(Buffer.from(await res.arrayBuffer()));
    record(
      true,
      `Icon ${icon.src} is a real PNG`,
      Boolean(size),
      size ? `${size.width}x${size.height}` : "not a PNG",
    );
    if (size) pngIcons.push({ ...icon, ...size });
  }
  record(
    true,
    "Has a 192px (or larger) icon",
    pngIcons.some((i) => i.width >= 192 && i.height >= 192),
    "Chrome installability minimum",
  );
  record(
    true,
    "Has a 512px icon",
    pngIcons.some((i) => i.width >= 512 && i.height >= 512),
    "splash-screen requirement",
  );
  record(
    false,
    "Has a maskable icon",
    icons.some((i) =>
      String(i.purpose ?? "")
        .split(/\s+/)
        .includes("maskable"),
    ),
    "Android adaptive icon",
  );
}

const sw = await get("/sw.js");
record(true, "Service worker is served", sw.response.ok, `HTTP ${sw.response.status}`);
record(
  true,
  "Service worker handles fetch",
  /addEventListener\(\s*["']fetch["']/.test(sw.body),
  "an installable PWA needs a fetch handler",
);
record(
  false,
  "Service worker is served as JavaScript",
  (sw.response.headers.get("content-type") ?? "").includes("javascript"),
  sw.response.headers.get("content-type") ?? "none",
);

const offline = await get("/offline");
record(
  true,
  "Offline fallback page responds",
  offline.response.ok,
  `HTTP ${offline.response.status}`,
);

const ping = await get("/api/ping");
record(true, "Connectivity probe responds", ping.response.ok, `HTTP ${ping.response.status}`);

const secure = base.startsWith("https://") || /^http:\/\/(127\.0\.0\.1|localhost)(:|$)/.test(base);
record(true, "Served from a secure context", secure, base);

const failed = results.filter((r) => r.required && !r.pass);
const warned = results.filter((r) => !r.required && !r.pass);

for (const r of results) {
  const mark = r.pass ? "PASS" : r.required ? "FAIL" : "WARN";
  console.log(`${mark}  ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
}
console.log(
  `\n${results.length - failed.length - warned.length}/${results.length} checks passed` +
    `${failed.length ? `, ${failed.length} required failure(s)` : ""}` +
    `${warned.length ? `, ${warned.length} warning(s)` : ""}`,
);
process.exit(failed.length > 0 ? 1 : 0);
