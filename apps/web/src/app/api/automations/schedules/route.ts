// Scheduled workflow automations (post-V1 automation pass; see /versionTwo.md).
//
//   GET  /api/automations/schedules - this user's automations, soonest-next-run first
//   POST /api/automations/schedules - create one from { workflowId, cadence, hour, minute, weekday?, enabled? }
import {
  createSchedule,
  getPrisma,
  InvalidScheduleError,
  listSchedules,
  parseScheduleInput,
  TooManySchedulesError,
} from "@onestop/api";
import { currentUserId } from "@/auth";
import { fail, NO_DATABASE_MESSAGE, ok, readJson, toErrorResponse } from "@/lib/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIGN_IN_REQUIRED = "Sign in to automate a workflow — it needs to run without you present.";

export async function GET(): Promise<Response> {
  const prisma = getPrisma();
  if (!prisma) return fail(503, "DATABASE_UNAVAILABLE", NO_DATABASE_MESSAGE);
  const userId = await currentUserId();
  if (!userId) return fail(401, "AUTH_REQUIRED", SIGN_IN_REQUIRED);
  try {
    return ok({ schedules: await listSchedules(userId, prisma) });
  } catch (err) {
    return toErrorResponse(err, "api/automations/schedules");
  }
}

export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request);
  if (!body) return fail(400, "INVALID_INPUT", "That request could not be read.");
  const prisma = getPrisma();
  if (!prisma) return fail(503, "DATABASE_UNAVAILABLE", NO_DATABASE_MESSAGE);
  const userId = await currentUserId();
  if (!userId) return fail(401, "AUTH_REQUIRED", SIGN_IN_REQUIRED);
  try {
    const input = parseScheduleInput(body);
    return ok({ schedule: await createSchedule(userId, input, prisma) }, 201);
  } catch (err) {
    if (err instanceof InvalidScheduleError) return fail(422, err.code, err.message);
    if (err instanceof TooManySchedulesError) return fail(409, err.code, err.message);
    return toErrorResponse(err, "api/automations/schedules");
  }
}
