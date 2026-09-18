// Wires the Postgres job store into the phase-04 pipeline (13-auth-database.md).
//
// Importing this module is enough: `getJobStore()` then returns the Postgres-backed store when
// DATABASE_URL is set, and the in-memory store otherwise, so a machine with no database still
// runs every tool.
import { createInMemoryJobStore, registerJobStoreFactory } from "../file-processing/job.ts";
import { getPrisma } from "./client.ts";
import { createPrismaJobStore, createResilientJobStore } from "./job-store.ts";

registerJobStoreFactory(() => {
  const prisma = getPrisma();
  if (!prisma) return createInMemoryJobStore();
  return createResilientJobStore(createPrismaJobStore(prisma), createInMemoryJobStore());
});
