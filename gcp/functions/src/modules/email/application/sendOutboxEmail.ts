import * as logger from "firebase-functions/logger";
import { localeOrDefault } from "../../i18n";
import { INVITE_FROM, INVITE_REPLY_TO, type InviteContext } from "../domain/ics";
import { ACCOUNT_CATEGORY, resolveEmailPreferences } from "../domain/categories";
import { isRosterTemplate, rosterEntryOf } from "../domain/templates/types";
import {
  MAX_ATTEMPTS, MEMBER_DAILY_CAP, SEND_LEASE_MS, capDay, emailHash, type OutboxDocument, type OutboxStatus, type SkipReason,
} from "../domain/outbox";
import { signOpenToken } from "../domain/openToken";
import type { RenderContext, RenderedEmail, TemplateId, TemplateVariables } from "../domain/templates/types";
import { MIN_KEY_BYTES, signUnsubscribeToken } from "../domain/unsubscribeToken";
import type {
  Clock, CompanySettingsReader, CapStore, EmailAttachment, EmailConfig, EmailPreferencesStore, EmailProviderPort,
  InviteEligibility, InviteOptOutStore, InviteSequenceStore, OutboxStore, RecipientDirectory, RosterInviteeDirectory, SuppressionStore,
} from "./ports";

/** Rendering functions, injected so unit tests use fakes (the real ones are `renderEmail`, `validateVariables`, `icsAttachmentFor`). */
export interface EmailRenderer {
  render(template: TemplateId, variables: TemplateVariables[TemplateId], ctx: RenderContext): RenderedEmail;
  validate(template: TemplateId, value: unknown): TemplateVariables[TemplateId] | null;
  attachment(template: TemplateId, variables: TemplateVariables[TemplateId], revision: number, invite?: InviteContext): EmailAttachment | null;
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
  /** Calendar invites only: per-member SEQUENCE/delivery state and the fresh going/status read. Without them invites are skipped. */
  inviteSequences?: InviteSequenceStore;
  inviteEligibility?: InviteEligibility;
  /** Roster invitations only: the roster entry read and the invitation opt-outs. Without them invitations are skipped. */
  invitees?: RosterInviteeDirectory;
  inviteOptOuts?: InviteOptOutStore;
  /** Structured log sink; fields never contain addresses, names, subjects or bodies. */
  log?: (event: string, fields: Record<string, string | number>) => void;
}

export interface SendResult { status: OutboxStatus | "missing"; reason?: string }

const MAX_FIRST_NAME = 80;

function firstName(displayName: string | null): string | null {
  const token = displayName?.trim().split(/\s+/)[0] ?? "";
  return token.length > 0 ? token.slice(0, MAX_FIRST_NAME) : null;
}

function eventIdOf(variables: TemplateVariables[TemplateId]): string {
  return (variables as { eventId: string }).eventId;
}

