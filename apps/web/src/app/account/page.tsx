// The signed-in user's profile (13-auth-database.md).
//
// Route protection is done here, in the server component, rather than in middleware: middleware
// runs on the edge runtime, and the Prisma client this page's data needs is Node-only.
import { findUserById, getPrisma, getUserSettings, getJobStore } from "@onestop/api";
import { Card } from "@onestop/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { authIsConfigured, currentUserId } from "@/auth";
import { AccountView } from "@/components/auth/AccountView";

export const metadata: Metadata = { title: "Account" };
export const dynamic = "force-dynamic";

export default async function AccountPage() {
  if (!authIsConfigured()) {
    return (
      <Card className="mx-auto flex max-w-md flex-col gap-3 p-6">
        <h1 className="text-2xl font-bold">Account</h1>
        <p className="text-sm text-fg-muted">
          Accounts are switched off on this instance: it has no database configured. Every tool
          still works without signing in - only saved history, favourites and workflows need an
          account.
        </p>
        <Link href="/tools" className="text-primary hover:underline">
          Browse the tools
        </Link>
      </Card>
    );
  }

  const userId = await currentUserId();
  if (!userId) redirect("/auth/login");

  const prisma = getPrisma();
  const user = prisma ? await findUserById(userId, prisma) : null;
  if (!user || !prisma) redirect("/auth/login");

  const [settings, jobs] = await Promise.all([
    getUserSettings(userId, prisma),
    getJobStore().list({ userId, limit: 100 }),
  ]);

  return <AccountView user={user} settings={settings} jobCount={jobs.length} />;
}
