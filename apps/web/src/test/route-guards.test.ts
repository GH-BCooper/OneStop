// Who may call the routes that do real work or hold someone's data.
//
// The pages were already behind sign-in; these are the checks that the API says the same thing, so
// "you need an account to run a tool" cannot be stepped around with curl. Run against the real route
// handlers, with the session and the accounts switch faked.
import {
  createInMemoryJobStore,
  createTempStore,
  getJobStore,
  getQrStore,
  resetRateLimits,
  setJobStore,
  setQrStore,
  setTempStore,
  type TempStore,
} from "@onestop/api";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state: { userId: string | null; accounts: boolean } = { userId: null, accounts: true };

vi.mock("@/auth", () => ({
  currentUserId: async () => state.userId,
  auth: async () => (state.userId ? { user: { id: state.userId, name: "Tester" } } : null),
}));
vi.mock("@/lib/auth-config", async (importOriginal) => {
  const original: Record<string, unknown> = await importOriginal();
  return { ...original, authIsConfigured: () => state.accounts };
});

const { POST: runTool } = await import("@/app/api/tools/run/route");
const { POST: runWorkflow } = await import("@/app/api/workflows/run/route");
const { GET: getJob } = await import("@/app/api/jobs/[id]/route");
const { GET: listQr } = await import("@/app/api/qr/links/route");
const { PATCH: patchQr, DELETE: deleteQr } = await import("@/app/api/qr/links/[id]/route");
const { GET: aiStatus } = await import("@/app/api/assistant/status/route");
const { GET: aiGreeting } = await import("@/app/api/assistant/greeting/route");
const { POST: aiAgent } = await import("@/app/api/assistant/agent/route");

let dir: string;
let temp: TempStore;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "onestop-guards-test-"));
  temp = createTempStore({ tempDir: dir, ttlMs: 60_000, autoSweep: false });
  setTempStore(temp);
  setJobStore(createInMemoryJobStore());
  setQrStore(getQrStore(path.join(dir, "qr.json")));
  resetRateLimits();
  state.userId = null;
  state.accounts = true;
});

afterEach(async () => {
  setTempStore(null);
  setJobStore(null);
  setQrStore(undefined);
  await temp.dispose();
  await fs.rm(dir, { recursive: true, force: true });
});

const jsonForm = (toolId = "hash-generator", text = "hello") => {
  const form = new FormData();
  form.set("toolId", toolId);
  form.set("text", text);
  return form;
};

const post = (url: string, body: FormData, headers: Record<string, string> = {}) =>
  new Request(`http://localhost${url}`, { method: "POST", body, headers });

describe("running a tool needs an account when accounts exist", () => {
  it("turns an anonymous caller away before reading anything", async () => {
    const res = await runTool(post("/api/tools/run", jsonForm()));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("AUTH_REQUIRED");
    expect(body.error.message).toMatch(/sign in/i);
  });

  it("lets a signed-in caller run, and attributes the job to them", async () => {
    state.userId = "user-a";
    const res = await runTool(post("/api/tools/run", jsonForm()));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; job: { id: string; userId: string | null } };
    expect(body.ok).toBe(true);
    expect(body.job.userId).toBe("user-a");
  });

  it("does not quietly downgrade a malformed access token to a guest run", async () => {
    const res = await runTool(
      post("/api/tools/run", jsonForm(), { authorization: "Bearer osk_bogus" }),
    );
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(/token/i);
  });

  it("still lets everyone in where no accounts are configured (guest mode)", async () => {
    state.accounts = false;
    const res = await runTool(post("/api/tools/run", jsonForm()));
    expect(res.status).toBe(200);
  });

  it("applies to workflow runs too", async () => {
    const form = new FormData();
    form.set("steps", JSON.stringify([{ toolId: "hash-generator" }]));
    form.set("text", "hi");
    expect((await runWorkflow(post("/api/workflows/run", form))).status).toBe(401);
  });

  it("applies to the assistant: status, greeting and the agent stream", async () => {
    expect((await aiStatus(new Request("http://localhost/api/assistant/status"))).status).toBe(401);
    expect((await aiGreeting(new Request("http://localhost/api/assistant/greeting"))).status).toBe(
      401,
    );
    const form = new FormData();
    form.set("message", "hello");
    const stream = await (await aiAgent(post("/api/assistant/agent", form))).text();
    expect(stream).toMatch(/"code":"AUTH_REQUIRED"/);
  });

  it("does not let the client-sent X-Forwarded-For dodge the rate limit", async () => {
    state.userId = "user-a";
    // Every request claims a brand-new first hop; the proxy-appended last hop is always the same.
    const codes: number[] = [];
    for (let i = 0; i < 130; i += 1) {
      const res = await runTool(
        post("/api/tools/run", jsonForm(), {
          "x-forwarded-for": `198.51.100.${i % 250}, 203.0.113.7`,
        }),
      );
      codes.push(res.status);
    }
    expect(codes).toContain(429);
  }, 120_000);
});

