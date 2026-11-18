import type { AuditEntry } from "../../admin/domain/audit";
import type { ParsedDraft } from "../domain/eventDraft";

export interface StoredOrganizer {
  companyId: string;
  role: string;
  /** Server-owned account status; "deactivated" is refused, a missing status counts as active. */
  status?: string;
  /** Shown as the actor name in the audit entry (never used for authorization). */
  displayName?: string;
}

/** The event fields the application service reads before deciding (server-owned values included). */
export interface StoredEvent {
  revision: number;
  attendeeCount: number;
  startTime: Date;
  endTime: Date;
  status: string;
  /** Current cover; absent when a store does not provide it (a dynamic cover is then always re-validated). */
  coverImageURL?: string;
  /** Stored venue coordinates and place ID, and when the coordinates were last resolved (server-owned `venueLocationAt`). */
  venue?: { latitude: number; longitude: number; placeId?: string };
  venueLocationAt?: Date;
  /** Current content, used only to describe a change in the audit entry. Absent values show as "not set". */
  title?: string;
  description?: string;
  capacity?: number;
  costCents?: number;
  isOutdoor?: boolean;
  tagIds?: string[];
  venueName?: string;
}

/**
 * What to do with the server-owned `venueLocationAt` when an event is saved: stamp it (a Google place ID with new or changed
 * coordinates), keep it (nothing about the place changed), or remove it (no place ID any more). Clients can never set it.
 */
export type VenueLocationStamp = { kind: "set"; at: Date } | { kind: "keep" } | { kind: "clear" };

export interface CommandReceipt {
  hash: string;
  eventId: string;
  revision: number;
}

/**
 * Operations available inside one atomic organizer transaction. All reads happen before writes
 * (Firestore transaction rule), so services read everything they need first.
 */
export interface OrganizerTransaction {
  getMembership(uid: string): Promise<StoredOrganizer | null>;
  getEvent(companyId: string, eventId: string): Promise<StoredEvent | null>;
  getReceipt(companyId: string, uid: string, requestId: string): Promise<CommandReceipt | null>;
  /** True when any RSVP record exists for the event, including cancelled ones (they keep a start-time snapshot). */
  hasAnyRsvp(companyId: string, eventId: string): Promise<boolean>;
  /** True when the event's album has at least one photo (a completed event with photos is not reopened casually). */
  hasAnyPhoto(companyId: string, eventId: string): Promise<boolean>;
  /** Tag IDs that do not exist in the shared tags catalog. */
  missingTagIds(tagIds: readonly string[]): Promise<string[]>;
  /** Creates the event, revision 1, with server-owned fields; fails if it exists. */
  createEvent(companyId: string, eventId: string, uid: string, draft: ParsedDraft, venueLocation?: VenueLocationStamp): void;
  /** Creates the private deduplication receipt; fails if it exists. */
  createReceipt(companyId: string, uid: string, requestId: string, receipt: CommandReceipt): void;
  /** Full-draft replacement; increments revision to `nextRevision` and records `updatedBy` (the editor UID, for the change log). */
  /** Appends one audit entry (`companies/{c}/auditLog/{id}`, create-only) in the same transaction as the command. */
  writeAudit(companyId: string, id: string, entry: AuditEntry): void;
  updateEvent(companyId: string, eventId: string, draft: ParsedDraft, status: "scheduled" | "cancelled" | "completed", nextRevision: number, updatedBy: string, venueLocation?: VenueLocationStamp): void;
}

export interface OrganizerStore {
  runTransaction<T>(work: (tx: OrganizerTransaction) => Promise<T>): Promise<T>;
}
