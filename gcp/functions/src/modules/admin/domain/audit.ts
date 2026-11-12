import { SERVER_TIME, type ServerTime } from "./ops";
import type { Role } from "./permissions";
import { length } from "./reader";

export type AuditTargetType = "member" | "event" | "photo" | "comment" | "attendee" | "roster" | "import" | "team" | "company" | "points" | "bugReport";

export interface AuditChange { field: string; before: string | null; after: string | null }

export interface AuditInput {
  /** Document id; deterministic from actor + requestId so a replay never duplicates. */
  id: string;
  action: string;
  targetType: AuditTargetType;
  targetId: string;
  summary: string;
  changes?: readonly AuditChange[];
  reason?: string | undefined;
  requestId?: string | undefined;
}

export interface AuditActor { uid: string; name: string; role: Role }

export interface AuditDocument {
  companyId: string; actorId: string; actorName: string; actorRole: Role;
  action: string; targetType: AuditTargetType; targetId: string; summary: string; changes: AuditChange[];
  reason?: string; requestId?: string; createdAt: ServerTime;
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
  if (input.reason) doc.reason = clip(input.reason, 200);
  if (input.requestId) doc.requestId = input.requestId;
  return doc;
}
