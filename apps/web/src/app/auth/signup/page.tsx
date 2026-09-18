import type { Metadata } from "next";
import { Suspense } from "react";
import { authIsConfigured, googleIsConfigured } from "@/lib/auth-config";
import { SignupForm } from "@/components/auth/forms";

export const metadata: Metadata = { title: "Create an account" };
export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <Suspense>
      <SignupForm googleEnabled={googleIsConfigured()} available={authIsConfigured()} />
    </Suspense>
  );
}
