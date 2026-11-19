import { NOTIFICATION_KINDS, type NotificationKind } from "../domain/categories";
import { DEFAULT_RESOLVED_PREFERENCES, evaluateDelivery } from "../domain/preferences";
import type { PushMessage } from "../domain/push";
import type { SubscriptionLevel } from "../domain/subscription";
import type { Clock, DeviceDirectory, DeviceToken, InboxWriter, MessagingPort, PreferencesReader } from "./ports";
import { rateClassOf } from "../domain/rateLimit";
import type { Locale } from "../../i18n";
import type { DeliveryLog, DeliveryReceipts, LocaleReader, MembershipReader, PushRateLimiter } from "./routerPorts";
import { sendToDevices, type PushStats } from "./sendPush";

export interface NotificationRecipient { uid: string; eventLevel?: SubscriptionLevel | null }

export interface NotificationRequest {
  /** Deterministic per logical notification; used as the receipt id and the in-app document id. */
  id: string;
  kind: NotificationKind;
  companyId: string;
  /** Derived server-side by the trigger, never from client payloads. */
  recipients: readonly NotificationRecipient[];
  push: PushMessage;
  /** Optional localized builder; `push` must equal `pushFor("en")`. Used per recipient locale when `deps.locales` is wired. */
  pushFor?: (locale: Locale) => PushMessage;
  inApp?: { title: string; body: string; targetType: string; targetId: string };
  /**
   * Optional email payload (email workstream, docs/contracts/email.md). Opaque to the router: the email channel
   * validates it against its template allow-list. Without it no email is considered.
   */
  email?: { template: string; variables: unknown; objectId: string; revisionOrWindow: string; notAfter?: Date | null } | undefined;
}

/** Email channel as the router sees it; implemented by `modules/email` (`routerEmailChannel`). Idempotent per recipient. */
export interface EmailChannelPort {
  /** Applies the shared precedence and the push-or-email policy, then enqueues at most one outbox entry. */
  deliver(request: NotificationRequest, recipient: NotificationRecipient, pushWillDeliver: boolean): Promise<boolean>;
}

export interface RouterDependencies {
  messaging: MessagingPort;
  devices: DeviceDirectory;
  /** Callers should pass a `cachedPreferences` wrapper (per invocation); the router does not cache. */
  preferences: PreferencesReader;
  receipts: DeliveryReceipts;
  rateLimiter: PushRateLimiter;
  inbox?: InboxWriter;
  /** Optional; absent means push and in-app only (the behavior before email). */
  email?: EmailChannelPort;
  /** Send-time membership check (same company, not deactivated). Production always wires it; absent skips the check. */
  members?: MembershipReader;
  /** Recipient locales for localized push copy; absent means every push is sent as `request.push` (English). */
  locales?: LocaleReader;
  /** Structured, PII-free logging of swallowed failures and send outcomes. Absent means silent. */
  logger?: DeliveryLog;
  clock: Clock;
}

export interface DeliveryStats extends PushStats {
  duplicate: boolean;
  inApp: number;
  /** Outbox entries newly enqueued by the email channel (0 when email is not wired or not requested). */
  emailsEnqueued: number;
  /** True when the id is leased by another (possibly crashed) attempt: a retry after the lease expires will deliver. */
  inProgress?: boolean;
  blocked: { category_off: number; event_level: number; no_destination: number; rate_limited: number; inactive: number };
}

const EMAIL_PARALLELISM = 20;

const safeLog = (log: DeliveryLog | undefined, level: "warn" | "error", message: string, fields: Record<string, unknown>) => {
  try { log?.[level](message, fields); } catch { /* logging must not break delivery */ }
};

const errorName = (error: unknown): string => (error instanceof Error ? error.name : "UnknownError");

const ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;

/**
 * Sends to the resolved devices, one multicast group per recipient locale when the request has a localized builder and
 * the locale reader is wired. A locale read failure never fails delivery: everyone gets the English `request.push`.
 */
async function sendLocalized(
  deps: RouterDependencies, request: NotificationRequest, toSend: readonly DeviceToken[], context: { notificationId: string; kind: string; companyId: string },
): Promise<PushStats> {
  const { pushFor } = request;
  if (!pushFor || !deps.locales) return sendToDevices(deps, toSend, request.push, context);
  let locales: Map<string, Locale>;
  try {
    locales = await deps.locales.localesFor([...new Set(toSend.map((device) => device.uid))]);
  } catch (error) {
    safeLog(deps.logger, "warn", "locale read failed; sending English", { ...context, recipients: new Set(toSend.map((device) => device.uid)).size, error: errorName(error) });
    return sendToDevices(deps, toSend, request.push, context);
  }
  const groups = new Map<Locale, DeviceToken[]>();
  for (const device of toSend) {
    const locale = locales.get(device.uid) ?? "en";
    const list = groups.get(locale);
    if (list) list.push(device); else groups.set(locale, [device]);
  }
  if (groups.size === 1 && groups.has("en")) return sendToDevices(deps, toSend, request.push, context);
  const merged: PushStats = { recipients: new Set(toSend.map((device) => device.uid)).size, tokens: 0, sent: 0, failed: 0, removed: 0 };
  for (const [locale, devices] of groups) {
    let message = request.push;
    if (locale !== "en") {
      try { message = pushFor(locale); } catch (error) {
        // A copy bug must never cost the push: that group gets English.
        safeLog(deps.logger, "warn", "localized push failed; sending English", { ...context, locale, error: errorName(error) });
      }
    }
    const part = await sendToDevices(deps, devices, message, context);
    merged.tokens += part.tokens; merged.sent += part.sent; merged.failed += part.failed; merged.removed += part.removed;
  }
  return merged;
}

