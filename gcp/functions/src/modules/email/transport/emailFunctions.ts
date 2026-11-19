import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { onDocumentCreated, onDocumentUpdated, onDocumentWritten } from "firebase-functions/v2/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineBoolean, defineSecret, defineString } from "firebase-functions/params";
import { defaultAdminApp } from "../../accounts/transport/resolveMembershipV1";
import { SHARE_ORIGIN } from "../../share/domain/sharePage";
import { emailChannel, type ChannelDeps } from "../application/enqueueEmail";
import type { EmailConfig, EmailProviderPort, EmailWebhookVerifier } from "../application/ports";
import { RetryableEmailError, sendOutboxEmail, type EmailRenderer } from "../application/sendOutboxEmail";
import { reapOutbox } from "../application/reapOutbox";
import { handleOpenPixel } from "../application/openPixel";
import { handleUnsubscribe } from "../application/unsubscribe";
import { handleWebhook } from "../application/webhook";
import { onEventUpdatedForInvites, onRsvpForInvite, type CalendarInviteDeps } from "../application/calendarInvites";
import { onMemberCreatedForWelcome } from "../application/welcome";
import { runWeeklyThemeEmails } from "../application/weeklyThemeEmails";
import { runAdminDigests } from "../application/adminDigest";
import { FirestoreDigestSource } from "../infrastructure/firestoreDigestSource";
import { FirestoreThemes } from "../../notifications/infrastructure/firestoreThemes";
import { icsAttachmentFor } from "../domain/ics";
import { OUTBOX_COLLECTION } from "../domain/outbox";
import { renderEmail, validateVariables } from "../domain/templates/render";
import { EmulatorOutboxEmailProvider, LogOnlyEmailProvider } from "../infrastructure/fakeProviders";
import { FirestoreCalendarStore, plainDoc } from "../infrastructure/firestoreCalendarStore";
import { FirestoreEmailStore } from "../infrastructure/firestoreEmailStore";
import { PostmarkProvider, PostmarkWebhookVerifier } from "../infrastructure/postmarkProvider";
import { ResendProvider, ResendWebhookVerifier } from "../infrastructure/resendProvider";

/*
 * Configuration (docs/ops/email-setup.md). Everything is off by default; nothing is sent until the owner sets
 * EMAIL_ENABLED=true, EMAIL_PROVIDER=postmark|resend, the secrets, and enables a company in
 * `emailSettings/{companyId}`. Secret values are bound per function and never logged.
 */
export const EMAIL_ENABLED = defineBoolean("EMAIL_ENABLED", { default: false, description: "Master switch for all email sending." });
export const EMAIL_PROVIDER = defineString("EMAIL_PROVIDER", { default: "log", description: "postmark | resend | log (log-only fake)." });
export const EMAIL_OPEN_TRACKING = defineBoolean("EMAIL_OPEN_TRACKING", { default: false, description: "Add an approximate open-tracking pixel to emails." });
export const EMAIL_DEFAULT_TIME_ZONE = defineString("EMAIL_DEFAULT_TIME_ZONE", { default: "America/New_York", description: "IANA zone for times when the company has none." });
export const POSTMARK_MESSAGE_STREAM = defineString("POSTMARK_MESSAGE_STREAM", { default: "notifications", description: "Postmark message stream id for optional notifications." });
export const EMAIL_UNSUBSCRIBE_KEY = defineSecret("EMAIL_UNSUBSCRIBE_KEY");
export const POSTMARK_SERVER_TOKEN = defineSecret("POSTMARK_SERVER_TOKEN");
export const EMAIL_WEBHOOK_PASSWORD = defineSecret("EMAIL_WEBHOOK_PASSWORD");
// Resend (alternative provider). A functions deploy needs every bound secret to exist: create placeholder values
// first (docs/ops/email-runbook.md); they are only read when EMAIL_PROVIDER=resend.
export const RESEND_API_KEY = defineSecret("RESEND_API_KEY");
export const RESEND_WEBHOOK_SECRET = defineSecret("RESEND_WEBHOOK_SECRET");

const REGION = "us-central1";
const WEBHOOK_USERNAME = "dip-email-webhook";
const emulator = () => process.env.FUNCTIONS_EMULATOR === "true";
/** Emulator-only key so the local suite can exercise unsubscribe links; production always uses the Secret Manager value. */
const EMULATOR_UNSUBSCRIBE_KEY = "emulator-only-unsubscribe-key-not-a-secret-0000";
export const EMULATOR_WEBHOOK_PASSWORD = "emulator-only-webhook-password-0000";

