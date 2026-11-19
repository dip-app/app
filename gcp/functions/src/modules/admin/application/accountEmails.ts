import type { Locale } from "../../i18n";
import { COMPANY_SETTINGS_COLLECTION, OUTBOX_COLLECTION, categoryOf, newOutboxData, outboxId } from "../../email/domain/outbox";
import { validateVariables } from "../../email/domain/templates/render";
import type { TemplateId, TemplateVariables } from "../../email/domain/templates/types";
import type { AdminDeps, AdminTransaction } from "./ports";

/**
 * Account emails queued by admin commands (docs/design/email-catalog.md). The outbox document is created in the same
 * transaction as the command and its idempotency receipt, with a deterministic id, so a retried or replayed command
 * never queues a second email; the email module's `onEmailOutboxCreated` trigger sends it after commit with every
 * send-time gate (company switch, recipient state, suppression, opt-out, caps).
 */

/** Email is on for this company: the EMAIL_ENABLED switch and the server-owned `emailSettings/{companyId}.enabled`. */
export async function companyEmailOn(tx: AdminTransaction, deps: Pick<AdminDeps, "email">, companyId: string): Promise<boolean> {
  if (!deps.email?.enabled()) return false;
  const settings = await tx.get(`${COMPANY_SETTINGS_COLLECTION}/${companyId}`);
  return settings?.enabled === true;
}

export interface QueuedEmail<T extends TemplateId> {
  template: T;
  variables: TemplateVariables[T];
  /** Member uid, or `roster-<entryId>` for a roster invitation. */
  uid: string;
  companyId: string;
  objectId: string;
  revisionOrWindow: string;
  notAfter: Date | null;
  locale?: Locale;
}

/**
 * Queues one email in the caller's transaction. Returns the outbox id, or null when the variables fail the template
 * allow-list or this exact email was already queued (the id is deterministic). Reads before it writes.
 */
export async function queueEmailInTx<T extends TemplateId>(tx: AdminTransaction, email: QueuedEmail<T>, now: Date): Promise<string | null> {
  const variables = validateVariables(email.template, email.variables);
  if (variables === null) return null;
  const id = outboxId(categoryOf(email.template), email.objectId, email.uid, email.revisionOrWindow);
  const path = `${OUTBOX_COLLECTION}/${id}`;
  if (await tx.get(path)) return null;
  tx.create(path, newOutboxData({ ...email, variables }, now));
  return id;
}
