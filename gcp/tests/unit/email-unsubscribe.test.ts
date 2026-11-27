import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { createHmac } from "node:crypto";
import { handleUnsubscribe, type UnsubscribeDeps } from "../../functions/src/modules/email/application/unsubscribe";
import type { EmailPreferencesStore } from "../../functions/src/modules/email/application/ports";
import { EMAIL_CATEGORIES, type EmailCategory } from "../../functions/src/modules/email/domain/categories";
import { MAX_TOKEN_LENGTH, signUnsubscribeToken, verifyUnsubscribeToken } from "../../functions/src/modules/email/domain/unsubscribeToken";

const KEY = "k".repeat(40);
const NOW = new Date("2026-11-17T12:00:00Z");
const NOW_S = Math.floor(NOW.getTime() / 1000);
const UID = "uid_Secret-123";

function fakePrefs(exists = true) {
  const calls: Array<{ uid: string; categories: EmailCategory[] }> = [];
  const store: EmailPreferencesStore = {
    async getEmailMap() { return null; },
    async disable(uid, categories) { calls.push({ uid, categories: [...categories] }); return exists; },
  };
  return { store, calls };
}
function setup(exists = true, now = NOW) {
  const prefs = fakePrefs(exists);
  const deps: UnsubscribeDeps = { preferences: prefs.store, clock: { now: () => now }, key: KEY, publicOrigin: "https://letsdip.work" };
  return { deps, calls: prefs.calls };
}
const tok = (category: EmailCategory = "reminders", ttl?: number) => signUnsubscribeToken(KEY, UID, category, NOW_S, ttl);
const req = (method: string, token: string, body: unknown = undefined, contentType: string | undefined = undefined) =>
  ({ method, path: `/u/${token}`, body, contentType });
const FORM = "application/x-www-form-urlencoded";

describe("unsubscribe token lifetime", () => {
  test("a default-lifetime token still verifies at day 300 and expires after a year", () => {
    const token = tok("reminders");
    assert.equal(verifyUnsubscribeToken(KEY, token, NOW_S + 300 * 86400).ok, true);
    assert.equal(verifyUnsubscribeToken(KEY, token, NOW_S + 366 * 86400).ok, false);
  });
});

describe("unsubscribe token", () => {
  test("round trip", () => {
    const r = verifyUnsubscribeToken(KEY, tok("invites"), NOW_S);
    assert.ok(r.ok && r.claims.uid === UID && r.claims.category === "invites");
  });
  test("signing validates input", () => {
    assert.throws(() => signUnsubscribeToken(KEY, "bad:uid", "invites", NOW_S));
    assert.throws(() => signUnsubscribeToken(KEY, "bad.uid", "invites", NOW_S));
    assert.throws(() => signUnsubscribeToken(KEY, "", "invites", NOW_S));
    assert.throws(() => signUnsubscribeToken("short", UID, "invites", NOW_S), /too short/);
    assert.throws(() => signUnsubscribeToken(KEY, UID, "chat" as EmailCategory, NOW_S));
  });
});

