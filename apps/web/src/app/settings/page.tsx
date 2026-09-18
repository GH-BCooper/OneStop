// `/settings` — theme, AI runtime and the small privacy/storage preferences
// (14-history-favorites.md). Signed in they follow the account; as a guest they stay on the
// device, and the page says which.
import type { Metadata } from "next";
import { SettingsView } from "@/components/settings/SettingsView";
import { authIsConfigured } from "@/lib/auth-config";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold sm:text-3xl">Settings</h1>
        <p className="mt-2 text-fg-muted">Theme, AI provider, privacy and storage preferences.</p>
      </div>
      <SettingsView accountsEnabled={authIsConfigured()} />
    </div>
  );
}