/** Runs one outbox email through every send-time gate. At most once: a lost lease or ambiguous outcome is never resent. */
export async function sendOutboxEmail(deps: SendDeps, outboxId: string): Promise<SendResult> {
  const log = deps.log ?? ((event, fields) => logger.info(event, fields));
  const now = deps.clock.now();
  let claim;
  try {
    claim = await deps.outbox.claim(outboxId, now, SEND_LEASE_MS);
  } catch (error) {
    // Nothing was claimed or sent: surface it so the runtime redelivers instead of acking a `queued` document forever.
    log("email.claim_failed", { outboxId, error: error instanceof Error ? error.name : "unknown" });
    throw new RetryableEmailError("claim_failed");
  }
  if (claim.kind === "missing") return { status: "missing" };
  if (claim.kind === "not_queued") return { status: claim.status, reason: "not_queued" };
  if (claim.kind === "abandoned") {
    log("email.abandoned", { outboxId });
    return { status: "unknown", reason: "abandoned" };
  }
  const doc = claim.doc;
  let retry: string | null = null;
  let result: SendResult;
  const state = { providerCalled: false };
  try {
    const outcome = await process(deps, doc, now, state);
    result = outcome.result;
    retry = outcome.retry;
  } catch (error) {
    log("email.unexpected", { outboxId, error: error instanceof Error ? error.name : "unknown", providerCalled: state.providerCalled ? 1 : 0 });
    if (!state.providerCalled) {
      // Failed before the provider was called (reads, cap transaction): nothing was sent, so retry is safe. Bounded by MAX_ATTEMPTS.
      const exhausted = doc.attempts >= MAX_ATTEMPTS;
      result = { status: exhausted ? "failed" : "queued", reason: "transient_error" };
      if (!exhausted) retry = "transient_error";
      try {
        await deps.outbox.finish(outboxId, result.status as "queued" | "failed", { reason: "transient_error" }, deps.clock.now());
      } catch {
        /* the lease will expire; the reaper marks it abandoned */
      }
    } else {
      // The provider may or may not have the message. Never resend.
      result = { status: "unknown", reason: "unexpected_error" };
      try {
        await deps.outbox.finish(outboxId, "unknown", { reason: "unexpected_error" }, deps.clock.now());
      } catch {
        /* the lease will expire and the next claim marks it abandoned */
      }
    }
  }
  log("email.result", { outboxId, template: doc.template, status: result.status, ...(result.reason ? { reason: result.reason } : {}) });
  if (retry !== null) throw new RetryableEmailError(retry);
  return result;
}

type ResolvedRecipient = { to: string; hash: string; displayName: string | null; locale: string | null | undefined } | { skip: SkipReason };

/**
 * Who this email goes to, read fresh at send time. Members: `users/{uid}` of the same company, active, with their own
 * category switch (account emails: at least one email category still on). Roster invitations: the roster entry of the
 * same company, still `invited`, whose address still hashes to the entry id, and not opted out of invitations.
 */
async function resolveRecipient(deps: SendDeps, doc: OutboxDocument, variables: TemplateVariables[TemplateId]): Promise<ResolvedRecipient> {
  if (isRosterTemplate(doc.template)) {
    if (!deps.invitees || !deps.inviteOptOuts) return { skip: "config_incomplete" };
    const entryId = (variables as TemplateVariables["roster_invite"]).entryId;
    if (rosterEntryOf(doc.uid) !== entryId) return { skip: "tenant_mismatch" };
    const invitee = await deps.invitees.get(doc.companyId, entryId);
    if (invitee === null) return { skip: "no_member" };
    if (invitee.companyId !== doc.companyId) return { skip: "tenant_mismatch" };
    if (invitee.status !== "invited") return { skip: "not_invited" };
    const to = invitee.email?.trim() ?? "";
    if (to.length === 0) return { skip: "no_email" };
    const hash = emailHash(to);
    if (hash !== entryId) return { skip: "tenant_mismatch" };
    if (await deps.inviteOptOuts.isOptedOut(hash)) return { skip: "opted_out" };
    return { to, hash, displayName: invitee.displayName, locale: doc.locale ?? null };
  }
  const recipient = await deps.recipients.get(doc.uid);
  if (recipient === null) return { skip: "no_member" };
  if (recipient.companyId !== doc.companyId) return { skip: "tenant_mismatch" };
  if (recipient.status !== null && recipient.status !== "active") return { skip: "inactive_member" };
  // Admin-only content: the role is re-checked at send time (a demoted admin must not receive the ideas email).
  if (doc.template === "admin_suggestions" && recipient.role !== "admin") return { skip: "not_admin" };
  const to = recipient.email?.trim() ?? "";
  if (to.length === 0) return { skip: "no_email" };
  const preferences = resolveEmailPreferences(await deps.preferences.getEmailMap(doc.uid));
  if (doc.category === ACCOUNT_CATEGORY) {
    // No switch of its own: "Unsubscribe from all DIP emails" (every category off) also stops account emails.
    if (!Object.values(preferences).some(Boolean)) return { skip: "all_off" };
  } else if (!preferences[doc.category]) return { skip: "preference_off" };
  return { to, hash: emailHash(to), displayName: recipient.displayName, locale: recipient.locale };
}

