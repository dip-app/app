import { logger } from "firebase-functions/v2";
import { EMAIL_CATEGORIES } from "../domain/categories";
import { emailHash } from "../domain/outbox";
import type { Clock, DeliveryEvent, EmailPreferencesStore, EmailWebhookVerifier, OutboxStore, RecipientDirectory, SuppressionStore } from "./ports";

/** Applies provider delivery events: suppress bad addresses, and turn every category off after a spam complaint. */

export const MAX_WEBHOOK_EVENTS = 500;

export interface WebhookDeps {
  suppressions: SuppressionStore;
  preferences: EmailPreferencesStore;
  outbox: OutboxStore;
  recipients: RecipientDirectory;
  clock: Clock;
}

export interface WebhookCounts { suppressed: number; optedOut: number; ignored: number }

export async function processDeliveryEvents(deps: WebhookDeps, events: DeliveryEvent[]): Promise<WebhookCounts> {
  const counts: WebhookCounts = { suppressed: 0, optedOut: 0, ignored: 0 };
  const batch = events.slice(0, MAX_WEBHOOK_EVENTS);
  counts.ignored += events.length - batch.length;
  for (const event of batch) {
    const email = event.email?.trim();
    if (!email) { counts.ignored++; continue; }
    const now = deps.clock.now();
    try {
      await applyEvent(deps, event, email, now, counts);
    } catch (error) {
      // Correlation ids only (no address, token or name); the provider retries the whole batch and every write is idempotent.
      logger.error("email webhook event failed", { ...correlation(event), type: event.type, error: error instanceof Error ? error.name : "unknown" });
      throw error;
    }
  }
  return counts;
}

function correlation(event: DeliveryEvent): Record<string, string> {
  return {
    ...(event.outboxId ? { outboxId: event.outboxId.slice(0, 200) } : {}),
    ...(event.providerMessageId ? { providerMessageId: event.providerMessageId.slice(0, 64) } : {}),
  };
}

async function applyEvent(deps: WebhookDeps, event: DeliveryEvent, email: string, now: Date, counts: WebhookCounts): Promise<void> {
  {
    switch (event.type) {
      case "hard_bounce":
        await deps.suppressions.suppress(emailHash(email), "hard_bounce", now);
        counts.suppressed++;
        break;
      case "provider_unsubscribe":
        await deps.suppressions.suppress(emailHash(email), "provider_unsubscribe", now);
        counts.suppressed++;
        break;
      case "complaint": {
        await deps.suppressions.suppress(emailHash(email), "complaint", now);
        counts.suppressed++;
        for (const uid of await complaintUids(deps, event, email)) {
          await deps.preferences.disable(uid, EMAIL_CATEGORIES);
          counts.optedOut++;
        }
        break;
      }
      default:
        counts.ignored++;
    }
    if (event.type === "hard_bounce" || event.type === "complaint" || event.type === "provider_unsubscribe") {
      logger.info("email webhook event applied", { type: event.type, ...correlation(event) });
    }
  }
}

async function complaintUids(deps: WebhookDeps, event: DeliveryEvent, email: string): Promise<string[]> {
  if (event.outboxId) {
    const doc = await deps.outbox.get(event.outboxId);
    if (doc?.uid) return [doc.uid];
  }
  return (await deps.recipients.uidsByEmail(email)).slice(0, 5);
}

export interface WebhookRequest { method: string; headers: Readonly<Record<string, string | string[] | undefined>>; rawBody: Buffer | undefined }
export interface WebhookResponse { status: number; body: string }

export async function handleWebhook(verifier: EmailWebhookVerifier, deps: WebhookDeps, req: WebhookRequest): Promise<WebhookResponse> {
  if ((req.method ?? "").toUpperCase() !== "POST") return { status: 405, body: "Method Not Allowed" };
  const parsed = verifier.parse(req.headers ?? {}, req.rawBody ?? Buffer.alloc(0));
  if (!parsed.ok) return { status: parsed.status, body: parsed.status === 401 ? "unauthorized" : "bad request" };
  try {
    // More than we process in one request: refuse so the provider retries (smaller batches) instead of silently dropping events.
    if (parsed.events.length > MAX_WEBHOOK_EVENTS) {
      logger.warn("email webhook batch too large", { events: parsed.events.length, max: MAX_WEBHOOK_EVENTS });
      return { status: 413, body: "payload too large" };
    }
    const counts = await processDeliveryEvents(deps, parsed.events);
    logger.info("email webhook processed", { ...counts, malformed: parsed.malformed ?? 0 });
    return { status: 200, body: "ok" };
  } catch {
    // Let the provider retry; suppress() and disable() are idempotent. Error details may include addresses, so omit them.
    logger.error("email webhook processing failed");
    return { status: 500, body: "error" };
  }
}
