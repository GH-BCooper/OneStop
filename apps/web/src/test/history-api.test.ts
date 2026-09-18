// The phase-14 HTTP surface (14-history-favorites.md), driven through the real route handlers:
// history, favourites, settings sync and usage. Like the phase-13 suite, the database-backed
// cases skip themselves when no TEST_DATABASE_URL/DATABASE_URL is configured; the guest cases
// always run, because a guest must work with no database at all.
import {
  createIsolatedTestPrisma,
  disconnectPrisma,
  dropTestSchema,
  hasTestDatabase,
  resetTestDatabase,
  testDatabaseUrl,
  urlForSchema,
  type PrismaClient,
} from "@onestop/api";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const SCHEMA = "test_history_routes";
const url = testDatabaseUrl();
if (url) process.env.DATABASE_URL = urlForSchema(url, SCHEMA);

const session = { userId: null as string | null };
vi.mock("@/auth", () => ({
  currentUserId: async () => session.userId,
  authIsConfigured: () => true,
  googleIsConfigured: () => false,
}));

const history = await import("@/app/api/history/route");
const historyEntry = await import("@/app/api/history/[id]/route");
const historyImport = await import("@/app/api/history/import/route");
const favorites = await import("@/app/api/favorites/route");
const settings = await import("@/app/api/settings/route");
const usage = await import("@/app/api/usage/route");

interface Envelope {
  ok?: boolean;
  entries?: { id: string; toolId: string; status: string; outputs: unknown[] }[];
  total?: number;
  page?: number;
  pageCount?: number;
  favorites?: string[];
  on?: boolean;
  settings?: { theme: string; preferredAI: string | null; preferences: Record<string, unknown> };
  usage?: Record<string, number>;
  recent?: string[];
  synced?: boolean;
  imported?: number;
  skipped?: number;
  removed?: number | boolean;
  error?: { code: string; message: string };
}

function get(handler: (r: Request) => Promise<Response>, path: string) {
  return handler(new Request(`http://localhost${path}`));
}

