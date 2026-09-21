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
import type { AiStatus } from "@onestop/types";
import {
  AI_MODES,
  aiHeaders,
  aiMode,
  DEFAULT_PREFERENCES,
  readAllAiKeys,
  readAiKey,
  writeAiKey,
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

/** An on/off switch, styled like a native toggle rather than a checkbox. */
function Switch({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors focus-visible:outline-2 focus-visible:outline-ring ${
        checked ? "border-primary bg-primary" : "border-border bg-surface-muted"
      } ${disabled ? "opacity-60" : ""}`}
    >
      <span
        className={`absolute top-0.5 h-4.5 w-4.5 rounded-full shadow transition-transform ${
          checked ? "translate-x-5.5 bg-primary-fg" : "translate-x-0.5 bg-fg-muted"
        }`}
      />
    </button>
  );
}

export function SettingsView({ accountsEnabled }: { accountsEnabled: boolean }) {
  const { data: session, status } = useSession();
  const signedIn = Boolean(session?.user);
  const [theme, setTheme] = useState<ThemePreference>("system");
  const [preferredAI, setPreferredAI] = useState<string>("");
  const [prefs, setPrefs] = useState<LocalPreferences>(DEFAULT_PREFERENCES);
  const [aiKey, setAiKey] = useState("");
  const [aiStatus, setAiStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [checkingAi, setCheckingAi] = useState(false);
  // What OneStop's own service can do right now, straight from the server (null while asking).
  const [hosted, setHosted] = useState<{ available: boolean; ollamaReachable: boolean } | null>(
    null,
  );
  const [savedKeys, setSavedKeys] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  // Set as soon as the visitor changes anything. The account's settings arrive asynchronously,
  // and a slow response must never undo a choice made while it was in flight.
  const touched = useRef(false);

  // The device's values first (they need no network), then the account's if there is one. The
  // account wins: it is the thing that is meant to follow the user between browsers.
  useEffect(() => {
    setTheme(readThemePreference());
    const stored = readPreferredAI() ?? "";
    setPreferredAI(stored);
    setAiKey(readAiKey(stored || null));
    setPrefs(readLocalPreferences());
    setSavedKeys(readAllAiKeys());
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

  // Asked once, and again whenever the visitor might have changed something that affects it.
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/assistant/status", {
      headers: aiHeaders("onestop"),
      signal: controller.signal,
      cache: "no-store",
    })
      .then((response) => response.json())
      .then((body: { status?: AiStatus }) => {
        if (!body.status) return setHosted({ available: false, ollamaReachable: false });
        setHosted({
          available: body.status.available,
          ollamaReachable: Boolean(body.status.ollamaReachable),
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) setHosted({ available: false, ollamaReachable: false });
      });
    return () => controller.abort();
  }, []);

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

  const selectedMode = aiMode(preferredAI || null);
  const source = prefs.aiSource === "own" ? "own" : "onestop";

  const changeAI = async (next: string) => {
    touched.current = true;
    setPreferredAI(next);
    // The key for this provider comes back by itself if it was entered before.
    setAiKey(readAiKey(next || null));
    setAiStatus(null);
    writePreferredAI(next || null);
    // Only the *choice* syncs to the account. The key never leaves this browser.
    confirmSaved(signedIn ? await saveSettings({ preferredAI: next || null }) : true);
  };

  const changeSource = async (next: "onestop" | "own") => {
    setAiStatus(null);
    await changePref("aiSource", next);
    // Switching to "your own" with nothing chosen yet: start from a provider that already has a
    // key saved, else Ollama when it answers, else Groq - never an empty, half-configured state.
    if (next === "own" && !preferredAI) {
      const keys = readAllAiKeys();
      const withKey = AI_MODES.find((m) => m.needsKey && keys[m.id]);
      const start = withKey?.id ?? (hosted?.ollamaReachable ? "ollama" : "groq");
      await changeAI(start);
    }
  };

  const changeAiKey = (next: string) => {
    touched.current = true;
    setAiKey(next);
    if (preferredAI) writeAiKey(preferredAI, next);
    setSavedKeys(readAllAiKeys());
    setAiStatus(null);
  };

  const checkAi = async () => {
    setCheckingAi(true);
    setAiStatus(null);
    try {
      const response = await fetch("/api/assistant/status", {
        headers: aiHeaders("own"),
        cache: "no-store",
      });
      const body = (await response.json()) as { status?: AiStatus };
      const check = body.status?.checks?.find((c) => c.provider === preferredAI);
      setAiStatus(
        check
          ? { ok: check.ok, message: check.message }
          : {
              ok: false,
              message: aiKey.trim()
                ? "That provider could not be checked. Try again."
                : "Paste your API key first, then check it.",
            },
      );
    } catch {
      setAiStatus({ ok: false, message: "The check could not run - is the app still reachable?" });
    } finally {
      setCheckingAi(false);
    }
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

      <Card className="flex flex-col gap-4">
        <div>
          <CardTitle>AI service</CardTitle>
          <CardDescription>
            Choose what powers the AI Assistant and the AI tools. Every AI tool also works with no
            AI at all, using OneStop&rsquo;s built-in offline methods.
          </CardDescription>
        </div>

        <div role="radiogroup" aria-label="AI service" className="flex flex-col gap-2">
          <label
            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm ${
              source === "onestop" ? "border-primary bg-surface-muted" : "border-border"
            }`}
          >
            <input
              type="radio"
              name="ai-source"
              className="mt-1"
              checked={source === "onestop"}
              disabled={!ready}
              onChange={() => void changeSource("onestop")}
            />
            <span className="flex flex-col gap-0.5">
              <span className="font-medium">
                Use OneStop AI service{" "}
                <span
                  data-testid="onestop-ai-availability"
                  className={
                    hosted === null
                      ? "text-fg-muted"
                      : hosted.available
                        ? "text-success"
                        : "text-danger"
                  }
                >
                  {hosted === null
                    ? "(checking…)"
                    : hosted.available
                      ? "(available)"
                      : "(unavailable)"}
                </span>
              </span>
              <span className="text-fg-muted">
                Nothing to set up. OneStop uses whichever of its own AI services is available and
                switches to another on its own if one runs out.
              </span>
            </span>
          </label>

          <label
            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm ${
              source === "own" ? "border-primary bg-surface-muted" : "border-border"
            }`}
          >
            <input
              type="radio"
              name="ai-source"
              className="mt-1"
              checked={source === "own"}
              disabled={!ready}
              onChange={() => void changeSource("own")}
            />
            <span className="flex flex-col gap-0.5">
              <span className="font-medium">Use your own AI service provider</span>
              <span className="text-fg-muted">
                Bring your own free Ollama, Groq, OpenRouter or Gemini account.
              </span>
            </span>
          </label>
        </div>

        {source === "onestop" && (
          <p
            data-testid="ai-disclosure"
            className="rounded-md border border-warning bg-surface p-3 text-sm text-fg"
          >
            <strong>Heads up.</strong> OneStop&rsquo;s AI service may run on a hosted free tier
            (Groq, OpenRouter or Google Gemini) or on the machine that runs OneStop. When it does,
            the text and file contents you send the AI are transmitted to that provider and need an
            internet connection.
          </p>
        )}

        {source === "own" && (
          <>
            <div role="radiogroup" aria-label="Preferred runtime" className="flex flex-col gap-2">
              <p className="text-sm font-medium">Preferred runtime</p>
              {AI_MODES.map((mode) => {
                // Ollama needs a server on the same machine as OneStop; on a hosted site (or
                // where it is not installed or running) it cannot be used, so it is dimmed out.
                const blocked = mode.id === "ollama" && hosted !== null && !hosted.ollamaReachable;
                const selected = preferredAI === mode.id;
                return (
                  <label
                    key={mode.id}
                    data-testid={`ai-runtime-${mode.id}`}
                    aria-disabled={blocked || undefined}
                    title={
                      blocked
                        ? "Ollama isn't running on the machine that hosts OneStop, so it can't be used here."
                        : undefined
                    }
                    className={`flex items-center gap-3 rounded-lg border p-3 text-sm ${
                      blocked
                        ? "cursor-not-allowed border-border opacity-45"
                        : selected
                          ? "cursor-pointer border-primary bg-surface-muted"
                          : "cursor-pointer border-border"
                    }`}
                  >
                    <input
                      type="radio"
                      name="ai-runtime"
                      checked={selected}
                      disabled={!ready || blocked}
                      onChange={() => void changeAI(mode.id)}
                    />
                    <span className="flex-1 font-medium">{mode.label}</span>
                    {mode.needsKey && savedKeys[mode.id] && (
                      <span className="text-xs text-fg-muted">key saved</span>
                    )}
                    {blocked && <span className="text-xs text-fg-muted">not available here</span>}
                  </label>
                );
              })}
            </div>

            {selectedMode && (
              <p
                data-testid="ai-disclosure"
                className={`rounded-md border p-3 text-sm ${
                  selectedMode.local
                    ? "border-border bg-surface-muted text-fg-muted"
                    : "border-warning bg-surface text-fg"
                }`}
              >
                <strong>{selectedMode.local ? "Private by default." : "Heads up."}</strong>{" "}
                {selectedMode.disclosure}
              </p>
            )}

            {selectedMode?.needsKey && (
              <div className="flex flex-col gap-1">
                <label htmlFor="settings-ai-key" className="text-sm font-medium">
                  Your {selectedMode.label.replace(/\s*\(.*\)$/, "")} API key
                </label>
                <input
                  id="settings-ai-key"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  className={fieldClass}
                  value={aiKey}
                  disabled={!ready}
                  placeholder="Paste your own free key"
                  onChange={(e) => changeAiKey(e.target.value)}
                />
                <p className="text-xs text-fg-muted">
                  Stored in this browser only — never sent to your OneStop account and never shared.
                  Get a free key at{" "}
                  <a
                    href={selectedMode.setupUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-primary underline"
                  >
                    {selectedMode.setupUrl}
                  </a>
                  .
                </p>
              </div>
            )}

            {selectedMode && (
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={checkingAi}
                  onClick={() => void checkAi()}
                >
                  {checkingAi ? "Checking…" : "Check connection"}
                </Button>
                {aiStatus && (
                  <p
                    data-testid="ai-status"
                    role="status"
                    className={`text-sm ${aiStatus.ok ? "text-success" : "text-danger"}`}
                  >
                    {aiStatus.message}
                  </p>
                )}
              </div>
            )}

            <p className="text-xs text-fg-muted">
              Keys you have saved for the other providers are used as backups: if your preferred one
              runs out of credits, OneStop moves on to the next.
            </p>
          </>
        )}
      </Card>

      <Card className="flex flex-col gap-3">
        <div>
          <CardTitle>Privacy &amp; storage</CardTitle>
          <CardDescription>
            Uploaded and produced files are deleted from the server automatically after a short
            retention window. Nothing is ever stored in the cloud unless you ask for it.
          </CardDescription>
        </div>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>
            Save work to history
            <span className="block text-xs text-fg-muted">
              Off means nothing is written to this device&rsquo;s history.
              {signedIn && " Runs are still recorded on your account."}
            </span>
          </span>
          <Switch
            label="Save work to history"
            checked={prefs.saveHistory}
            disabled={!ready}
            onChange={(next) => void changePref("saveHistory", next)}
          />
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
