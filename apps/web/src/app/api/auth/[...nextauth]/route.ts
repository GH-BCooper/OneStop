// Auth.js endpoints: sign in, sign out, callbacks, CSRF and session (13-auth-database.md).
import { handlers } from "@/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const { GET, POST } = handlers;
