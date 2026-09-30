"use client";

// Theme presets, text accessibility and reduced data (21-roadmap-expansion.md, roadmap §7.6, §6).
//
// Deliberately per-device rather than synced to the account: a high-contrast theme or larger text is
// usually about the screen you are sitting in front of, not about who you are. It sits beside the
// existing light/dark control rather than replacing it — choosing a preset takes over, and "Follow
// light / dark" hands control back.
import { useEffect, useState } from "react";
import {
  CardDescription,
  CardTitle,
  THEME_PRESETS,
  TEXT_PRESETS,
  type TextPresetId,
  type ThemePresetId,
} from "@onestop/ui";
import {
  activeThemePreset,
  applyTextPreferences,
  applyThemePreset,
  readTextPreferences,
  readThemePresetPreference,
  type TextPreferences,
} from "@/lib/appearance";

/** A tiny live sample of a preset, drawn from that preset's own tokens. */
function Swatch({ id }: { id: ThemePresetId }) {
  const preset = THEME_PRESETS.find((p) => p.id === id);
  if (!preset) return null;
  return (
    <span
      aria-hidden="true"
      className="flex h-6 w-10 shrink-0 items-center justify-center overflow-hidden rounded border"
      style={{ background: preset.colors.bg, borderColor: preset.colors.border }}
    >
      <span className="h-2.5 w-4 rounded-sm" style={{ background: preset.colors.primary }} />
    </span>
  );
}

export function AppearancePanel() {
  const [preset, setPreset] = useState<ThemePresetId | null>(null);
  const [active, setActive] = useState<ThemePresetId>("chrome");
  const [text, setText] = useState<TextPreferences>({ text: "default", dataSaver: false });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setPreset(readThemePresetPreference());
    setActive(activeThemePreset());
    setText(readTextPreferences());
    setReady(true);
  }, []);

  const choosePreset = (id: ThemePresetId | null) => {
    applyThemePreset(id);
    setPreset(id);
    setActive(id ?? activeThemePreset());
  };

  const chooseText = (id: TextPresetId) => setText(applyTextPreferences({ text: id }));

  return (
    <div className="flex flex-col gap-5">
      <div>
        <CardTitle as="h2">Theme preset</CardTitle>
        <CardDescription>
          Presets replace the light/dark toggle while one is chosen. They are stored on this device
          only, so a shared account can look different on each screen.
        </CardDescription>
      </div>

      <fieldset className="grid gap-2 sm:grid-cols-2" disabled={!ready}>
        <legend className="sr-only">Theme preset</legend>
        <button
          type="button"
          aria-pressed={preset === null}
          data-preset-option="follow"
          onClick={() => choosePreset(null)}
          className={`flex items-center gap-3 rounded-lg border p-3 text-left text-sm ${
            preset === null ? "border-primary bg-surface-muted" : "border-border"
          }`}
        >
          <span aria-hidden="true" className="w-10 shrink-0 text-center text-lg">
            ◐
          </span>
          <span className="min-w-0">
            <span className="block font-medium">Follow light / dark</span>
            <span className="block text-xs text-fg-muted">
              Uses the header toggle and your system setting — currently{" "}
              {active === "lacquer" ? "black lacquer" : "polished chrome"}.
            </span>
          </span>
        </button>
        {THEME_PRESETS.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={preset === option.id}
            data-preset-option={option.id}
            onClick={() => choosePreset(option.id)}
            className={`flex items-center gap-3 rounded-lg border p-3 text-left text-sm ${
              preset === option.id ? "border-primary bg-surface-muted" : "border-border"
            }`}
          >
            <Swatch id={option.id} />
            <span className="min-w-0">
              <span className="block font-medium">{option.name}</span>
              <span className="block text-xs text-fg-muted">{option.description}</span>
            </span>
          </button>
        ))}
      </fieldset>

      <div className="border-t border-border pt-4">
        <CardTitle as="h2">Reading & accessibility</CardTitle>
        <CardDescription>
          Spacing and size only — no font is downloaded, so these work offline and cost nothing.
        </CardDescription>
        <fieldset className="mt-3 flex flex-wrap gap-2" disabled={!ready}>
          <legend className="sr-only">Text</legend>
          {TEXT_PRESETS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={text.text === option.id}
              data-text-option={option.id}
              title={option.description}
              onClick={() => chooseText(option.id)}
              className={`rounded-full border px-3 py-1.5 text-sm ${
                text.text === option.id
                  ? "border-primary bg-primary text-primary-fg"
                  : "border-border bg-surface"
              }`}
            >
              {option.name}
            </button>
          ))}
        </fieldset>
      </div>

      <label className="flex cursor-pointer items-start gap-3 border-t border-border pt-4 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={text.dataSaver}
          disabled={!ready}
          data-testid="data-saver-toggle"
          onChange={(e) => setText(applyTextPreferences({ dataSaver: e.target.checked }))}
        />
        <span>
          <span className="block font-medium">Reduced data mode</span>
          <span className="block text-xs text-fg-muted">
            Turns off the hover tilt and glow effects and the heavy gradients, and loads preview
            thumbnails lazily. Useful on a metered connection or a low battery. OneStop also does
            this by itself when your browser reports a slow or metered connection.
          </span>
        </span>
      </label>
    </div>
  );
}
