/** Small formatting helpers. Presentation only — no rules live here. */

/** "just now" → "12m ago" → "3h ago" → "Yesterday" → a date. */
export function relativeTime(at: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 45) return "just now";

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  if (hours < 48) return "Yesterday";

  return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** The last path segment — what a person calls the project. */
export function projectName(cwd: string): string {
  const parts = cwd.replace(/\/+$/, "").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? cwd;
}

/** Task ids are long by design; a card only needs enough to be unambiguous. */
export function shortId(id: string): string {
  return id.replace(/^t_/, "").slice(0, 8);
}
