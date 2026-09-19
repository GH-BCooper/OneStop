// Runs the whole E2E suite against ONE `next start`.
//
// Phase 18 and 19 both recorded the problem: each of the eleven `*.e2e.test.ts` files spawns its
// own production server in `beforeAll`, so `npm run test:e2e` starts eleven of them and saturates
// the machine - the files pass in small groups and fail together. Every file already honours
// `E2E_BASE_URL` and skips its own spawn when it is set, so the fix is a runner, not a rewrite.
//
//   npm run test:e2e:shared            all files, one server
//   npm run test:e2e:shared -- shell   only the files whose name matches
//
// Anything after `--` is passed through to Vitest, so `-t "name"` works too.
import { spawn } from "node:child_process";
import { existsSync, openSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Vitest loads `.env` through `tests/setup/env.ts`; this runner starts before Vitest does, and it
// needs DATABASE_URL/TEST_DATABASE_URL to decide whether the database suites can run at all.
try {
  process.loadEnvFile(path.join(root, ".env"));
} catch {
  // No .env: the database suites will skip, which is a supported way to run.
}
const port = Number(process.env.E2E_SHARED_PORT ?? 3140);
const baseUrl = `http://127.0.0.1:${port}`;
const passthrough = process.argv.slice(2);
const SCHEMA = process.env.E2E_SCHEMA ?? "test_shared_e2e";

/**
 * Files that cannot use the shared server, with the reason.
 *
 * - `pwa.e2e.test.ts` starts its server with `CONNECTIVITY_CHECK_URL` pointed at a closed port so
 *   the app is genuinely in the "no Internet" state.
 * - `assistant.e2e.test.ts` starts its server with every AI provider pointed nowhere, so a
 *   developer who happens to have Ollama running cannot make its "no runtime" assertions pass.
 *
 * Neither state is something one shared server can be in for some files and not others, so each
 * gets its own server - which it already knows how to start - straight after the shared pass.
 */
const OWN_SERVER = ["tests/e2e/pwa.e2e.test.ts", "tests/e2e/assistant.e2e.test.ts"];

if (!existsSync(path.join(root, "apps/web/.next/BUILD_ID"))) {
  console.error("Run `npm run build` first — the E2E suite runs the production server.");
  process.exit(1);
}

async function waitForServer(url, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Server did not start at ${url}`);
}

/**
 * One server means one database schema. Each DB-backed file normally makes its own and tells its
 * own server about it; here the runner makes one, migrates it, and hands it to both sides through
 * `E2E_SCHEMA`, which those files honour. `fileParallelism: false` keeps them from colliding.
 */
async function prepareSchema() {
  const {
    createIsolatedTestPrisma,
    dropTestSchema,
    hasTestDatabase,
    testDatabaseUrl,
    urlForSchema,
  } = await import("../apps/api/src/db/testing.ts");
  if (!hasTestDatabase()) return { url: undefined, drop: async () => {} };
  try {
    const prisma = await createIsolatedTestPrisma(SCHEMA);
    await prisma.$disconnect();
  } catch (err) {
    console.warn(`e2e: no usable test database (${String(err)}); database suites will skip`);
    return { url: undefined, drop: async () => {} };
  }
  return {
    url: urlForSchema(testDatabaseUrl(), SCHEMA),
    drop: () => dropTestSchema(SCHEMA).catch(() => {}),
  };
}

const db = await prepareSchema();
if (db.url) console.log(`e2e: one database schema for every file: ${SCHEMA}`);

// The console transport prints the password-reset link, and one test reads it back. A file is
// how a shared server can hand that to a test process that did not spawn it.
const serverLogPath = path.join(os.tmpdir(), `onestop-e2e-server-${process.pid}.log`);
const serverLogFd = openSync(serverLogPath, "w");

console.log(`e2e: starting one server on ${baseUrl}`);
const server = spawn(
  process.execPath,
  [
    path.join(root, "node_modules/next/dist/bin/next"),
    "start",
    "-p",
    String(port),
    "-H",
    "127.0.0.1",
  ],
  {
    cwd: path.join(root, "apps/web"),
    stdio: ["ignore", serverLogFd, serverLogFd],
    env: {
      ...process.env,
      ...(db.url ? { DATABASE_URL: db.url } : {}),
      NEXTAUTH_URL: baseUrl,
      APP_URL: baseUrl,
      NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET ?? "e2e-only-secret-value-not-for-real-use",
      MAIL_TRANSPORT: "console",
      // The suite drives hundreds of tool runs from one address; the per-caller limit phase 20
      // added to POST /api/tools/run is not what is under test here.
      RUN_RATE_LIMIT: process.env.RUN_RATE_LIMIT ?? "100000",
    },
  },
);

let stopped = false;
const stop = () => {
  if (stopped) return;
  stopped = true;
  server.kill();
};
process.on("exit", stop);
process.on("SIGINT", () => {
  stop();
  process.exit(130);
});

// When the caller named files or a `-t` filter, honour it and do not add a second pass.
const filtered = passthrough.length > 0;
const shared = readdirSync(path.join(root, "tests/e2e"))
  .filter((name) => name.endsWith(".e2e.test.ts"))
  .map((name) => `tests/e2e/${name}`)
  .filter((file) => !OWN_SERVER.includes(file));

let code = 1;
try {
  await waitForServer(baseUrl);
  console.log(
    `e2e: server up, running ${filtered ? "your selection" : `${shared.length} files`} against it`,
  );
  code = await runVitest(filtered ? [] : shared, {
    E2E_BASE_URL: baseUrl,
    E2E_SERVER_LOG: serverLogPath,
    ...(db.url ? { E2E_SCHEMA: SCHEMA } : {}),
  });
  stop();
  if (code === 0 && !filtered) {
    console.log("e2e: now the files that need their own server");
    code = await runVitest(OWN_SERVER, {});
  }
} catch (err) {
  console.error(String(err));
} finally {
  stop();
  await db.drop();
  rmSync(serverLogPath, { force: true });
}
process.exit(code);

function runVitest(args, env) {
  return new Promise((resolve) => {
    const vitest = spawn(
      process.execPath,
      [
        path.join(root, "node_modules/vitest/vitest.mjs"),
        "run",
        "--config",
        "vitest.e2e.config.ts",
        ...args,
        ...passthrough,
      ],
      { cwd: root, stdio: "inherit", env: { ...process.env, ...env } },
    );
    vitest.on("exit", (value) => resolve(value ?? 1));
  });
}
