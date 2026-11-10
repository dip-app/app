import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { onDocumentCreated, onDocumentUpdated, onDocumentWritten } from "firebase-functions/v2/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defaultAdminApp } from "../../accounts/transport/resolveMembershipV1";
import { registerDevice, unregisterDevice } from "../application/devices";
import { onChatMessageCreated, onEventDocumentUpdated, onRsvpWritten, sendDueReminders } from "../application/handlers";
import type { Caller, DeviceRegistry, MessagingPort } from "../application/ports";
import { NotificationsError } from "../domain/errors";
import { REMINDER_SCHEDULE } from "../domain/reminders";
import { FirestoreNotificationsStore, plainEvent } from "../infrastructure/firestoreNotificationsStore";
import { EmulatorOutboxMessaging, FcmMessaging } from "../infrastructure/messaging";

const REGION = "us-central1";
const emulator = () => process.env.FUNCTIONS_EMULATOR === "true";

function dependencies() {
  const app = defaultAdminApp();
  const db = getFirestore(app);
  const store = new FirestoreNotificationsStore(db);
  // The emulator never reaches FCM; it records pushes in an outbox collection instead.
  const messaging: MessagingPort = emulator() ? new EmulatorOutboxMessaging(db) : new FcmMessaging(app);
  return { store, messaging, clock: { now: () => new Date() } };
}

export function callerFromRequest(request: Pick<CallableRequest, "auth">): Caller | null {
  const auth = request.auth;
  if (!auth) return null;
  const provider: unknown = auth.token.firebase?.sign_in_provider;
  return { uid: auth.uid, emailVerified: auth.token.email_verified === true, signInProvider: typeof provider === "string" ? provider : null };
}

async function callable<T>(name: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof NotificationsError && error.code !== "internal") {
      throw new HttpsError(error.code, error.message, { reason: error.reason, ...(error.fields.length ? { fields: [...error.fields] } : {}) });
    }
    // Never log tokens, payloads or exception messages.
    logger.error(`${name} failed`, { reason: error instanceof NotificationsError ? error.reason : "UNEXPECTED" });
    throw new HttpsError("internal", "Something went wrong. Try again later.");
  }
}

export function handleRegisterDevice(registry: DeviceRegistry, request: Pick<CallableRequest, "auth" | "data">) {
  return callable("registerDeviceV1", () => registerDevice(registry, callerFromRequest(request), request.data));
}

export function handleUnregisterDevice(registry: DeviceRegistry, request: Pick<CallableRequest, "auth" | "data">) {
  return callable("unregisterDeviceV1", () => unregisterDevice(registry, callerFromRequest(request), request.data));
}

const callableOptions = { region: REGION, enforceAppCheck: !emulator() } as const;

export const registerDeviceV1 = onCall(callableOptions, (request) => handleRegisterDevice(dependencies().store, request));
export const unregisterDeviceV1 = onCall(callableOptions, (request) => handleUnregisterDevice(dependencies().store, request));

/** Chat message created -> push to `all` subscribers who are going, except the author. */
export const onEventMessageCreated = onDocumentCreated(
  { document: "companies/{companyId}/events/{eventId}/messages/{messageId}", region: REGION },
  async (event) => {
    if (!event.data) return;
    const { store, messaging } = dependencies();
    const { companyId, eventId, messageId } = event.params;
    const stats = await onChatMessageCreated({ messaging, devices: store, recipients: store, events: store, claims: store },
      companyId, eventId, messageId, event.data.data());
    logger.info("chat push", { companyId, eventId, ...stats });
  });

/** Event updated -> append changeLog (bounded, idempotent) and push the change to `all`/`changes` subscribers. */
export const onEventChanged = onDocumentUpdated(
  { document: "companies/{companyId}/events/{eventId}", region: REGION },
  async (event) => {
    if (!event.data) return;
    const { store, messaging, clock } = dependencies();
    const { companyId, eventId } = event.params;
    const updateTime = event.data.after.updateTime?.toDate() ?? new Date(event.time);
    const result = await onEventDocumentUpdated({ messaging, devices: store, recipients: store, changeLog: store, clock },
      companyId, eventId, plainEvent(event.data.before.data()), plainEvent(event.data.after.data()), updateTime);
    if (result.appended) logger.info("event change logged", { companyId, eventId, ...result.push });
  });

/** RSVP written by setRsvpV1 -> create the default `changes` subscription on join, remove it on leave. */
export const onRsvpChanged = onDocumentWritten(
  { document: "companies/{companyId}/events/{eventId}/rsvps/{userId}", region: REGION },
  async (event) => {
    const { store } = dependencies();
    const { companyId, eventId, userId } = event.params;
    const writeTime = event.data?.after.updateTime?.toDate() ?? new Date(event.time);
    await onRsvpWritten(store, companyId, eventId, userId, writeTime);
  });

/** Every 15 minutes (UTC): ~24 h and ~1 h reminders, exactly once per event, window and start time. */
export const sendEventReminders = onSchedule(
  { schedule: REMINDER_SCHEDULE, timeZone: "Etc/UTC", region: REGION, retryCount: 1 },
  async () => {
    const { store, messaging, clock } = dependencies();
    const result = await sendDueReminders({ messaging, devices: store, recipients: store, upcoming: store, claims: store, clock });
    logger.info("reminders", result);
  });