function webhookPassword(): string {
  const value = EMAIL_WEBHOOK_PASSWORD.value();
  return value.length === 0 && emulator() ? EMULATOR_WEBHOOK_PASSWORD : value;
}

export const renderer: EmailRenderer = {
  render: (template, variables, ctx) => renderEmail(template, variables, ctx),
  validate: (template, value) => validateVariables(template, value),
  attachment: (template, variables, revision, invite) => icsAttachmentFor(template, variables, revision, invite?.now ?? new Date(), invite),
};

function unsubscribeKey(): string {
  const value = EMAIL_UNSUBSCRIBE_KEY.value();
  return value.length === 0 && emulator() ? EMULATOR_UNSUBSCRIBE_KEY : value;
}

export function emailConfig(): EmailConfig {
  return {
    // The emulator never reaches a provider (emulatorEmailOutbox), so it runs with email on; a company still needs
    // `emailSettings/{companyId}.enabled`.
    enabled: EMAIL_ENABLED.value() || emulator(),
    unsubscribeKey: unsubscribeKey(),
    // Unset params read as "" at runtime outside a CLI deploy; fall back to the documented defaults.
    defaultTimeZone: EMAIL_DEFAULT_TIME_ZONE.value() || "America/New_York",
    publicOrigin: SHARE_ORIGIN,
    openTracking: EMAIL_OPEN_TRACKING.value() || emulator(),
  };
}

function provider(store: FirebaseFirestore.Firestore): EmailProviderPort {
  // The emulator never reaches a provider: it records messages in `emulatorEmailOutbox`.
  if (emulator()) return new EmulatorOutboxEmailProvider(store);
  if (EMAIL_PROVIDER.value() === "postmark") {
    return new PostmarkProvider({ serverToken: POSTMARK_SERVER_TOKEN.value(), streams: { notifications: POSTMARK_MESSAGE_STREAM.value() || "notifications" } });
  }
  if (EMAIL_PROVIDER.value() === "resend") return new ResendProvider({ apiKey: RESEND_API_KEY.value() });
  return new LogOnlyEmailProvider();
}

/** Resend signs with Svix (`whsec_...`); Postmark (and the emulator/log setups) use Basic credentials. */
function webhookVerifier(): EmailWebhookVerifier {
  if (!emulator() && EMAIL_PROVIDER.value() === "resend") return new ResendWebhookVerifier(RESEND_WEBHOOK_SECRET.value());
  return new PostmarkWebhookVerifier(WEBHOOK_USERNAME, webhookPassword());
}

function stores() {
  const db = getFirestore(defaultAdminApp());
  return { db, store: new FirestoreEmailStore(db), calendar: new FirestoreCalendarStore(db) };
}

/**
 * Dependencies for the shared notification router's email channel (docs/design/stretch/push-triggers.md, router).
 * The router calls `emailChannel(emailChannelDependencies(), candidate)` once per recipient.
 */
export function emailChannelDependencies(): ChannelDeps {
  const { store } = stores();
  return {
    outbox: store.outbox, companies: store.companies, preferences: store.preferences,
    clock: { now: () => new Date() }, validate: renderer.validate, config: { enabled: EMAIL_ENABLED.value() || emulator() },
  };
}
export { emailChannel };

function calendarInviteDependencies(): CalendarInviteDeps {
  const { calendar } = stores();
  return { ...emailChannelDependencies(), sequences: calendar.sequences, events: calendar.events };
}

const INVITE_TRIGGER = { region: REGION, retry: true, timeoutSeconds: 120, memory: "256MiB", maxInstances: 10 } as const;

/**
 * RSVP written -> calendar invite on join, calendar cancellation on leave (email only; docs/design/stretch/calendar.md).
 * Independent of the push router: it never touches push or in-app notices, and is a no-op while EMAIL_ENABLED is off.
 */
export const calendarInviteOnRsvp = onDocumentWritten(
  { ...INVITE_TRIGGER, document: "companies/{companyId}/events/{eventId}/rsvps/{userId}" },
  async (event) => {
    const { companyId, eventId, userId } = event.params;
    const status = (snap: { exists: boolean; get(field: string): unknown } | undefined): string | null => {
      const value = snap?.exists ? snap.get("status") : null;
      return typeof value === "string" ? value : null;
    };
    const before = status(event.data?.before);
    const after = status(event.data?.after);
    if (before === after) return;
    const writeTime = event.data?.after.updateTime?.toDate() ?? event.data?.before.updateTime?.toDate() ?? new Date(event.time);
    const outcome = await onRsvpForInvite(calendarInviteDependencies(), { companyId, eventId, uid: userId, before, after, writeTime });
    logger.info("calendar invite rsvp", { companyId, eventId, outcome });
  });

