import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import type { OutgoingEmail } from "../../functions/src/modules/email/application/ports";
import { MAX_WEBHOOK_BYTES, PostmarkProvider, PostmarkWebhookVerifier } from "../../functions/src/modules/email/infrastructure/postmarkProvider";

const TOKEN = "secret-server-token-123";
const message: OutgoingEmail = {
  to: "jane@example.com", subject: "Hi", html: "<p>x</p>", text: "x",
  headers: { "List-Unsubscribe": "<https://letsdip.work/u/t>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  attachments: [{ filename: "e.ics", contentType: "text/calendar", content: "BEGIN:VCALENDAR" }],
  stream: "notifications", metadata: { outboxId: "invites_e1_u1_r1" }, tag: "invite_received",
};

function provider(fetchImpl: typeof fetch, extra: Partial<ConstructorParameters<typeof PostmarkProvider>[0]> = {}) {
  return new PostmarkProvider({ serverToken: TOKEN, fetchImpl, ...extra });
}
const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("PostmarkProvider request", () => {
  test("body shape and headers", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const f = (async (url: string, init: RequestInit) => { seen = { url, init }; return new Response(JSON.stringify({ ErrorCode: 0, MessageID: "m-1" }), { status: 200 }); }) as unknown as typeof fetch;
    const out = await provider(f, { streams: { notifications: "dip-notify" } }).send(message);
    assert.deepEqual(out, { kind: "sent", providerMessageId: "m-1" });
    const s = seen!;
    assert.equal(s.url, "https://api.postmarkapp.com/email");
    assert.equal(s.init.method, "POST");
    const h = s.init.headers as Record<string, string>;
    assert.equal(h["X-Postmark-Server-Token"], TOKEN);
    assert.equal(h["Accept"], "application/json");
    const body = JSON.parse(s.init.body as string);
    assert.equal(body.From, "DIP <notify@letsdip.work>");
    assert.equal(body.ReplyTo, "support@letsdip.work");
    assert.equal(body.To, "jane@example.com");
    assert.equal(body.TrackOpens, false);
    assert.equal(body.TrackLinks, "None");
    assert.equal(body.MessageStream, "dip-notify");
    assert.deepEqual(body.Metadata, { outboxId: "invites_e1_u1_r1" });
    assert.equal(body.Tag, "invite_received");
    assert.deepEqual(body.Headers[0], { Name: "List-Unsubscribe", Value: "<https://letsdip.work/u/t>" });
    assert.deepEqual(body.Attachments, [{ Name: "e.ics", Content: Buffer.from("BEGIN:VCALENDAR").toString("base64"), ContentType: "text/calendar" }]);
    assert.ok(s.init.signal instanceof AbortSignal);
  });

  test("default stream is notifications", async () => {
    let body: { MessageStream: string } | null = null;
    const f = (async (_u: string, init: RequestInit) => { body = JSON.parse(init.body as string); return new Response(JSON.stringify({ ErrorCode: 0, MessageID: "m" }), { status: 200 }); }) as unknown as typeof fetch;
    await provider(f).send(message);
    assert.equal(body!.MessageStream, "notifications");
  });
});

describe("PostmarkProvider response mapping", () => {
  const cases: Array<[string, number, unknown, unknown]> = [
    ["429", 429, { ErrorCode: 0 }, { kind: "retryable", code: "http_429" }],
    ["503", 503, {}, { kind: "retryable", code: "http_503" }],
    ["406 inactive", 422, { ErrorCode: 406 }, { kind: "rejected", code: "pm_406_inactive", suppress: true }],
    ["300 invalid", 422, { ErrorCode: 300 }, { kind: "rejected", code: "pm_300_invalid_email", suppress: true }],
    ["other 422", 422, { ErrorCode: 405 }, { kind: "rejected", code: "pm_405" }],
    ["500 ambiguous", 500, {}, { kind: "unknown", code: "http_500" }],
    ["401 token", 401, { ErrorCode: 10 }, { kind: "rejected", code: "http_401" }],
    ["200 without id", 200, { ErrorCode: 0 }, { kind: "unknown", code: "missing_message_id" }],
  ];
  for (const [name, status, body, expected] of cases) {
    test(name, async () => assert.deepEqual(await provider(reply(status, body)).send(message), expected));
  }

  test("unparseable body is judged by status", async () => {
    const f = (async () => new Response("<html>", { status: 502 })) as unknown as typeof fetch;
    assert.deepEqual(await provider(f).send(message), { kind: "unknown", code: "http_502" });
  });

  test("DNS failure and refused connection are retryable", async () => {
    for (const code of ["ENOTFOUND", "ECONNREFUSED"]) {
      const f = (async () => { throw new TypeError("fetch failed", { cause: { code } }); }) as unknown as typeof fetch;
      assert.deepEqual(await provider(f).send(message), { kind: "retryable", code: `network_${code.toLowerCase()}` });
    }
  });

  test("timeout and reset are unknown, and never leak the token", async () => {
    const timeout = (async () => { throw new DOMException("t", "TimeoutError"); }) as unknown as typeof fetch;
    assert.deepEqual(await provider(timeout).send(message), { kind: "unknown", code: "timeout" });
    const reset = (async () => { throw new TypeError(`fetch failed ${TOKEN}`, { cause: { code: "ECONNRESET" } }); }) as unknown as typeof fetch;
    const out = await provider(reset).send(message);
    assert.deepEqual(out, { kind: "unknown", code: "network_error" });
    assert.ok(!JSON.stringify(out).includes(TOKEN));
    assert.ok(!JSON.stringify(out).includes("example.com"));
  });

  test("real timeout aborts a hanging request", async () => {
    const hang = ((_u: string, init: RequestInit) => new Promise((_res, rej) => {
      init.signal!.addEventListener("abort", () => rej(init.signal!.reason));
    })) as unknown as typeof fetch;
    assert.deepEqual(await provider(hang, { timeoutMs: 20 }).send(message), { kind: "unknown", code: "timeout" });
  });
});

