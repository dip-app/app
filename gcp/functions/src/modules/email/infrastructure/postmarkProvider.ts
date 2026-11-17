import { createHash, timingSafeEqual } from "node:crypto";
import type {
  DeliveryEvent, EmailProviderPort, EmailWebhookVerifier, OutgoingEmail, SendOutcome, WebhookParseResult,
} from "../application/ports";

const ENDPOINT = "https://api.postmarkapp.com/email";
const DEFAULT_FROM = "DIP <notify@letsdip.work>";
const REPLY_TO = "support@letsdip.work";
const DEFAULT_TIMEOUT_MS = 10_000;
/** Errors that prove nothing was written to the provider. */
const PRE_SEND_CODES = new Set(["ENOTFOUND", "ECONNREFUSED", "EAI_AGAIN"]);

export interface PostmarkOptions {
  /** Server token. Secret: only ever placed in the request header, never logged or returned. */
  serverToken: string;
  from?: string;
  /** Maps our logical stream to a Postmark message stream id. */
  streams?: Partial<Record<OutgoingEmail["stream"], string>>;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

function causeCode(error: unknown): string | null {
  const cause = (error as { cause?: { code?: unknown } } | null)?.cause;
  return typeof cause?.code === "string" ? cause.code : null;
}

export class PostmarkProvider implements EmailProviderPort {
  readonly name = "postmark";
  private readonly from: string;
  private readonly streams: Record<string, string>;
  private readonly timeoutMs: number;

  constructor(private readonly options: PostmarkOptions) {
    this.from = options.from ?? DEFAULT_FROM;
    this.streams = { notifications: "notifications", ...(options.streams ?? {}) } as Record<string, string>;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async send(message: OutgoingEmail): Promise<SendOutcome> {
    const body = {
      From: this.from,
      ReplyTo: REPLY_TO,
      To: message.to,
      Subject: message.subject,
      HtmlBody: message.html,
      TextBody: message.text,
      Headers: Object.entries(message.headers).map(([Name, Value]) => ({ Name, Value })),
      Attachments: message.attachments.map((a) => ({
        Name: a.filename, Content: Buffer.from(a.content, "utf8").toString("base64"), ContentType: a.contentType,
      })),
      MessageStream: this.streams[message.stream] ?? "notifications",
      Metadata: { outboxId: message.metadata.outboxId },
      Tag: message.tag,
      TrackOpens: false,
      TrackLinks: "None",
    };
    let response: Response;
    try {
      response = await (this.options.fetchImpl ?? fetch)(ENDPOINT, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json", "X-Postmark-Server-Token": this.options.serverToken },
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
    let payload: { ErrorCode?: unknown; MessageID?: unknown } = {};
    try { payload = (await response.json()) as typeof payload; } catch { /* body unreadable: judged by status only */ }
    const errorCode = typeof payload.ErrorCode === "number" ? payload.ErrorCode : null;

    if (status === 200 && errorCode === 0) {
      return typeof payload.MessageID === "string" && payload.MessageID.length > 0
        ? { kind: "sent", providerMessageId: payload.MessageID }
        : { kind: "unknown", code: "missing_message_id" };
    }
    if (status === 429 || status === 503) return { kind: "retryable", code: `http_${status}` };
    if (errorCode === 406) return { kind: "rejected", code: "pm_406_inactive", suppress: true };
    if (errorCode === 300) return { kind: "rejected", code: "pm_300_invalid_email", suppress: true };
    if (status === 422) return { kind: "rejected", code: `pm_${errorCode ?? "422"}` };
    if (status >= 500) return { kind: "unknown", code: `http_${status}` };
    if (status === 200) return { kind: "unknown", code: `pm_${errorCode ?? "unexpected"}` };
    return { kind: "rejected", code: `http_${status}` };
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------------------------------------------------

export const MAX_WEBHOOK_BYTES = 256 * 1024;
export const MIN_WEBHOOK_PASSWORD = 24;
const OUTBOX_ID = /^[A-Za-z0-9_-]{1,300}$/;
const HARD = new Set(["HardBounce", "BadEmailAddress", "ManuallyDeactivated"]);
const SOFT = new Set(["SoftBounce", "Transient", "DnsError"]);

function sha(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

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

function bounceType(type: unknown): DeliveryEvent["type"] {
  if (typeof type !== "string") return "other";
  if (HARD.has(type)) return "hard_bounce";
  if (type === "SpamNotification") return "complaint";
  if (SOFT.has(type)) return "soft_bounce";
  return "other";
}

function normalize(raw: unknown): DeliveryEvent | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const item = raw as Record<string, unknown>;
  let type: DeliveryEvent["type"] = "other";
  let when: unknown;
  switch (item["RecordType"]) {
    case "Bounce": type = bounceType(item["Type"]); when = item["BouncedAt"]; break;
    case "SpamComplaint": type = "complaint"; when = item["BouncedAt"]; break;
    case "SubscriptionChange": type = item["SuppressSending"] === true ? "provider_unsubscribe" : "other"; when = item["ChangedAt"]; break;
    case "Delivery": type = "delivered"; when = item["DeliveredAt"]; break;
    default: break;
  }
  const meta = item["Metadata"];
  const metaId = typeof meta === "object" && meta !== null ? (meta as Record<string, unknown>)["outboxId"] : undefined;
  return {
    type,
    email: str(item["Email"]) ?? str(item["Recipient"]),
    outboxId: typeof metaId === "string" && OUTBOX_ID.test(metaId) ? metaId : null,
    providerMessageId: str(item["MessageID"]),
    occurredAt: date(when),
  };
}

/** Postmark webhooks are authenticated with HTTP Basic credentials embedded in the configured webhook URL. */
export class PostmarkWebhookVerifier implements EmailWebhookVerifier {
  constructor(private readonly username: string, private readonly password: string) {}

  parse(headers: Readonly<Record<string, string | string[] | undefined>>, rawBody: Buffer): WebhookParseResult {
    // An unset or weak secret must never turn into "any caller with an empty password is authenticated".
    if (this.username.length === 0 || this.password.length < MIN_WEBHOOK_PASSWORD) return { ok: false, status: 401, reason: "unauthorized" };
    const auth = header(headers, "authorization") ?? "";
    const expected = sha(`Basic ${Buffer.from(`${this.username}:${this.password}`, "utf8").toString("base64")}`);
    if (!timingSafeEqual(sha(auth), expected)) return { ok: false, status: 401, reason: "unauthorized" };
    if (rawBody.length > MAX_WEBHOOK_BYTES) return { ok: false, status: 400, reason: "malformed" };
    let parsed: unknown;
    try { parsed = JSON.parse(rawBody.toString("utf8")); } catch { return { ok: false, status: 400, reason: "malformed" }; }
    const items = Array.isArray(parsed) ? parsed : [parsed];
    const events: DeliveryEvent[] = [];
    let malformed = 0;
    for (const item of items) {
      const event = normalize(item);
      if (event === null) { malformed++; continue; } // one bad item must not reject the rest of the batch
      events.push(event);
    }
    if (events.length === 0 && malformed > 0) return { ok: false, status: 400, reason: "malformed" };
    return { ok: true, events, ...(malformed > 0 ? { malformed } : {}) };
  }
}
