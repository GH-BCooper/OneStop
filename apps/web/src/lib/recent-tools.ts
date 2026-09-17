// Recently used tools, kept in localStorage on this device.
// TODO(14-history-favorites.md): replace with persisted history for signed-in users.

export const RECENT_TOOLS_KEY = "onestop-recent-tools";
const MAX_RECENT = 12;

export function readRecentTools(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_TOOLS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function recordRecentTool(id: string): void {
  try {
    const next = [id, ...readRecentTools().filter((x) => x !== id)].slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_TOOLS_KEY, JSON.stringify(next));
  } catch {
    // Storage can be blocked (private mode); recents are a convenience only.
  }
}
