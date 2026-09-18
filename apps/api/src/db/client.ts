// The Prisma client singleton (13-auth-database.md).
//
// Two rules shape this file:
//   1. OneStop must run with no database at all (local-first, CLAUDE.md §2.2). If DATABASE_URL is
//      unset - or the server is unreachable - every public tool keeps working; only the features
//      that need durable storage (accounts, synced history) report that they are unavailable.
//   2. Nothing outside this folder imports the generated client, so the rest of the app is not
//      coupled to Prisma.
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/client.ts";

export type { PrismaClient };

let client: PrismaClient | null = null;
let resolvedUrl: string | null = null;

/** The configured connection string, or null when the app is running without a database. */
export function databaseUrl(): string | null {
  const url = process.env.DATABASE_URL?.trim();
  return url ? url : null;
}

/** The `schema` query parameter of a Postgres URL, if it sets one. */
export function schemaFromUrl(url: string): string | null {
  try {
    return new URL(url).searchParams.get("schema");
  } catch {
    return null;
  }
}

export function isDatabaseConfigured(): boolean {
  return databaseUrl() !== null;
}

/**
 * The shared client, or null when no DATABASE_URL is set. Connecting is lazy: Prisma opens a
 * socket on the first query, so a misconfigured URL costs nothing until something needs it.
 */
export function getPrisma(): PrismaClient | null {
  const url = databaseUrl();
  if (!url) return null;
  if (client && resolvedUrl === url) return client;
  // In dev, Next.js re-evaluates modules on every edit; reuse the client across reloads so we
  // do not leak connection pools.
  const globals = globalThis as { __onestopPrisma?: { url: string; client: PrismaClient } };
  if (globals.__onestopPrisma?.url === url) {
    client = globals.__onestopPrisma.client;
    resolvedUrl = url;
    return client;
  }
  // Prisma 7 takes the schema from the adapter, not from the URL, so `?schema=` is forwarded.
  const schema = schemaFromUrl(url);
  const adapter = new PrismaPg({ connectionString: url }, schema ? { schema } : {});
  client = new PrismaClient({ adapter });
  resolvedUrl = url;
  if (process.env.NODE_ENV !== "production") globals.__onestopPrisma = { url, client };
  return client;
}

/** Like `getPrisma`, but throws the user-facing message when there is no database. */
export function requirePrisma(): PrismaClient {
  const prisma = getPrisma();
  if (!prisma) throw new DatabaseUnavailableError();
  return prisma;
}

export class DatabaseUnavailableError extends Error {
  readonly code = "DATABASE_UNAVAILABLE";
  constructor(cause?: unknown) {
    super("Accounts are unavailable right now. Tools still work without signing in.");
    this.name = "DatabaseUnavailableError";
    if (cause !== undefined) this.cause = cause;
  }
}

/** True for the errors Prisma raises when it cannot reach or authenticate against Postgres. */
export function isConnectionError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  if (typeof code === "string" && ["P1000", "P1001", "P1002", "P1003", "P1017"].includes(code)) {
    return true;
  }
  const message = err instanceof Error ? err.message : "";
  return /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|Can't reach database server|connection terminated/i.test(
    message,
  );
}

/** Closes the pool. Used by tests; the server keeps the client for its lifetime. */
export async function disconnectPrisma(): Promise<void> {
  const current = client;
  client = null;
  resolvedUrl = null;
  delete (globalThis as { __onestopPrisma?: unknown }).__onestopPrisma;
  await current?.$disconnect();
}
