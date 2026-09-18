// Database module surface (13-auth-database.md).
export {
  DatabaseUnavailableError,
  databaseUrl,
  disconnectPrisma,
  getPrisma,
  isConnectionError,
  isDatabaseConfigured,
  requirePrisma,
  type PrismaClient,
} from "./client.ts";
export { createPrismaJobStore, createResilientJobStore } from "./job-store.ts";
// Test-only helpers (they do nothing unless a test database is configured), exported here so the
// web app's route tests can reach them through the same package boundary as everything else.
export {
  createIsolatedTestPrisma,
  createTestPrisma,
  dropTestSchema,
  hasTestDatabase,
  loadTestEnv,
  resetTestDatabase,
  testDatabaseUrl,
  urlForSchema,
} from "./testing.ts";
