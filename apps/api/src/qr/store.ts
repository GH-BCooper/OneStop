// Interim store for dynamic QR codes, hosted pages and scan counts (11-qr-tools.md).
//
// INTERIM STORAGE - MIGRATE IN PHASE 14
// -------------------------------------
// A dynamic QR code only works if the short URL printed into the code outlives the browser tab
// that made it, so this cannot live in IndexedDB the way 11-qr-tools.md suggests: the redirect is
// resolved on the server. Until 13-auth-database.md brings Postgres, records are kept in one JSON
// file under the data directory. The shape below is deliberately close to a table row
// (id / ownerToken / kind / payload / timestamps, scans as their own list) so the phase-14
// migration is a copy, not a redesign. See PROGRESS.md, phase 11.
//
// Ownership: there are no accounts yet, so a link is owned by a random `ownerToken` the browser
// keeps in a cookie. Phase 13 replaces that with the real user id.
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { unsupported } from "./formats.ts";

export type QrLinkKind = "redirect" | "page";

/** One piece of a hosted page. Assets are inlined as data URLs while storage is interim. */
export interface QrPageBlock {
  type: "heading" | "text" | "link" | "image" | "audio" | "file";
  /** Heading/paragraph text, link label, or file name. */
  text?: string;
  /** Link href. */
  url?: string;
  /** `data:...;base64,...` payload for image/audio/file blocks. */
  data?: string;
  /** Original file name for a downloadable block. */
  fileName?: string;
  /** Byte size of `data`, kept so a listing never has to decode it. */
  size?: number;
}

export interface QrPage {
  title: string;
  /** Short line under the title. */
  subtitle?: string;
  blocks: QrPageBlock[];
  /** Accent colour for the hosted page. */
  accent?: string;
}

export interface QrScan {
  at: string;
  /** Coarse client hints only: never an IP address, never anything identifying (master plan 15). */
  device?: string;
  referrer?: string;
}

export interface QrLink {
  id: string;
  kind: QrLinkKind;
  /** Short label shown in the analytics list. */
  title: string;
  /** Destination for a `redirect` link. */
  target?: string;
  /** Hosted content for a `page` link. */
  page?: QrPage;
  ownerToken: string | null;
  createdAt: string;
  updatedAt: string;
  /** A paused link still resolves, but shows "this code is paused" instead of redirecting. */
  active: boolean;
  scanCount: number;
  lastScannedAt: string | null;
  /** The most recent scans, newest last. Capped so the file cannot grow without bound. */
  scans: QrScan[];
  /** Every destination this code has had, oldest first. Proves the code itself never changed. */
  history: { at: string; target: string }[];
}

export interface CreateQrLinkInput {
  kind: QrLinkKind;
  title: string;
  target?: string;
  page?: QrPage;
  ownerToken?: string | null;
}

export interface UpdateQrLinkInput {
  title?: string;
  target?: string;
  page?: QrPage;
  active?: boolean;
}

/** Most recent scans kept per link. */
export const MAX_SCANS_KEPT = 500;
/** Largest inlined asset, and largest page, while storage is interim. */
export const MAX_ASSET_BYTES = 2 * 1024 * 1024;
export const MAX_PAGE_BYTES = 8 * 1024 * 1024;
/** Ceiling on how many links the interim file holds, so it stays a file and not a database. */
export const MAX_LINKS = 2000;

const ID_RE = /^[0-9a-z]{10}$/;

/** Short, URL-safe, unambiguous ids: the whole point is a code that stays small. */
export function newLinkId(): string {
  const alphabet = "23456789abcdefghijkmnpqrstuvwxyz";
  const bytes = randomUUID().replace(/-/g, "");
  let id = "";
  for (let i = 0; i < 10; i += 1) {
    id += alphabet[parseInt(bytes.slice(i * 2, i * 2 + 2), 16) % alphabet.length];
  }
  return id;
}

export function isQrLinkId(id: string): boolean {
  return ID_RE.test(id);
}

function dataDir(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.QR_DATA_DIR?.trim() || env.DATA_DIR?.trim() || ".onestop-data";
  return path.resolve(base);
}

