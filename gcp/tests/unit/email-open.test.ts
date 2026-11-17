import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { TRANSPARENT_GIF, handleOpenPixel } from "../../functions/src/modules/email/application/openPixel";
import { sendOutboxEmail, type EmailRenderer, type SendDeps } from "../../functions/src/modules/email/application/sendOutboxEmail";
import type { ClaimResult, EmailProviderPort, OutboxStore, OutgoingEmail } from "../../functions/src/modules/email/application/ports";
import { categoryOf, type OutboxDocument } from "../../functions/src/modules/email/domain/outbox";
import { MAX_OPEN_TOKEN_LENGTH, OPEN_TOKEN_TTL_SECONDS, signOpenToken, verifyOpenToken } from "../../functions/src/modules/email/domain/openToken";
import { signUnsubscribeToken, verifyUnsubscribeToken } from "../../functions/src/modules/email/domain/unsubscribeToken";

const KEY = "k".repeat(40);
const NOW = new Date("2030-01-01T12:00:00Z");
const NOW_S = Math.floor(NOW.getTime() / 1000);
const ID = "invites_evt-1_uid-1_r1";

describe("open token", () => {
  test("round trip", () => {
    const token = signOpenToken(KEY, ID, NOW_S);
    assert.deepEqual(verifyOpenToken(KEY, token, NOW_S + 10), { ok: true, outboxId: ID, expiresAt: NOW_S + OPEN_TOKEN_TTL_SECONDS });
  });
  test("tamper, wrong key, expiry, oversize, junk", () => {
    const token = signOpenToken(KEY, ID, NOW_S);
    assert.equal(verifyOpenToken(KEY, `${token.slice(0, -2)}xx`, NOW_S).ok, false);
    const sig = token.split(".")[1]!;
    const forged = Buffer.from(`v1:other_id:${NOW_S + 999}`).toString("base64url");
    assert.equal(verifyOpenToken(KEY, `${forged}.${sig}`, NOW_S).ok, false);
    assert.deepEqual(verifyOpenToken("j".repeat(40), token, NOW_S), { ok: false, reason: "bad_signature" });
    assert.deepEqual(verifyOpenToken(KEY, token, NOW_S + OPEN_TOKEN_TTL_SECONDS + 1), { ok: false, reason: "expired" });
    assert.deepEqual(verifyOpenToken(KEY, "a".repeat(MAX_OPEN_TOKEN_LENGTH + 1), NOW_S), { ok: false, reason: "malformed" });
    for (const junk of [undefined, null, 5, {}, "", ".", "a.b.c", "%%%.%%%", "..."]) assert.equal(verifyOpenToken(KEY, junk, NOW_S).ok, false);
    assert.equal(verifyOpenToken("short", token, NOW_S).ok, false); // a short key never throws
  });
  test("bad outbox ids are not signable", () => {
    assert.throws(() => signOpenToken(KEY, "has:colon", NOW_S));
    assert.throws(() => signOpenToken(KEY, "", NOW_S));
    assert.throws(() => signOpenToken(KEY, "a".repeat(301), NOW_S));
  });
  test("unsubscribe tokens are not open tokens and vice versa", () => {
    const unsub = signUnsubscribeToken(KEY, "uid-1", "invites", NOW_S);
    assert.equal(verifyOpenToken(KEY, unsub, NOW_S).ok, false);
    const open = signOpenToken(KEY, ID, NOW_S);
    assert.equal(verifyUnsubscribeToken(KEY, open, NOW_S).ok, false);
    assert.equal(verifyOpenToken(KEY, open, NOW_S).ok, true);
  });
});

function fakeOutbox(failWith?: Error) {
  const calls: Array<[string, Date]> = [];
  return { calls, store: { recordOpen: async (id: string, now: Date) => { calls.push([id, now]); if (failWith) throw failWith; return true; } } };
}