/** Event updated -> re-send the invite (same UID, higher SEQUENCE) on time, place or title changes; cancel on cancellation. */
export const calendarInviteOnEventUpdated = onDocumentUpdated(
  { ...INVITE_TRIGGER, document: "companies/{companyId}/events/{eventId}", memory: "512MiB" },
  async (event) => {
    if (!event.data) return;
    const { companyId, eventId } = event.params;
    const updateTime = event.data.after.updateTime?.toDate() ?? new Date(event.time);
    const stats = await onEventUpdatedForInvites(calendarInviteDependencies(), {
      companyId, eventId, before: plainDoc(event.data.before.data()), after: plainDoc(event.data.after.data()), updateTime,
    });
    if (stats.recipients > 0) logger.info("calendar invite event update", { companyId, eventId, ...stats });
  });

/**
 * Member created (first membership resolve writes `users/{uid}` once) -> one welcome email (account category). A no-op
 * while EMAIL_ENABLED is off or the company has no `emailSettings` switch on; never retried into a second email (the
 * outbox id is deterministic).
 */
export const welcomeEmailOnMemberCreated = onDocumentCreated(
  { document: "users/{userId}", region: REGION, retry: true, timeoutSeconds: 30, memory: "256MiB", maxInstances: 10 },
  async (event) => {
    if (!event.data) return;
    const { db, store } = stores();
    const outcome = await onMemberCreatedForWelcome({
      ...emailChannelDependencies(), companies: store.companies,
      companyName: async (companyId) => {
        const name: unknown = (await db.collection("companies").doc(companyId).get()).get("name");
        return typeof name === "string" ? name : null;
      },
    }, { uid: event.params.userId, data: event.data.data() });
    if (outcome.enqueued) logger.info("welcome email queued", { outboxId: outcome.id });
  });

/**
 * Weekly theme announcement email (opt-in `weekly_themes`, default off). Same schedule, lookback and member pager as
 * `sendWeeklyThemePushes` (Monday 09:00 America/New_York; themes that started in the last 24 hours). A no-op while
 * EMAIL_ENABLED is off; per company only while `emailSettings/{companyId}.enabled`. Outbox ids make retries send once.
 */
export const sendWeeklyThemeEmails = onSchedule(
  { schedule: "every monday 09:00", timeZone: "America/New_York", region: REGION, retryCount: 1, timeoutSeconds: 540, memory: "512MiB", maxInstances: 1 },
  async () => {
    const { db, store } = stores();
    const themes = new FirestoreThemes(db);
    const config = emailConfig();
    const stats = await runWeeklyThemeEmails({
      themes, members: themes, companies: store.companies, preferences: store.preferences,
      enqueue: { outbox: store.outbox, clock: { now: () => new Date() }, validate: renderer.validate },
      config: { enabled: config.enabled }, now: () => new Date(),
      log: (event, fields) => logger.info(event, fields),
    });
    if (stats.failed > 0) logger.warn("weekly theme emails finished with failures", { failed: stats.failed });
  });

/**
 * Daily roster digest for admins (opt-in `admin_digest`, default off). Hourly (UTC) like the weekly ideas job; each
 * company is due from 08:00 to 11:59 in its own zone (`emailSettings/{companyId}.timeZone`) and reports the previous day.
 */
export const sendAdminDigestEmails = onSchedule(
  { schedule: "0 * * * *", timeZone: "Etc/UTC", region: REGION, retryCount: 0, timeoutSeconds: 300, memory: "256MiB", maxInstances: 1 },
  async () => {
    const { db, store } = stores();
    const config = emailConfig();
    const summary = await runAdminDigests({
      source: new FirestoreDigestSource(db), companies: store.companies, preferences: store.preferences,
      enqueue: { outbox: store.outbox, clock: { now: () => new Date() }, validate: renderer.validate },
      config: { enabled: config.enabled, defaultTimeZone: config.defaultTimeZone },
      log: (event, fields) => logger.info(event, fields),
    }, new Date());
    if (summary.failed > 0) logger.warn("admin digest finished with failures", { failed: summary.failed });
  });

