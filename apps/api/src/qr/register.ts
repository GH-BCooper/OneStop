// Wires the Postgres dynamic-QR store into the app (14-history-favorites.md).
//
// Importing this module is enough: with a DATABASE_URL, `getQrStore()` returns the Postgres store
// and phase 11's interim JSON file is copied in once, on first use; without one, the interim file
// stays the store, so a machine with no database still resolves every code it already has.
import { getPrisma, isConnectionError, type PrismaClient } from "../db/client.ts";
import { createPrismaQrStore, migrateJsonQrLinks } from "./prisma-store.ts";
import { qrDataFile, registerQrStoreFactory, type QrStore } from "./store.ts";

/**
 * Runs the interim-file migration at most once per client, before the first store operation.
 * A failure is logged, not thrown: a code that cannot be imported must not stop the ones already
 * in Postgres from resolving.
 */
function migrateOnce(prisma: PrismaClient): () => Promise<void> {
  let started: Promise<void> | undefined;
  return () => {
    started ??= migrateJsonQrLinks(prisma, qrDataFile())
      .then(() => undefined)
      .catch((err: unknown) => {
        if (isConnectionError(err)) started = undefined; // retry once the database is back
        console.error("[qr] the interim QR file could not be migrated", err);
      });
    return started;
  };
}

/** Wraps a store so every call waits for the one-time migration first. */
export function withMigration(store: QrStore, ready: () => Promise<void>): QrStore {
  return {
    list: async (owner) => (await ready(), store.list(owner)),
    get: async (id) => (await ready(), store.get(id)),
    create: async (input) => (await ready(), store.create(input)),
    update: async (id, patch, owner) => (await ready(), store.update(id, patch, owner)),
    remove: async (id, owner) => (await ready(), store.remove(id, owner)),
    recordScan: async (id, scan) => (await ready(), store.recordScan(id, scan)),
    clear: async () => (await ready(), store.clear()),
  };
}

registerQrStoreFactory(() => {
  const prisma = getPrisma();
  // No database: `getQrStore()` falls back to the interim JSON file on its own.
  if (!prisma) return undefined;
  return withMigration(createPrismaQrStore(prisma), migrateOnce(prisma));
});
