import type { App } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { sendPush } from "../../notifications/application/sendPush";
import type { MessagingPort } from "../../notifications/application/ports";
import { invitePush } from "../../notifications/domain/push";
import { FirestoreNotificationsStore } from "../../notifications/infrastructure/firestoreNotificationsStore";
import { EmulatorOutboxMessaging, FcmMessaging } from "../../notifications/infrastructure/messaging";
import type { InviteNotifier, InvitePushInput } from "../application/ports";

/**
 * Sends the invite push through the existing notifications pipeline (`sendPush`: token registry, FCM multicast,
 * invalid-token cleanup). Users without a registered device (push is off in the client until the push flag is
 * enabled) are skipped silently. The emulator records pushes in its outbox instead of reaching FCM.
 */
export class PushInviteNotifier implements InviteNotifier {
  private readonly store: FirestoreNotificationsStore;
  private readonly messaging: MessagingPort;

  constructor(app: App, emulator: boolean) {
    const db = getFirestore(app);
    this.store = new FirestoreNotificationsStore(db);
    this.messaging = emulator ? new EmulatorOutboxMessaging(db) : new FcmMessaging(app);
  }

  async invited(input: InvitePushInput): Promise<void> {
    await sendPush({ messaging: this.messaging, devices: this.store }, [input.toUserId],
      invitePush(input.companyId, input.eventId, input.eventTitle, input.inviteId, input.fromName));
  }
}
