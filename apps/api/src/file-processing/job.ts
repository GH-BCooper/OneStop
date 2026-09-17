// The Job model and its store (04-file-core.md; master plan §16).
//
// Phase 04 keeps jobs in memory. Everything goes through the `JobStore` interface so phase 13
// can drop in a Prisma-backed implementation without a single caller changing.
import { randomUUID } from "node:crypto";
import type { Job, JobStatus } from "@onestop/types";

export type { Job, JobStatus };

export interface CreateJobInput {
  toolId: string;
  userId?: string | null;
  inputMetadata?: Record<string, unknown>;
}

export interface UpdateJobInput {
  status?: JobStatus;
  outputMetadata?: Record<string, unknown> | null;
  inputMetadata?: Record<string, unknown>;
}

export interface ListJobsFilter {
  userId?: string | null;
  toolId?: string;
  status?: JobStatus;
  limit?: number;
}

export interface JobStore {
  create(input: CreateJobInput): Promise<Job>;
  get(id: string): Promise<Job | undefined>;
  update(id: string, patch: UpdateJobInput): Promise<Job>;
  /** Newest first. */
  list(filter?: ListJobsFilter): Promise<Job[]>;
  delete(id: string): Promise<boolean>;
  clear(): Promise<void>;
}

/** Transitions the pipeline is allowed to make. Anything else is a bug and throws. */
const ALLOWED_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  pending: ["validating", "failed"],
  validating: ["processing", "failed", "success"],
  processing: ["success", "failed"],
  success: [],
  failed: [],
};

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return from === to || (ALLOWED_TRANSITIONS[from]?.includes(to) ?? false);
}

export class JobNotFoundError extends Error {
  constructor(readonly jobId: string) {
    super(`Job ${jobId} was not found.`);
    this.name = "JobNotFoundError";
  }
}

export class InvalidJobTransitionError extends Error {
  constructor(
    readonly from: JobStatus,
    readonly to: JobStatus,
  ) {
    super(`A job cannot go from "${from}" to "${to}".`);
    this.name = "InvalidJobTransitionError";
  }
}

export interface InMemoryJobStoreOptions {
  /** Injectable clock, so tests can assert ordering without sleeping. */
  now?: () => number;
  /** Cap on retained jobs; the oldest are dropped past it. Default 500. */
  maxJobs?: number;
}

export function createInMemoryJobStore(options: InMemoryJobStoreOptions = {}): JobStore {
  const now = options.now ?? Date.now;
  const maxJobs = options.maxJobs ?? 500;
  // Insertion order = creation order, which keeps `list()` cheap.
  const jobs = new Map<string, Job>();

  return {
    async create(input) {
      const job: Job = {
        id: randomUUID(),
        userId: input.userId ?? null,
        toolId: input.toolId,
        status: "pending",
        inputMetadata: input.inputMetadata ?? {},
        outputMetadata: null,
        createdAt: new Date(now()).toISOString(),
      };
      jobs.set(job.id, job);
      while (jobs.size > maxJobs) {
        const oldest = jobs.keys().next();
        if (oldest.done) break;
        jobs.delete(oldest.value);
      }
      return { ...job };
    },

    async get(id) {
      const job = jobs.get(id);
      return job ? { ...job } : undefined;
    },

    async update(id, patch) {
      const job = jobs.get(id);
      if (!job) throw new JobNotFoundError(id);
      if (patch.status && !canTransition(job.status, patch.status)) {
        throw new InvalidJobTransitionError(job.status, patch.status);
      }
      const next: Job = {
        ...job,
        ...(patch.status ? { status: patch.status } : {}),
        ...(patch.inputMetadata ? { inputMetadata: patch.inputMetadata } : {}),
        ...(patch.outputMetadata !== undefined ? { outputMetadata: patch.outputMetadata } : {}),
      };
      jobs.set(id, next);
      return { ...next };
    },

    async list(filter = {}) {
      let result = [...jobs.values()].reverse();
      if (filter.userId !== undefined) result = result.filter((j) => j.userId === filter.userId);
      if (filter.toolId) result = result.filter((j) => j.toolId === filter.toolId);
      if (filter.status) result = result.filter((j) => j.status === filter.status);
      if (filter.limit !== undefined) result = result.slice(0, filter.limit);
      return result.map((j) => ({ ...j }));
    },

    async delete(id) {
      return jobs.delete(id);
    },

    async clear() {
      jobs.clear();
    },
  };
}

let shared: JobStore | null = null;

/** The process-wide job store used by the API routes. Phase 13 swaps this for Postgres. */
export function getJobStore(): JobStore {
  shared ??= createInMemoryJobStore();
  return shared;
}

/** Test seam: replaces the shared store (pass null to reset to the default). */
export function setJobStore(store: JobStore | null): void {
  shared = store;
}
