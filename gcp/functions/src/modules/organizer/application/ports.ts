import type { ParsedDraft } from "../domain/eventDraft";

export interface StoredOrganizer {
  companyId: string;
  role: string;
}

/** The event fields the application service reads before deciding (server-owned values included). */
export interface StoredEvent {
  revision: number;
  attendeeCount: number;
  startTime: Date;
  endTime: Date;
  status: string;
}

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
  /** Tag IDs that do not exist in the shared tags catalog. */
  missingTagIds(tagIds: readonly string[]): Promise<string[]>;
  /** Creates the event, revision 1, with server-owned fields; fails if it exists. */
  createEvent(companyId: string, eventId: string, uid: string, draft: ParsedDraft): void;
  /** Creates the private deduplication receipt; fails if it exists. */
  createReceipt(companyId: string, uid: string, requestId: string, receipt: CommandReceipt): void;
  /** Full-draft replacement; increments revision to `nextRevision`. */
  updateEvent(companyId: string, eventId: string, draft: ParsedDraft, status: "scheduled" | "cancelled", nextRevision: number): void;
}

export interface OrganizerStore {
  runTransaction<T>(work: (tx: OrganizerTransaction) => Promise<T>): Promise<T>;
}