describe("handleOpenPixel", () => {
  test("the gif is 43 bytes", () => assert.equal(TRANSPARENT_GIF.length, 43));
  test("valid token counts once per request, with the pixel headers", async () => {
    const o = fakeOutbox();
    const deps = { outbox: o.store, clock: { now: () => NOW }, key: KEY };
    const path = `/o/${signOpenToken(KEY, ID, NOW_S)}.gif`;
    for (const method of ["GET", "HEAD", "get"]) {
      const r = await handleOpenPixel(deps, { method, path });
      assert.equal(r.status, 200);
      assert.equal(r.headers["Content-Type"], "image/gif");
      assert.equal(r.headers["Cache-Control"], "no-store, no-cache, must-revalidate, max-age=0");
      assert.equal(r.headers["Pragma"], "no-cache");
      assert.equal(r.headers["X-Robots-Tag"], "noindex");
      assert.equal(r.headers["Referrer-Policy"], "no-referrer");
      assert.equal(Object.keys(r.headers).some((h) => /^(set-cookie|location)$/i.test(h)), false);
    }
    assert.equal(o.calls.length, 3);
    assert.equal(o.calls[0]![0], ID);
    await handleOpenPixel(deps, { method: "GET", path: `/${signOpenToken(KEY, ID, NOW_S)}.gif` }); // bare function path
    assert.equal(o.calls.length, 4);
  });
  test("invalid tokens return identical bytes and headers and never touch the store", async () => {
    const o = fakeOutbox();
    const deps = { outbox: o.store, clock: { now: () => NOW }, key: KEY };
    const good = await handleOpenPixel(deps, { method: "GET", path: `/o/${signOpenToken(KEY, ID, NOW_S)}.gif` });
    const before = o.calls.length;
    const expired = signOpenToken(KEY, ID, NOW_S - OPEN_TOKEN_TTL_SECONDS - 10);
    for (const path of ["/o/garbage.gif", "/o/.gif", "/", "", `/o/${expired}.gif`, `/o/${"a".repeat(2000)}.gif`, `/o/${signOpenToken("j".repeat(40), ID, NOW_S)}.gif`]) {
      const r = await handleOpenPixel(deps, { method: "GET", path });
      assert.equal(r.status, 200);
      assert.deepEqual(r.headers, good.headers);
      assert.ok(r.body.equals(good.body));
    }
    assert.equal(o.calls.length, before);
  });
  test("other methods are 405 and never touch the store", async () => {
    const o = fakeOutbox();
    const deps = { outbox: o.store, clock: { now: () => NOW }, key: KEY };
    for (const method of ["POST", "PUT", "DELETE", "PATCH", ""]) {
      assert.equal((await handleOpenPixel(deps, { method, path: `/o/${signOpenToken(KEY, ID, NOW_S)}.gif` })).status, 405);
    }
    assert.equal(o.calls.length, 0);
  });
  test("a store error still returns the gif", async () => {
    const o = fakeOutbox(new Error("firestore down"));
    const r = await handleOpenPixel({ outbox: o.store, clock: { now: () => NOW }, key: KEY }, { method: "GET", path: `/o/${signOpenToken(KEY, ID, NOW_S)}.gif` });
    assert.equal(r.status, 200);
    assert.ok(r.body.equals(TRANSPARENT_GIF));
  });
});

describe("sender open pixel", () => {
  const base: EmailRenderer = {
    render: () => ({ subject: "s", preheader: "p", html: "<p>x</p>", text: "x" }),
    validate: (_t, v) => v as never,
    attachment: () => null,
  };
  async function run(openTracking: boolean) {
    const contexts: Array<{ openPixelURL?: string | null }> = [];
    const doc: OutboxDocument = {
      id: ID, uid: "u1", companyId: "c1", category: categoryOf("invite_received"), template: "invite_received",
      variables: { eventId: "e1", eventTitle: "T", startTime: "2030-01-02T18:00:00Z", endTime: "2030-01-02T19:00:00Z", inviterFirstName: "S" } as never,
      status: "sending", attempts: 1, notAfter: null, createdAt: NOW, expireAt: NOW, leaseUntil: null,
    };
    const outbox: OutboxStore = {
      create: async () => true,
      claim: async (): Promise<ClaimResult> => ({ kind: "claimed", doc }),
      finish: async () => {},
      get: async () => doc,
      recordOpen: async () => false,
    };
    const provider: EmailProviderPort = { name: "f", send: async (_m: OutgoingEmail) => ({ kind: "sent", providerMessageId: "p" }) };
    const deps: SendDeps = {
      outbox, provider,
      renderer: { ...base, render: (t, v, ctx) => { contexts.push(ctx); return base.render(t, v, ctx); } },
      recipients: { get: async () => ({ uid: "u1", companyId: "c1", email: "a@b.co", displayName: "A", status: "active" }), uidsByEmail: async () => [] },
      companies: { get: async () => ({ enabled: true, dailyCap: 10, timeZone: null }) },
      suppressions: { isSuppressed: async () => false, suppress: async () => {} },
      caps: { consume: async () => "ok" },
      preferences: { getEmailMap: async () => null, disable: async () => true },
      clock: { now: () => NOW },
      config: { enabled: true, unsubscribeKey: KEY, postalAddress: "1 Main St", defaultTimeZone: "UTC", publicOrigin: "https://letsdip.work", openTracking },
      log: () => {},
    };
    await sendOutboxEmail(deps, ID);
    return contexts[0]!;
  }
  test("pixel URL only when openTracking is true, and it verifies", async () => {
    assert.equal((await run(false)).openPixelURL, null);
    const url = (await run(true)).openPixelURL!;
    assert.match(url, /^https:\/\/letsdip\.work\/o\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.gif$/);
    const verified = verifyOpenToken(KEY, url.slice("https://letsdip.work/o/".length, -4), NOW_S);
    assert.equal(verified.ok && verified.outboxId, ID);
  });
});
