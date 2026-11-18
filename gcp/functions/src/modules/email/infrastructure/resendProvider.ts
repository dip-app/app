import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  DeliveryEvent, EmailProviderPort, EmailWebhookVerifier, OutgoingEmail, SendOutcome, WebhookParseResult,
} from "../application/ports";

/*
 * Resend adapter (https://resend.com/docs/api-reference/emails/send-email). Plain fetch, no SDK.
 * Alternative to Postmark: select with EMAIL_PROVIDER=resend (docs/ops/email-runbook.md, "Resend").
 */

const ENDPOINT = "https://api.resend.com/emails";
const DEFAULT_FROM = "DIP <notify@letsdip.work>";
const REPLY_TO = "support@letsdip.work";
const DEFAULT_TIMEOUT_MS = 10_000;
/** Errors that prove nothing was written to the provider. */
const PRE_SEND_CODES = new Set(["ENOTFOUND", "ECONNREFUSED", "EAI_AGAIN"]);
/** Resend rejects idempotency keys longer than 256 characters (400 invalid_idempotency_key). */
const MAX_IDEMPOTENCY_KEY = 256;
/** Resend tag names and values: ASCII letters, digits, underscore, dash; at most 256 characters. */
const MAX_TAG = 256;

export interface ResendOptions {
  /** API key (`re_...`). Secret: only ever placed in the request header, never logged or returned. */
  apiKey: string;
  from?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** Test seam for a local fake server; production uses the Resend API. */
  endpoint?: string;
}

function causeCode(error: unknown): string | null {
  const cause = (error as { cause?: { code?: unknown } } | null)?.cause;
  return typeof cause?.code === "string" ? cause.code : null;
}

/** Tag values may only contain `[A-Za-z0-9_-]`; anything else becomes `_`. */
export function resendTagValue(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, MAX_TAG);
  return cleaned.length > 0 ? cleaned : "none";
}

export class ResendProvider implements EmailProviderPort {
  readonly name = "resend";
  private readonly from: string;
  private readonly timeoutMs: number;

