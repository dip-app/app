import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { handleWebhook, processDeliveryEvents, type WebhookDeps } from "../../functions/src/modules/email/application/webhook";
import type { DeliveryEvent, EmailWebhookVerifier, WebhookParseResult } from "../../functions/src/modules/email/application/ports";
import type { EmailCategory } from "../../functions/src/modules/email/domain/categories";
import { EMAIL_CATEGORIES } from "../../functions/src/modules/email/domain/categories";
import { emailHash } from "../../functions/src/modules/email/domain/outbox";

const NOW = new Date("2026-11-17T12:00:00Z");

function setup(opts: { outboxUid?: string | null; uidsByEmail?: string[]; failSuppress?: boolean } = {}) {
  const suppressed: Array<{ hash: string; reason: string }> = [];
  const disabled: Array<{ uid: string; categories: EmailCategory[] }> = [];
  const touched: string[] = [];
  const deps: WebhookDeps = {
    clock: { now: () => NOW },
    suppressions: {
      async isSuppressed() { return false; },
      async suppress(hash, reason) {
        touched.push("suppress");
        if (opts.failSuppress) throw new Error("boom to-secret@example.com");
        suppressed.push({ hash, reason });
      },
    },
    preferences: {
      async getEmailMap() { return null; },
      async disable(uid, categories) { touched.push("disable"); disabled.push({ uid, categories: [...categories] }); return true; },
    },
    outbox: {
      async create() { return true; },
      async claim() { return { kind: "missing" } as const; },
      async finish() {},
      async get(id) { touched.push("outbox"); return opts.outboxUid ? ({ id, uid: opts.outboxUid } as never) : null; },
    },
    recipients: {
      async get() { return null; },
      async uidsByEmail() { touched.push("recipients"); return opts.uidsByEmail ?? []; },
    },
  };
  return { deps, suppressed, disabled, touched };
}
const ev = (type: DeliveryEvent["type"], email: string | null = "Person@Example.com", outboxId: string | null = null): DeliveryEvent =>
  ({ type, email, outboxId, providerMessageId: "m1", occurredAt: NOW });

describe("processDeliveryEvents", () => {
  test("hard bounce suppresses by normalized hash", async () => {
    const { deps, suppressed, disabled } = setup();
    const counts = await processDeliveryEvents(deps, [ev("hard_bounce")]);
    assert.deepEqual(counts, { suppressed: 1, optedOut: 0, ignored: 0 });
    assert.deepEqual(suppressed, [{ hash: emailHash("person@example.com"), reason: "hard_bounce" }]);
    assert.equal(disabled.length, 0);
  });
  test("complaint suppresses and disables all categories via the outbox uid", async () => {
    const { deps, suppressed, disabled, touched } = setup({ outboxUid: "u1", uidsByEmail: ["other"] });
    const counts = await processDeliveryEvents(deps, [ev("complaint", "a@b.co", "ob1")]);
    assert.deepEqual(counts, { suppressed: 1, optedOut: 1, ignored: 0 });
    assert.equal(suppressed[0]!.reason, "complaint");
    assert.deepEqual(disabled, [{ uid: "u1", categories: [...EMAIL_CATEGORIES] }]);
    assert.ok(!touched.includes("recipients"));
  });
  test("complaint falls back to uidsByEmail (capped at 5)", async () => {
    const { deps, disabled } = setup({ outboxUid: null, uidsByEmail: ["a", "b", "c", "d", "e", "f", "g"] });
    const counts = await processDeliveryEvents(deps, [ev("complaint", "a@b.co", "missing")]);
    assert.equal(counts.optedOut, 5);
    assert.deepEqual(disabled.map((d) => d.uid), ["a", "b", "c", "d", "e"]);
  });
  test("provider unsubscribe suppresses without touching preferences", async () => {
    const { deps, suppressed, disabled } = setup();
    await processDeliveryEvents(deps, [ev("provider_unsubscribe")]);
    assert.equal(suppressed[0]!.reason, "provider_unsubscribe");
    assert.equal(disabled.length, 0);
  });
  test("soft bounce, delivered, other and missing email are ignored", async () => {
    const { deps, touched } = setup();
    const counts = await processDeliveryEvents(deps, [ev("soft_bounce"), ev("delivered"), ev("other"), ev("hard_bounce", null), ev("complaint", "  ")]);
    assert.deepEqual(counts, { suppressed: 0, optedOut: 0, ignored: 5 });
    assert.equal(touched.length, 0);
  });
  test("batches are capped at 500 events", async () => {
    const { deps, suppressed } = setup();
    const counts = await processDeliveryEvents(deps, Array.from({ length: 600 }, () => ev("hard_bounce")));
    assert.equal(suppressed.length, 500);
    assert.equal(counts.suppressed, 500);
    assert.equal(counts.ignored, 100);
  });
});

describe("handleWebhook", () => {
  const verifier = (result: WebhookParseResult): EmailWebhookVerifier => ({ parse: () => result });
  const post = { method: "POST", headers: {}, rawBody: Buffer.from("{}") };

  test("401 from the verifier touches no store", async () => {
    const { deps, touched } = setup();
    const res = await handleWebhook(verifier({ ok: false, status: 401, reason: "unauthorized" }), deps, post);
    assert.equal(res.status, 401);
    assert.equal(touched.length, 0);
  });
  test("400 for malformed payloads", async () => {
    const res = await handleWebhook(verifier({ ok: false, status: 400, reason: "malformed" }), setup().deps, post);
    assert.equal(res.status, 400);
  });
  test("GET returns 405 and never calls the verifier", async () => {
    let called = false;
    const v: EmailWebhookVerifier = { parse: () => { called = true; return { ok: true, events: [] }; } };
    const res = await handleWebhook(v, setup().deps, { ...post, method: "GET" });
    assert.equal(res.status, 405);
    assert.equal(called, false);
  });
  test("valid events return 200 ok", async () => {
    const { deps, suppressed } = setup();
    const res = await handleWebhook(verifier({ ok: true, events: [ev("hard_bounce")] }), deps, post);
    assert.deepEqual(res, { status: 200, body: "ok" });
    assert.equal(suppressed.length, 1);
  });
  test("processing error returns 500 without leaking details", async () => {
    const res = await handleWebhook(verifier({ ok: true, events: [ev("hard_bounce")] }), setup({ failSuppress: true }).deps, post);
    assert.equal(res.status, 500);
    assert.ok(!res.body.includes("example.com"));
  });
});
