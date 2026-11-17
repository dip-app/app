import type { App } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { defineBoolean } from "firebase-functions/params";
import { cachedPreferences } from "../application/preferenceCache";
import type { MessagingPort } from "../application/ports";
import type { RouterDependencies } from "../application/router";
import { FirestoreDeliveryReceipts, FirestorePushRateLimiter } from "../infrastructure/firestoreDelivery";
import { FirestoreNotificationsStore } from "../infrastructure/firestoreNotificationsStore";
import { FirestorePreferences } from "../infrastructure/firestorePreferences";
import { EmulatorOutboxMessaging, FcmMessaging } from "../infrastructure/messaging";

/**
 * Deploy-time switch (docs/design/stretch/push-triggers.md, "Rollout and flags"). When true, the migrated
 * triggers (chat, change, reminder, invite) deliver through `deliverNotification`; when false they keep the
 * legacy path. New triggers (attendee added, invite answered, challenge reviewed, weekly theme) always use the
 * router. Rollback: set PUSH_ROUTER_ENABLED=false in the functions environment and redeploy.
 */
export const PUSH_ROUTER_ENABLED = defineBoolean("PUSH_ROUTER_ENABLED", { default: true });

export function pushRouterEnabled(): boolean {
  try {
    return PUSH_ROUTER_ENABLED.value();
  } catch {
    return true;
  }
}

const emulator = () => process.env.FUNCTIONS_EMULATOR === "true";

/**
 * Router dependencies for ONE invocation (fresh preference cache each call). Any module may call this; the
 * emulator never reaches FCM and records pushes in `emulatorPushOutbox` instead.
 */
export function routerDependencies(app: App): RouterDependencies & { store: FirestoreNotificationsStore } {
  const db = getFirestore(app);
  const store = new FirestoreNotificationsStore(db);
  const messaging: MessagingPort = emulator() ? new EmulatorOutboxMessaging(db) : new FcmMessaging(app);
  return {
    store,
    messaging,
    devices: store,
    preferences: cachedPreferences(new FirestorePreferences(db)),
    receipts: new FirestoreDeliveryReceipts(db),
    rateLimiter: new FirestorePushRateLimiter(db),
    inbox: store,
    clock: { now: () => new Date() },
  };
}