  constructor(private readonly options: ResendOptions) {
    this.from = options.from ?? DEFAULT_FROM;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async send(message: OutgoingEmail): Promise<SendOutcome> {
    const outboxId = message.metadata.outboxId;
    if (outboxId.length === 0 || outboxId.length > MAX_IDEMPOTENCY_KEY) return { kind: "rejected", code: "resend_bad_idempotency_key" };
    const body = {
      from: message.from ?? this.from,
      to: [message.to],
      reply_to: message.replyTo ?? REPLY_TO,
      subject: message.subject,
      html: message.html,
      text: message.text,
      headers: message.headers,
      attachments: message.attachments.map((a) => ({
        filename: a.filename, content: Buffer.from(a.content, "utf8").toString("base64"), content_type: a.contentType,
      })),
      // Resend webhooks carry tags (not metadata), so the outbox id travels as a tag for correlation.
      tags: [
        { name: "template", value: resendTagValue(message.tag) },
        { name: "outbox_id", value: resendTagValue(outboxId) },
      ],
    };
    let response: Response;
    try {
      response = await (this.options.fetchImpl ?? fetch)(this.options.endpoint ?? ENDPOINT, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.options.apiKey}`,
          // Same outbox id on every attempt: Resend replays the first result for 24 hours instead of sending twice.
          "Idempotency-Key": outboxId,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const code = causeCode(error);
      if (code !== null && PRE_SEND_CODES.has(code)) return { kind: "retryable", code: `network_${code.toLowerCase()}` };
      const name = (error as { name?: unknown } | null)?.name;
      return { kind: "unknown", code: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network_error" };
    }
    const status = response.status;
    let payload: { id?: unknown; name?: unknown } = {};
    try { payload = (await response.json()) as typeof payload; } catch { /* body unreadable: judged by status only */ }
    const errorName = typeof payload.name === "string" && /^[a-z_]{1,64}$/.test(payload.name) ? payload.name : null;

    if (status === 200 || status === 201) {
      return typeof payload.id === "string" && payload.id.length > 0
        ? { kind: "sent", providerMessageId: payload.id }
        : { kind: "unknown", code: "missing_message_id" };
    }
    if (status === 429) return { kind: "retryable", code: `resend_429_${errorName ?? "rate_limit"}` };
    if (status === 409) {
      // A request with this key is still running: retry later and Resend returns its result.
      if (errorName === "concurrent_idempotent_requests") return { kind: "retryable", code: "resend_409_concurrent" };
      // The key was already used with a different body, so an earlier attempt may have been accepted: never resend.
      if (errorName === "invalid_idempotent_request") return { kind: "unknown", code: "resend_409_idempotency_mismatch" };
      return { kind: "rejected", code: "resend_409" };
    }
    // 5xx: safe to retry because the idempotency key makes a repeat of an accepted request return the original result.
    if (status >= 500 && status <= 599) return { kind: "retryable", code: `resend_${status}` };
    if (status >= 400 && status <= 499) return { kind: "rejected", code: `resend_${status}${errorName ? `_${errorName}` : ""}` };
    return { kind: "unknown", code: `resend_${status}` };
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Webhook (Svix signatures, https://docs.svix.com/receiving/verifying-payloads/how-manual)
// ---------------------------------------------------------------------------------------------------------------------

export const MAX_RESEND_WEBHOOK_BYTES = 256 * 1024;
/** Replay window: a delivery whose timestamp differs from now by more than this is refused (both directions). */
export const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;
const SECRET_PREFIX = "whsec_";
const MIN_SECRET_BYTES = 16;
const OUTBOX_ID = /^[A-Za-z0-9_-]{1,300}$/;

function header(headers: Readonly<Record<string, string | string[] | undefined>>, name: string): string | undefined {
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name) return Array.isArray(value) ? value[0] : value;
  }
  return undefined;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function date(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** `Name <a@b.c>` -> `a@b.c`. */
function bareAddress(value: string): string {
  const match = /<([^<>]+)>\s*$/.exec(value);
  return (match?.[1] ?? value).trim();
}

function normalize(raw: unknown): DeliveryEvent | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const event = raw as Record<string, unknown>;
  const dataRaw = event["data"];
  const data = typeof dataRaw === "object" && dataRaw !== null && !Array.isArray(dataRaw) ? dataRaw as Record<string, unknown> : {};
  let type: DeliveryEvent["type"] = "other";
  switch (event["type"]) {
    case "email.bounced": {
      const bounce = data["bounce"];
      const bounceType = typeof bounce === "object" && bounce !== null ? (bounce as Record<string, unknown>)["type"] : undefined;
      // Permanent means the address is bad. Transient, Temporary and Undetermined are not proof: keep sending allowed.
      type = bounceType === "Permanent" ? "hard_bounce" : "soft_bounce";
      break;
    }
    case "email.complained": type = "complaint"; break;
    case "email.delivery_delayed": type = "soft_bounce"; break;
    case "email.delivered": type = "delivered"; break;
    default: break;
  }
  const to = data["to"];
  const first = Array.isArray(to) ? str(to[0]) : str(to);
  const tags = data["tags"];
  const tagId = typeof tags === "object" && tags !== null ? (tags as Record<string, unknown>)["outbox_id"] : undefined;
  return {
    type,
    email: first === null ? null : bareAddress(first),
    outboxId: typeof tagId === "string" && OUTBOX_ID.test(tagId) ? tagId : null,
    providerMessageId: str(data["email_id"]),
    occurredAt: date(event["created_at"]),
  };
}

/**
 * Resend signs webhooks with Svix: HMAC-SHA256 over `${svix-id}.${svix-timestamp}.${rawBody}` keyed with the base64
 * bytes of the `whsec_` secret; `svix-signature` holds one or more space-separated `v1,<base64>` values.
 */
export class ResendWebhookVerifier implements EmailWebhookVerifier {
  private readonly key: Buffer | null;

  constructor(secret: string, private readonly now: () => Date = () => new Date()) {
    // An unset or malformed secret must never turn into "any caller is authenticated".
    const key = secret.startsWith(SECRET_PREFIX) ? Buffer.from(secret.slice(SECRET_PREFIX.length), "base64") : null;
    this.key = key !== null && key.length >= MIN_SECRET_BYTES ? key : null;
  }

  parse(headers: Readonly<Record<string, string | string[] | undefined>>, rawBody: Buffer): WebhookParseResult {
    const denied: WebhookParseResult = { ok: false, status: 401, reason: "unauthorized" };
    if (this.key === null) return denied;
    const id = header(headers, "svix-id");
    const timestamp = header(headers, "svix-timestamp");
    const signatures = header(headers, "svix-signature");
    if (!id || !timestamp || !signatures || id.length > 256 || !/^\d{1,12}$/.test(timestamp)) return denied;
    if (rawBody.length > MAX_RESEND_WEBHOOK_BYTES) return { ok: false, status: 400, reason: "malformed" };
    const seconds = Number(timestamp);
    if (Math.abs(Math.floor(this.now().getTime() / 1000) - seconds) > WEBHOOK_TOLERANCE_SECONDS) return denied;

    const expected = createHmac("sha256", this.key).update(`${id}.${timestamp}.`).update(rawBody).digest();
    let matched = false;
    // Evaluate every candidate (no early exit) so timing does not reveal which one matched.
    for (const candidate of signatures.split(" ").slice(0, 10)) {
      const [version, value] = candidate.split(",");
      if (version !== "v1" || value === undefined) continue;
      const decoded = Buffer.from(value, "base64");
      if (decoded.length === expected.length && timingSafeEqual(decoded, expected)) matched = true;
    }
    if (!matched) return denied;

    let parsed: unknown;
    try { parsed = JSON.parse(rawBody.toString("utf8")); } catch { return { ok: false, status: 400, reason: "malformed" }; }
    const event = normalize(parsed);
    if (event === null) return { ok: false, status: 400, reason: "malformed" };
    return { ok: true, events: [event] };
  }
}
