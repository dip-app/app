// Human-readable labels for audit log actions. The backend writes machine keys such as "ai.generateDrafts"
// (gcp/functions/src/modules/admin/domain/auditActions.ts); the portal never shows a raw key in the row.
// auditLabels.test.ts fails when the backend list and this map drift apart.
// @i18n-migrated

import { t, type MessageKey } from "./i18n";

export type AuditCategory = "People" | "Events" | "Challenges" | "AI" | "Email" | "Settings" | "Security";

export const AUDIT_CATEGORIES: readonly AuditCategory[] = ["People", "Events", "Challenges", "AI", "Email", "Settings", "Security"];

export interface AuditLabel { label: string; category: AuditCategory }

/** The label is read through a getter so it follows the current language (the map itself is built once). */
function entry(labelKey: MessageKey, category: AuditCategory): AuditLabel {
  return { category, get label() { return t(labelKey); } };
}

export const AUDIT_LABELS: Record<string, AuditLabel> = {
  "member.update": entry("audit.action.memberUpdate", "People"),
  "member.reset": entry("audit.action.memberReset", "People"),
  "member.status": entry("audit.action.memberStatus", "Security"),
  "points.adjust": entry("audit.action.pointsAdjust", "People"),
  "photo.remove": entry("audit.action.photoRemove", "Events"),
  "photo.comment.remove": entry("audit.action.photoCommentRemove", "Events"),
  "attendee.add": entry("audit.action.attendeeAdd", "Events"),
  "attendee.remove": entry("audit.action.attendeeRemove", "Events"),
  "attendance.record": entry("audit.action.attendanceRecord", "Events"),
  "team.upsert": entry("audit.action.teamUpsert", "People"),
  "roster.upsert": entry("audit.action.rosterUpsert", "People"),
  "roster.revoke": entry("audit.action.rosterRevoke", "Security"),
  "roster.resend": entry("audit.action.rosterResend", "People"),
  "roster.backfill": entry("audit.action.rosterBackfill", "People"),
  "roster.claim": entry("audit.action.rosterClaim", "People"),
  "import.plan": entry("audit.action.importPlan", "People"),
  "import.apply": entry("audit.action.importApply", "People"),
  "bugreport.update": entry("audit.action.bugreportUpdate", "Settings"),
  "ai.generateDrafts": entry("audit.action.aiGenerateDrafts", "AI"),
  "ai.noteDeclined": entry("audit.action.aiNoteDeclined", "AI"),
  "ai.generateFailed": entry("audit.action.aiGenerateFailed", "AI"),
  "ai.ideasGenerated": entry("audit.action.aiIdeasGenerated", "AI"),
  "ai.ideasFailed": entry("audit.action.aiIdeasFailed", "AI"),
  "company.office.update": entry("audit.action.companyOfficeUpdate", "Settings"),
  "suggestions.setSchedule": entry("audit.action.suggestionsSetSchedule", "Email"),
  "suggestions.sendTest": entry("audit.action.suggestionsSendTest", "Email"),
  "event.create": entry("audit.action.eventCreate", "Events"),
  "event.update": entry("audit.action.eventUpdate", "Events"),
  "event.status": entry("audit.action.eventStatus", "Events"),
  "event.cancel": entry("audit.action.eventCancel", "Events"),
  "challenge.create": entry("audit.action.challengeCreate", "Challenges"),
  "challenge.update": entry("audit.action.challengeUpdate", "Challenges"),
  "submission.approve": entry("audit.action.submissionApprove", "Challenges"),
  "submission.reject": entry("audit.action.submissionReject", "Challenges"),
  "cover.pick": entry("audit.action.coverPick", "AI"),
  "cover.import": entry("audit.action.coverImport", "AI"),
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
  if (words.length === 0) return t("audit.unknownAction");
  const [first, ...rest] = words;
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(" ");
}

export interface ResolvedAuditAction { label: string; category: AuditCategory; known: boolean }

/** Label and category for any action key; unknown keys get the humanized form under "Settings". */
export function auditAction(key: string): ResolvedAuditAction {
  const hit = Object.prototype.hasOwnProperty.call(AUDIT_LABELS, key) ? AUDIT_LABELS[key] : undefined;
  return hit ? { label: hit.label, category: hit.category, known: true } : { label: humanizeAction(key), category: "Settings", known: false };
}

/** Categories that at least one action maps to, in display order (empty ones never fill the filter). */
export function auditCategoriesInUse(): AuditCategory[] {
  const used = new Set(Object.values(AUDIT_LABELS).map((l) => l.category));
  return AUDIT_CATEGORIES.filter((c) => used.has(c));
}

const CATEGORY_LABEL: Record<AuditCategory, MessageKey> = {
  People: "audit.category.people", Events: "audit.category.events", Challenges: "audit.category.challenges", AI: "audit.category.ai",
  Email: "audit.category.email", Settings: "audit.category.settings", Security: "audit.category.security",
};

/** The category name to show; the id itself ("People") stays the stable value in URLs and CSS class names. */
export const auditCategoryLabel = (category: AuditCategory): string => t(CATEGORY_LABEL[category]);

export function isAuditCategory(value: string): value is AuditCategory {
  return (AUDIT_CATEGORIES as readonly string[]).includes(value);
}

export interface AuditFact { label: string; value: string }

const AI_FACTS: Record<string, MessageKey> = {
  credits: "audit.fact.credits",
  tokens: "audit.fact.tokens",
  models: "audit.fact.models",
  flaggedCategories: "audit.fact.flaggedCategories",
  triageReasons: "audit.fact.triageReasons",
};

/**
 * Plain facts for AI entries: credits (never dollars), token counts and model names, never prompts or drafts.
 * Fields outside the allow-list are dropped, so a cost or content field added later cannot leak into the page.
 */
export function aiFacts(changes: readonly { field: string; before: string; after: string }[]): AuditFact[] {
  const out: AuditFact[] = [];
  for (const c of changes) {
    const labelKey = Object.prototype.hasOwnProperty.call(AI_FACTS, c.field) ? AI_FACTS[c.field] : undefined;
    if (labelKey && c.after) out.push({ label: t(labelKey), value: c.after });
  }
  return out;
}

export const isAiAction = (key: string) => key.startsWith("ai.");
