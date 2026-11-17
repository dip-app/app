import { strict as assert } from "node:assert";
import { createHmac } from "node:crypto";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, afterEach, before, describe, test } from "node:test";
import type { OutgoingEmail } from "../../functions/src/modules/email/application/ports";
import { ResendProvider, ResendWebhookVerifier, resendTagValue } from "../../functions/src/modules/email/infrastructure/resendProvider";

const API_KEY = "re_test_key_123";
const message: OutgoingEmail = {
  to: "jane@example.com", subject: "Hi", html: "<p>x</p>", text: "x",
  headers: { "List-Unsubscribe": "<https://letsdip.work/u/t>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  attachments: [{ filename: "e.ics", contentType: "text/calendar; method=REQUEST", content: "BEGIN:VCALENDAR" }],
  stream: "notifications", metadata: { outboxId: "invites_e1_u1_r1" }, tag: "invite_received",
};

// ---- local fake of POST /emails ----------------------------------------------------------------------------------------
interface Seen { method: string; url: string; headers: IncomingHttpHeaders; body: Record<string, unknown> }
let seen: Seen[] = [];
let respond: (n: number) => { status: number; body: unknown } = () => ({ status: 200, body: { id: "re-msg-1" } });
let server: Server;
let endpoint = "";

before(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      seen.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") });
      const r = respond(seen.length);
      res.writeHead(r.status, { "Content-Type": "application/json" });
      res.end(typeof r.body === "string" ? r.body : JSON.stringify(r.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/emails`;
});
after(() => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); }));
afterEach(() => { seen = []; respond = () => ({ status: 200, body: { id: "re-msg-1" } }); });

const provider = (extra: Partial<ConstructorParameters<typeof ResendProvider>[0]> = {}) => new ResendProvider({ apiKey: API_KEY, endpoint, ...extra });

describe("ResendProvider request", () => {
  test("success: body shape, auth, idempotency key, headers, tags, attachment", async () => {
    assert.deepEqual(await provider().send(message), { kind: "sent", providerMessageId: "re-msg-1" });
    assert.equal(seen.length, 1);
    const s = seen[0]!;
    assert.equal(s.method, "POST");
    assert.equal(s.headers["authorization"], `Bearer ${API_KEY}`);
    assert.equal(s.headers["idempotency-key"], "invites_e1_u1_r1");
    assert.equal(s.headers["content-type"], "application/json");
    assert.equal(s.body["from"], "DIP <notify@letsdip.work>");
    assert.equal(s.body["reply_to"], "support@letsdip.work");
    assert.deepEqual(s.body["to"], ["jane@example.com"]);
    assert.equal(s.body["subject"], "Hi");
    assert.equal(s.body["html"], "<p>x</p>");
    assert.equal(s.body["text"], "x");
    assert.deepEqual(s.body["headers"], message.headers);
    assert.deepEqual(s.body["tags"], [{ name: "template", value: "invite_received" }, { name: "outbox_id", value: "invites_e1_u1_r1" }]);
    assert.deepEqual(s.body["attachments"], [{ filename: "e.ics", content: Buffer.from("BEGIN:VCALENDAR").toString("base64"), content_type: "text/calendar; method=REQUEST" }]);
    assert.equal(JSON.stringify(s.body).includes(API_KEY), false);
  });

  test("no attachment sends an empty list; the same outbox id is reused on a retry", async () => {
    await provider().send({ ...message, attachments: [] });
    await provider().send({ ...message, attachments: [] });
    assert.deepEqual(seen[0]!.body["attachments"], []);
    assert.equal(seen[0]!.headers["idempotency-key"], seen[1]!.headers["idempotency-key"]);
  });

  test("tag values are restricted to letters, digits, underscore and dash", () => {
    assert.equal(resendTagValue("event.updated v2"), "event_updated_v2");
    assert.equal(resendTagValue(""), "none");
    assert.equal(resendTagValue("a".repeat(400)).length, 256);
  });

  test("an over-long outbox id is rejected before any request", async () => {
    const out = await provider().send({ ...message, metadata: { outboxId: "x".repeat(257) } });
    assert.deepEqual(out, { kind: "rejected", code: "resend_bad_idempotency_key" });
    assert.equal(seen.length, 0);
  });
});

describe("ResendProvider error classification", () => {
  const cases: Array<[string, number, unknown, unknown]> = [
    ["429 rate limit retries", 429, { statusCode: 429, name: "rate_limit_exceeded", message: "slow down" }, { kind: "retryable", code: "resend_429_rate_limit_exceeded" }],
    ["429 daily quota retries", 429, { name: "daily_quota_exceeded" }, { kind: "retryable", code: "resend_429_daily_quota_exceeded" }],
    ["429 without a body retries", 429, "", { kind: "retryable", code: "resend_429_rate_limit" }],
    ["500 retries", 500, { name: "application_error" }, { kind: "retryable", code: "resend_500" }],
    ["503 retries", 503, { name: "service_unavailable" }, { kind: "retryable", code: "resend_503" }],
    ["502 html body retries", 502, "<html>", { kind: "retryable", code: "resend_502" }],
    ["400 validation is permanent", 400, { name: "validation_error" }, { kind: "rejected", code: "resend_400_validation_error" }],
    ["401 bad key is permanent", 401, { name: "missing_api_key" }, { kind: "rejected", code: "resend_401_missing_api_key" }],
    ["403 unverified domain is permanent", 403, { name: "validation_error" }, { kind: "rejected", code: "resend_403_validation_error" }],
    ["422 is permanent", 422, { name: "missing_required_field" }, { kind: "rejected", code: "resend_422_missing_required_field" }],
    ["409 in progress retries", 409, { name: "concurrent_idempotent_requests" }, { kind: "retryable", code: "resend_409_concurrent" }],
    ["409 body mismatch is unknown", 409, { name: "invalid_idempotent_request" }, { kind: "unknown", code: "resend_409_idempotency_mismatch" }],
    ["200 without id is unknown", 200, {}, { kind: "unknown", code: "missing_message_id" }],
    ["unexpected 3xx is unknown", 302, {}, { kind: "unknown", code: "resend_302" }],
  ];
  for (const [name, status, body, expected] of cases) {
    test(name, async () => {
      respond = () => ({ status, body });
      assert.deepEqual(await provider().send(message), expected);
    });
  }

  test("a hostile error name is not copied into the code", async () => {
    respond = () => ({ status: 400, body: { name: "<script>alert(1)</script>" } });
    assert.deepEqual(await provider().send(message), { kind: "rejected", code: "resend_400" });
  });

  test("connection refused before sending retries", async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(closed.address() as AddressInfo).port}/emails`;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    assert.deepEqual(await provider({ endpoint: url }).send(message), { kind: "retryable", code: "network_econnrefused" });
  });

  test("timeout is unknown (at most once)", async () => {
    const f = ((_u: string, init: RequestInit) => new Promise((_r, reject) => {
      init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("t"), { name: "TimeoutError" })));
    })) as unknown as typeof fetch;
    assert.deepEqual(await provider({ fetchImpl: f, timeoutMs: 20 }).send(message), { kind: "unknown", code: "timeout" });
  });

  test("a reset connection is unknown", async () => {
    const f = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    assert.deepEqual(await provider({ fetchImpl: f }).send(message), { kind: "unknown", code: "network_error" });
  });
});