/**
 * Single delivery path for server notifications: in-app write, exactly-once claim, preference precedence
 * (category, per-event level, destination), per-user rate cap, then FCM. Never logs tokens or message text.
 */
export async function deliverNotification(deps: RouterDependencies, request: NotificationRequest): Promise<DeliveryStats> {
  if (!ID_PATTERN.test(request.id)) throw new Error("INVALID_NOTIFICATION_ID");
  const stats: DeliveryStats = {
    recipients: 0, tokens: 0, sent: 0, failed: 0, removed: 0, duplicate: false, inApp: 0, emailsEnqueued: 0,
    blocked: { category_off: 0, event_level: 0, no_destination: 0, rate_limited: 0, inactive: 0 },
  };
  const byUid = new Map<string, NotificationRecipient>();
  for (const recipient of request.recipients) if (!byUid.has(recipient.uid)) byUid.set(recipient.uid, recipient);
  let recipients = [...byUid.values()];
  if (recipients.length === 0) return stats;
  const context = { notificationId: request.id, kind: request.kind, companyId: request.companyId };

  // Membership can change between the trigger and the send (deactivation, company change): drop recipients who are
  // no longer active members of this company before any channel is touched. A read failure throws (fail closed).
  if (deps.members) {
    const active = await deps.members.activeIn(request.companyId, recipients.map((recipient) => recipient.uid));
    const kept = recipients.filter((recipient) => active.has(recipient.uid));
    stats.blocked.inactive = recipients.length - kept.length;
    recipients = kept;
    if (recipients.length === 0) return stats;
  }
  const uids = recipients.map((recipient) => recipient.uid);

  // In-app notices are not governed by push switches. Ids are deterministic (create-only), so this is
  // idempotent and runs before the receipt: a retried trigger still completes a failed in-app write.
  const inAppType = NOTIFICATION_KINDS[request.kind].inAppType;
  if (inAppType !== null && request.inApp && deps.inbox) {
    const { title, body, targetType, targetId } = request.inApp;
    try {
      stats.inApp = await deps.inbox.createMany(uids.map((uid) => ({ uid, id: request.id, companyId: request.companyId, type: inAppType, title, body, targetType, targetId })));
    } catch (error) {
      // Best-effort: the push below must not depend on the in-app write.
      safeLog(deps.logger, "warn", "in-app write failed", { ...context, recipients: uids.length, error: errorName(error) });
    }
  }

  // Receipts are global; scope the key by company so equal ids in two tenants never collide. Two-phase: the claim is
  // a lease, completed only after sending, so a crash in between is retried once the lease expires.
  const receiptKey = `${request.companyId}/${request.id}`;
  if (!(await deps.receipts.claim(receiptKey))) {
    const inProgress = !(await deps.receipts.isDone(receiptKey));
    return { ...stats, duplicate: true, ...(inProgress ? { inProgress } : {}) };
  }

  const [preferences, devices] = await Promise.all([deps.preferences.preferencesFor(uids), deps.devices.tokensFor(uids)]);
  const tokensByUid = new Map<string, DeviceToken[]>();
  for (const device of devices) {
    const list = tokensByUid.get(device.uid);
    if (list) list.push(device); else tokensByUid.set(device.uid, [device]);
  }

  const passing: string[] = [];
  for (const recipient of recipients) {
    const decision = evaluateDelivery({
      kind: request.kind, channel: "push",
      preferences: preferences.get(recipient.uid) ?? DEFAULT_RESOLVED_PREFERENCES,
      eventLevel: recipient.eventLevel ?? null,
      hasDestination: (tokensByUid.get(recipient.uid)?.length ?? 0) > 0,
    });
    if (decision.deliver) passing.push(recipient.uid); else stats.blocked[decision.reason]++;
  }
  const admitted = passing.length ? await deps.rateLimiter.admit(passing, deps.clock.now(), rateClassOf(request.kind)) : new Set<string>();

  // Email channel (EML-8): after the push decision, so the push-or-email policy knows whether a push goes out.
  // Best-effort and idempotent (create-once outbox ids): an email failure never blocks the push. Bounded parallelism.
  if (deps.email && request.email) {
    const email = deps.email;
    let emailErrors = 0;
    const emailErrorNames = new Set<string>();
    for (let offset = 0; offset < recipients.length; offset += EMAIL_PARALLELISM) {
      const results = await Promise.all(recipients.slice(offset, offset + EMAIL_PARALLELISM).map(async (recipient) => {
        try {
          return await email.deliver(request, recipient, admitted.has(recipient.uid));
        } catch (error) {
          emailErrors++;
          emailErrorNames.add(errorName(error));
          return false;
        }
      }));
      stats.emailsEnqueued += results.filter(Boolean).length;
    }
    if (emailErrors > 0) safeLog(deps.logger, "warn", "email delivery failed", { ...context, failed: emailErrors, errors: [...emailErrorNames] });
  }
  const toSend: DeviceToken[] = [];
  for (const uid of passing) {
    if (!admitted.has(uid)) { stats.blocked.rate_limited++; continue; }
    toSend.push(...(tokensByUid.get(uid) ?? []));
  }
  let result: DeliveryStats = stats;
  if (toSend.length > 0) result = { ...stats, ...(await sendLocalized(deps, request, toSend, context)) };
  await deps.receipts.complete(receiptKey);
  return result;
}