function send(
  handler: (r: Request) => Promise<Response>,
  path: string,
  method: string,
  body: unknown,
) {
  return handler(
    new Request(`http://localhost${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function json(response: Response): Promise<{ status: number; body: Envelope }> {
  return { status: response.status, body: (await response.json()) as Envelope };
}

const describeDb = hasTestDatabase() ? describe : describe.skip;

describeDb("history, favourites and settings (Postgres)", () => {
  let prisma: PrismaClient;
  let userId: string;
  let otherId: string;

  /** Creates a finished job the way the pipeline would, with metadata history can read back. */
  async function seedJob(options: {
    userId?: string | null;
    toolId: string;
    status?: string;
    createdAt: string;
    files?: { name: string; expiresAt: string }[];
    summary?: string;
  }) {
    return prisma.job.create({
      data: {
        userId: options.userId === undefined ? userId : options.userId,
        toolId: options.toolId,
        status: options.status ?? "success",
        createdAt: new Date(options.createdAt),
        inputMetadata: {
          execution: "server",
          fileCount: 1,
          files: [{ name: `${options.toolId}-input.bin`, size: 10, type: "" }],
        } as never,
        outputMetadata: {
          execution: "server",
          summary: options.summary ?? `${options.toolId} finished`,
          files: (options.files ?? []).map((f, i) => ({
            id: `file-${options.toolId}-${i}`,
            name: f.name,
            mimeType: "application/pdf",
            size: 100,
            expiresAt: f.expiresAt,
          })),
        } as never,
      },
    });
  }

  beforeAll(async () => {
    prisma = await createIsolatedTestPrisma(SCHEMA);
  });

  // Rows, not `signUp`: these routes never look at a password, and bcrypt at cost 12 would be
  // the slowest thing running before every test in the file.
  async function makeUser(email: string): Promise<string> {
    const { id } = await prisma.user.create({ data: { email, name: email.split("@")[0] } });
    return id;
  }

  beforeEach(async () => {
    await resetTestDatabase(prisma);
    userId = await makeUser("sam@example.com");
    otherId = await makeUser("alex@example.com");
    session.userId = userId;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await disconnectPrisma();
    await dropTestSchema(SCHEMA);
    vi.restoreAllMocks();
  });

  // ---- history ------------------------------------------------------------------------------

  it("lists a signed-in user's jobs, newest first, with the metadata the page renders", async () => {
    await seedJob({ toolId: "merge-pdf", createdAt: "2026-09-10T10:00:00.000Z" });
    await seedJob({
      toolId: "split-pdf",
      createdAt: "2026-09-19T10:00:00.000Z",
      files: [{ name: "part-1.pdf", expiresAt: "2099-01-01T00:00:00.000Z" }],
    });

    const { status, body } = await json(await get(history.GET, "/api/history"));
    expect(status).toBe(200);
    expect(body.total).toBe(2);
    expect(body.entries?.map((e) => e.toolId)).toEqual(["split-pdf", "merge-pdf"]);
    expect(body.entries?.[0]).toMatchObject({
      status: "success",
      summary: "split-pdf finished",
      inputs: ["split-pdf-input.bin"],
      scope: "account",
    });
    expect(body.entries?.[0]?.outputs).toHaveLength(1);
  });

  it("never shows another account's jobs, or a guest's", async () => {
    await seedJob({ toolId: "merge-pdf", createdAt: "2026-09-10T10:00:00.000Z" });
    await seedJob({ userId: otherId, toolId: "split-pdf", createdAt: "2026-09-11T10:00:00.000Z" });
    await seedJob({ userId: null, toolId: "rotate-pdf", createdAt: "2026-09-12T10:00:00.000Z" });

    const { body } = await json(await get(history.GET, "/api/history"));
    expect(body.entries?.map((e) => e.toolId)).toEqual(["merge-pdf"]);
  });

  it("filters by tool, category, status and date range", async () => {
    await seedJob({ toolId: "merge-pdf", createdAt: "2026-09-10T10:00:00.000Z" });
    await seedJob({ toolId: "split-pdf", status: "failed", createdAt: "2026-09-15T10:00:00.000Z" });
    await seedJob({ toolId: "compress-image", createdAt: "2026-09-19T10:00:00.000Z" });

    const byTool = await json(await get(history.GET, "/api/history?tool=merge-pdf"));
    expect(byTool.body.total).toBe(1);

    const byCategory = await json(await get(history.GET, "/api/history?category=pdf"));
    expect(byCategory.body.total).toBe(2);

    const byStatus = await json(await get(history.GET, "/api/history?status=failed"));
    expect(byStatus.body.entries?.map((e) => e.toolId)).toEqual(["split-pdf"]);

    // A plain date is inclusive at both ends, so this window holds exactly the middle job.
    const byDate = await json(await get(history.GET, "/api/history?from=2026-09-15&to=2026-09-15"));
    expect(byDate.body.entries?.map((e) => e.toolId)).toEqual(["split-pdf"]);

    const unknownCategory = await json(await get(history.GET, "/api/history?category=nope"));
    expect(unknownCategory.body.total).toBe(3);
  });

  it("paginates", async () => {
    for (let i = 0; i < 25; i += 1) {
      await seedJob({
        toolId: "merge-pdf",
        createdAt: new Date(Date.UTC(2026, 8, 1, 0, 0, i)).toISOString(),
      });
    }
    const first = await json(await get(history.GET, "/api/history"));
    expect(first.body).toMatchObject({ total: 25, page: 1, pageCount: 2 });
    expect(first.body.entries).toHaveLength(20);

    const second = await json(await get(history.GET, "/api/history?page=2"));
    expect(second.body.entries).toHaveLength(5);
    // No overlap between the pages.
    const ids = new Set(first.body.entries?.map((e) => e.id));
    expect(second.body.entries?.some((e) => ids.has(e.id))).toBe(false);
  });

  it("deletes one entry and clears the rest, and refuses another account's", async () => {
    const mine = await seedJob({ toolId: "merge-pdf", createdAt: "2026-09-10T10:00:00.000Z" });
    const theirs = await seedJob({
      userId: otherId,
      toolId: "split-pdf",
      createdAt: "2026-09-11T10:00:00.000Z",
    });

    // Someone else's entry answers exactly like a missing one.
    const refused = await json(
      await historyEntry.DELETE(new Request("http://localhost"), {
        params: Promise.resolve({ id: theirs.id }),
      }),
    );
    expect(refused.status).toBe(404);
    expect(await prisma.job.findUnique({ where: { id: theirs.id } })).not.toBeNull();

    const removed = await json(
      await historyEntry.DELETE(new Request("http://localhost"), {
        params: Promise.resolve({ id: mine.id }),
      }),
    );
    expect(removed.status).toBe(200);
    expect(await prisma.job.findUnique({ where: { id: mine.id } })).toBeNull();

    await seedJob({ toolId: "rotate-pdf", createdAt: "2026-09-12T10:00:00.000Z" });
    const cleared = await json(await history.DELETE());
    expect(cleared.body.removed).toBe(1);
    expect(await prisma.job.count({ where: { userId } })).toBe(0);
    // The other account is untouched.
    expect(await prisma.job.count({ where: { userId: otherId } })).toBe(1);
  });

  it("asks a guest to sign in rather than leaking anything", async () => {
    session.userId = null;
    const { status, body } = await json(await get(history.GET, "/api/history"));
    expect(status).toBe(401);
    expect(body.error?.code).toBe("AUTH_REQUIRED");
  });

  it("imports a guest's device history once, and merges their favourites", async () => {
    const entries = [
      { toolId: "merge-pdf", status: "success", createdAt: "2026-09-10T10:00:00.000Z" },
      { toolId: "split-pdf", status: "failed", createdAt: "2026-09-11T10:00:00.000Z" },
    ];
    const first = await json(
      await send(historyImport.POST, "/api/history/import", "POST", {
        entries,
        favorites: ["merge-pdf", "not-a-real-tool"],
      }),
    );
    expect(first.body).toMatchObject({ imported: 2, skipped: 0 });
    expect(first.body.favorites).toEqual(["merge-pdf"]);

    // Running it again changes nothing: entries match on tool + timestamp.
    const again = await json(
      await send(historyImport.POST, "/api/history/import", "POST", { entries }),
    );
    expect(again.body).toMatchObject({ imported: 0, skipped: 2 });
    expect(await prisma.job.count({ where: { userId } })).toBe(2);

    const listed = await json(await get(history.GET, "/api/history"));
    expect(listed.body.entries?.map((e) => e.toolId)).toEqual(["split-pdf", "merge-pdf"]);
  });

  // ---- favourites ---------------------------------------------------------------------------

  it("toggles a favourite, persists it and keeps it per account", async () => {
    expect((await json(await get(favorites.GET, "/api/favorites"))).body.favorites).toEqual([]);

    const on = await json(
      await send(favorites.POST, "/api/favorites", "POST", { toolId: "merge-pdf" }),
    );
    expect(on.body).toMatchObject({ on: true, favorites: ["merge-pdf"] });

    // A fresh read - a different device, in effect - sees the same list.
    expect((await json(await get(favorites.GET, "/api/favorites"))).body.favorites).toEqual([
      "merge-pdf",
    ]);
    // ...and the other account's is still empty.
    session.userId = otherId;
    expect((await json(await get(favorites.GET, "/api/favorites"))).body.favorites).toEqual([]);
    session.userId = userId;

    const off = await json(
      await send(favorites.POST, "/api/favorites", "POST", { toolId: "merge-pdf" }),
    );
    expect(off.body).toMatchObject({ on: false, favorites: [] });

    // `on` makes it idempotent for a client that knows what it wants.
    await send(favorites.POST, "/api/favorites", "POST", { toolId: "merge-pdf", on: true });
    const repeated = await json(
      await send(favorites.POST, "/api/favorites", "POST", { toolId: "merge-pdf", on: true }),
    );
    expect(repeated.body.favorites).toEqual(["merge-pdf"]);
  });

  it("refuses a tool that is not in the registry", async () => {
    const { status, body } = await json(
      await send(favorites.POST, "/api/favorites", "POST", { toolId: "../../etc/passwd" }),
    );
    expect(status).toBe(404);
    expect(body.error?.code).toBe("UNSUPPORTED_INPUT");
    expect(await prisma.favorite.count()).toBe(0);
  });

  // ---- settings sync ------------------------------------------------------------------------

  it("stores settings against the account so another session sees them", async () => {
    const saved = await json(
      await send(settings.PATCH, "/api/settings", "PATCH", {
        theme: "dark",
        preferredAI: "ollama",
        preferences: { saveHistory: false },
      }),
    );
    expect(saved.body.settings).toMatchObject({ theme: "dark", preferredAI: "ollama" });
    expect(saved.body.settings?.preferences).toMatchObject({ saveHistory: false });

    // Session B: the same account, a different browser. It reads what session A wrote.
    const read = await json(await get(settings.GET, "/api/settings"));
    expect(read.body.settings).toMatchObject({ theme: "dark", preferredAI: "ollama" });

    // A patch merges - one preference does not clear the others.
    const merged = await json(
      await send(settings.PATCH, "/api/settings", "PATCH", { preferences: { reduceMotion: true } }),
    );
    expect(merged.body.settings?.preferences).toMatchObject({
      saveHistory: false,
      reduceMotion: true,
    });

    // The other account keeps its own.
    session.userId = otherId;
    expect((await json(await get(settings.GET, "/api/settings"))).body.settings?.theme).toBe(
      "system",
    );
  });

  it("rejects an unknown theme and drops unknown preference keys", async () => {
    const bad = await json(await send(settings.PATCH, "/api/settings", "PATCH", { theme: "neon" }));
    expect(bad.status).toBe(400);

    const filtered = await json(
      await send(settings.PATCH, "/api/settings", "PATCH", {
        preferences: { saveHistory: true, __proto__: "x", somethingElse: 1 },
      }),
    );
    expect(Object.keys(filtered.body.settings?.preferences ?? {})).toEqual(["saveHistory"]);
  });

  // ---- usage --------------------------------------------------------------------------------

  it("reports real run counts and recent tools, which the registry sorts on", async () => {
    await seedJob({ toolId: "merge-pdf", createdAt: "2026-09-10T10:00:00.000Z" });
    await seedJob({ toolId: "merge-pdf", createdAt: "2026-09-11T10:00:00.000Z" });
    await seedJob({ toolId: "split-pdf", createdAt: "2026-09-19T10:00:00.000Z" });

    const { body } = await json(await get(usage.GET, "/api/usage"));
    expect(body.synced).toBe(true);
    expect(body.usage).toMatchObject({ "merge-pdf": 2, "split-pdf": 1 });
    expect(body.recent).toEqual(["split-pdf", "merge-pdf"]);
  });

  it("answers a guest with empty usage rather than an error", async () => {
    session.userId = null;
    const { status, body } = await json(await get(usage.GET, "/api/usage"));
    expect(status).toBe(200);
    expect(body).toMatchObject({ usage: {}, recent: [], synced: false });
  });
});