// ---- webhook -----------------------------------------------------------------------------------------------------------
const SECRET_BYTES = Buffer.from("0123456789abcdef0123456789abcdef");
const SECRET = `whsec_${SECRET_BYTES.toString("base64")}`;
const NOW = new Date("2026-11-20T12:00:00Z");
const nowSeconds = Math.floor(NOW.getTime() / 1000);

function sign(id: string, timestamp: string, body: string, key: Buffer = SECRET_BYTES): string {
  return `v1,${createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64")}`;
}
function signed(payload: unknown, opts: { timestamp?: number; id?: string; key?: Buffer; extra?: string } = {}) {
  const body = JSON.stringify(payload);
  const id = opts.id ?? "msg_abc";
  const ts = String(opts.timestamp ?? nowSeconds);
  const sig = sign(id, ts, body, opts.key);
  return { headers: { "svix-id": id, "svix-timestamp": ts, "svix-signature": opts.extra ? `${opts.extra} ${sig}` : sig }, raw: Buffer.from(body) };
}
const verifier = () => new ResendWebhookVerifier(SECRET, () => NOW);
const event = (type: string, data: Record<string, unknown> = {}) => ({
  type, created_at: "2026-11-20T11:59:59.000Z",
  data: { email_id: "re-msg-1", from: "DIP <notify@letsdip.work>", to: ["Jane <jane@example.com>"], tags: { template: "invite_received", outbox_id: "invites_e1_u1_r1" }, ...data },
});