describe("a job belongs to whoever ran it", () => {
  async function seed(userId: string | null): Promise<string> {
    const job = await getJobStore().create({
      userId,
      toolId: "hash-generator",
      inputMetadata: { files: [{ name: "secret.txt" }] },
    });
    return job.id;
  }
  const ask = (id: string) =>
    getJob(new Request(`http://localhost/api/jobs/${id}`), { params: Promise.resolve({ id }) });

  it("answers the owner, and nobody else, as if it did not exist", async () => {
    const id = await seed("user-a");
    state.userId = "user-a";
    expect((await ask(id)).status).toBe(200);
    state.userId = "user-b";
    expect((await ask(id)).status).toBe(404);
    state.userId = null;
    expect((await ask(id)).status).toBe(404);
  });

  it("leaves a guest-run job (no owner) readable, since there is nobody to hide it from", async () => {
    const id = await seed(null);
    state.userId = null;
    expect((await ask(id)).status).toBe(200);
  });
});

describe("dynamic QR codes belong to their maker", () => {
  async function makeCode(owner: string | null): Promise<string> {
    const link = await getQrStore().create({
      kind: "redirect",
      title: "Poster",
      target: "https://example.com/",
      ownerToken: owner,
    });
    return link.id;
  }
  const params = (id: string) => ({ params: Promise.resolve({ id }) });
  const patch = (id: string, body: unknown) =>
    patchQr(
      new Request(`http://localhost/api/qr/links/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
      params(id),
    );
  const del = (id: string) =>
    deleteQr(new Request(`http://localhost/api/qr/links/${id}`, { method: "DELETE" }), params(id));

  it("refuses a stranger who merely learned the id from a scan URL", async () => {
    const id = await makeCode("user-a");
    state.userId = null;
    expect((await patch(id, { target: "https://evil.example/" })).status).toBe(401);
    expect((await del(id)).status).toBe(401);
    state.userId = "user-b";
    expect((await patch(id, { target: "https://evil.example/" })).status).toBe(403);
    expect((await del(id)).status).toBe(403);
    expect((await getQrStore().get(id))?.target).toBe("https://example.com/");
  });

  it("lets the owner re-point and delete it", async () => {
    const id = await makeCode("user-a");
    state.userId = "user-a";
    const res = await patch(id, { target: "https://example.org/next" });
    expect(res.status).toBe(200);
    expect((await getQrStore().get(id))?.target).toBe("https://example.org/next");
    expect((await del(id)).status).toBe(200);
    expect(await getQrStore().get(id)).toBeUndefined();
  });

  it("keeps a pre-accounts code (no owner) read-only once accounts exist", async () => {
    const id = await makeCode(null);
    state.userId = "user-b";
    expect((await patch(id, { title: "mine now" })).status).toBe(403);
  });

  it("is fully open with no accounts configured: one person, who owns everything", async () => {
    state.accounts = false;
    const id = await makeCode(null);
    expect((await patch(id, { title: "renamed" })).status).toBe(200);
  });

  it("shows an anonymous caller none of the instance's codes once accounts exist", async () => {
    await makeCode("user-a");
    const anon = await listQr();
    expect(anon.status).toBe(401);
    state.userId = "user-a";
    const mine = (await (await listQr()).json()) as { codes: unknown[] };
    expect(mine.codes).toHaveLength(1);
    state.userId = "user-b";
    expect(((await (await listQr()).json()) as { codes: unknown[] }).codes).toHaveLength(0);
  });
});