export interface QrStore {
  readonly file: string;
  list(ownerToken?: string | null): Promise<QrLink[]>;
  get(id: string): Promise<QrLink | undefined>;
  create(input: CreateQrLinkInput): Promise<QrLink>;
  update(id: string, patch: UpdateQrLinkInput, ownerToken?: string | null): Promise<QrLink>;
  remove(id: string, ownerToken?: string | null): Promise<boolean>;
  /** Records one scan and returns the link as it now stands. */
  recordScan(id: string, scan?: Omit<QrScan, "at">): Promise<QrLink | undefined>;
  /** Test helper: forget everything, on disk and in memory. */
  clear(): Promise<void>;
}

function pageBytes(page: QrPage): number {
  return page.blocks.reduce((sum, b) => sum + (b.size ?? b.data?.length ?? 0), 0);
}

/** Rejects anything that would make a hosted page unsafe or unreasonably large. */
export function validatePage(page: QrPage): QrPage {
  const title = page.title.trim();
  if (title === "") throw unsupported("Give the page a title.");
  if (page.blocks.length === 0) throw unsupported("Add something to the page first.");
  if (page.blocks.length > 100) throw unsupported("A page can hold at most 100 items.");
  for (const block of page.blocks) {
    if (block.url !== undefined && !/^https?:\/\//i.test(block.url)) {
      throw unsupported("Page links must start with http:// or https://.");
    }
    if (block.data !== undefined) {
      if (!/^data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,/i.test(block.data)) {
        throw unsupported("A page attachment could not be read.");
      }
      if ((block.size ?? block.data.length) > MAX_ASSET_BYTES) {
        throw unsupported("Each attachment on a hosted page must be under 2 MB for now.");
      }
    }
  }
  if (pageBytes(page) > MAX_PAGE_BYTES) {
    throw unsupported(
      "This page's attachments add up to more than 8 MB. Remove one and try again.",
    );
  }
  return { ...page, title };
}

class JsonQrStore implements QrStore {
  readonly file: string;
  /** Writes are chained so two concurrent requests can never interleave a read-modify-write. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(file: string) {
    this.file = file;
  }

  /**
   * Always read from disk. Next.js can hold more than one instance of a server module (a route
   * handler and a page are bundled separately), and each would otherwise keep its own copy of the
   * map: a scan recorded by `/q/<id>` would then be overwritten by an edit made through the API,
   * and vice versa. The file is small and these operations are rare, so re-reading is the simple,
   * correct choice - Postgres removes the question entirely in phase 14.
   */
  private async load(): Promise<Map<string, QrLink>> {
    const links = new Map<string, QrLink>();
    try {
      const text = await fs.readFile(this.file, "utf8");
      const parsed: unknown = JSON.parse(text);
      const rows = Array.isArray(parsed) ? parsed : [];
      for (const row of rows) {
        const link = row as QrLink;
        if (link && typeof link.id === "string" && isQrLinkId(link.id)) links.set(link.id, link);
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        console.error(`[qr] could not read ${this.file}; starting empty`, err);
      }
    }
    return links;
  }

  private async persist(links: Map<string, QrLink>): Promise<void> {
    const rows = [...links.values()];
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    // Write-then-rename, so a crash mid-write never leaves a truncated file behind.
    const temp = `${this.file}.${process.pid}.tmp`;
    await fs.writeFile(temp, JSON.stringify(rows, null, 2), { encoding: "utf8", mode: 0o600 });
    await fs.rename(temp, this.file);
  }

  /** Runs `fn` with exclusive access to the map, then saves. */
  private write<T>(fn: (links: Map<string, QrLink>) => Promise<T> | T): Promise<T> {
    const next = this.queue.then(async () => {
      const links = await this.load();
      const result = await fn(links);
      await this.persist(links);
      return result;
    });
    // Keep the chain alive even when one caller rejects.
    this.queue = next.catch(() => undefined);
    return next;
  }

