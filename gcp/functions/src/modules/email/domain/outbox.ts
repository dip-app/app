import { createHash } from "node:crypto";
import type { OutboxCategory } from "./categories";
import type { Locale } from "../../i18n";
import { templateCategory, type TemplateId, type TemplateVariables } from "./templates/types";

/**
 * Server-only outbox (`emailOutbox/{id}`, deny-all rules, Firestore TTL on `expireAt`).
 * The id is deterministic, `{category}_{objectId}_{uid}_{revisionOrWindow}`, and the document is written with
 * create(), so a redelivered trigger or a replayed notification cannot enqueue a second email.
 * The outbox never stores an email address; the sender reads it from `users/{uid}` at send time.
 */

export const OUTBOX_COLLECTION = "emailOutbox";
export const SUPPRESSIONS_COLLECTION = "emailSuppressions";
export const CAPS_COLLECTION = "emailCaps";
export const COMPANY_SETTINGS_COLLECTION = "emailSettings";
export const EMULATOR_OUTBOX_COLLECTION = "emulatorEmailOutbox";

export const OUTBOX_TTL_DAYS = 30;
/** Bounded attempts for definite, retryable provider rejections (rate limits, provider outages before acceptance). */
export const MAX_ATTEMPTS = 5;
/** A claim older than this is considered abandoned (the instance died mid-send); it is never resent. */
export const SEND_LEASE_MS = 2 * 60 * 1000;

/** Reaper (EML audit): a `queued` document untouched this long will never be redelivered, so it is closed as failed. */
export const STALE_QUEUED_MS = 60 * 60 * 1000;
/** Documents handled per status per reaper run. */
export const REAPER_BATCH = 200;
/** Open-pixel replays stop writing after this many counted opens per email (counts are approximate anyway). */
export const MAX_OPEN_COUNT = 20;

/** False once an email has reached the open-count bound; the store then skips the write. */
export function canCountOpen(openCount: unknown): boolean {
  return !(typeof openCount === "number" && openCount >= MAX_OPEN_COUNT);
}

export const MEMBER_DAILY_CAP = 20;
export const COMPANY_DAILY_CAP_DEFAULT = 2000;

/**
 * queued -> sending -> sent | failed | skipped | expired | unknown; sending -> queued only for a definite retryable rejection.
 * `unknown`: the provider may have accepted the message (timeout, abandoned lease). Never retried: at most once wins over
 * at least once because a duplicate email is worse than a missing reminder.
 */
export type OutboxStatus = "queued" | "sending" | "sent" | "failed" | "skipped" | "expired" | "unknown";

export type SkipReason =
  | "disabled" | "company_disabled" | "config_incomplete" | "no_member" | "tenant_mismatch" | "inactive_member" | "no_email"
  | "preference_off" | "not_admin" | "suppressed" | "member_cap" | "company_cap" | "invalid_variables"
  | "not_going" | "event_canceled" | "never_invited" | "rejoined" | "event_ended"
  | "not_invited" | "opted_out" | "all_off";

/** Opt-outs of roster invitation emails, keyed by the address hash (server-only, deny-all rules). */
export const INVITE_OPT_OUTS_COLLECTION = "emailInviteOptOuts";

export interface OutboxDocument<T extends TemplateId = TemplateId> {
  id: string;
  /** Member uid, or `roster-<entryId>` for a roster invitation (see `rosterRecipientKey`). */
  uid: string;
  companyId: string;
  category: OutboxCategory;
  /**
   * Language for a recipient who has no `users/{uid}.locale` yet (a roster invitee): the inviting admin's language.
   * Members always get their own stored language.
   */
  locale?: Locale;
  template: T;
  variables: TemplateVariables[T];
  status: OutboxStatus;
  attempts: number;
  /** Do not send after this instant (for example a reminder after the event started). */
  notAfter: Date | null;
  createdAt: Date;
  expireAt: Date;
  reason?: SkipReason | string;
  providerMessageId?: string;
  /** sha256 of the normalized address actually used, recorded after a send for support lookups (never the address). */
  toHash?: string;
  leaseUntil?: Date | null;
}

const ID_PART = /^[A-Za-z0-9-]{1,64}$/;

/** A part that is not a plain opaque id (contains `_`, `/`, or is long) is replaced by a stable hash, so ids stay unambiguous. */
function idPart(value: string): string {
  if (value.length === 0) throw new Error("empty outbox id part");
  return ID_PART.test(value) ? value : `h${createHash("sha256").update(value, "utf8").digest("hex").slice(0, 32)}`;
}

/** Builds the create-once id `{category}_{objectId}_{uid}_{revisionOrWindow}`. */
export function outboxId(category: OutboxCategory, objectId: string, uid: string, revisionOrWindow: string): string {
  return `${category}_${idPart(objectId)}_${idPart(uid)}_${idPart(revisionOrWindow)}`;
}

/** The outbox category of one email; the variables matter only for the 24 h reminder (`templateCategory`). */
export function categoryOf(template: TemplateId, variables?: unknown): OutboxCategory {
  return templateCategory(template, variables);
}

/**
 * The stored shape of a new `queued` outbox document (dates as Date; the Admin SDK stores them as Timestamps). Shared by
 * the outbox store and by commands that enqueue inside their own transaction (the roster invitation and the problem
 * report email are written in the same transaction as the admin command and its idempotency receipt).
 */
export function newOutboxData(entry: { uid: string; companyId: string; template: TemplateId; variables: unknown; notAfter: Date | null; locale?: Locale }, now: Date): Record<string, unknown> {
  return {
    uid: entry.uid,
    companyId: entry.companyId,
    category: categoryOf(entry.template, entry.variables),
    template: entry.template,
    variables: entry.variables,
    status: "queued",
    attempts: 0,
    notAfter: entry.notAfter,
    createdAt: now,
    expireAt: new Date(now.getTime() + OUTBOX_TTL_DAYS * 24 * 60 * 60 * 1000),
    leaseUntil: null,
    ...(entry.locale ? { locale: entry.locale } : {}),
  };
}

/** Address normalization for suppression lookups: trim and lowercase the whole address. */
export function normalizeEmail(address: string): string {
  return address.trim().toLowerCase();
}

export function emailHash(address: string): string {
  return createHash("sha256").update(normalizeEmail(address), "utf8").digest("hex");
}

/** UTC day key used by the daily cap counters (`emailCaps/{scope}_{day}`). */
export function capDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}
