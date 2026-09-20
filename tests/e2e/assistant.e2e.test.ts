/// <reference lib="dom" />
// Real-server, real-browser proof of phase 16 (16-ai-assistant.md).
//
// The server this drives has **no AI runtime at all**: no Ollama, no keys, no internet needed.
// That is the point — the phase's headline acceptance criterion is that OneStop stays fully
// functional with nothing configured, and the only honest way to check it is to run the real
// production bundle in that exact state and use the assistant.
//
// What it proves:
//   * master plan §7.1's example is planned as three real OneStop tools and runs end to end,
//     producing a downloadable file;
//   * a request OneStop cannot do shows grouped Free/Paid external recommendations, each with a
//     link, a purpose and a limitation, instead of inventing a tool;
//   * a plan naming a tool that is not in the registry is refused by the server before anything
//     runs, even when the request is crafted by hand rather than by the planner;
//   * the runtime panel discloses which runtime is in use, and says the assistant still works.
//
// Needs `npm run build` and a local Chrome or Edge. No database: the assistant works for guests.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const port = Number(process.env.E2E_ASSISTANT_PORT ?? 3117);

let server: ChildProcess | undefined;
let browser: Browser;

const baseUrl = () => process.env.E2E_BASE_URL ?? `http://127.0.0.1:${port}`;

