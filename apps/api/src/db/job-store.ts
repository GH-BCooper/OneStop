// The Postgres-backed JobStore (13-auth-database.md).
//
// Same `JobStore` contract as phase 04's in-memory store, so nothing that creates or reads jobs
// had to change. Jobs hold metadata only - never file bytes (master plan §16).
import type { Job, JobStatus } from "@onestop/types";
import {
  canTransition,
  InvalidJobTransitionError,
  JobNotFoundError,
  type CreateJobInput,
  type JobStore,
  type ListJobsFilter,
  type UpdateJobInput,
} from "../file-processing/job.ts";
import { isConnectionError, type PrismaClient } from "./client.ts";

type JobRow = {
  id: string;
  userId: string | null;
  toolId: string;
  status: string;
  inputMetadata: unknown;
  outputMetadata: unknown;
  createdAt: Date;
};

function asMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toJob(row: JobRow): Job {
  return {
    id: row.id,
    userId: row.userId,
    toolId: row.toolId,
    status: row.status as JobStatus,
    inputMetadata: asMetadata(row.inputMetadata),
    outputMetadata:
      row.outputMetadata === null || row.outputMetadata === undefined
        ? null
        : asMetadata(row.outputMetadata),
    createdAt: row.createdAt.toISOString(),
  };
}

/** Postgres implementation of the phase-04 `JobStore` contract. */
export function createPrismaJobStore(prisma: PrismaClient): JobStore {
  return {
    async create(input: CreateJobInput) {
      const row = await prisma.job.create({
        data: {
          userId: input.userId ?? null,
          toolId: input.toolId,
          status: "pending" satisfies JobStatus,
          inputMetadata: (input.inputMetadata ?? {}) as never,
        },
      });
      return toJob(row as JobRow);
    },

    async get(id: string) {
      const row = await prisma.job.findUnique({ where: { id } });
      return row ? toJob(row as JobRow) : undefined;
    },

    async update(id: string, patch: UpdateJobInput) {
      const existing = await prisma.job.findUnique({ where: { id } });
      if (!existing) throw new JobNotFoundError(id);
      const from = (existing as JobRow).status as JobStatus;
      if (patch.status && !canTransition(from, patch.status)) {
        throw new InvalidJobTransitionError(from, patch.status);
      }
      const row = await prisma.job.update({
        where: { id },
        data: {
          ...(patch.status ? { status: patch.status } : {}),
          ...(patch.inputMetadata ? { inputMetadata: patch.inputMetadata as never } : {}),
          ...(patch.outputMetadata !== undefined
            ? { outputMetadata: (patch.outputMetadata ?? null) as never }
            : {}),
        },
      });
      return toJob(row as JobRow);
    },

    async list(filter: ListJobsFilter = {}) {
      const rows = await prisma.job.findMany({
        where: {
          ...(filter.userId !== undefined ? { userId: filter.userId } : {}),
          ...(filter.toolId ? { toolId: filter.toolId } : {}),
          ...(filter.status ? { status: filter.status } : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        ...(filter.limit !== undefined ? { take: filter.limit } : {}),
      });
      return (rows as JobRow[]).map(toJob);
    },

    async delete(id: string) {
      try {
        await prisma.job.delete({ where: { id } });
        return true;
      } catch {
        return false;
      }
    },

    async clear() {
      await prisma.job.deleteMany({});
    },
  };
}

/**
 * Wraps the Postgres store so an unreachable database never takes the tools down with it
 * (CLAUDE.md §2.2). On a connection error the call is retried against `fallback` - an in-memory
 * store - and the next `retryAfterMs` of traffic skips Postgres entirely, so one outage does not
 * mean one stalled request per job step.
 */
export function createResilientJobStore(
  primary: JobStore,
  fallback: JobStore,
  options: { retryAfterMs?: number; now?: () => number; onDegrade?: (err: unknown) => void } = {},
): JobStore {
  const retryAfterMs = options.retryAfterMs ?? 30_000;
  const now = options.now ?? Date.now;
  const onDegrade =
    options.onDegrade ??
    ((err: unknown) => {
      console.error(
        "[db] Postgres is unreachable; job history is being kept in memory for now.",
        err,
      );
    });
  let degradedUntil = 0;

  async function run<T>(op: (store: JobStore) => Promise<T>): Promise<T> {
    if (now() < degradedUntil) return op(fallback);
    try {
      return await op(primary);
    } catch (err) {
      if (!isConnectionError(err)) throw err;
      degradedUntil = now() + retryAfterMs;
      onDegrade(err);
      return op(fallback);
    }
  }

  return {
    create: (input) => run((s) => s.create(input)),
    get: (id) => run((s) => s.get(id)),
    // A job created in Postgres does not exist in the fallback, so an update that arrives after
    // the database dropped would fail with JobNotFoundError and take the running tool down with
    // it. The status is only bookkeeping, so report the patched state instead of failing.
    update: (id, patch) =>
      run(async (s) => {
        try {
          return await s.update(id, patch);
        } catch (err) {
          if (s === fallback && err instanceof JobNotFoundError) {
            return {
              id,
              userId: null,
              toolId: "",
              status: patch.status ?? "processing",
              inputMetadata: patch.inputMetadata ?? {},
              outputMetadata: patch.outputMetadata ?? null,
              createdAt: new Date(now()).toISOString(),
            } satisfies Job;
          }
          throw err;
        }
      }),
    list: (filter) => run((s) => s.list(filter)),
    delete: (id) => run((s) => s.delete(id)),
    clear: () => run((s) => s.clear()),
  };
}