describe("invalid tokens", () => {
  const good = tok();
  const [payload, sig] = good.split(".") as [string, string];
  const forge = (text: string) => {
    const p = Buffer.from(text, "utf8").toString("base64url");
    return `${p}.${createHmac("sha256", KEY).update(`dip-email-unsubscribe.${p}`, "utf8").digest("base64url")}`;
  };
  const cases: Record<string, string> = {
    tamperedPayload: `${Buffer.from(`v1:other:reminders:${NOW_S + 999}`).toString("base64url")}.${sig}`,
    tamperedSignature: `${payload}.${sig.slice(0, -2)}AA`,
    wrongKey: signUnsubscribeToken("z".repeat(40), UID, "reminders", NOW_S),
    truncated: good.slice(0, good.length - 10),
    extraDots: `${good}.extra`,
    oversized: "a".repeat(MAX_TOKEN_LENGTH + 1),
    nonBase64: "!!!.???",
    wrongVersion: forge(`v2:${UID}:reminders:${NOW_S + 100}`),
    unknownCategory: forge(`v1:${UID}:chat:${NOW_S + 100}`),
    expired: signUnsubscribeToken(KEY, UID, "reminders", NOW_S - 1000, 10),
    empty: "x",
  };
  test("all failures return 400 with an identical body for GET and POST", async () => {
    const bodies = new Set<string>();
    for (const [name, token] of Object.entries(cases)) {
      for (const method of ["GET", "POST"]) {
        const { deps, calls } = setup();
        const res = await handleUnsubscribe(deps, req(method, token, "List-Unsubscribe=One-Click", FORM));
        assert.equal(res.status, 400, `${name} ${method}`);
        assert.equal(calls.length, 0, name);
        bodies.add(res.body);
      }
    }
    assert.equal(bodies.size, 1);
    assert.match([...bodies][0]!, /invalid or has expired/);
  });
  test("expiry boundary: valid at exactly expiry, invalid one second later", async () => {
    const t = signUnsubscribeToken(KEY, UID, "reminders", NOW_S, 100);
    const at = setup(true, new Date((NOW_S + 100) * 1000));
    assert.equal((await handleUnsubscribe(at.deps, req("GET", t))).status, 200);
    const after = setup(true, new Date((NOW_S + 101) * 1000));
    assert.equal((await handleUnsubscribe(after.deps, req("GET", t))).status, 400);
  });
});

describe("GET and HEAD", () => {
  test("valid GET renders confirmation and does not change preferences", async () => {
    const { deps, calls } = setup();
    for (const method of ["GET", "HEAD"]) {
      const res = await handleUnsubscribe(deps, req(method, tok("challenges")));
      assert.equal(res.status, 200);
      assert.match(res.body, /challenge reviews/);
      assert.match(res.body, /<button class="primary" type="submit">Unsubscribe<\/button>/);
      assert.match(res.body, /name="scope" value="all"/);
      assert.match(res.body, /name="List-Unsubscribe" value="One-Click"/);
      assert.match(res.body, /lang="en"/);
    }
    assert.equal(calls.length, 0);
  });
  test("category wording", async () => {
    const words = { invites: "event invitations", event_updates: "event updates", reminders: "event reminders", challenges: "challenge reviews", discovery: "event suggestions", calendar_invites: "calendar invites", admin_suggestions: "weekly event ideas", weekly_themes: "weekly challenge announcements", admin_digest: "daily roster digests", day_before_reminders: "event reminders the day before" };
    for (const c of EMAIL_CATEGORIES) {
      const res = await handleUnsubscribe(setup().deps, req("GET", tok(c)));
      assert.ok(res.body.includes(words[c]), c);
    }
  });
  test("bare function path works", async () => {
    const res = await handleUnsubscribe(setup().deps, { method: "GET", path: `/${tok()}`, body: undefined, contentType: undefined });
    assert.equal(res.status, 200);
  });
});

