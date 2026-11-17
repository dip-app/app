/**
 * Email side of the shared notification category registry (docs/design/stretch/push-triggers.md, Categories).
 * The push workstream owns the full registry; email offers only the subset below. `chat`, `social` and
 * `discovery` are never emailed in V2. When the shared registry lands, these ids must stay identical to it.
 */

export const EMAIL_CATEGORIES = ["invites", "event_updates", "reminders", "challenges"] as const;
export type EmailCategory = (typeof EMAIL_CATEGORIES)[number];

/** Defaults when `users/{uid}/settings/notifications` has no `email.<category>` value (evaluated server-side). */
export const EMAIL_DEFAULTS: Readonly<Record<EmailCategory, boolean>> = {
  invites: true,
  event_updates: true,
  // Push covers reminders by default; members opt in to reminder emails (design doc, open question 2).
  reminders: false,
  challenges: true,
};

/** Categories whose delivery is also gated by the per-event subscription level (`all | changes | reminders | none`). */
export const EVENT_LEVEL_GATE: Readonly<Partial<Record<EmailCategory, readonly string[]>>> = {
  event_updates: ["all", "changes"],
  reminders: ["all", "changes", "reminders"],
};

export function isEmailCategory(value: unknown): value is EmailCategory {
  return typeof value === "string" && (EMAIL_CATEGORIES as readonly string[]).includes(value);
}

/** Resolves stored preferences (possibly missing or partial) against the defaults. Non-boolean values fall back to the default. */
export function resolveEmailPreferences(stored: Readonly<Record<string, unknown>> | null | undefined): Record<EmailCategory, boolean> {
  const out = { ...EMAIL_DEFAULTS };
  for (const category of EMAIL_CATEGORIES) {
    const value = stored?.[category];
    if (typeof value === "boolean") out[category] = value;
  }
  return out;
}
