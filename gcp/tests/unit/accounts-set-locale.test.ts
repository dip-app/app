import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { parseSetMyLocaleRequest, setMyLocale, type LocaleMember, type LocaleStore, type LocaleTransaction } from "../../functions/src/modules/accounts/application/setMyLocale";
import { AccountsError } from "../../functions/src/modules/accounts/domain/errors";
import { handleSetMyLocale } from "../../functions/src/modules/accounts/transport/setMyLocaleV1";

// setMyLocaleV1 (issue #259 backend phase): the member's language for email and push, server-owned.

/** HttpsError comes from the functions workspace; match it structurally (this test file cannot resolve the package). */
function isHttpsError(error: unknown): error is { code: string; message: string; details: unknown } {
  return error instanceof Error && error.constructor.name === "HttpsError";
}

const CALLER = { uid: "u1", emailVerified: true, signInProvider: "google.com" };

/** Serializes transactions like Firestore would for one document; records every write. */
class FakeStore implements LocaleStore {
  users = new Map<string, LocaleMember & Record<string, unknown>>();
  writes: Array<{ uid: string; data: Record<string, unknown> }> = [];
  private queue: Promise<unknown> = Promise.resolve();
  runTransaction<T>(work: (tx: LocaleTransaction) => Promise<T>): Promise<T> {
    const run = this.queue.then(() => work({
      getMember: async (uid) => (this.users.has(uid) ? { ...this.users.get(uid)! } : null),
      setLocale: (uid, locale) => {
        this.writes.push({ uid, data: { locale } });
        this.users.set(uid, { ...this.users.get(uid)!, locale });
      },
    }));
    this.queue = run.catch(() => undefined);
    return run;
  }
}

function store(member: Partial<LocaleMember & Record<string, unknown>> | null = {}) {
  const s = new FakeStore();
  if (member) s.users.set("u1", { companyId: "c1", role: "member", displayName: "Jane", pointsBalance: 5, ...member });
  return s;
}

async function rejects(promise: Promise<unknown>, reason: string, fields?: string[]) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof AccountsError);
    assert.equal(error.reason, reason);
    if (fields) assert.deepEqual([...error.fields], fields);
    return true;
  });
}

describe("setMyLocaleV1 request", () => {
  test("accepts only the supported locales", () => {
    assert.equal(parseSetMyLocaleRequest({ contractVersion: 1, locale: "en" }), "en");
    assert.equal(parseSetMyLocaleRequest({ contractVersion: 1, locale: "es" }), "es");
    for (const locale of ["fr", "ES", "es-MX", "", null, 1, undefined]) {
      assert.throws(() => parseSetMyLocaleRequest({ contractVersion: 1, locale }), (e: unknown) => e instanceof AccountsError && e.fields.includes("locale"));
    }
  });

  test("rejects other fields, a wrong version and non-objects", () => {
    assert.throws(() => parseSetMyLocaleRequest({ contractVersion: 1, locale: "es", uid: "u2", companyId: "c2" }),
      (e: unknown) => e instanceof AccountsError && e.reason === "VALIDATION_FAILED" && e.fields.join() === "companyId,uid");
    assert.throws(() => parseSetMyLocaleRequest({ contractVersion: 2, locale: "es" }), (e: unknown) => e instanceof AccountsError && e.fields.includes("contractVersion"));
    for (const data of [null, "es", ["es"], undefined]) assert.throws(() => parseSetMyLocaleRequest(data), AccountsError);
  });
});

