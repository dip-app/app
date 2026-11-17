import * as logger from "firebase-functions/logger";
import { resolveEmailPreferences } from "../domain/categories";
import {
  MAX_ATTEMPTS, MEMBER_DAILY_CAP, SEND_LEASE_MS, capDay, emailHash, type OutboxDocument, type OutboxStatus, type SkipReason,
} from "../domain/outbox";
import { signOpenToken } from "../domain/openToken";
import type { RenderContext, RenderedEmail, TemplateId, TemplateVariables } from "../domain/templates/types";
import { MIN_KEY_BYTES, signUnsubscribeToken } from "../domain/unsubscribeToken";
import type {
  Clock, CompanySettingsReader, CapStore, EmailAttachment, EmailConfig, EmailPreferencesStore, EmailProviderPort,
  OutboxStore, RecipientDirectory, SuppressionStore,
} from "./ports";

/** Rendering functions, injected so unit tests use fakes (the real ones are `renderEmail`, `validateVariables`, `icsAttachmentFor`). */
export interface EmailRenderer {
  render(template: TemplateId, variables: TemplateVariables[TemplateId], ctx: RenderContext): RenderedEmail;
  validate(template: TemplateId, value: unknown): TemplateVariables[TemplateId] | null;
  attachment(template: TemplateId, variables: TemplateVariables[TemplateId], revision: number): EmailAttachment | null;
}

/** Thrown after a definite, retryable rejection so the Functions runtime redelivers the event (trigger uses retry:true). */
export class RetryableEmailError extends Error {
  constructor(readonly code: string) {
    super(`email send retryable: ${code}`);
    this.name = "RetryableEmailError";
  }
}

export interface SendDeps {
  outbox: OutboxStore;
  recipients: RecipientDirectory;
  companies: CompanySettingsReader;
  suppressions: SuppressionStore;
  caps: CapStore;
  preferences: EmailPreferencesStore;
  provider: EmailProviderPort;
  renderer: EmailRenderer;
  clock: Clock;
  config: EmailConfig;
  tokenSigner?: typeof signUnsubscribeToken;
  /** Structured log sink; fields never contain addresses, names, subjects or bodies. */
  log?: (event: string, fields: Record<string, string | number>) => void;
}

export interface SendResult { status: OutboxStatus | "missing"; reason?: string }

const MAX_FIRST_NAME = 80;

function firstName(displayName: string | null): string | null {
  const token = displayName?.trim().split(/\s+/)[0] ?? "";
  return token.length > 0 ? token.slice(0, MAX_FIRST_NAME) : null;
}

/** Runs one outbox email through every send-time gate. At most once: a lost lease or ambiguous outcome is never resent. */
export async function sendOutboxEmail(deps: SendDeps, outboxId: string): Promise<SendResult> {
  const log = deps.log ?? ((event, fields) => logger.info(event, fields));
  const now = deps.clock.now();
  const claim = await deps.outbox.claim(outboxId, now, SEND_LEASE_MS);
  if (claim.kind === "missing") return { status: "missing" };
  if (claim.kind === "not_queued") return { status: claim.status, reason: "not_queued" };
  if (claim.kind === "abandoned") {
    log("email.abandoned", { outboxId });
    return { status: "unknown", reason: "abandoned" };
  }
  const doc = claim.doc;
  let retry: string | null = null;
  let result: SendResult;
  try {
    const outcome = await process(deps, doc, now);
    result = outcome.result;
    retry = outcome.retry;
  } catch (error) {
    // Anything unexpected after the claim: the provider may or may not have the message. Never resend.
    log("email.unexpected", { outboxId, error: error instanceof Error ? error.name : "unknown" });
    result = { status: "unknown", reason: "unexpected_error" };
    try {
      await deps.outbox.finish(outboxId, "unknown", { reason: "unexpected_error" }, deps.clock.now());
    } catch {
      /* the lease will expire and the next claim marks it abandoned */
    }
  }
  log("email.result", { outboxId, template: doc.template, status: result.status, ...(result.reason ? { reason: result.reason } : {}) });
  if (retry !== null) throw new RetryableEmailError(retry);
  return result;
}

