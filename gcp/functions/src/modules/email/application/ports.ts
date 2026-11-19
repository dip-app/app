import type { EmailCategory } from "../domain/categories";
import type { OutboxDocument, OutboxStatus, SkipReason } from "../domain/outbox";
import type { TemplateId, TemplateVariables } from "../domain/templates/types";

export interface Clock { now(): Date }

// ---------------------------------------------------------------------------------------------------------------------
// Provider boundary (EML-2). Postmark in production, an emulator outbox or a log-only fake elsewhere.
// ---------------------------------------------------------------------------------------------------------------------

export interface EmailAttachment { filename: string; contentType: string; content: string /* utf8 text */ }

export interface OutgoingEmail {
  /** Recipient address, read from `users/{uid}` at send time. Adapters must never log it. */
  to: string;
  /** Sender override, `Name <address>`; adapters fall back to their default notify@ sender. Calendar invites use events@letsdip.work. */
  from?: string;
  /** Reply-To override; adapters fall back to support@letsdip.work. */
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  /** Extra headers, e.g. List-Unsubscribe and List-Unsubscribe-Post. */
  headers: Record<string, string>;
  attachments: EmailAttachment[];
  /** Provider-side routing: transactional (account-critical) vs optional notifications (design doc, sender identity). */
  stream: "notifications";
  /** Opaque correlation data echoed by provider webhooks; only the outbox id (no personal data). */
  metadata: { outboxId: string };
  /** Provider tag for analytics: the template id. */
  tag: string;
}

/**
 * - `sent`: accepted by the provider.
 * - `retryable`: definitely NOT accepted, safe to retry later (rate limited, provider unavailable before acceptance).
 * - `rejected`: definitely not accepted and retrying will not help (inactive recipient, invalid request).
 * - `unknown`: the provider may have accepted it (timeout, connection reset after the request was written). Never retried.
 */
export type SendOutcome =
  | { kind: "sent"; providerMessageId: string }
  | { kind: "retryable"; code: string }
  | { kind: "rejected"; code: string; suppress?: boolean }
  | { kind: "unknown"; code: string };

export interface EmailProviderPort {
  readonly name: string;
  send(message: OutgoingEmail): Promise<SendOutcome>;
}

/** One normalized delivery event from a provider webhook. `outboxId` comes from the message metadata when present. */
export interface DeliveryEvent {
  type: "hard_bounce" | "soft_bounce" | "complaint" | "provider_unsubscribe" | "delivered" | "other";
  email: string | null;
  outboxId: string | null;
  providerMessageId: string | null;
  occurredAt: Date | null;
}

export type WebhookParseResult =
  | { ok: true; events: DeliveryEvent[]; /** Items skipped because they were not objects. */ malformed?: number }
  | { ok: false; status: 401 | 400; reason: "unauthorized" | "malformed" };

export interface EmailWebhookVerifier {
  /** Authenticates the request (constant-time) and normalizes the payload. Never throws on hostile input. */
  parse(headers: Readonly<Record<string, string | string[] | undefined>>, rawBody: Buffer): WebhookParseResult;
}

// ---------------------------------------------------------------------------------------------------------------------
// Stores (server-only collections, all behind deny-all rules).
// ---------------------------------------------------------------------------------------------------------------------

export interface NewOutboxEntry<T extends TemplateId = TemplateId> {
  id: string;
  uid: string;
  companyId: string;
  template: T;
  variables: TemplateVariables[T];
  notAfter: Date | null;
}

export type ClaimResult =
  | { kind: "claimed"; doc: OutboxDocument }
  | { kind: "not_queued"; status: OutboxStatus }
  | { kind: "abandoned" }
  | { kind: "missing" };

export interface OutboxStore {
  /** create(); false when the id already exists (idempotent enqueue). */
  create(entry: NewOutboxEntry, now: Date): Promise<boolean>;
  /**
   * Transaction: when status is `queued`, set `sending`, attempts + 1 and a lease; when it is `sending` with an expired
   * lease, set `unknown` and return `abandoned`; otherwise return the current status untouched.
   */
  claim(id: string, now: Date, leaseMs: number): Promise<ClaimResult>;
  /** Final or retry transition from `sending`. `fields` never include an address. */
  finish(id: string, status: Exclude<OutboxStatus, "sending">, fields: { reason?: SkipReason | string; providerMessageId?: string; toHash?: string }, now: Date): Promise<void>;
  /** Lookup used by the webhook to map a complaint back to the member. */
  get(id: string): Promise<OutboxDocument | null>;
  /**
   * Approximate open tracking. Transaction: only when the document exists and is `sent` (and `now` is not before its
   * sent time) increments `openCount`, sets `firstOpenedAt` once and sets `lastOpenedAt`. Returns whether it counted.
   * Counters only; no per-open event log (no IP, user agent or timestamps list is stored).
   */
  recordOpen(id: string, now: Date): Promise<boolean>;
}

// ---------------------------------------------------------------------------------------------------------------------
// Calendar invites (CAL-8 / EML-5): per (event, member) iCalendar SEQUENCE state and send-time eligibility.
// ---------------------------------------------------------------------------------------------------------------------

export type InviteIntent = "join" | "update" | "cancel";

