import type { AuditAction } from "./auditActions";
import type { AuditSummaryKey } from "./auditSummaries";
import { SERVER_TIME, type ServerTime } from "./ops";
import { isRole, type Role } from "./permissions";
import { length } from "./reader";

export type AuditTargetType = "member" | "event" | "photo" | "comment" | "attendee" | "roster" | "import" | "team" | "company" | "points" | "bugReport" | "challenge" | "submission" | "cover";

export interface AuditChange { field: string; before: string | null; after: string | null }

export interface AuditInput {
  /** Document id; deterministic from actor + requestId so a replay never duplicates. */
  id: string;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: string;
  summary: string;
  /** Stable message key for `summary` plus its params (additive: `summary` stays the English sentence). */
  summaryKey?: AuditSummaryKey | undefined;
  summaryParams?: Readonly<Record<string, string | number>> | undefined;
  changes?: readonly AuditChange[];
  reason?: string | undefined;
  requestId?: string | undefined;
  /** True when the actor acted on their own member record (points adjustments, attendance). */
  selfTarget?: true | undefined;
}

export interface AuditSummaryParam { name: string; value: string }

export interface AuditActor { uid: string; name: string; role: Role }

export interface AuditDocument {
  companyId: string; actorId: string; actorName: string; actorRole: Role;
  action: AuditAction; targetType: AuditTargetType; targetId: string; summary: string; changes: AuditChange[];
  summaryKey?: string; summaryParams?: AuditSummaryParam[];
  reason?: string; requestId?: string; selfTarget?: true; createdAt: ServerTime;
}

const clip = (value: string, max: number) => (length(value) <= max ? value : `${[...value].slice(0, max - 1).join("")}…`);

/** Short, redacted string form of a changed value (never whole documents). */
export function shown(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) return clip(value.map(String).join(", "), 200);
  return clip(typeof value === "string" ? value : String(value), 200);
}

export function change(field: string, before: unknown, after: unknown): AuditChange {
  return { field: clip(field, 60), before: shown(before), after: shown(after) };
}

/** Field-level diff of the supplied fields only (undefined means "not supplied"). Arrays compare by content. */
export function diffFields(before: Record<string, unknown>, after: Record<string, unknown>): AuditChange[] {
  const out: AuditChange[] = [];
  for (const key of Object.keys(after)) {
    const next = after[key];
    if (next === undefined) continue;
    if (JSON.stringify(before[key] ?? null) !== JSON.stringify(next)) out.push(change(key, before[key], next));
  }
  return out;
}

export function auditDocument(companyId: string, actor: AuditActor, input: AuditInput): AuditDocument {
  const doc: AuditDocument = {
    companyId, actorId: actor.uid, actorName: clip(actor.name, 80), actorRole: actor.role,
    action: input.action, targetType: input.targetType, targetId: clip(input.targetId, 256),
    summary: clip(input.summary, 280), changes: (input.changes ?? []).slice(0, 30).map(c => ({ ...c })), createdAt: SERVER_TIME,
  };
  if (input.summaryKey) {
    doc.summaryKey = input.summaryKey;
    const params = Object.entries(input.summaryParams ?? {}).slice(0, 10)
      .map(([name, value]) => ({ name: clip(name, 40), value: clip(String(value), 280) }));
    if (params.length > 0) doc.summaryParams = params;
  }
  if (input.reason) doc.reason = clip(input.reason, 200);
  if (input.requestId) doc.requestId = input.requestId;
  if (input.selfTarget) doc.selfTarget = true;
  return doc;
}

/** An audit document without its timestamp: what a module store receives; the adapter stamps the server time. */
export type AuditEntry = Omit<AuditDocument, "createdAt">;

/**
 * Builds the entry a module-specific transaction (events, themes, submissions) stores through its own `writeAudit` port, so
 * those commands record the same audit shape as the admin commands without depending on the admin store.
 */
export function auditEntry(companyId: string, member: { uid: string; displayName?: unknown; role: string }, input: AuditInput): AuditEntry {
  const name = typeof member.displayName === "string" && member.displayName !== "" ? member.displayName : "Unknown";
  const role: Role = isRole(member.role) ? member.role : "member";
  const { createdAt: _createdAt, ...entry } = auditDocument(companyId, { uid: member.uid, name, role }, input);
  return entry;
}