describe("PostmarkWebhookVerifier", () => {
  const v = new PostmarkWebhookVerifier("hook", "pa:ss");
  const auth = { authorization: `Basic ${Buffer.from("hook:pa:ss").toString("base64")}` };
  const body = (value: unknown) => Buffer.from(JSON.stringify(value));

  test("auth failures are 401", () => {
    for (const headers of [{}, { authorization: "Basic xxx" }, { authorization: `Basic ${Buffer.from("hook:wrong").toString("base64")}` }, { authorization: "" }]) {
      assert.deepEqual(v.parse(headers, body({})), { ok: false, status: 401, reason: "unauthorized" });
    }
  });

  test("header lookup is case-insensitive and accepts array", () => {
    assert.equal(v.parse({ Authorization: auth.authorization }, body({ RecordType: "Delivery" })).ok, true);
    assert.equal(v.parse({ authorization: [auth.authorization] }, body({ RecordType: "Delivery" })).ok, true);
  });

  test("oversized and malformed bodies are 400", () => {
    assert.deepEqual(v.parse(auth, Buffer.alloc(MAX_WEBHOOK_BYTES + 1, 32)), { ok: false, status: 400, reason: "malformed" });
    assert.deepEqual(v.parse(auth, Buffer.from("{nope")), { ok: false, status: 400, reason: "malformed" });
    assert.deepEqual(v.parse(auth, Buffer.from("5")), { ok: false, status: 400, reason: "malformed" });
    assert.equal(v.parse(auth, body([{}, 3])).ok, false);
  });

  function one(payload: unknown) {
    const r = v.parse(auth, body(payload));
    assert.ok(r.ok);
    return r.events[0]!;
  }

  test("record type mapping", () => {
    for (const type of ["HardBounce", "BadEmailAddress", "ManuallyDeactivated"]) assert.equal(one({ RecordType: "Bounce", Type: type, Email: "a@b.c" }).type, "hard_bounce");
    for (const type of ["SoftBounce", "Transient", "DnsError"]) assert.equal(one({ RecordType: "Bounce", Type: type }).type, "soft_bounce");
    assert.equal(one({ RecordType: "Bounce", Type: "SpamNotification" }).type, "complaint");
    assert.equal(one({ RecordType: "Bounce", Type: "AutoResponder" }).type, "other");
    assert.equal(one({ RecordType: "SpamComplaint" }).type, "complaint");
    assert.equal(one({ RecordType: "SubscriptionChange", SuppressSending: true }).type, "provider_unsubscribe");
    assert.equal(one({ RecordType: "SubscriptionChange", SuppressSending: false }).type, "other");
    assert.equal(one({ RecordType: "Delivery", Recipient: "r@x.y" }).type, "delivered");
    assert.equal(one({ RecordType: "Open" }).type, "other");
  });

  test("fields", () => {
    const e = one({ RecordType: "Bounce", Type: "HardBounce", Email: "a@b.c", MessageID: "m1", Metadata: { outboxId: "invites_e1_u1_r1" }, BouncedAt: "2030-01-01T00:00:00Z" });
    assert.equal(e.email, "a@b.c");
    assert.equal(e.providerMessageId, "m1");
    assert.equal(e.outboxId, "invites_e1_u1_r1");
    assert.equal(e.occurredAt?.toISOString(), "2030-01-01T00:00:00.000Z");
    const d = one({ RecordType: "Delivery", Recipient: "r@x.y", DeliveredAt: "2030-02-01T00:00:00Z" });
    assert.equal(d.email, "r@x.y");
    assert.equal(d.occurredAt?.toISOString(), "2030-02-01T00:00:00.000Z");
    assert.equal(one({ RecordType: "SubscriptionChange", SuppressSending: true, ChangedAt: "bad" }).occurredAt, null);
  });

  test("hostile metadata is ignored", () => {
    for (const outboxId of ["../x", "a/b", "x".repeat(301), "", 5, { a: 1 }, "a b"]) {
      assert.equal(one({ RecordType: "SpamComplaint", Metadata: { outboxId } }).outboxId, null);
    }
    assert.equal(one({ RecordType: "SpamComplaint", Metadata: "x" }).outboxId, null);
  });

  test("array payload", () => {
    const r = v.parse(auth, body([{ RecordType: "Delivery" }, { RecordType: "SpamComplaint" }]));
    assert.ok(r.ok);
    assert.deepEqual(r.events.map((e) => e.type), ["delivered", "complaint"]);
  });
});