describe("ResendWebhookVerifier signature", () => {
  test("matches the Svix documentation test vector", () => {
    const secret = "whsec_plJ3nmyCDGBKInavdOK15jsl";
    const key = Buffer.from(secret.slice(6), "base64");
    assert.equal(sign("msg_loFOjxBNrRLzqYUf", "1731705121", '{"event_type":"ping","data":{"success":true}}', key), "v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0=");
  });

  test("valid signature is accepted and normalized", () => {
    const { headers, raw } = signed(event("email.delivered"));
    const out = verifier().parse(headers, raw);
    assert.equal(out.ok, true);
    if (out.ok) {
      assert.deepEqual(out.events, [{
        type: "delivered", email: "jane@example.com", outboxId: "invites_e1_u1_r1", providerMessageId: "re-msg-1",
        occurredAt: new Date("2026-11-20T11:59:59.000Z"),
      }]);
    }
  });

  test("header names are case-insensitive and a rotated secret (two signatures) still verifies", () => {
    const { headers, raw } = signed(event("email.delivered"), { extra: "v1,AAAA" });
    const upper = { "Svix-Id": headers["svix-id"], "Svix-Timestamp": headers["svix-timestamp"], "Svix-Signature": headers["svix-signature"] };
    assert.equal(verifier().parse(upper, raw).ok, true);
  });

  test("invalid signatures are 401", () => {
    const { headers, raw } = signed(event("email.delivered"));
    for (const bad of [
      { ...headers, "svix-signature": sign("msg_abc", headers["svix-timestamp"], "{}", SECRET_BYTES) },
      { ...headers, "svix-signature": "v1,AAAA" },
      { ...headers, "svix-signature": "v2," + headers["svix-signature"].slice(3) },
      { ...headers, "svix-signature": "" },
      { ...headers, "svix-id": "msg_other" },
      { ...headers, "svix-timestamp": String(nowSeconds + 1) },
    ]) assert.deepEqual(verifier().parse(bad, raw), { ok: false, status: 401, reason: "unauthorized" });
  });

  test("a tampered body is 401", () => {
    const { headers } = signed(event("email.delivered"));
    assert.equal(verifier().parse(headers, Buffer.from(JSON.stringify(event("email.complained")))).ok, false);
  });

  test("signed with another secret is 401", () => {
    const { headers, raw } = signed(event("email.delivered"), { key: Buffer.from("another-secret-another-secret-00") });
    assert.equal(verifier().parse(headers, raw).ok, false);
  });

  test("missing headers are 401", () => {
    const { raw } = signed(event("email.delivered"));
    assert.deepEqual(verifier().parse({}, raw), { ok: false, status: 401, reason: "unauthorized" });
  });

  test("expired and replayed (old) deliveries are 401, the window is five minutes both ways", () => {
    for (const offset of [-301, 301, -86_400]) {
      const { headers, raw } = signed(event("email.complained"), { timestamp: nowSeconds + offset });
      assert.deepEqual(verifier().parse(headers, raw), { ok: false, status: 401, reason: "unauthorized" }, `offset ${offset}`);
    }
    for (const offset of [-300, 0, 300]) {
      const { headers, raw } = signed(event("email.complained"), { timestamp: nowSeconds + offset });
      assert.equal(verifier().parse(headers, raw).ok, true, `offset ${offset}`);
    }
  });

  test("a non-numeric timestamp is 401", () => {
    const body = JSON.stringify(event("email.delivered"));
    const headers = { "svix-id": "m", "svix-timestamp": "abc", "svix-signature": sign("m", "abc", body) };
    assert.equal(verifier().parse(headers, Buffer.from(body)).ok, false);
  });

  test("unset or malformed secrets never authenticate", () => {
    const { headers, raw } = signed(event("email.delivered"));
    for (const secret of ["", "whsec_", "whsec_AAAA", SECRET.replace("whsec_", ""), "placeholder"]) {
      assert.deepEqual(new ResendWebhookVerifier(secret, () => NOW).parse(headers, raw), { ok: false, status: 401, reason: "unauthorized" }, secret);
    }
    // Signed with an empty key must not pass against an empty secret either.
    const forged = signed(event("email.delivered"), { key: Buffer.alloc(0) });
    assert.equal(new ResendWebhookVerifier("", () => NOW).parse(forged.headers, forged.raw).ok, false);
  });

  test("oversized and malformed signed bodies are 400", () => {
    const big = Buffer.alloc(300 * 1024, 97);
    const t = String(nowSeconds);
    assert.deepEqual(verifier().parse({ "svix-id": "m", "svix-timestamp": t, "svix-signature": sign("m", t, big.toString()) }, big), { ok: false, status: 400, reason: "malformed" });
    const bad = "not json";
    assert.deepEqual(verifier().parse({ "svix-id": "m", "svix-timestamp": t, "svix-signature": sign("m", t, bad) }, Buffer.from(bad)), { ok: false, status: 400, reason: "malformed" });
    const arr = "[1]";
    assert.deepEqual(verifier().parse({ "svix-id": "m", "svix-timestamp": t, "svix-signature": sign("m", t, arr) }, Buffer.from(arr)), { ok: false, status: 400, reason: "malformed" });
  });
});

