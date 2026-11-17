import type { App } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { deliverNotification } from "../../notifications/application/router";
import { sendPush } from "../../notifications/application/sendPush";
import type { MessagingPort } from "../../notifications/application/ports";
import { invitePush } from "../../notifications/domain/push";
import { FirestoreNotificationsStore } from "../../notifications/infrastructure/firestoreNotificationsStore";
import { EmulatorOutboxMessaging, FcmMessaging } from "../../notifications/infrastructure/messaging";
import { pushRouterEnabled, routerDependencies } from "../../notifications/transport/routerDeps";
import type { InviteNotifier, InvitePushInput } from "../application/ports";

/**
 * Sends the invite push through the existing notifications pipeline (`sendPush`: token registry, FCM multicast,
 * invalid-token cleanup). Users without a registered device (push is off in the client until the push flag is
 * enabled) are skipped silently. The emulator records pushes in its outbox instead of reaching FCM.
 */
export class PushInviteNotifier implements InviteNotifier {
  private readonly store: FirestoreNotificationsStore;
  private readonly messaging: MessagingPort;
  private readonly app: App;

  constructor(app: App, emulator: boolean) {
    this.app = app;
    const db = getFirestore(app);
    this.store = new FirestoreNotificationsStore(db);
    this.messaging = emulator ? new EmulatorOutboxMessaging(db) : new FcmMessaging(app);
  }

  async invited(input: InvitePushInput): Promise<void> {
    if (pushRouterEnabled()) {
      // The invite flow already wrote the in-app notice in its own transaction, so the router gets no `inApp`;
      // it contributes the category switch, the `invite_{inviteId}` receipt and the rate cap.
      await deliverNotification(routerDependencies(this.app), {
        id: `invite_${input.inviteId}`, kind: "invite", companyId: input.companyId, recipients: [{ uid: input.toUserId }],
        push: invitePush(input.companyId, input.eventId, input.eventTitle, input.inviteId, input.fromName),
      });
      return;
    }
    await sendPush({ messaging: this.messaging, devices: this.store }, [input.toUserId],
      invitePush(input.companyId, input.eventId, input.eventTitle, input.inviteId, input.fromName));
  }
}
