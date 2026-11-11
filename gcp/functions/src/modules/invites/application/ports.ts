import type { Document, ParticipationTransaction } from "../../participation/application/ports";
import type { BudgetState } from "../domain/invitePolicy";

export type { Document };

/**
 * Everything an invite command touches in one Firestore transaction. It extends the participation
 * transaction so acceptance runs the same RSVP/capacity code as `setRsvpV1`.
 */
export interface InviteTransaction extends ParticipationTransaction {
  getInvite(companyId: string, inviteId: string): Promise<Document | null>;
  /** The adapter converts `eventStartTime` to a Timestamp and adds `createdAt` as a server timestamp. */
  createInvite(companyId: string, inviteId: string, data: Document): void;
  /** Sets `status` and `respondedAt` (server timestamp). */
  markResponded(companyId: string, inviteId: string, status: "accepted" | "declined"): void;
  /** Creates `users/{uid}/notifications/{id}`; the adapter adds `createdAt`. Create-only. */
  createNotification(uid: string, notificationId: string, data: Document): void;
  getBudget(key: string): Promise<Document | null>;
  setBudget(key: string, state: BudgetState, expiresAt: Date): void;
}

/** `member` carries only the membership fields the policy needs (companyId, role, status), never shown to clients. */
export interface DirectoryMember {
  userId: string; displayName: string; avatarId: string; department: string;
  member: { companyId: string; role: unknown; status: unknown };
}

export interface InviteStore {
  runTransaction<T>(work: (tx: InviteTransaction) => Promise<T>): Promise<T>;
  getMember(uid: string): Promise<Document | null>;
  /** startTime is converted to a Date by the adapter. */
  getEvent(companyId: string, eventId: string): Promise<Document | null>;
  /** Same-company members, at most `cap`, with only the minimal directory fields. `complete` is false when more exist. */
  listMembers(companyId: string, cap: number): Promise<{ members: DirectoryMember[]; complete: boolean }>;
  /** Per candidate: `going` when an RSVP is going, `invited` when an invite for this event exists. */
  memberStates(companyId: string, eventId: string, uids: readonly string[]): Promise<Map<string, "going" | "invited">>;
  /** Consumes one unit of a fixed-window budget in its own transaction; false when exhausted. */
  consumeBudget(key: string, limit: number, windowMs: number, nowMs: number): Promise<boolean>;
}

export interface InvitePushInput {
  companyId: string;
  eventId: string;
  eventTitle: string;
  inviteId: string;
  toUserId: string;
  fromName: string;
}

/** Best-effort push for a newly created invitation (the existing push pipeline). Never fails the command. */
export interface InviteNotifier {
  invited(input: InvitePushInput): Promise<void>;
}

export interface InviteCaller {
  uid: string;
  emailVerified: boolean;
  signInProvider: string | null;
}
