import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { defineBoolean, defineSecret, defineString } from "firebase-functions/params";
import { defaultAdminApp } from "../../accounts/transport/resolveMembershipV1";
import { SHARE_ORIGIN } from "../../share/domain/sharePage";
import { emailChannel, type ChannelDeps } from "../application/enqueueEmail";
import type { EmailConfig, EmailProviderPort } from "../application/ports";
import { RetryableEmailError, sendOutboxEmail, type EmailRenderer } from "../application/sendOutboxEmail";
import { handleUnsubscribe } from "../application/unsubscribe";
import { handleWebhook } from "../application/webhook";
import { icsAttachmentFor } from "../domain/ics";
import { OUTBOX_COLLECTION } from "../domain/outbox";
import { renderEmail, validateVariables } from "../domain/templates/render";
import { EmulatorOutboxEmailProvider, LogOnlyEmailProvider } from "../infrastructure/fakeProviders";
import { FirestoreEmailStore } from "../infrastructure/firestoreEmailStore";
import { PostmarkProvider, PostmarkWebhookVerifier } from "../infrastructure/postmarkProvider";

/*
 * Configuration (docs/ops/email-setup.md). Everything is off by default; nothing is sent until the owner sets
 * EMAIL_ENABLED=true, EMAIL_PROVIDER=postmark, a postal address, the secrets, and enables a company in
 * `emailSettings/{companyId}`. Secret values are bound per function and never logged.
 */
export const EMAIL_ENABLED = defineBoolean("EMAIL_ENABLED", { default: false, description: "Master switch for all email sending." });
export const EMAIL_PROVIDER = defineString("EMAIL_PROVIDER", { default: "log", description: "postmark | log (log-only fake)." });
export const EMAIL_POSTAL_ADDRESS = defineString("EMAIL_POSTAL_ADDRESS", { default: "", description: "Postal address for the email footer (CAN-SPAM). Sending is skipped while empty." });
export const EMAIL_DEFAULT_TIME_ZONE = defineString("EMAIL_DEFAULT_TIME_ZONE", { default: "America/New_York", description: "IANA zone for times when the company has none." });
export const POSTMARK_MESSAGE_STREAM = defineString("POSTMARK_MESSAGE_STREAM", { default: "notifications", description: "Postmark message stream id for optional notifications." });
export const EMAIL_UNSUBSCRIBE_KEY = defineSecret("EMAIL_UNSUBSCRIBE_KEY");
export const POSTMARK_SERVER_TOKEN = defineSecret("POSTMARK_SERVER_TOKEN");
export const EMAIL_WEBHOOK_PASSWORD = defineSecret("EMAIL_WEBHOOK_PASSWORD");

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
  attachment: (template, variables, revision) => icsAttachmentFor(template, variables, revision),
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
    postalAddress: EMAIL_POSTAL_ADDRESS.value() || (emulator() ? "Emulator, 1 Test Street, Testville" : ""),
    defaultTimeZone: EMAIL_DEFAULT_TIME_ZONE.value(),
    publicOrigin: SHARE_ORIGIN,
  };
}

function provider(store: FirebaseFirestore.Firestore): EmailProviderPort {
  // The emulator never reaches a provider: it records messages in `emulatorEmailOutbox`.
  if (emulator()) return new EmulatorOutboxEmailProvider(store);
  if (EMAIL_PROVIDER.value() === "postmark") {
    return new PostmarkProvider({ serverToken: POSTMARK_SERVER_TOKEN.value(), streams: { notifications: POSTMARK_MESSAGE_STREAM.value() } });
  }
  return new LogOnlyEmailProvider();
}

function stores() {
  const db = getFirestore(defaultAdminApp());
  return { db, store: new FirestoreEmailStore(db) };
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

/** Outbox document created -> run every send-time gate and send at most once. */
export const onEmailOutboxCreated = onDocumentCreated(
  {
    document: `${OUTBOX_COLLECTION}/{outboxId}`, region: REGION, retry: true, timeoutSeconds: 60, maxInstances: 10,
    secrets: [EMAIL_UNSUBSCRIBE_KEY, POSTMARK_SERVER_TOKEN],
  },
  async (event) => {
    if (!event.data) return;
    const { db, store } = stores();
    try {
      await sendOutboxEmail({
        outbox: store.outbox, recipients: store.recipients, companies: store.companies, suppressions: store.suppressions,
        caps: store.caps, preferences: store.preferences, provider: provider(db), renderer, clock: { now: () => new Date() },
        config: emailConfig(),
      }, event.params.outboxId);
    } catch (error) {
      if (error instanceof RetryableEmailError) throw error; // redelivered by the runtime; the claim prevents duplicates
      logger.error("email send failed", { outboxId: event.params.outboxId, error: error instanceof Error ? error.name : "unknown" });
    }
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
        { preferences: stores().store.preferences, clock: { now: () => new Date() }, key: unsubscribeKey(), publicOrigin: SHARE_ORIGIN },
        { method: req.method, path: req.path, body: req.body, contentType: req.get("content-type") },
      );
      response.status(result.status).set(result.headers).send(result.body);
    } catch (error) {
      logger.error("emailUnsubscribeV1 failed", { error: error instanceof Error ? error.name : "unknown" });
      response.status(500).set({ "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }).send("Something went wrong. Try again later.");
    }
  });

/** Provider bounce and complaint webhook (direct function URL with Basic credentials; see docs/ops/email-setup.md). */
export const emailWebhookV1 = onRequest(
  { region: REGION, invoker: "public", cors: false, timeoutSeconds: 30, memory: "256MiB", maxInstances: 5, secrets: [EMAIL_WEBHOOK_PASSWORD] },
  async (req, res) => {
    const response = res as unknown as HttpResponseLike;
    const { store } = stores();
    const result = await handleWebhook(
      new PostmarkWebhookVerifier(WEBHOOK_USERNAME, webhookPassword()),
      { suppressions: store.suppressions, preferences: store.preferences, outbox: store.outbox, recipients: store.recipients, clock: { now: () => new Date() } },
      { method: req.method, headers: req.headers, rawBody: req.rawBody },
    );
    response.status(result.status).set({ "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }).send(result.body);
  });
