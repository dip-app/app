import type { ChangeLogEntry } from "../domain/changeLog";
import type { DevicePlatform } from "../domain/device";
import type { PushMessage } from "../domain/push";
import type { SubscriptionLevel } from "../domain/subscription";

export interface Clock { now(): Date }

/** One send result per token, in input order. `errorCode` is the FCM error code (e.g. messaging/...). */
export interface SendResult { success: boolean; errorCode?: string }

/** Thin FCM boundary (firebase-admin messaging in production, a fake in tests, an outbox in the emulator). */
export interface MessagingPort {
  /** At most MULTICAST_LIMIT tokens per call. */
  sendMulticast(tokens: readonly string[], message: PushMessage): Promise<SendResult[]>;
}

export interface DeviceToken { uid: string; tokenHash: string; token: string }

export interface DeviceDirectory {
  /** All registered tokens of these users (bounded per user). */
  tokensFor(uids: readonly string[]): Promise<DeviceToken[]>;
  /** Deletes `users/{uid}/devices/{tokenHash}` for tokens FCM reported as invalid. */
  remove(devices: readonly DeviceToken[]): Promise<void>;
}

export interface RecipientDirectory {
  /** UIDs whose subscription document for the event has one of these levels. */
  subscribers(companyId: string, eventId: string, levels: readonly SubscriptionLevel[]): Promise<string[]>;
  /** The subset of `uids` that currently have a `going` RSVP for the event. */
  going(companyId: string, eventId: string, uids: readonly string[]): Promise<Set<string>>;
}

/** Create-once markers under the event (`pushReceipts/{key}`), used for exactly-once claims. */
export interface ClaimStore {
  /** True when this call created the marker; false when it already existed. */
  claim(companyId: string, eventId: string, key: string): Promise<boolean>;
}

export interface EventSummary {
  companyId: string;
  eventId: string;
  title: string;
  status: string;
  startTime: Date;
  endTime: Date;
}

export interface EventReader {
  get(companyId: string, eventId: string): Promise<EventSummary | null>;
}

export interface UpcomingEvents {
  /** Scheduled events (all companies) with startTime in (from, to]. */
  scheduledStartingIn(from: Date, to: Date): Promise<EventSummary[]>;
}

export interface ChangeLogStore {
  /** Transactionally appends to the event's changeLog; false when the event is gone or the entry is a duplicate. */
  append(companyId: string, eventId: string, entry: ChangeLogEntry): Promise<boolean>;
}

export interface SubscriptionStore {
  /**
   * In one transaction reads the current RSVP and subscription for uid and applies `decide`'s result.
   * `subscriptionUpdatedAt` is null when there is no subscription document.
   */
  reconcile(companyId: string, eventId: string, uid: string,
    decide: (state: { rsvpStatus: string | null; subscriptionLevel: SubscriptionLevel | null; subscriptionUpdatedAt: Date | null }) => "create-default" | "delete" | "keep"): Promise<"create-default" | "delete" | "keep">;
}

export interface StoredDevice { tokenHash: string; updatedAt: Date | null }

export interface DeviceRegistryTransaction {
  getMember(uid: string): Promise<{ companyId: string; role: string } | null>;
  listDevices(uid: string): Promise<StoredDevice[]>;
  /** Other users currently holding this token (a phone that switched accounts). */
  ownersOf(tokenHash: string): Promise<string[]>;
  upsert(uid: string, tokenHash: string, device: { token: string; platform: DevicePlatform; appVersion: string }): void;
  remove(uid: string, tokenHash: string): void;
  exists(uid: string, tokenHash: string): Promise<boolean>;
}

export interface DeviceRegistry {
  runTransaction<T>(work: (tx: DeviceRegistryTransaction) => Promise<T>): Promise<T>;
}

export interface Caller { uid: string; emailVerified: boolean; signInProvider: string | null }

export interface PushDependencies {
  messaging: MessagingPort;
  devices: DeviceDirectory;
  recipients: RecipientDirectory;
}