  async list(ownerToken?: string | null): Promise<QrLink[]> {
    const links = await this.load();
    const all = [...links.values()];
    const mine = ownerToken ? all.filter((l) => l.ownerToken === ownerToken) : all;
    return mine.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async get(id: string): Promise<QrLink | undefined> {
    if (!isQrLinkId(id)) return undefined;
    return (await this.load()).get(id);
  }

  create(input: CreateQrLinkInput): Promise<QrLink> {
    return this.write((links) => {
      if (links.size >= MAX_LINKS) {
        throw unsupported(
          "You have reached the limit of 2000 saved QR codes. Delete one you no longer need.",
        );
      }
      const now = new Date().toISOString();
      let id = newLinkId();
      while (links.has(id)) id = newLinkId();
      const link: QrLink = {
        id,
        kind: input.kind,
        title: input.title.trim() || "Untitled QR code",
        ...(input.target ? { target: input.target } : {}),
        ...(input.page ? { page: validatePage(input.page) } : {}),
        ownerToken: input.ownerToken ?? null,
        createdAt: now,
        updatedAt: now,
        active: true,
        scanCount: 0,
        lastScannedAt: null,
        scans: [],
        history: input.target ? [{ at: now, target: input.target }] : [],
      };
      links.set(id, link);
      return link;
    });
  }

  update(id: string, patch: UpdateQrLinkInput, ownerToken?: string | null): Promise<QrLink> {
    return this.write((links) => {
      const link = links.get(id);
      if (!link) throw unsupported("That QR code no longer exists.");
      if (ownerToken !== undefined && link.ownerToken !== null && link.ownerToken !== ownerToken) {
        throw unsupported("That QR code belongs to someone else.");
      }
      const now = new Date().toISOString();
      if (patch.title !== undefined) link.title = patch.title.trim() || link.title;
      if (patch.active !== undefined) link.active = patch.active;
      if (patch.target !== undefined && patch.target !== link.target) {
        link.target = patch.target;
        link.history.push({ at: now, target: patch.target });
        if (link.history.length > 50) link.history.splice(0, link.history.length - 50);
      }
      if (patch.page !== undefined) link.page = validatePage(patch.page);
      link.updatedAt = now;
      return link;
    });
  }

  remove(id: string, ownerToken?: string | null): Promise<boolean> {
    return this.write((links) => {
      const link = links.get(id);
      if (!link) return false;
      if (ownerToken !== undefined && link.ownerToken !== null && link.ownerToken !== ownerToken) {
        throw unsupported("That QR code belongs to someone else.");
      }
      links.delete(id);
      return true;
    });
  }

  recordScan(id: string, scan: Omit<QrScan, "at"> = {}): Promise<QrLink | undefined> {
    return this.write((links) => {
      const link = links.get(id);
      if (!link) return undefined;
      const at = new Date().toISOString();
      link.scanCount += 1;
      link.lastScannedAt = at;
      link.scans.push({ at, ...scan });
      if (link.scans.length > MAX_SCANS_KEPT) {
        link.scans.splice(0, link.scans.length - MAX_SCANS_KEPT);
      }
      return link;
    });
  }

  clear(): Promise<void> {
    return this.write(async (links) => {
      links.clear();
    });
  }
}

let store: QrStore | undefined;

/** The process-wide store. `file` is only passed by tests. */
export function getQrStore(file?: string): QrStore {
  if (file) return new JsonQrStore(file);
  if (!store) store = new JsonQrStore(path.join(dataDir(), "qr-links.json"));
  return store;
}

/** Test seam: swaps the process-wide store (pass undefined to restore the default). */
export function setQrStore(next: QrStore | undefined): void {
  store = next;
}

/**
 * The base URL a dynamic QR code points at. It has to be an absolute URL - a phone camera has no
 * idea what "/q/abc" means - so it is configured, not guessed.
 */
export function appBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw =
    env.NEXT_PUBLIC_APP_URL?.trim() ||
    env.APP_URL?.trim() ||
    (env.VERCEL_URL ? `https://${env.VERCEL_URL}` : "") ||
    "http://localhost:3000";
  return raw.replace(/\/+$/, "");
}

/** Where the code points: `<base>/q/<id>`. This string is what never changes. */
export function shortUrlFor(id: string, base = appBaseUrl()): string {
  return `${base}/q/${id}`;
}