async function process(deps: SendDeps, doc: OutboxDocument, now: Date, state: { providerCalled: boolean }): Promise<{ result: SendResult; retry: string | null }> {
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

  const resolved = await resolveRecipient(deps, doc, variables);
  if ("skip" in resolved) return skip(resolved.skip);
  const { to, hash, displayName, locale: rawLocale } = resolved;
  if (await deps.suppressions.isSuppressed(hash)) return skip("suppressed");

  const isInvite = doc.template === "calendar_invite" || doc.template === "calendar_cancel";
  if (isInvite) {
    // Send-time truth: a member who left, an event that was canceled or ended, or a cancel for a calendar entry that never
    // reached the member must not produce an email, whatever was true when the outbox entry was queued.
    if (!deps.inviteEligibility || !deps.inviteSequences) return skip("config_incomplete");
    const state = await deps.inviteEligibility.state(doc.companyId, eventIdOf(variables), doc.uid);
    if (doc.template === "calendar_invite") {
      if (!state.going) return skip("not_going");
      if (state.eventStatus !== "scheduled") return skip("event_canceled");
      if (state.endTime !== null && state.endTime.getTime() <= now.getTime()) return skip("event_ended");
    } else {
      if ((variables as TemplateVariables["calendar_cancel"]).reason === "left" && state.going && state.eventStatus === "scheduled") return skip("rejoined");
      if (!(await deps.inviteSequences.isDelivered(doc.companyId, eventIdOf(variables), doc.uid))) return skip("never_invited");
    }
  }

  const cap = await deps.caps.consume(doc.uid, doc.companyId, capDay(now), MEMBER_DAILY_CAP, company.dailyCap, now, doc.id);
  if (cap !== "ok") return skip(cap);

  // Every email is rendered in its own recipient's language: one outbox document per recipient, so a fan-out with mixed
  // locales sends each member their own copy. Missing or unsupported values mean English.
  const locale = localeOrDefault(rawLocale);
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const sign = deps.tokenSigner ?? signUnsubscribeToken;
  const unsubscribeURL = `${deps.config.publicOrigin}/u/${sign(deps.config.unsubscribeKey, doc.uid, doc.category, nowSeconds)}`;
  const rendered = deps.renderer.render(doc.template, variables, {
    recipientFirstName: firstName(displayName),
    timeZone: company.timeZone ?? deps.config.defaultTimeZone,
    unsubscribeURL,
    openPixelURL: deps.config.openTracking
      ? `${deps.config.publicOrigin}/o/${signOpenToken(deps.config.unsubscribeKey, doc.id, nowSeconds)}.gif`
      : null,
    locale,
    ...(isRosterTemplate(doc.template) ? { recipientAddress: to } : {}),
  });
  const attachment = deps.renderer.attachment(doc.template, variables,
    "revision" in variables && typeof variables.revision === "number" ? variables.revision : 0,
    isInvite ? { attendeeEmail: to, attendeeName: displayName?.trim() || null, memberUid: doc.uid, now, locale } : undefined);
  // An invite without its calendar part would be a plain "you joined" email with a promise it cannot keep.
  if (isInvite && attachment === null) return skip("invalid_variables");

  state.providerCalled = true;
  const outcome = await deps.provider.send({
    to,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    headers: { "List-Unsubscribe": `<${unsubscribeURL}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    attachments: attachment === null ? [] : [attachment],
    ...(isInvite ? { from: INVITE_FROM, replyTo: INVITE_REPLY_TO } : {}),
    stream: "notifications",
    metadata: { outboxId: doc.id },
    tag: doc.template,
  });

  switch (outcome.kind) {
    case "sent":
      if (isInvite && deps.inviteSequences) {
        // Best effort: the email is already accepted, so a failed bookkeeping write must not turn `sent` into `unknown`.
        try { await deps.inviteSequences.setDelivered(doc.companyId, eventIdOf(variables), doc.uid, doc.template === "calendar_invite", deps.clock.now()); } catch { /* cancel is then skipped as never_invited */ }
      }
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