describe("setMyLocaleV1 command", () => {
  test("auth denial: signed out, unverified email, non-Google provider", async () => {
    const s = store();
    await rejects(setMyLocale(s, null, { contractVersion: 1, locale: "es" }), "UNAUTHENTICATED");
    await rejects(setMyLocale(s, { ...CALLER, emailVerified: false }, { contractVersion: 1, locale: "es" }), "EMAIL_NOT_VERIFIED");
    await rejects(setMyLocale(s, { ...CALLER, signInProvider: "password" }, { contractVersion: 1, locale: "es" }), "PROVIDER_NOT_ALLOWED");
    assert.equal(s.writes.length, 0);
  });

  test("membership: no user document, no company, unknown role and deactivated accounts are refused", async () => {
    await rejects(setMyLocale(store(null), CALLER, { contractVersion: 1, locale: "es" }), "MEMBERSHIP_CONFLICT");
    await rejects(setMyLocale(store({ companyId: "" }), CALLER, { contractVersion: 1, locale: "es" }), "MEMBERSHIP_CONFLICT");
    await rejects(setMyLocale(store({ role: "root" }), CALLER, { contractVersion: 1, locale: "es" }), "MEMBERSHIP_CONFLICT");
    await rejects(setMyLocale(store({ status: "deactivated" }), CALLER, { contractVersion: 1, locale: "es" }), "ACCOUNT_DEACTIVATED");
  });

  test("tenant isolation and field ownership: writes only the caller's own locale, never another uid or field", async () => {
    const s = store();
    s.users.set("u2", { companyId: "c1", role: "member" });
    await rejects(setMyLocale(s, CALLER, { contractVersion: 1, locale: "es", uid: "u2" }), "VALIDATION_FAILED", ["uid"]);
    const result = await setMyLocale(s, CALLER, { contractVersion: 1, locale: "es" });
    assert.deepEqual(result, { contractVersion: 1, locale: "es", changed: true });
    assert.deepEqual(s.writes, [{ uid: "u1", data: { locale: "es" } }]);
    assert.equal(s.users.get("u2")!.locale, undefined);
    assert.equal(s.users.get("u1")!.pointsBalance, 5);
    assert.equal(s.users.get("u1")!.role, "member");
  });

  test("idempotent: the same locale again writes nothing; switching back writes once", async () => {
    const s = store({ locale: "es" });
    assert.deepEqual(await setMyLocale(s, CALLER, { contractVersion: 1, locale: "es" }), { contractVersion: 1, locale: "es", changed: false });
    assert.equal(s.writes.length, 0);
    assert.deepEqual(await setMyLocale(s, CALLER, { contractVersion: 1, locale: "en" }), { contractVersion: 1, locale: "en", changed: true });
    assert.equal(s.writes.length, 1);
  });

  test("concurrent identical calls write once (transactions serialize on the user document)", async () => {
    const s = store();
    const results = await Promise.all([1, 2, 3].map(() => setMyLocale(s, CALLER, { contractVersion: 1, locale: "es" })));
    assert.deepEqual(results.map((r) => r.changed).sort(), [false, false, true]);
    assert.equal(s.writes.length, 1);
  });

  test("admins and organizers can set their own locale (the admin portal Language setting)", async () => {
    for (const role of ["admin", "organizer"]) {
      assert.equal((await setMyLocale(store({ role }), CALLER, { contractVersion: 1, locale: "es" })).changed, true);
    }
  });
});

describe("setMyLocaleV1 transport", () => {
  const request = (data: unknown, auth: unknown = { uid: "u1", token: { email_verified: true, firebase: { sign_in_provider: "google.com" } } }) =>
    ({ auth, data }) as never;

  test("maps domain errors to callable errors with reason, fields and a message key", async () => {
    await assert.rejects(handleSetMyLocale(store(), request({ contractVersion: 1, locale: "fr" })), (error: unknown) => {
      assert.ok(isHttpsError(error));
      assert.equal(error.code, "invalid-argument");
      assert.equal(error.message, "Invalid request.");
      assert.deepEqual(error.details, { reason: "VALIDATION_FAILED", fields: ["locale"], messageKey: "errors.validationFailed" });
      return true;
    });
    await assert.rejects(handleSetMyLocale(store(), request({ contractVersion: 1, locale: "es" }, null)), (error: unknown) =>
      isHttpsError(error) && error.code === "unauthenticated");
  });

  test("an unexpected failure is a generic internal error", async () => {
    const broken: LocaleStore = { runTransaction: async () => { throw new Error("boom"); } };
    await assert.rejects(handleSetMyLocale(broken, request({ contractVersion: 1, locale: "es" })), (error: unknown) =>
      isHttpsError(error) && error.code === "internal" && error.message === "Something went wrong. Try again later.");
  });

  test("success returns the response", async () => {
    assert.deepEqual(await handleSetMyLocale(store(), request({ contractVersion: 1, locale: "es" })), { contractVersion: 1, locale: "es", changed: true });
  });
});
