import { auditDocument, type AuditActor, type AuditInput } from "../domain/audit";
import { AdminError, stored } from "../domain/errors";
import { paths } from "../domain/ops";
import { can, isRole, type Permission, type Role } from "../domain/permissions";
import { payloadHash } from "../domain/reader";
import { isDeactivated } from "../domain/member";
import type { AdminTransaction, Caller, Doc } from "./ports";

export interface Actor extends AuditActor { companyId: string }

const RECEIPT_RETENTION_DAYS = 30;

export function requireCaller(caller: Caller | null): Caller {
  if (!caller) throw new AdminError("unauthenticated", "UNAUTHENTICATED", "Sign in to continue.");
  if (!caller.emailVerified) throw new AdminError("permission-denied", "EMAIL_NOT_VERIFIED", "Verified email required.");
  if (caller.signInProvider !== "google.com") throw new AdminError("permission-denied", "PROVIDER_NOT_ALLOWED", "Google sign-in required.");
  return caller;
}

/**
 * Authorization derives only from the server-owned membership document: the caller's role must grant the
 * permission, the account must be active and the supplied companyId must equal the caller's own company.
 * Runs before any target resource is read, so another tenant or a plain member learns nothing.
 */
export async function authorize(tx: AdminTransaction, caller: Caller, companyId: string, permission: Permission): Promise<Actor> {
  const member = await tx.get(paths.user(caller.uid));
  if (!member || typeof member.companyId !== "string" || member.companyId === "") {
    throw new AdminError("permission-denied", "MEMBERSHIP_CONFLICT", "Company membership required.");
  }
  if (isDeactivated(member)) throw new AdminError("permission-denied", "ACCOUNT_DEACTIVATED", "This account is deactivated.");
  if (!can(member.role, permission)) throw new AdminError("permission-denied", "INSUFFICIENT_ROLE", "You don't have permission to do this.");
  if (member.companyId !== companyId) throw new AdminError("permission-denied", "COMPANY_MISMATCH", "You can only manage your own company.");
  stored(isRole(member.role) && typeof member.displayName === "string", "membership");
  return { uid: caller.uid, name: member.displayName, role: member.role as Role, companyId };
}

export interface Receipt { command: string; hash: string; response: Doc }

/**
 * Idempotency: the first execution stores a private receipt in the same transaction. The same key with the same
 * command and payload returns the stored response (`replay: true`, no writes); any other use fails REQUEST_REUSED.
 */
export async function once<T extends object>(tx: AdminTransaction, actor: Actor, command: string, requestId: string,
  payload: unknown, run: () => Promise<T>, now: Date): Promise<{ value: T; replay: boolean }> {
  const receiptPath = paths.receipt(actor.companyId, actor.uid, requestId);
  const hash = payloadHash(payload);
  const receipt = await tx.get(receiptPath);
  if (receipt) {
    if (receipt.command !== command || receipt.hash !== hash || typeof receipt.response !== "object" || receipt.response === null) {
      throw new AdminError("failed-precondition", "REQUEST_REUSED", "This request ID was already used with different details.", ["requestId"]);
    }
    return { value: receipt.response as T, replay: true };
  }
  const value = await run();
  tx.create(receiptPath, {
    command, hash, response: value, createdAt: now, expireAt: new Date(now.getTime() + RECEIPT_RETENTION_DAYS * 86_400_000),
  });
  return { value, replay: false };
}

/** Appends one audit entry in the caller's transaction (append-only: create never overwrites). */
export function writeAudit(tx: AdminTransaction, actor: Actor, input: AuditInput): void {
  tx.create(paths.audit(actor.companyId, input.id), { ...auditDocument(actor.companyId, actor, input) });
}

/** A same-company member document, or MEMBER_NOT_FOUND (also for another tenant's user: no disclosure). */
export async function loadMember(tx: AdminTransaction, actor: Actor, uid: string): Promise<Doc> {
  const member = await tx.get(paths.user(uid));
  if (!member || member.companyId !== actor.companyId) throw new AdminError("not-found", "MEMBER_NOT_FOUND", "Member not found.");
  return member;
}

export interface StoredEvent {
  title: string; status: "scheduled" | "cancelled" | "completed"; capacity: number; attendeeCount: number; revision: number; pointsValue: number; startTime: Date; endTime: Date;
}

const isDate = (value: unknown): value is Date => value instanceof Date && Number.isFinite(value.getTime());
const isInt = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value);

export async function loadEvent(tx: AdminTransaction, actor: Actor, eventId: string): Promise<StoredEvent> {
  const event = await tx.get(paths.event(actor.companyId, eventId));
  if (!event || event.companyId !== actor.companyId) throw new AdminError("not-found", "EVENT_NOT_FOUND", "Event not found.");
  stored(typeof event.title === "string" && (event.status === "scheduled" || event.status === "cancelled" || event.status === "completed") && isInt(event.capacity) &&
    event.capacity >= 1 && event.capacity <= 10000 && isInt(event.attendeeCount) && event.attendeeCount >= 0 &&
    isDate(event.startTime) && isDate(event.endTime), "event");
  return {
    title: event.title, status: event.status as StoredEvent["status"], capacity: event.capacity as number, attendeeCount: event.attendeeCount as number,
    revision: isInt(event.revision) ? event.revision : 1, pointsValue: isInt(event.pointsValue) && event.pointsValue > 0 ? event.pointsValue : 0, startTime: event.startTime as Date, endTime: event.endTime as Date,
  };
}
