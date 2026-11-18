// Human-readable labels for audit log actions. The backend writes machine keys such as "ai.generateDrafts"
// (gcp/functions/src/modules/admin/domain/auditActions.ts); the portal never shows a raw key in the row.
// auditLabels.test.ts fails when the backend list and this map drift apart.

export type AuditCategory = "People" | "Events" | "Challenges" | "AI" | "Email" | "Settings" | "Security";

export const AUDIT_CATEGORIES: readonly AuditCategory[] = ["People", "Events", "Challenges", "AI", "Email", "Settings", "Security"];

export interface AuditLabel { label: string; category: AuditCategory }

export const AUDIT_LABELS: Record<string, AuditLabel> = {
  "member.update": { label: "Edited a member's profile", category: "People" },
  "member.reset": { label: "Reset a member's profile", category: "People" },
  "member.status": { label: "Changed a member's access", category: "Security" },
  "points.adjust": { label: "Adjusted a member's points", category: "People" },
  "photo.remove": { label: "Removed an event photo", category: "Events" },
  "photo.comment.remove": { label: "Removed a photo comment", category: "Events" },
  "attendee.add": { label: "Added an attendee to an event", category: "Events" },
  "attendee.remove": { label: "Removed an attendee from an event", category: "Events" },
  "attendance.record": { label: "Recorded event attendance", category: "Events" },
  "team.upsert": { label: "Saved a team", category: "People" },
  "roster.upsert": { label: "Saved a roster entry", category: "People" },
  "roster.revoke": { label: "Revoked an invitation", category: "Security" },
  "roster.resend": { label: "Resent an invitation", category: "People" },
  "roster.backfill": { label: "Backfilled the roster", category: "People" },
  "roster.claim": { label: "Claimed a roster invitation", category: "People" },
  "import.plan": { label: "Previewed an employee import", category: "People" },
  "import.apply": { label: "Applied an employee import", category: "People" },
  "bugreport.update": { label: "Updated a bug report", category: "Settings" },
  "ai.generateDrafts": { label: "Generated event drafts with Dipbot", category: "AI" },
  "ai.noteDeclined": { label: "Dipbot declined an event note", category: "AI" },
  "ai.generateFailed": { label: "Couldn't generate event drafts with Dipbot", category: "AI" },
  "company.office.update": { label: "Changed the company office address", category: "Settings" },
  "suggestions.setSchedule": { label: "Changed the weekly ideas email schedule", category: "Email" },
  "suggestions.sendTest": { label: "Sent a test of the weekly ideas email", category: "Email" },
  "event.create": { label: "Created an event", category: "Events" },
  "event.update": { label: "Edited an event", category: "Events" },
  "event.status": { label: "Changed an event's status", category: "Events" },
  "event.cancel": { label: "Cancelled an event", category: "Events" },
  "challenge.create": { label: "Created a weekly theme", category: "Challenges" },
  "challenge.update": { label: "Edited a weekly theme", category: "Challenges" },
  "submission.approve": { label: "Approved a theme entry", category: "Challenges" },
  "submission.reject": { label: "Asked for changes on a theme entry", category: "Challenges" },
  "cover.pick": { label: "Picked an event cover with Dipbot", category: "AI" },
  "cover.import": { label: "Imported a new cover photo", category: "AI" },
};

const ACRONYMS: Record<string, string> = {
  ai: "AI", id: "ID", ids: "IDs", csv: "CSV", url: "URL", api: "API", rsvp: "RSVP", sso: "SSO", ics: "ICS", sms: "SMS",
  pdf: "PDF", ui: "UI", uid: "UID", dipbot: "Dipbot",
};

/**
 * Readable fallback for a key without a label: "ai.generateDrafts" -> "AI generate drafts",
 * "rsvpListExport" -> "RSVP list export". Known acronyms stay upper case and the brand name keeps its spelling.
 */
export function humanizeAction(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => (ACRONYMS[w.toLowerCase()] ?? (w === w.toUpperCase() && w.length > 1 ? w : w.toLowerCase())));
  if (words.length === 0) return "Unknown action";
  const [first, ...rest] = words;
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(" ");
}

export interface ResolvedAuditAction { label: string; category: AuditCategory; known: boolean }

/** Label and category for any action key; unknown keys get the humanized form under "Settings". */
export function auditAction(key: string): ResolvedAuditAction {
  const hit = Object.prototype.hasOwnProperty.call(AUDIT_LABELS, key) ? AUDIT_LABELS[key] : undefined;
  return hit ? { ...hit, known: true } : { label: humanizeAction(key), category: "Settings", known: false };
}

/** Categories that at least one action maps to, in display order (empty ones never fill the filter). */
export function auditCategoriesInUse(): AuditCategory[] {
  const used = new Set(Object.values(AUDIT_LABELS).map((l) => l.category));
  return AUDIT_CATEGORIES.filter((c) => used.has(c));
}

export function isAuditCategory(value: string): value is AuditCategory {
  return (AUDIT_CATEGORIES as readonly string[]).includes(value);
}

export interface AuditFact { label: string; value: string }

const AI_FACTS: Record<string, string> = {
  credits: "Credits used",
  tokens: "Tokens",
  models: "Model",
  flaggedCategories: "Safety categories",
  triageReasons: "Reasons",
};

/**
 * Plain facts for AI entries: credits (never dollars), token counts and model names, never prompts or drafts.
 * Fields outside the allow-list are dropped, so a cost or content field added later cannot leak into the page.
 */
export function aiFacts(changes: readonly { field: string; before: string; after: string }[]): AuditFact[] {
  const out: AuditFact[] = [];
  for (const c of changes) {
    const label = AI_FACTS[c.field];
    if (label && c.after) out.push({ label, value: c.after });
  }
  return out;
}

export const isAiAction = (key: string) => key.startsWith("ai.");