async function waitForServer(url: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Server did not start at ${url}`);
}

async function launchBrowser(): Promise<Browser> {
  if (process.env.E2E_BROWSER_PATH) {
    return chromium.launch({ executablePath: process.env.E2E_BROWSER_PATH });
  }
  const errors: unknown[] = [];
  for (const channel of ["chrome", "msedge", "chromium"]) {
    try {
      return await chromium.launch({ channel });
    } catch (err) {
      errors.push(err);
    }
  }
  throw new Error(`No Chrome/Edge found; set E2E_BROWSER_PATH. ${String(errors.at(-1))}`);
}

/** A real four-page PDF with extractable text, built in the page so the upload is a genuine file. */
const MAKE_PDF = `
  (async () => {
    const enc = (s) => new TextEncoder().encode(s);
    // A minimal, valid 4-page PDF written by hand — no library needed in the browser.
    const pages = [1, 2, 3, 4];
    let objects = [];
    objects.push("1 0 obj\\n<< /Type /Catalog /Pages 2 0 R >>\\nendobj\\n");
    const kids = pages.map((p) => (2 + p) + " 0 R").join(" ");
    objects.push("2 0 obj\\n<< /Type /Pages /Kids [" + kids + "] /Count " + pages.length + " >>\\nendobj\\n");
    let contentStart = 2 + pages.length + 1;
    pages.forEach((p, i) => {
      objects.push((2 + p) + " 0 obj\\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 " + (contentStart + pages.length) + " 0 R >> >> /Contents " + (contentStart + i) + " 0 R >>\\nendobj\\n");
    });
    pages.forEach((p, i) => {
      const text = "BT /F1 18 Tf 60 760 Td (Region " + p + " Units " + (p * 10) + ") Tj ET";
      objects.push((contentStart + i) + " 0 obj\\n<< /Length " + text.length + " >>\\nstream\\n" + text + "\\nendstream\\nendobj\\n");
    });
    objects.push((contentStart + pages.length) + " 0 obj\\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\\nendobj\\n");

    let pdf = "%PDF-1.4\\n";
    const offsets = [0];
    for (const obj of objects) { offsets.push(pdf.length); pdf += obj; }
    const xref = pdf.length;
    pdf += "xref\\n0 " + (objects.length + 1) + "\\n0000000000 65535 f \\n";
    for (let i = 1; i <= objects.length; i++) {
      pdf += String(offsets[i]).padStart(10, "0") + " 00000 n \\n";
    }
    pdf += "trailer\\n<< /Size " + (objects.length + 1) + " /Root 1 0 R >>\\nstartxref\\n" + xref + "\\n%%EOF";

    const dt = new DataTransfer();
    dt.items.add(new File([enc(pdf)], "report.pdf", { type: "application/pdf" }));
    return dt;
  })()
`;

async function attachPdf(page: Page): Promise<void> {
  const input = page.locator('input[type="file"]').first();
  const handle = await page.evaluateHandle(MAKE_PDF);
  await page.evaluate(
    ([element, transfer]) => {
      (element as HTMLInputElement).files = (transfer as DataTransfer).files;
      element.dispatchEvent(new Event("change", { bubbles: true }));
    },
    [await input.elementHandle(), handle] as const,
  );
}

describe("the AI Assistant in a real browser, with no AI runtime configured", () => {
  beforeAll(async () => {
    if (!existsSync(path.join(root, "apps/web/.next/BUILD_ID"))) {
      throw new Error("Run `npm run build` before `npm run test:e2e`.");
    }
    server = spawn(
      process.execPath,
      [
        path.join(root, "node_modules/next/dist/bin/next"),
        "start",
        "-p",
        String(port),
        "-H",
        "127.0.0.1",
      ],
      {
        cwd: path.join(root, "apps/web"),
        stdio: ["ignore", "ignore", "ignore"],
        env: {
          ...process.env,
          APP_URL: `http://127.0.0.1:${port}`,
          // The whole point of this file: nothing AI is configured, and Ollama is pointed at a
          // port nothing is listening on so a developer's own install cannot make it pass.
          OLLAMA_HOST: "http://127.0.0.1:1",
          GROQ_API_KEY: "",
          OPENROUTER_API_KEY: "",
          GOOGLE_AI_API_KEY: "",
          AI_IMAGE_URL: "",
        },
      },
    );
    await waitForServer(baseUrl());
    browser = await launchBrowser();
  }, 180_000);

  afterAll(async () => {
    await browser?.close();
    server?.kill();
  });

  async function newPage(): Promise<Page> {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    return context.newPage();
  }

  it("says which runtime it has, and that it still works without one", async () => {
    const page = await newPage();
    await page.goto(`${baseUrl()}/assistant`);
    const runtime = page.getByTestId("assistant-runtime");
    await expect
      .poll(async () => runtime.textContent(), { timeout: 20_000 })
      .toContain("built-in offline method");
    expect(await runtime.textContent()).toContain("Not configured");
    await page.close();
  }, 60_000);

  it("plans and runs master plan §7.1's example end to end", async () => {
    const page = await newPage();
    await page.goto(`${baseUrl()}/assistant`);

    await page
      .getByTestId("assistant-request")
      .fill("Convert this PDF to Excel, remove the first 2 pages, then compress the result");
    await attachPdf(page);
    await page.getByRole("button", { name: "Send" }).click();

    const plan = page.getByTestId("assistant-plan");
    await plan.waitFor({ state: "visible", timeout: 30_000 });
    const planText = (await plan.textContent()) ?? "";
    // Three real registry tools, named as the catalogue names them.
    expect(planText).toContain("Delete PDF Pages");
    expect(planText).toContain("PDF → Excel");
    expect(planText).toContain("File Compressor");
    expect(planText).toContain("pages: 1-2");

    await page.getByTestId("assistant-run").click();
    const result = page.getByTestId("assistant-result");
    await result.waitFor({ state: "visible", timeout: 120_000 });
    const resultText = (await result.textContent()) ?? "";
    expect(resultText).toContain("Finished");

    // The result is a real, downloadable file.
    const link = result.locator("a[download]").first();
    await link.waitFor({ state: "visible", timeout: 20_000 });
    const href = await link.getAttribute("href");
    const download = await fetch(`${baseUrl()}${href}`);
    expect(download.ok).toBe(true);
    expect((await download.arrayBuffer()).byteLength).toBeGreaterThan(100);
    await page.close();
  }, 240_000);

  it("recommends external tools instead of inventing one it does not have", async () => {
    const page = await newPage();
    await page.goto(`${baseUrl()}/assistant`);
    await page.getByTestId("assistant-request").fill("generate a 3D model of a house");
    await page.getByRole("button", { name: "Send" }).click();

    const panel = page.getByTestId("external-recommendations");
    await panel.waitFor({ state: "visible", timeout: 30_000 });
    const free = page.getByTestId("recommendations-free");
    const paid = page.getByTestId("recommendations-paid");
    expect(await free.textContent()).toContain("Limitation:");
    expect(await paid.textContent()).toContain("Limitation:");
    // Grouped, not mixed.
    expect(await free.textContent()).toContain("Blender");
    expect(await paid.textContent()).not.toContain("Blender");
    // Every recommendation is a real outbound link, opened safely.
    const first = free.locator("a").first();
    expect(await first.getAttribute("href")).toMatch(/^https:\/\//);
    expect(await first.getAttribute("rel")).toContain("noopener");
    await page.close();
  }, 60_000);

  it("refuses a hand-crafted plan naming a tool that is not in the registry", async () => {
    // Straight at the API: the browser is not the boundary, the server is.
    const form = new FormData();
    form.set(
      "plan",
      JSON.stringify({
        steps: [
          { toolId: "merge-pdf", options: {} },
          { toolId: "totally-made-up-tool", options: {} },
        ],
        explanation: "a bad model answer",
      }),
    );
    form.append(
      "files",
      new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "a.pdf", {
        type: "application/pdf",
      }),
    );

    const response = await fetch(`${baseUrl()}/api/assistant/run`, { method: "POST", body: form });
    expect(response.status).toBe(422);
    const body = (await response.json()) as {
      error?: { message?: string };
      rejected?: { toolId: string }[];
    };
    expect(body.error?.message).toContain("totally-made-up-tool");
    expect(body.error?.message).toContain("Nothing was run");
    expect(body.rejected?.[0]?.toolId).toBe("totally-made-up-tool");
  }, 60_000);

  it("reports no runtime through the status endpoint rather than failing", async () => {
    const response = await fetch(`${baseUrl()}/api/assistant/status`);
    expect(response.ok).toBe(true);
    const body = (await response.json()) as { status?: { available: boolean; message: string } };
    expect(body.status?.available).toBe(false);
    expect(body.status?.message).toContain("Ollama");
  }, 60_000);
});
