/** "morning" before noon, "afternoon" before 6pm, "evening" otherwise — server or client, same rule. */
export function timeOfDayGreeting(date: Date = new Date()): "morning" | "afternoon" | "evening" {
  const hour = date.getHours();
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

/** The first word of a display name, or null when there is nothing to greet by. */
export function firstNameOf(name: string | null | undefined): string | null {
  const trimmed = name?.trim();
  return trimmed ? (trimmed.split(/\s+/)[0] ?? null) : null;
}
