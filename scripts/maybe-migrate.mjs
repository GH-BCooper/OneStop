// Runs `prisma migrate deploy` as part of every build, but only when a database is actually
// configured. Without this, a hosted deploy (Render, Railway, …) that sets DATABASE_URL but never
// runs `npm run db:deploy` by hand ends up with a reachable Postgres that has no tables at all:
// every Prisma query then throws a raw "relation does not exist" error, which every route's
// catch-all turns into the same unhelpful "Something went wrong. Please try again." — for sign-up
// *and* for every tool run, since a job row is written on each one. Folding the migration into the
// build means a deploy can never again ship in that half-configured state.
import { execFileSync } from "node:child_process";

const url = process.env.DATABASE_URL?.trim();
if (!url) {
  console.log("[db] DATABASE_URL not set — skipping migrate deploy (app runs without a database).");
  process.exit(0);
}

try {
  execFileSync("npx", ["prisma", "migrate", "deploy"], { stdio: "inherit", shell: false });
} catch (err) {
  console.error("[db] prisma migrate deploy failed:", err.message);
  process.exit(1);
}
