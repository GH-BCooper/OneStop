// One saved workflow (15-workflows.md).
//
//   GET    /api/workflows/:id - the workflow, if it is this user's
//   PUT    /api/workflows/:id - replace its name, description and steps
//   DELETE /api/workflows/:id - delete it
import {
  deleteWorkflow,
  getPrisma,
  getWorkflow,
  InvalidWorkflowError,
  parseWorkflowInput,
  updateWorkflow,
  WorkflowNotFoundError,
} from "@onestop/api";
import { currentUserId } from "@/auth";
import { fail, NO_DATABASE_MESSAGE, ok, readJson, toErrorResponse } from "@/lib/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIGN_IN_REQUIRED = "Sign in to see the workflows saved to your account.";
const GONE = "That workflow does not exist.";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params): Promise<Response> {
  const prisma = getPrisma();
  if (!prisma) return fail(503, "DATABASE_UNAVAILABLE", NO_DATABASE_MESSAGE);
  const userId = await currentUserId();
  if (!userId) return fail(401, "AUTH_REQUIRED", SIGN_IN_REQUIRED);
  try {
    const { id } = await params;
    // Someone else's workflow answers exactly like a missing one.
    const workflow = await getWorkflow(userId, id, prisma);
    if (!workflow) return fail(404, "NOT_FOUND", GONE);
    return ok({ workflow });
  } catch (err) {
    return toErrorResponse(err, "api/workflows/:id");
  }
}

export async function PUT(request: Request, { params }: Params): Promise<Response> {
  const body = await readJson(request);
  if (!body) return fail(400, "INVALID_INPUT", "That request could not be read.");
  const prisma = getPrisma();
  if (!prisma) return fail(503, "DATABASE_UNAVAILABLE", NO_DATABASE_MESSAGE);
  const userId = await currentUserId();
  if (!userId) return fail(401, "AUTH_REQUIRED", SIGN_IN_REQUIRED);
  try {
    const { id } = await params;
    const input = parseWorkflowInput(body);
    return ok({ workflow: await updateWorkflow(userId, id, input, prisma) });
  } catch (err) {
    if (err instanceof InvalidWorkflowError) return fail(422, err.code, err.message);
    if (err instanceof WorkflowNotFoundError) return fail(404, err.code, GONE);
    return toErrorResponse(err, "api/workflows/:id");
  }
}

export async function DELETE(_request: Request, { params }: Params): Promise<Response> {
  const prisma = getPrisma();
  if (!prisma) return fail(503, "DATABASE_UNAVAILABLE", NO_DATABASE_MESSAGE);
  const userId = await currentUserId();
  if (!userId) return fail(401, "AUTH_REQUIRED", SIGN_IN_REQUIRED);
  try {
    const { id } = await params;
    const removed = await deleteWorkflow(userId, id, prisma);
    if (!removed) return fail(404, "NOT_FOUND", GONE);
    return ok({ removed: true });
  } catch (err) {
    return toErrorResponse(err, "api/workflows/:id");
  }
}
