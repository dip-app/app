import { createHash } from "node:crypto";
import type { App } from "firebase-admin/app";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { getMessaging, type MulticastMessage } from "firebase-admin/messaging";
import type { MessagingPort, SendResult } from "../application/ports";
import type { PushMessage } from "../domain/push";

/** Maps the domain message to an FCM multicast message with APNs grouping/collapse headers. */
export function toMulticast(tokens: readonly string[], message: PushMessage): MulticastMessage {
  return {
    tokens: [...tokens],
    notification: { title: message.title, body: message.body },
    data: { ...message.data },
    apns: {
      headers: message.collapseId ? { "apns-collapse-id": message.collapseId } : {},
      payload: { aps: { threadId: message.threadId, sound: "default" } },
    },
  };
}

/**
 * Production adapter (firebase-admin messaging). Sending requires an APNs authentication key uploaded to the
 * Firebase project (paid Apple Developer team) — a separate, authorized deployment prerequisite.
 * Registration-token multicast is deprecated in firebase-admin 14 in favour of Installation IDs; it still
 * works and is what the iOS FirebaseMessaging SDK provides today.
 */
export class FcmMessaging implements MessagingPort {
  constructor(private readonly app: App) {}

  async sendMulticast(tokens: readonly string[], message: PushMessage): Promise<SendResult[]> {
    const response = await getMessaging(this.app).sendEachForMulticast(toMulticast(tokens, message));
    return response.responses.map((item) => (item.success ? { success: true } : { success: false, errorCode: item.error?.code ?? "unknown" }));
  }
}

/**
 * Emulator-only adapter: never contacts FCM. Each multicast is recorded in `emulatorPushOutbox` (deny-all
 * rules) so integration tests can assert recipients and payloads. Tokens beginning with "invalid-" simulate
 * an unregistered token. Selected only when FUNCTIONS_EMULATOR === "true".
 */
export class EmulatorOutboxMessaging implements MessagingPort {
  constructor(private readonly db: Firestore) {}

  async sendMulticast(tokens: readonly string[], message: PushMessage): Promise<SendResult[]> {
    await this.db.collection("emulatorPushOutbox").add({
      tokenHashes: tokens.map((token) => createHash("sha256").update(token, "utf8").digest("hex")),
      title: message.title, body: message.body, data: message.data, threadId: message.threadId,
      createdAt: FieldValue.serverTimestamp(),
    });
    return tokens.map((token) => (token.startsWith("invalid-")
      ? { success: false, errorCode: "messaging/registration-token-not-registered" }
      : { success: true }));
  }
}
