import { NOTIFICATION_KINDS, type NotificationKind } from "../domain/categories";
import { DEFAULT_RESOLVED_PREFERENCES, evaluateDelivery } from "../domain/preferences";
import type { PushMessage } from "../domain/push";
import type { SubscriptionLevel } from "../domain/subscription";
import type { Clock, DeviceDirectory, DeviceToken, InboxWriter, MessagingPort, PreferencesReader } from "./ports";
import type { DeliveryReceipts, PushRateLimiter } from "./routerPorts";
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
  inApp?: { title: string; body: string; targetType: string; targetId: string };
}

export interface RouterDependencies {
  messaging: MessagingPort;
  devices: DeviceDirectory;
  /** Callers should pass a `cachedPreferences` wrapper (per invocation); the router does not cache. */
  preferences: PreferencesReader;
  receipts: DeliveryReceipts;
  rateLimiter: PushRateLimiter;
  inbox?: InboxWriter;
  clock: Clock;
}

export interface DeliveryStats extends PushStats {
  duplicate: boolean;
  inApp: number;
  blocked: { category_off: number; event_level: number; no_destination: number; rate_limited: number };
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;

/**
 * Single delivery path for server notifications: in-app write, exactly-once claim, preference precedence
 * (category, per-event level, destination), per-user rate cap, then FCM. Never logs tokens or message text.
 */
export async function deliverNotification(deps: RouterDependencies, request: NotificationRequest): Promise<DeliveryStats> {
  if (!ID_PATTERN.test(request.id)) throw new Error("INVALID_NOTIFICATION_ID");
  const stats: DeliveryStats = {
    recipients: 0, tokens: 0, sent: 0, failed: 0, removed: 0, duplicate: false, inApp: 0,
    blocked: { category_off: 0, event_level: 0, no_destination: 0, rate_limited: 0 },
  };
  const byUid = new Map<string, NotificationRecipient>();
  for (const recipient of request.recipients) if (!byUid.has(recipient.uid)) byUid.set(recipient.uid, recipient);
  const recipients = [...byUid.values()];
  if (recipients.length === 0) return stats;
  const uids = recipients.map((recipient) => recipient.uid);

  // In-app notices are not governed by push switches. Ids are deterministic (create-only), so this is
  // idempotent and runs before the receipt: a retried trigger still completes a failed in-app write.
  const inAppType = NOTIFICATION_KINDS[request.kind].inAppType;
  if (inAppType !== null && request.inApp && deps.inbox) {
    const { title, body, targetType, targetId } = request.inApp;
    try {
      stats.inApp = await deps.inbox.createMany(uids.map((uid) => ({ uid, id: request.id, companyId: request.companyId, type: inAppType, title, body, targetType, targetId })));
    } catch {
      // Best-effort: the push below must not depend on the in-app write.
    }
  }

  // Receipts are global; scope the key by company so equal ids in two tenants never collide.
  if (!(await deps.receipts.claim(`${request.companyId}/${request.id}`))) return { ...stats, duplicate: true };

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
  // Email channel (EML-8, email workstream) plugs in here: evaluateDelivery with channel "email" per recipient.

  const admitted = passing.length ? await deps.rateLimiter.admit(passing, deps.clock.now()) : new Set<string>();
  const toSend: DeviceToken[] = [];
  for (const uid of passing) {
    if (!admitted.has(uid)) { stats.blocked.rate_limited++; continue; }
    toSend.push(...(tokensByUid.get(uid) ?? []));
  }
  if (toSend.length === 0) return stats;
  return { ...stats, ...(await sendToDevices(deps, toSend, request.push)) };
}