export interface InviteSequenceStore {
  /**
   * One transaction per (company, event, member) state document `emailInviteState/{hash}`. Assigns the next SEQUENCE:
   * `join` always (marks the entry active), `update` only when active, `cancel` only when active (then marks it
   * inactive). Returns null when the intent does not apply. Re-calling with the same `key` returns the first result, so
   * a redelivered trigger never burns a number or loses a cancel. Gaps in SEQUENCE are harmless; it only has to grow.
   */
  assign(companyId: string, eventId: string, uid: string, intent: InviteIntent, key: string, retainUntil: Date, now: Date): Promise<number | null>;
  /** True once a REQUEST for this member and event was accepted by the provider and no CANCEL followed. */
  isDelivered(companyId: string, eventId: string, uid: string): Promise<boolean>;
  setDelivered(companyId: string, eventId: string, uid: string, delivered: boolean, now: Date): Promise<void>;
}

export interface InviteEventState {
  /** Member has a `going` RSVP in the same company. */
  going: boolean;
  /** Event status, or null when the event is missing. */
  eventStatus: string | null;
  endTime: Date | null;
}

export interface InviteEligibility {
  /** Fresh read at send time (tenant checked: the RSVP and the event live under `companyId`). */
  state(companyId: string, eventId: string, uid: string): Promise<InviteEventState>;
}

/** Event as the invite triggers need it. Times and ids are already plain values; no coordinates. */
export interface InviteEvent {
  eventId: string;
  title: string;
  status: string;
  startTime: Date;
  endTime: Date;
  revision: number;
  venueName?: string;
  venueAddress?: string;
}

export interface InviteEventReader {
  get(companyId: string, eventId: string): Promise<InviteEvent | null>;
  /** UIDs with a `going` RSVP in `companyId` (bounded, newest first not required). */
  goingUids(companyId: string, eventId: string, limit: number): Promise<string[]>;
}

/** Maintenance port for the scheduled reaper. Kept apart from `OutboxStore` so the send path's fakes stay small. */
export interface OutboxReaper {
  /** Ids of `sending` documents whose lease ended at or before `now` (oldest first, at most `limit`). */
  expiredSendingIds(now: Date, limit: number): Promise<string[]>;
  /** Ids of `queued` documents created before `cutoff` (oldest first, at most `limit`). */
  staleQueuedIds(cutoff: Date, limit: number): Promise<string[]>;
  /** Transaction: `sending` with an ended lease -> `unknown`/`abandoned`. False when it moved on meanwhile. Never resends. */
  markAbandoned(id: string, now: Date): Promise<boolean>;
  /** Transaction: `queued` and untouched since `cutoff` -> `failed`/`stale_queued`. False when it moved on meanwhile. */
  markStaleQueued(id: string, cutoff: Date, now: Date): Promise<boolean>;
}

export interface Recipient {
  uid: string;
  companyId: string | null;
  email: string | null;
  displayName: string | null;
  status: string | null;
  /** Member role (`member` | `organizer` | `admin`); optional so older fakes keep compiling. */
  role?: string | null;
  /** Raw `users/{uid}.locale` (server-owned via setMyLocaleV1); the sender maps anything unsupported or missing to English. */
  locale?: string | null;
}

export interface RecipientDirectory {
  get(uid: string): Promise<Recipient | null>;
  /** Members whose stored email equals this address (normalized compare is the adapter's job). At most 5. */
  uidsByEmail(email: string): Promise<string[]>;
}

export interface CompanyEmailSettings { enabled: boolean; dailyCap: number; timeZone: string | null }

export interface CompanySettingsReader {
  /** `emailSettings/{companyId}`; null when absent (email off for that company). */
  get(companyId: string): Promise<CompanyEmailSettings | null>;
}

export interface SuppressionStore {
  isSuppressed(emailHash: string): Promise<boolean>;
  /** Idempotent upsert of `emailSuppressions/{emailHash}`; keeps the first createdAt. */
  suppress(emailHash: string, reason: "hard_bounce" | "complaint" | "provider_unsubscribe" | "provider_rejected", now: Date): Promise<void>;
}

export interface CapStore {
  /**
   * Transactionally increments `emailCaps/member_{uid}_{day}` and `emailCaps/company_{companyId}_{day}` when both are
   * below their limits; returns which limit blocked otherwise (nothing is incremented then). Idempotent per `outboxId`:
   * a marker document `emailCaps/cap_{uid}_{day}_{outboxId}` is checked and written in the same transaction, so a retry
   * of the same outbox email returns `ok` without consuming again.
   */
  consume(uid: string, companyId: string, day: string, memberLimit: number, companyLimit: number, now: Date, outboxId: string): Promise<"ok" | "member_cap" | "company_cap">;
}

export interface EmailPreferencesStore {
  /** Raw `email` map of `users/{uid}/settings/notifications` (null when the doc or map is absent). */
  getEmailMap(uid: string): Promise<Record<string, unknown> | null>;
  /**
   * Turns the given categories off with a merge write that keeps every other field:
   * `{ contractVersion: 1, email: { <category>: false }, updatedAt: serverTimestamp }`. No-op when `users/{uid}` is missing.
   */
  disable(uid: string, categories: readonly EmailCategory[]): Promise<boolean>;
}

// ---------------------------------------------------------------------------------------------------------------------
// Configuration resolved by the transport from params and secrets. Secret values are never logged.
// ---------------------------------------------------------------------------------------------------------------------

export interface EmailConfig {
  enabled: boolean;
  unsubscribeKey: string;
  defaultTimeZone: string;
  /** `https://letsdip.work`; links are built from it. */
  publicOrigin: string;
  /** Adds the signed open pixel to rendered emails (`EMAIL_OPEN_TRACKING`). */
  openTracking: boolean;
}
