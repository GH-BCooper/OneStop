// Test support for the database-backed suites (13-auth-database.md).
//
// The auth and job-store integration tests need a real Postgres. They run when TEST_DATABASE_URL
// (or DATABASE_URL) points at one, and skip themselves otherwise, so `npm test` passes on a
// machine with no database - which is the same promise the app itself makes.
//
// Vitest runs test *files* in parallel, so every file that touches the database gets its own
// Postgres schema: the migrations are applied into it, the file works in isolation, and the
// schema is dropped afterwards. That keeps the suite parallel without one file truncating
// another's rows.
import { PrismaPg } from "@prisma/adapter-pg";
import fs from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "./generated/client.ts";

export type { PrismaClient };

let loaded = false;

/** Loads `.env` once so a local run sees the same settings as the dev server. */
export function loadTestEnv(): void {
  if (loaded) return;
  loaded = true;
  try {
    process.loadEnvFile(".env");
  } catch {
    // No .env - CI exports the variables itself, or there is no database and tests skip.
  }
}

export function testDatabaseUrl(): string | null {
  loadTestEnv();
  const url = process.env.TEST_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
  return url ? url : null;
}

export function hasTestDatabase(): boolean {
  return testDatabaseUrl() !== null;
}

/** The same connection string with its `schema` parameter replaced. */
export function urlForSchema(url: string, schema: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set("schema", schema);
  return parsed.toString();
}

/** A client bound to the test database, optionally to one schema inside it. */
export function createTestPrisma(schema?: string): PrismaClient {
  const url = testDatabaseUrl();
  if (!url) throw new Error("No TEST_DATABASE_URL/DATABASE_URL is set.");
  // The driver adapter - not the URL - decides which schema generated queries name, so the schema
  // has to be passed as an option as well as kept in the URL for anything that re-parses it.
  const connectionString = schema ? urlForSchema(url, schema) : url;
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }, schema ? { schema } : {}),
  });
}

/** Every migration's SQL, oldest first - what `prisma migrate deploy` would apply. */
async function migrationSql(): Promise<string> {
  const dir = path.join(process.cwd(), "prisma", "migrations");
  const entries = (await fs.readdir(dir, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  const parts: string[] = [];
  for (const name of entries) {
    parts.push(await fs.readFile(path.join(dir, name, "migration.sql"), "utf8"));
  }
  return parts.join("\n");
}

/**
 * Creates a private schema, applies the migrations into it and returns a client bound to it.
 * `schema` should be stable per test file (for example "test_auth_routes").
 */
export async function createIsolatedTestPrisma(schema: string): Promise<PrismaClient> {
  if (!/^[a-z][a-z0-9_]{0,48}$/.test(schema)) {
    throw new Error(`"${schema}" is not a usable schema name.`);
  }
  const admin = createTestPrisma();
  try {
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    // The migration SQL is unqualified, so each statement is run with the search path pointed at
    // the new schema (one connection from the pool may serve each, so it is set every time).
    for (const statement of splitStatements(await migrationSql())) {
      await admin.$executeRawUnsafe(`SET search_path TO "${schema}"; ${statement}`);
    }
  } finally {
    await admin.$disconnect();
  }
  return createTestPrisma(schema);
}

/** Splits a migration file into statements. The generated SQL has no dollar-quoted bodies. */
function splitStatements(sql: string): string[] {
  return sql
    .split(/;\s*$/m)
    .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
    .filter((s) => s.length > 0);
}

/** Drops a schema made by `createIsolatedTestPrisma`. */
export async function dropTestSchema(schema: string): Promise<void> {
  const admin = createTestPrisma();
  try {
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  } finally {
    await admin.$disconnect();
  }
}

/** Empties every table this phase owns, so each test starts from a known state. */
export async function resetTestDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.passwordResetToken.deleteMany({});
  await prisma.qrScan.deleteMany({});
  await prisma.qrLink.deleteMany({});
  await prisma.favorite.deleteMany({});
  await prisma.job.deleteMany({});
  await prisma.workflow.deleteMany({});
  await prisma.userSettings.deleteMany({});
  await prisma.session.deleteMany({});
  await prisma.account.deleteMany({});
  await prisma.user.deleteMany({});
}

/**
 * Whether a Postgres is actually listening at the configured URL.
 *
 * `hasTestDatabase()` only says a connection string is configured. A developer who has one in
 * `.env` but has not started the container would otherwise see every database suite fail rather
 * than skip, which is the opposite of the promise above. A short TCP probe tells the two apart.
 */
export async function testDatabaseReachable(timeoutMs = 750): Promise<boolean> {
  const url = testDatabaseUrl();
  if (!url) return false;
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return false;
  }
  const net = await import("node:net");
  return new Promise<boolean>((resolve) => {
    const socket = new net.Socket();
    const done = (result: boolean) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    socket.connect(Number(target.port || 5432), target.hostname);
  });
}
