// One scheduled automation (post-V1 automation pass; see /versionTwo.md).
//
//   PATCH  /api/automations/schedules/:id - update timing/cadence/enabled
//   DELETE /api/automations/schedules/:id - delete it
import {
  deleteSchedule,
  getPrisma,
  InvalidScheduleError,
  ScheduleNotFoundError,
  updateSchedule,
} from "@onestop/api";
import type { ScheduleCadence } from "@onestop/types";
import { currentUserId } from "@/auth";
import { fail, NO_DATABASE_MESSAGE, ok, readJson, toErrorResponse } from "@/lib/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIGN_IN_REQUIRED = "Sign in to manage your automations.";
const GONE = "That automation does not exist.";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params): Promise<Response> {
  const body = await readJson(request);
  if (!body) return fail(400, "INVALID_INPUT", "That request could not be read.");
  const prisma = getPrisma();
  if (!prisma) return fail(503, "DATABASE_UNAVAILABLE", NO_DATABASE_MESSAGE);
  const userId = await currentUserId();
  if (!userId) return fail(401, "AUTH_REQUIRED", SIGN_IN_REQUIRED);
  try {
    const { id } = await params;
    const patch = {
      cadence: typeof body.cadence === "string" ? (body.cadence as ScheduleCadence) : undefined,
      hour: typeof body.hour === "number" ? body.hour : undefined,
      minute: typeof body.minute === "number" ? body.minute : undefined,
      weekday: typeof body.weekday === "number" ? body.weekday : undefined,
      enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
    };
    return ok({ schedule: await updateSchedule(userId, id, patch, prisma) });
  } catch (err) {
    if (err instanceof InvalidScheduleError) return fail(422, err.code, err.message);
    if (err instanceof ScheduleNotFoundError) return fail(404, err.code, GONE);
    return toErrorResponse(err, "api/automations/schedules/:id");
  }
}

export async function DELETE(_request: Request, { params }: Params): Promise<Response> {
  const prisma = getPrisma();
  if (!prisma) return fail(503, "DATABASE_UNAVAILABLE", NO_DATABASE_MESSAGE);
  const userId = await currentUserId();
  if (!userId) return fail(401, "AUTH_REQUIRED", SIGN_IN_REQUIRED);
  try {
    const { id } = await params;
    const removed = await deleteSchedule(userId, id, prisma);
    if (!removed) return fail(404, "NOT_FOUND", GONE);
    return ok({ removed: true });
  } catch (err) {
    return toErrorResponse(err, "api/automations/schedules/:id");
  }
}
