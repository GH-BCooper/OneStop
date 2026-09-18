import type { Metadata } from "next";
import { Suspense } from "react";
import { authIsConfigured, googleIsConfigured } from "@/auth";
import { LoginForm } from "@/components/auth/forms";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <Suspense>
      <LoginForm googleEnabled={googleIsConfigured()} available={authIsConfigured()} />
    </Suspense>
  );
}
