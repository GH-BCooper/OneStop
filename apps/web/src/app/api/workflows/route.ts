// Saved workflows for the signed-in user (15-workflows.md).
//
//   GET  /api/workflows - this user's workflows, most recently updated first
//   POST /api/workflows - create one from { name, description?, steps }
//
// A guest keeps workflows in localStorage (`@/lib/localWorkflows`) and never calls this route, so
// the builder and the run engine work with no account at all — only syncing needs one.
import {
  createWorkflow,
  getPrisma,
  InvalidWorkflowError,
  listWorkflows,
  parseWorkflowInput,
  TooManyWorkflowsError,
} from "@onestop/api";
import { currentUserId } from "@/auth";
import { fail, NO_DATABASE_MESSAGE, ok, readJson, toErrorResponse } from "@/lib/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIGN_IN_REQUIRED = "Sign in to keep your workflows across devices.";

export async function GET(): Promise<Response> {
  const prisma = getPrisma();
  if (!prisma) return fail(503, "DATABASE_UNAVAILABLE", NO_DATABASE_MESSAGE);
  const userId = await currentUserId();
  if (!userId) return fail(401, "AUTH_REQUIRED", SIGN_IN_REQUIRED);
  try {
    return ok({ workflows: await listWorkflows(userId, prisma) });
  } catch (err) {
    return toErrorResponse(err, "api/workflows");
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
    const input = parseWorkflowInput(body);
    return ok({ workflow: await createWorkflow(userId, input, prisma) }, 201);
  } catch (err) {
    if (err instanceof InvalidWorkflowError) return fail(422, err.code, err.message);
    if (err instanceof TooManyWorkflowsError) return fail(409, err.code, err.message);
    return toErrorResponse(err, "api/workflows");
  }
}