describe("ResendWebhookVerifier event mapping", () => {
  const typeOf = (payload: unknown) => {
    const { headers, raw } = signed(payload);
    const out = verifier().parse(headers, raw);
    assert.equal(out.ok, true);
    return out.ok ? out.events[0]!.type : null;
  };

  test("bounce and complaint mapping", () => {
    assert.equal(typeOf(event("email.bounced", { bounce: { type: "Permanent", subType: "General", message: "x" } })), "hard_bounce");
    assert.equal(typeOf(event("email.bounced", { bounce: { type: "Permanent", subType: "Suppressed" } })), "hard_bounce");
    assert.equal(typeOf(event("email.bounced", { bounce: { type: "Transient", subType: "MailboxFull" } })), "soft_bounce");
    assert.equal(typeOf(event("email.bounced", { bounce: { type: "Undetermined" } })), "soft_bounce");
    assert.equal(typeOf(event("email.bounced")), "soft_bounce");
    assert.equal(typeOf(event("email.complained")), "complaint");
    assert.equal(typeOf(event("email.delivery_delayed")), "soft_bounce");
    assert.equal(typeOf(event("email.delivered")), "delivered");
    assert.equal(typeOf(event("email.opened")), "other");
    assert.equal(typeOf(event("email.sent")), "other");
  });

  test("outbox id comes from the tag and must be well formed", () => {
    const { headers, raw } = signed(event("email.complained", { tags: { outbox_id: "../evil id" } }));
    const out = verifier().parse(headers, raw);
    assert.equal(out.ok && out.events[0]!.outboxId, null);
  });

  test("a missing recipient yields a null address", () => {
    const { headers, raw } = signed(event("email.complained", { to: [] }));
    const out = verifier().parse(headers, raw);
    assert.equal(out.ok && out.events[0]!.email, null);
  });
});
