// Prisma 7 configuration (13-auth-database.md).
//
// Prisma 7 no longer reads the connection URL from schema.prisma: the CLI takes it from here and
// the runtime client takes it from a driver adapter (see apps/api/src/db/client.ts).
import { defineConfig } from "prisma/config";

// `.env` is not loaded automatically for the CLI; Node 22+ can do it without a dependency.
try {
  process.loadEnvFile(".env");
} catch {
  // No .env file - fall back to whatever the shell exports (CI, hosted deploys).
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // `prisma generate` must work on a fresh clone that has no .env yet, so an unset URL falls back
  // to the local default rather than failing the build. Commands that really talk to a database
  // (migrate, studio) still need a real DATABASE_URL and say so if it is wrong.
  datasource: {
    url: process.env.DATABASE_URL ?? "postgresql://onestop:onestop@localhost:5432/onestop",
  },
});