/** Outbox document created -> run every send-time gate and send at most once. */
export const onEmailOutboxCreated = onDocumentCreated(
  {
    document: `${OUTBOX_COLLECTION}/{outboxId}`, region: REGION, retry: true, timeoutSeconds: 60, memory: "256MiB", maxInstances: 10,
    secrets: [EMAIL_UNSUBSCRIBE_KEY, POSTMARK_SERVER_TOKEN, RESEND_API_KEY],
  },
  async (event) => {
    if (!event.data) return;
    const { db, store, calendar } = stores();
    try {
      await sendOutboxEmail({
        inviteSequences: calendar.sequences, inviteEligibility: calendar.eligibility, invitees: store.invitees, inviteOptOuts: store.invitees,
        outbox: store.outbox, recipients: store.recipients, companies: store.companies, suppressions: store.suppressions,
        caps: store.caps, preferences: store.preferences, provider: provider(db), renderer, clock: { now: () => new Date() },
        config: emailConfig(),
      }, event.params.outboxId);
    } catch (error) {
      if (error instanceof RetryableEmailError) throw error; // redelivered by the runtime; the claim prevents duplicates
      logger.error("email send failed", { outboxId: event.params.outboxId, error: error instanceof Error ? error.name : "unknown" });
    }
  });

/** Every 15 minutes: close outbox documents the trigger can no longer finish (see application/reapOutbox.ts). */
export const emailOutboxReaper = onSchedule(
  { schedule: "every 15 minutes", timeZone: "Etc/UTC", region: REGION, timeoutSeconds: 120, memory: "256MiB", maxInstances: 1, retryCount: 0 },
  async () => {
    const { store } = stores();
    await reapOutbox({ reaper: store.reaper, clock: { now: () => new Date() } });
  });

interface HttpResponseLike {
  status(code: number): HttpResponseLike;
  set(headers: Record<string, string>): HttpResponseLike;
  send(body: string): unknown;
}

/** `https://letsdip.work/u/<token>` (Hosting rewrite). No auth, no cookies, no redirects (RFC 8058). */
export const emailUnsubscribeV1 = onRequest(
  { region: REGION, invoker: "public", cors: false, timeoutSeconds: 10, memory: "256MiB", maxInstances: 10, secrets: [EMAIL_UNSUBSCRIBE_KEY] },
  async (req, res) => {
    const response = res as unknown as HttpResponseLike;
    try {
      const result = await handleUnsubscribe(
        { preferences: stores().store.preferences, inviteOptOuts: stores().store.invitees, clock: { now: () => new Date() }, key: unsubscribeKey(), publicOrigin: SHARE_ORIGIN },
        { method: req.method, path: req.path, body: req.body, contentType: req.get("content-type") },
      );
      response.status(result.status).set(result.headers).send(result.body);
    } catch (error) {
      logger.error("emailUnsubscribeV1 failed", { error: error instanceof Error ? error.name : "unknown" });
      response.status(500).set({ "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }).send("Something went wrong. Try again later.");
    }
  });

/** `https://letsdip.work/o/<token>.gif` (Hosting rewrite). Public, no cookies, no redirects; always the same GIF. */
export const emailOpenV1 = onRequest(
  { region: REGION, invoker: "public", cors: false, timeoutSeconds: 10, memory: "256MiB", maxInstances: 10, secrets: [EMAIL_UNSUBSCRIBE_KEY] },
  async (req, res) => {
    const response = res as unknown as HttpResponseLike;
    const result = await handleOpenPixel(
      { outbox: stores().store.outbox, clock: { now: () => new Date() }, key: unsubscribeKey() },
      { method: req.method, path: req.path },
    );
    response.status(result.status).set(result.headers).send(result.body as unknown as string);
  });

/** Provider bounce and complaint webhook (direct function URL; Basic credentials for Postmark, Svix signature for Resend; see docs/ops/email-setup.md). */
export const emailWebhookV1 = onRequest(
  { region: REGION, invoker: "public", cors: false, timeoutSeconds: 30, memory: "256MiB", maxInstances: 5, secrets: [EMAIL_WEBHOOK_PASSWORD, RESEND_WEBHOOK_SECRET] },
  async (req, res) => {
    const response = res as unknown as HttpResponseLike;
    const { store } = stores();
    const result = await handleWebhook(
      webhookVerifier(),
      { suppressions: store.suppressions, preferences: store.preferences, outbox: store.outbox, recipients: store.recipients, clock: { now: () => new Date() } },
      { method: req.method, headers: req.headers, rawBody: req.rawBody },
    );
    response.status(result.status).set({ "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }).send(result.body);
  });
