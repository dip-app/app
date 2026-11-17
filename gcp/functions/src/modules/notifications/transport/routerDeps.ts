import type { App } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { defineBoolean } from "firebase-functions/params";
import { cachedPreferences } from "../application/preferenceCache";
import type { MessagingPort } from "../application/ports";
import { routerEmailChannel } from "../../email/application/routerChannel";
import { emailChannelDependencies } from "../../email/transport/emailFunctions";
import type { EmailChannelPort, RouterDependencies } from "../application/router";
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
  // BooleanParam.value() is false when the variable is unset (the default is only applied by the CLI at deploy
  // time), so an absent variable must be read as the default here: the router is on unless explicitly disabled.
  if (process.env.PUSH_ROUTER_ENABLED === undefined) return true;
  try {
    return PUSH_ROUTER_ENABLED.value();
  } catch {
    return true;
  }
}

const emulator = () => process.env.FUNCTIONS_EMULATOR === "true";

/**
 * The email channel for this invocation, or undefined when it cannot be built (a missing parameter or secret must
 * never take the push path down). Whether email actually sends is decided inside the channel: it does nothing while
 * EMAIL_ENABLED is false/unset (the emulator is the exception and records to its outbox).
 */
function emailChannel(): EmailChannelPort | undefined {
  try {
    return routerEmailChannel(emailChannelDependencies());
  } catch {
    return undefined;
  }
}

/**
 * Router dependencies for ONE invocation (fresh preference cache each call). Any module may call this; the
 * emulator never reaches FCM and records pushes in `emulatorPushOutbox` instead.
 */
export function routerDependencies(app: App): RouterDependencies & { store: FirestoreNotificationsStore } {
  const db = getFirestore(app);
  const store = new FirestoreNotificationsStore(db);
  const messaging: MessagingPort = emulator() ? new EmulatorOutboxMessaging(db) : new FcmMessaging(app);
  const email = emailChannel();
  return {
    store,
    messaging,
    ...(email ? { email } : {}),
    devices: store,
    preferences: cachedPreferences(new FirestorePreferences(db)),
    receipts: new FirestoreDeliveryReceipts(db),
    rateLimiter: new FirestorePushRateLimiter(db),
    inbox: store,
    clock: { now: () => new Date() },
  };
}
