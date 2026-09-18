import type { Metadata } from "next";
import { Suspense } from "react";
import { authIsConfigured } from "@/auth";
import { ResetPasswordForm } from "@/components/auth/forms";

export const metadata: Metadata = { title: "Reset password" };
export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <Suspense>
      <ResetPasswordForm available={authIsConfigured()} />
    </Suspense>
  );
}
