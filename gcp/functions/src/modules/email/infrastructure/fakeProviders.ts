import { createHash } from "node:crypto";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import type { EmailProviderPort, OutgoingEmail, SendOutcome } from "../application/ports";
import { EMULATOR_OUTBOX_COLLECTION, normalizeEmail } from "../domain/outbox";

/** Replaces every occurrence of the recipient address (any case) so the emulator record never stores it. */
function redact(value: string, address: string): string {
  if (address.length === 0) return value;
  return value.split(new RegExp(address.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi")).join(REDACTED_RECIPIENT);
}

/** RFC 5545 unfolding (a CRLF followed by one space continues the line), so a folded address is redacted too. */
function unfold(value: string): string {
  return value.replace(/\r\n[ \t]/g, "");
}

/** What the emulator record shows instead of the recipient address (roster invitations and calendar files contain it). */
export const REDACTED_RECIPIENT = "[recipient]";

/**
 * Emulator-only provider: never contacts a mail service. Each message is recorded in `emulatorEmailOutbox`
 * (deny-all rules) so integration and end-to-end tests can assert the full content: subject, From and Reply-To, HTML
 * and text parts, headers and attachments (`gcp/tests/e2e`). The address is stored only as a hash; where the content
 * itself contains it (roster invitation, calendar ATTENDEE) it is replaced by `[recipient]`; calendar files are stored unfolded.
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
      from: message.from ?? null,
      replyTo: message.replyTo ?? null,
      attachmentNames: message.attachments.map((a) => a.filename),
      attachments: message.attachments.map((a) => ({ filename: a.filename, contentType: a.contentType, content: redact(unfold(a.content), normalized) })),
      htmlLength: message.html.length,
      html: redact(message.html, normalized),
      text: redact(message.text, normalized),
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
