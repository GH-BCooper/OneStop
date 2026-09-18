// Dynamic QR codes and hosted pages (11-qr-tools.md).
//
// The idea is simple and is what makes these tools worth having: the code itself only ever holds
// `<app>/q/<id>`, a short string that never changes. What that id resolves to - a redirect target
// or a hosted page - is stored server-side and can be edited afterwards, so a code that is already
// printed on a poster can be pointed somewhere else.
//
// Storage is interim (see store.ts) until phase 14 brings it into Postgres. Since
// 13-auth-database.md a code created by a signed-in user is owned by their user id (the
// executor reads it from the ExecContext); a guest's code stays unowned, exactly as before.
import type { ExecContext, ExecResult, FileRef } from "@onestop/types";
import type { Executor } from "@onestop/tool-registry";
import { buildUrl } from "./formats.ts";
import {
  mimeForName,
  optString,
  qrResult,
  runQrTool,
  textInput,
  toDataUrl,
  unsupported,
} from "./common.ts";
import {
  getQrStore,
  shortUrlFor,
  validatePage,
  type QrLink,
  type QrPage,
  type QrPageBlock,
} from "./store.ts";

/** How many files one hosted page may carry while storage is interim. */
const MAX_PAGE_FILES = 20;

export interface HostedQrInput {
  title: string;
  /** A hosted page... */
  page?: QrPage;
  /** ...or a plain redirect. Exactly one of the two. */
  target?: string;
  note?: string;
  ownerToken?: string | null;
}

/**
 * Creates a stored link and returns the QR code for its short URL, plus everything the UI needs
 * to manage it later. Shared by every tool in this file.
 */
export async function hostedQrCode(
  toolId: string,
  options: Record<string, unknown>,
  input: HostedQrInput,
): Promise<ExecResult> {
  const store = getQrStore();
  const link = await store.create({
    kind: input.page ? "page" : "redirect",
    title: input.title,
    ...(input.page ? { page: input.page } : {}),
    ...(input.target ? { target: input.target } : {}),
    ownerToken: input.ownerToken ?? null,
  });
  const shortUrl = shortUrlFor(link.id);
  return qrResult(shortUrl, options, `${toolId}-${link.id}`, {
    output: {
      id: link.id,
      shortUrl,
      manageAt: "/tools/qr/dynamic-qr-code",
      kind: link.kind,
      title: link.title,
      ...(link.target ? { destination: link.target } : {}),
      createdAt: link.createdAt,
    },
    note: [
      `The code holds ${shortUrl}, which never changes.`,
      input.note ?? "",
      "Edit or pause it from Dynamic QR Code; scans are counted under QR Code Analytics.",
    ]
      .filter(Boolean)
      .join(" "),
  });
}

/** Dynamic QR Code: a redirect you can re-point at any time. */
export const dynamicQrExecutor: Executor = (input, options, ctx) =>
  runQrTool("dynamic-qr-code", async () => {
    const target = buildUrl(textInput(input, "the link this code should open"));
    const title = optString(options, "title") || new URL(target).host;
    return hostedQrCode("dynamic-qr-code", options, {
      title,
      target,
      ownerToken: (ctx as ExecContext).userId ?? null,
      note: `It currently opens ${target}.`,
    });
  });

/** Custom QR Landing Page: a small OneStop-hosted page, no external hosting needed. */
export const landingPageExecutor: Executor = (input, options, ctx) =>
  runQrTool("custom-qr-landing-page", async () => {
    const body = textInput(input, "the text for the page");
    const title = optString(options, "title") || "OneStop page";
    const blocks: QrPageBlock[] = [{ type: "text", text: body }];
    const linkUrl = optString(options, "linkUrl");
    if (linkUrl !== "") {
      blocks.push({
        type: "link",
        text: optString(options, "linkLabel") || linkUrl,
        url: buildUrl(linkUrl),
      });
    }
    const page: QrPage = {
      title,
      ...(optString(options, "subtitle") ? { subtitle: optString(options, "subtitle") } : {}),
      accent: optString(options, "accent", "#2563eb"),
      blocks,
    };
    return hostedQrCode("custom-qr-landing-page", options, {
      title,
      page: validatePage(page),
      ownerToken: (ctx as ExecContext).userId ?? null,
      note: "The page is hosted by OneStop; edit its text whenever you like.",
    });
  });

/** How a file is shown on a hosted page. */
function blockForFile(name: string, bytes: Uint8Array): QrPageBlock {
  const mimeType = mimeForName(name);
  const data = toDataUrl(bytes, mimeType);
  const type: QrPageBlock["type"] = mimeType.startsWith("image/")
    ? "image"
    : mimeType.startsWith("audio/")
      ? "audio"
      : "file";
  return { type, text: name, data, fileName: name, size: data.length };
}

/** QR Code -> Content Page: text, images, audio and files behind one code. */
export const contentPageExecutor: Executor = (input, options, ctx) =>
  runQrTool("qr-content-page", async () => {
    const files: FileRef[] = Array.isArray(input) ? input : [];
    const text = typeof input === "string" ? input : "";
    if (files.length === 0 && text.trim() === "") {
      throw unsupported("Add a file, or some text, for the page to hold.");
    }
    if (files.length > MAX_PAGE_FILES) {
      throw unsupported(`A content page can hold at most ${MAX_PAGE_FILES} files.`);
    }
    const title = optString(options, "title") || (files[0]?.name ?? "Shared content");
    const blocks: QrPageBlock[] = [];
    if (text.trim() !== "") blocks.push({ type: "text", text: text.trim() });
    for (const ref of files) {
      const bytes = await (ctx as ExecContext).readFile(ref);
      blocks.push(blockForFile(ref.name, bytes));
    }
    const page: QrPage = {
      title,
      ...(optString(options, "subtitle") ? { subtitle: optString(options, "subtitle") } : {}),
      accent: optString(options, "accent", "#2563eb"),
      blocks,
    };
    return hostedQrCode("qr-content-page", options, {
      title,
      page: validatePage(page),
      ownerToken: (ctx as ExecContext).userId ?? null,
      note: `The page holds ${blocks.length} item${blocks.length === 1 ? "" : "s"}.`,
    });
  });

// ---- resolution (used by the /q/<id> route) ----------------------------------------------------

export type ResolvedQr =
  | { status: "missing" }
  | { status: "paused"; link: QrLink }
  | { status: "redirect"; link: QrLink; target: string }
  | { status: "page"; link: QrLink; page: QrPage };

/**
 * Resolves a short id and counts the scan. The scan is recorded even for a paused code - knowing
 * a paused poster is still being scanned is exactly the sort of thing analytics is for.
 */
export async function resolveQrLink(
  id: string,
  scan: { device?: string; referrer?: string } = {},
): Promise<ResolvedQr> {
  const store = getQrStore();
  const link = await store.recordScan(id, scan);
  if (!link) return { status: "missing" };
  if (!link.active) return { status: "paused", link };
  if (link.kind === "redirect" && link.target) {
    return { status: "redirect", link, target: link.target };
  }
  if (link.page) return { status: "page", link, page: link.page };
  return { status: "missing" };
}
