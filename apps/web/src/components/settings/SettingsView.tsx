"use client";

// `/settings` (14-history-favorites.md).
//
// Signed in, every change is written to `UserSettings` in Postgres *and* applied to this device,
// so opening OneStop in another browser and signing in picks the same theme and AI mode up. As a
// guest the same controls work, but stay on the device, and the page says so with a prompt to
// sign in rather than hiding anything.
import { Button, Card, CardDescription, CardTitle, buttonClasses } from "@onestop/ui";
import type { ThemePreference } from "@onestop/types";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  AI_MODES,
  DEFAULT_PREFERENCES,
  applyThemePreference,
  fetchSettings,
  readLocalPreferences,
  readPreferredAI,
  readThemePreference,
  saveSettings,
  writeLocalPreferences,
  writePreferredAI,
  type LocalPreferences,
} from "@/lib/preferences";

const THEMES: { id: ThemePreference; label: string }[] = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "system", label: "Match my system" },
];

const fieldClass =
  "h-10 w-full min-w-0 rounded-md border border-border bg-surface px-3 text-sm text-fg focus-visible:outline-2 focus-visible:outline-ring";

export function SettingsView({ accountsEnabled }: { accountsEnabled: boolean }) {
  const { data: session, status } = useSession();
  const signedIn = Boolean(session?.user);
  const [theme, setTheme] = useState<ThemePreference>("system");
  const [preferredAI, setPreferredAI] = useState<string>("");
  const [prefs, setPrefs] = useState<LocalPreferences>(DEFAULT_PREFERENCES);
  const [notice, setNotice] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  // Set as soon as the visitor changes anything. The account's settings arrive asynchronously,
  // and a slow response must never undo a choice made while it was in flight.
  const touched = useRef(false);

  // The device's values first (they need no network), then the account's if there is one. The
  // account wins: it is the thing that is meant to follow the user between browsers.
  useEffect(() => {
    setTheme(readThemePreference());
    setPreferredAI(readPreferredAI() ?? "");
    setPrefs(readLocalPreferences());
    setReady(true);
  }, []);

  useEffect(() => {
    if (status === "loading" || !signedIn) return;
    const controller = new AbortController();
    void fetchSettings(controller.signal).then((settings) => {
      if (!settings || touched.current) return;
      setTheme(settings.theme);
      setPreferredAI(settings.preferredAI ?? "");
      setPrefs({ ...DEFAULT_PREFERENCES, ...(settings.preferences as Partial<LocalPreferences>) });
      applyThemePreference(settings.theme);
      writePreferredAI(settings.preferredAI);
      writeLocalPreferences(settings.preferences as Partial<LocalPreferences>);
    });
    return () => controller.abort();
  }, [signedIn, status]);

  const confirmSaved = (saved: unknown) => {
    setNotice(
      signedIn
        ? saved
          ? "Saved to your account."
          : "Saved on this device — your account could not be reached."
        : "Saved on this device.",
    );
  };

  const changeTheme = async (next: ThemePreference) => {
    touched.current = true;
    setTheme(next);
    applyThemePreference(next);
    confirmSaved(signedIn ? await saveSettings({ theme: next }) : true);
  };

  const changeAI = async (next: string) => {
    touched.current = true;
    setPreferredAI(next);
    writePreferredAI(next || null);
    confirmSaved(signedIn ? await saveSettings({ preferredAI: next || null }) : true);
  };

  const changePref = async <K extends keyof LocalPreferences>(
    key: K,
    value: LocalPreferences[K],
  ) => {
    touched.current = true;
    const next = writeLocalPreferences({ [key]: value } as Partial<LocalPreferences>);
    setPrefs(next);
    confirmSaved(signedIn ? await saveSettings({ preferences: { [key]: value } }) : true);
  };

  return (
    <div className="flex flex-col gap-6">
      {accountsEnabled && !signedIn && status !== "loading" && (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-dashed text-sm">
          <p className="text-fg-muted">
            These settings are saved on <strong className="text-fg">this device only</strong>.
          </p>
          <Link href="/auth/login?next=/settings" className={buttonClasses("secondary", "sm")}>
            Sign in to sync your settings across devices
          </Link>
        </Card>
      )}

      {notice && (
        <p role="status" className="rounded-md border border-border bg-surface p-3 text-sm">
          {notice}
        </p>
      )}

      <Card className="flex flex-col gap-3">
        <div>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>
            “Match my system” follows your operating system&rsquo;s light/dark setting.
          </CardDescription>
        </div>
        <fieldset className="flex flex-wrap gap-2" disabled={!ready}>
          <legend className="sr-only">Theme</legend>
          {THEMES.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={theme === option.id}
              data-theme-option={option.id}
              onClick={() => void changeTheme(option.id)}
              className={`rounded-full border px-3 py-1.5 text-sm ${
                theme === option.id
                  ? "border-primary bg-primary text-primary-fg"
                  : "border-border bg-surface"
              }`}
            >
              {option.label}
            </button>
          ))}
        </fieldset>
      </Card>

      <Card className="flex flex-col gap-3">
        <div>
          <CardTitle>AI runtime</CardTitle>
          <CardDescription>
            Ollama runs entirely on this machine and works offline. The hosted free tiers need
            internet and send your prompt to that provider — they are never the default, and each
            one uses a key you supply. The Assistant itself is built in phase 16.
          </CardDescription>
        </div>
        <label htmlFor="settings-ai" className="text-sm font-medium">
          Preferred runtime
        </label>
        <select
          id="settings-ai"
          className={fieldClass}
          value={preferredAI}
          disabled={!ready}
          onChange={(e) => void changeAI(e.target.value)}
        >
          <option value="">No preference (use whatever is available)</option>
          {AI_MODES.map((mode) => (
            <option key={mode.id} value={mode.id}>
              {mode.label}
            </option>
          ))}
        </select>
      </Card>

      <Card className="flex flex-col gap-3">
        <div>
          <CardTitle>Privacy &amp; storage</CardTitle>
          <CardDescription>
            Uploaded and produced files are deleted from the server automatically after a short
            retention window. Nothing is ever stored in the cloud unless you ask for it.
          </CardDescription>
        </div>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={prefs.saveHistory}
            disabled={!ready}
            onChange={(e) => void changePref("saveHistory", e.target.checked)}
          />
          <span>
            Keep a history of what I run
            <span className="block text-xs text-fg-muted">
              Off means nothing is written to this device&rsquo;s history.
              {signedIn && " Runs are still recorded on your account."}
            </span>
          </span>
        </label>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={prefs.confirmBeforeDelete}
            disabled={!ready}
            onChange={(e) => void changePref("confirmBeforeDelete", e.target.checked)}
          />
          <span>Ask before deleting anything</span>
        </label>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={prefs.reduceMotion}
            disabled={!ready}
            onChange={(e) => void changePref("reduceMotion", e.target.checked)}
          />
          <span>Reduce animation</span>
        </label>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={prefs.defaultDownload === "auto"}
            disabled={!ready}
            onChange={(e) => void changePref("defaultDownload", e.target.checked ? "auto" : "ask")}
          />
          <span>Start the download as soon as a result is ready</span>
        </label>
      </Card>

      <Card className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle>Your data</CardTitle>
          <CardDescription>
            History and favourites live on {signedIn ? "your account" : "this device"}.
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <Link href="/history" className={buttonClasses("secondary", "sm")}>
            Manage history
          </Link>
          {signedIn && (
            <Link href="/account" className={buttonClasses("ghost", "sm")}>
              Account
            </Link>
          )}
        </div>
      </Card>

      {!accountsEnabled && (
        <p className="text-sm text-fg-muted">
          This instance has no database configured, so settings stay on this device. Every tool
          still works.
        </p>
      )}

      <div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            const reset = writeLocalPreferences(DEFAULT_PREFERENCES);
            setPrefs(reset);
            void changeTheme("system");
          }}
        >
          Reset to defaults
        </Button>
      </div>
    </div>
  );
}