async function process(deps: SendDeps, doc: OutboxDocument, now: Date): Promise<{ result: SendResult; retry: string | null }> {
  const finish = async (status: Exclude<OutboxStatus, "sending">, fields: { reason?: SkipReason | string; providerMessageId?: string; toHash?: string }) => {
    await deps.outbox.finish(doc.id, status, fields, deps.clock.now());
    return { result: { status, ...(fields.reason ? { reason: fields.reason } : {}) } as SendResult, retry: null as string | null };
  };
  const skip = (reason: SkipReason) => finish("skipped", { reason });

  if (doc.notAfter !== null && now.getTime() > doc.notAfter.getTime()) return finish("expired", { reason: "expired" });
  if (!deps.config.enabled) return skip("disabled");
  if (Buffer.byteLength(deps.config.unsubscribeKey, "utf8") < MIN_KEY_BYTES) {
    return skip("config_incomplete");
  }
  const variables = deps.renderer.validate(doc.template, doc.variables);
  if (variables === null) return skip("invalid_variables");

  const company = await deps.companies.get(doc.companyId);
  if (company === null || !company.enabled) return skip("company_disabled");

  const recipient = await deps.recipients.get(doc.uid);
  if (recipient === null) return skip("no_member");
  if (recipient.companyId !== doc.companyId) return skip("tenant_mismatch");
  if (recipient.status !== null && recipient.status !== "active") return skip("inactive_member");
  const to = recipient.email?.trim() ?? "";
  if (to.length === 0) return skip("no_email");

  const preferences = resolveEmailPreferences(await deps.preferences.getEmailMap(doc.uid));
  if (!preferences[doc.category]) return skip("preference_off");

  const hash = emailHash(to);
  if (await deps.suppressions.isSuppressed(hash)) return skip("suppressed");

  const cap = await deps.caps.consume(doc.uid, doc.companyId, capDay(now), MEMBER_DAILY_CAP, company.dailyCap, now);
  if (cap !== "ok") return skip(cap);

  const nowSeconds = Math.floor(now.getTime() / 1000);
  const sign = deps.tokenSigner ?? signUnsubscribeToken;
  const unsubscribeURL = `${deps.config.publicOrigin}/u/${sign(deps.config.unsubscribeKey, doc.uid, doc.category, nowSeconds)}`;
  const rendered = deps.renderer.render(doc.template, variables, {
    recipientFirstName: firstName(recipient.displayName),
    timeZone: company.timeZone ?? deps.config.defaultTimeZone,
    unsubscribeURL,
    openPixelURL: deps.config.openTracking
      ? `${deps.config.publicOrigin}/o/${signOpenToken(deps.config.unsubscribeKey, doc.id, nowSeconds)}.gif`
      : null,
  });
  const attachment = deps.renderer.attachment(doc.template, variables,
    "revision" in variables && typeof variables.revision === "number" ? variables.revision : 0);

  const outcome = await deps.provider.send({
    to,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    headers: { "List-Unsubscribe": `<${unsubscribeURL}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    attachments: attachment === null ? [] : [attachment],
    stream: "notifications",
    metadata: { outboxId: doc.id },
    tag: doc.template,
  });

  switch (outcome.kind) {
    case "sent":
      return finish("sent", { providerMessageId: outcome.providerMessageId, toHash: hash });
    case "retryable": {
      if (doc.attempts < MAX_ATTEMPTS) {
        const queued = await finish("queued", { reason: outcome.code });
        return { result: queued.result, retry: outcome.code };
      }
      return finish("failed", { reason: outcome.code });
    }
    case "rejected": {
      const failed = await finish("failed", { reason: outcome.code });
      if (outcome.suppress === true) {
        try { await deps.suppressions.suppress(hash, "provider_rejected", deps.clock.now()); } catch { /* best effort */ }
      }
      return failed;
    }
    default:
      return finish("unknown", { reason: outcome.code });
  }
}
