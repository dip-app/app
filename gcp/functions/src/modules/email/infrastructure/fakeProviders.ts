import { createHash } from "node:crypto";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import type { EmailProviderPort, OutgoingEmail, SendOutcome } from "../application/ports";
import { EMULATOR_OUTBOX_COLLECTION, normalizeEmail } from "../domain/outbox";

/**
 * Emulator-only provider: never contacts a mail service. Each message is recorded in `emulatorEmailOutbox`
 * (deny-all rules) so integration tests can assert content. The address is stored only as a hash.
 * "bounce-" addresses simulate an inactive recipient, "slow-" addresses an ambiguous timeout.
 */
export class EmulatorOutboxEmailProvider implements EmailProviderPort {
  readonly name = "emulator";
  constructor(private readonly db: Firestore) {}

  async send(message: OutgoingEmail): Promise<SendOutcome> {
    const normalized = normalizeEmail(message.to);
    if (normalized.startsWith("bounce-")) return { kind: "rejected", code: "emulator_bounce", suppress: true };
    if (normalized.startsWith("slow-")) return { kind: "unknown", code: "emulator_timeout" };
    const ref = this.db.collection(EMULATOR_OUTBOX_COLLECTION).doc();
    await ref.set({
      toHash: createHash("sha256").update(normalized, "utf8").digest("hex"),
      subject: message.subject,
      template: message.tag,
      outboxId: message.metadata.outboxId,
      headers: message.headers,
      attachmentNames: message.attachments.map((a) => a.filename),
      htmlLength: message.html.length,
      text: message.text,
      createdAt: FieldValue.serverTimestamp(),
    });
    return { kind: "sent", providerMessageId: `emu-${ref.id}` };
  }
}

/** Logs only the template tag and outbox id. Used when no provider credentials are configured. */
export class LogOnlyEmailProvider implements EmailProviderPort {
  readonly name = "log";

  async send(message: OutgoingEmail): Promise<SendOutcome> {
    logger.info("email.log_only", { template: message.tag, outboxId: message.metadata.outboxId });
    return { kind: "sent", providerMessageId: `log-${message.metadata.outboxId}` };
  }
}