describe("POST", () => {
  const bodies: Array<[string, unknown]> = [
    ["string", "List-Unsubscribe=One-Click"],
    ["buffer", Buffer.from("List-Unsubscribe=One-Click")],
    ["object", { "List-Unsubscribe": "One-Click" }],
  ];
  for (const [name, body] of bodies) {
    test(`one-click (${name}) disables exactly the token category`, async () => {
      const { deps, calls } = setup();
      const res = await handleUnsubscribe(deps, req("POST", tok("event_updates"), body, FORM));
      assert.equal(res.status, 200);
      assert.match(res.body, /You are unsubscribed/);
      assert.match(res.body, /Profile &gt; Notifications/);
      assert.deepEqual(calls, [{ uid: UID, categories: ["event_updates"] }]);
    });
  }
  test("one-click works without a content type", async () => {
    const { deps, calls } = setup();
    assert.equal((await handleUnsubscribe(deps, req("POST", tok(), "List-Unsubscribe=One-Click", undefined))).status, 200);
    assert.equal(calls.length, 1);
  });
  test("scope=all disables all email categories", async () => {
    const { deps, calls } = setup();
    const res = await handleUnsubscribe(deps, req("POST", tok("invites"), "List-Unsubscribe=One-Click&scope=all", FORM));
    assert.equal(res.status, 200);
    assert.deepEqual(calls[0]!.categories, [...EMAIL_CATEGORIES]);
    assert.equal(calls[0]!.categories.length, 10);
    for (const c of ["weekly_themes", "admin_digest", "day_before_reminders"] as const) assert.ok(calls[0]!.categories.includes(c));
  });
  test("POST without an unsubscribe action changes nothing", async () => {
    const { deps, calls } = setup();
    assert.equal((await handleUnsubscribe(deps, req("POST", tok(), "foo=bar", FORM))).status, 400);
    assert.equal((await handleUnsubscribe(deps, req("POST", tok(), undefined))).status, 400);
    assert.equal(calls.length, 0);
  });
  test("repeat POST is idempotent", async () => {
    const { deps, calls } = setup();
    const t = tok();
    const a = await handleUnsubscribe(deps, req("POST", t, "List-Unsubscribe=One-Click", FORM));
    const b = await handleUnsubscribe(deps, req("POST", t, "List-Unsubscribe=One-Click", FORM));
    assert.equal(a.status, 200);
    assert.deepEqual(a, b);
    assert.deepEqual(calls[0], calls[1]);
  });
  test("missing member still returns the same 200 page", async () => {
    const gone = await handleUnsubscribe(setup(false).deps, req("POST", tok(), "List-Unsubscribe=One-Click", FORM));
    const here = await handleUnsubscribe(setup(true).deps, req("POST", tok(), "List-Unsubscribe=One-Click", FORM));
    assert.equal(gone.status, 200);
    assert.equal(gone.body, here.body);
  });
});

describe("response hygiene", () => {
  test("other methods get 405 with Allow", async () => {
    for (const m of ["PUT", "DELETE", "PATCH", "OPTIONS"]) {
      const { deps, calls } = setup();
      const res = await handleUnsubscribe(deps, req(m, tok(), "List-Unsubscribe=One-Click"));
      assert.equal(res.status, 405);
      assert.equal(res.headers["Allow"], "GET, HEAD, POST");
      assert.equal(calls.length, 0);
    }
  });
  test("security headers, no redirects, no cookies, no uid", async () => {
    const t = tok();
    const all = [
      await handleUnsubscribe(setup().deps, req("GET", t)),
      await handleUnsubscribe(setup().deps, req("POST", t, "List-Unsubscribe=One-Click", FORM)),
      await handleUnsubscribe(setup().deps, req("GET", "bad")),
      await handleUnsubscribe(setup().deps, req("PUT", t)),
    ];
    for (const res of all) {
      const names = Object.keys(res.headers).map((h) => h.toLowerCase());
      assert.ok(!names.includes("location") && !names.includes("set-cookie"));
      assert.ok(res.status < 300 || res.status >= 400);
      assert.equal(res.headers["Cache-Control"], "no-store");
      assert.equal(res.headers["X-Robots-Tag"], "noindex");
      assert.equal(res.headers["X-Content-Type-Options"], "nosniff");
      assert.equal(res.headers["Referrer-Policy"], "no-referrer");
      assert.equal(res.headers["Content-Security-Policy"], "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
      assert.ok(!res.body.includes(UID));
    }
    assert.equal(all[0]!.headers["Content-Type"], "text/html; charset=utf-8");
  });
  test("echoed token is HTML-escaped", async () => {
    // A token only reaches the page after verifying, so exercise escaping through the form action of a valid one and
    // confirm a hostile path never appears in an error page.
    const hostile = await handleUnsubscribe(setup().deps, req("GET", `"><script>alert(1)</script>`));
    assert.equal(hostile.status, 400);
    assert.ok(!hostile.body.includes("<script>alert"));
    const ok = await handleUnsubscribe(setup().deps, req("GET", tok()));
    assert.ok(!/action="[^"]*[<>'][^"]*"/.test(ok.body));
  });
});
