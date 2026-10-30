import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { joinCompany } from "../../functions/src/modules/accounts/application/joinCompany";
import type { MembershipStore, MembershipTransaction } from "../../functions/src/modules/accounts/application/ports";
import { AccountsError } from "../../functions/src/modules/accounts/domain/errors";
import { joinCodeLookupId, normalizeJoinCode } from "../../functions/src/modules/accounts/domain/joinCode";
import type { AuthIdentity, NewMemberProfile } from "../../functions/src/modules/accounts/domain/membership";
import { handleJoinCompany, identityFromRequest, toHttpsError } from "../../functions/src/modules/accounts/transport/joinCompanyV1";

// firebase-functions resolves from gcp/functions/node_modules, not from this
// folder, so callable errors are checked structurally rather than by class.
function isHttpsError(error: unknown): error is { code: string; message: string; details?: unknown } {
  return error instanceof Error && error.constructor.name === "HttpsError" && typeof (error as { code?: unknown }).code === "string";
}

// ---------------------------------------------------------------------------
// In-memory store with optimistic transactions (reads record versions; commit
// retries if anything read changed or a create target already exists). This
// mirrors the Firestore semantics the service relies on closely enough to
// exercise concurrent first joins. It is a test double, not emulator evidence.
// ---------------------------------------------------------------------------
type Doc = Record<string, unknown>;
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

class FakeStore implements MembershipStore {
  docs = new Map<string, { data: Doc; version: number }>();
  transactions = 0;
  reads: string[] = [];
  private clock = 0;

  seed(path: string, data: Doc) {
    this.docs.set(path, { data: structuredClone(data), version: ++this.clock });
  }
  get(path: string): Doc | undefined {
    return this.docs.get(path)?.data;
  }

  async runTransaction<T>(work: (tx: MembershipTransaction) => Promise<T>): Promise<T> {
    this.transactions += 1;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const seen = new Map<string, number>();
      const creates: Array<[string, Doc]> = [];
      const read = async (path: string) => {
        await tick();
        this.reads.push(path);
        const entry = this.docs.get(path);
        seen.set(path, entry?.version ?? 0);
        return entry?.data;
      };
      const tx: MembershipTransaction = {
        resolveCompanyId: async (id) => {
          const data = await read(`companyAccess/${id}`);
          return typeof data?.companyId === "string" ? data.companyId : null;
        },
        companyExists: async (id) => (await read(`companies/${id}`)) !== undefined,
        getMembership: async (uid) => {
          const data = await read(`users/${uid}`);
          return data ? { companyId: String(data.companyId), role: String(data.role) } : null;
        },
        createMember: (uid: string, profile: NewMemberProfile) => {
          creates.push([`users/${uid}`, { ...profile, createdAt: "SERVER_TIMESTAMP" }]);
        },
      };
      const result = await work(tx);
      await tick();
      const stale = [...seen].some(([path, version]) => (this.docs.get(path)?.version ?? 0) !== version);
      if (stale || creates.some(([path]) => this.docs.has(path))) continue;
      for (const [path, data] of creates) this.seed(path, data);
      return result;
    }
    throw new Error("transaction contention");
  }
}

const CODE = "DEMO-2026";
const OTHER_CODE = "OTHER-1";
function seededStore() {
  const store = new FakeStore();
  store.seed("companies/company-demo", { name: "Demo Company" });
  store.seed(`companyAccess/${joinCodeLookupId(CODE)}`, { companyId: "company-demo" });
  store.seed("companies/company-other", { name: "Other Company" });
  store.seed(`companyAccess/${joinCodeLookupId(OTHER_CODE)}`, { companyId: "company-other" });
  return store;
}
const verified: AuthIdentity = { uid: "user-1", email: "new@example.invalid", emailVerified: true };
const request = (overrides: Record<string, unknown> = {}) => ({
  contractVersion: 1,
  joinCode: CODE,
  displayName: "New Person",
  ...overrides,
});

async function rejects(promise: Promise<unknown>, code: string, reason: string, fields?: string[]) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof AccountsError, `expected AccountsError, got ${String(error)}`);
    assert.equal(error.code, code);
    assert.equal(error.reason, reason);
    if (fields) assert.deepEqual([...error.fields], fields);
    return true;
  });
}

describe("join code normalization", () => {
  test("trims and uppercases", () => {
    assert.equal(normalizeJoinCode("  demo-2026\n"), "DEMO-2026");
  });

  test("lookup ID matches the seeded companyAccess document", () => {
    const fixture = JSON.parse(readFileSync(new URL("../../sample-data/v1.json", import.meta.url), "utf8")) as {
      joinCode: string;
      firestoreDocuments: Array<{ path: string; data: Doc }>;
    };
    const path = `companyAccess/${joinCodeLookupId(normalizeJoinCode(fixture.joinCode))}`;
    const doc = fixture.firestoreDocuments.find((d) => d.path === path);
    assert.ok(doc, "seed must contain the hashed lookup for its join code");
    assert.equal(doc.data.companyId, "company-demo");
  });
});

describe("joinCompanyV1 rejects before touching data", () => {
  test("unauthenticated caller", async () => {
    const store = seededStore();
    await rejects(joinCompany(store, null, request()), "unauthenticated", "UNAUTHENTICATED");
    assert.equal(store.transactions, 0);
  });

  const invalid: Array<[string, unknown, string[]]> = [
    ["non-object payload", "DEMO-2026", []],
    ["array payload", [CODE], []],
    ["wrong contract version", request({ contractVersion: 2 }), ["contractVersion"]],
    ["missing contract version", { joinCode: CODE, displayName: "A" }, ["contractVersion"]],
    ["blank join code", request({ joinCode: "   " }), ["joinCode"]],
    ["empty join code", request({ joinCode: "" }), ["joinCode"]],
    ["overlong join code", request({ joinCode: "X".repeat(65) }), ["joinCode"]],
    ["non-string join code", request({ joinCode: 2026 }), ["joinCode"]],
    ["missing display name", { contractVersion: 1, joinCode: CODE }, ["displayName"]],
    ["blank display name", request({ displayName: "  " }), ["displayName"]],
    ["overlong display name", request({ displayName: "n".repeat(81) }), ["displayName"]],
    ["client-supplied role", request({ role: "admin" }), ["role"]],
    ["client-supplied companyId and balance", request({ companyId: "company-other", pointsBalance: 500 }), ["companyId", "pointsBalance"]],
  ];
  for (const [name, payload, fields] of invalid) {
    test(`invalid-argument: ${name}`, async () => {
      const store = seededStore();
      await rejects(joinCompany(store, verified, payload), "invalid-argument", "VALIDATION_FAILED", fields);
      assert.equal(store.transactions, 0);
    });
  }

  test("unverified email cannot probe codes", async () => {
    const store = seededStore();
    await rejects(
      joinCompany(store, { ...verified, emailVerified: false }, request()),
      "permission-denied",
      "EMAIL_NOT_VERIFIED",
    );
    assert.equal(store.transactions, 0);
  });

  test("account without an email is treated as unverified", async () => {
    const store = seededStore();
    await rejects(joinCompany(store, { ...verified, email: null }, request()), "permission-denied", "EMAIL_NOT_VERIFIED");
    assert.equal(store.transactions, 0);
  });
});

describe("joinCompanyV1 code resolution", () => {
  test("unknown code is a generic not-found that leaks no company data and writes nothing", async () => {
    const store = seededStore();
    const before = store.docs.size;
    await assert.rejects(joinCompany(store, verified, request({ joinCode: "nope" })), (error: unknown) => {
      assert.ok(error instanceof AccountsError);
      assert.equal(error.code, "not-found");
      assert.equal(error.reason, "INVALID_JOIN_CODE");
      assert.doesNotMatch(error.message, /company-|Demo|Other|NOPE/i);
      return true;
    });
    assert.equal(store.docs.size, before);
    assert.equal(store.get("users/user-1"), undefined);
  });

  test("code pointing at a missing company returns the same generic error", async () => {
    const store = seededStore();
    store.seed(`companyAccess/${joinCodeLookupId("ORPHAN")}`, { companyId: "company-gone" });
    await rejects(joinCompany(store, verified, request({ joinCode: "orphan" })), "not-found", "INVALID_JOIN_CODE");
    assert.equal(store.get("users/user-1"), undefined);
  });

  test("lookup uses the hashed path, never the raw code", async () => {
    const store = seededStore();
    await joinCompany(store, verified, request({ joinCode: " demo-2026 " }));
    assert.ok(store.reads.every((path) => !path.includes("DEMO") && !path.toLowerCase().includes("demo-2026")));
  });
});

describe("joinCompanyV1 membership", () => {
  test("first join creates a member profile with documented defaults", async () => {
    const store = seededStore();
    const response = await joinCompany(store, verified, request({ joinCode: "  demo-2026 ", displayName: "  New Person " }));
    assert.deepEqual(response, { contractVersion: 1, companyId: "company-demo", role: "member" });
    assert.deepEqual(store.get("users/user-1"), {
      companyId: "company-demo",
      displayName: "New Person",
      email: "new@example.invalid",
      photoURL: "",
      avatarId: "",
      department: "",
      jobTitle: "",
      city: "",
      role: "member",
      interestTagIds: [],
      travelRadiusMiles: 20,
      availability: [],
      friendIds: [],
      favoritePhotoIds: [],
      pointsBalance: 0,
      createdAt: "SERVER_TIMESTAMP",
    });
  });

  test("replaying the same company returns the stored membership without rewriting the profile", async () => {
    const store = seededStore();
    await joinCompany(store, verified, request());
    const first = structuredClone(store.get("users/user-1"));
    const replay = await joinCompany(store, verified, request({ displayName: "Changed Name", joinCode: "demo-2026" }));
    assert.deepEqual(replay, { contractVersion: 1, companyId: "company-demo", role: "member" });
    assert.deepEqual(store.get("users/user-1"), first);
  });

  test("an existing admin replays as admin: nothing is promoted or demoted", async () => {
    const store = seededStore();
    store.seed("users/admin-1", { companyId: "company-demo", role: "admin", pointsBalance: 40 });
    const response = await joinCompany(store, { ...verified, uid: "admin-1" }, request());
    assert.deepEqual(response, { contractVersion: 1, companyId: "company-demo", role: "admin" });
    assert.deepEqual(store.get("users/admin-1"), { companyId: "company-demo", role: "admin", pointsBalance: 40 });
  });

  test("a member of another company cannot switch tenants", async () => {
    const store = seededStore();
    store.seed("users/user-1", { companyId: "company-other", role: "member" });
    await rejects(joinCompany(store, verified, request()), "failed-precondition", "MEMBERSHIP_CONFLICT");
    assert.deepEqual(store.get("users/user-1"), { companyId: "company-other", role: "member" });
  });

  test("a stored unknown role is not echoed as a valid membership", async () => {
    const store = seededStore();
    store.seed("users/user-1", { companyId: "company-demo", role: "owner" });
    await rejects(joinCompany(store, verified, request()), "internal", "INVALID_STORED_MEMBERSHIP");
  });

  test("concurrent first joins for one user create exactly one profile", async () => {
    const store = seededStore();
    const results = await Promise.all([
      joinCompany(store, verified, request({ displayName: "First" })),
      joinCompany(store, verified, request({ displayName: "Second" })),
      joinCompany(store, verified, request({ displayName: "Third" })),
    ]);
    for (const result of results) {
      assert.deepEqual(result, { contractVersion: 1, companyId: "company-demo", role: "member" });
    }
    const users = [...store.docs.keys()].filter((path) => path.startsWith("users/"));
    assert.deepEqual(users, ["users/user-1"]);
  });

  test("concurrent joins to different companies leave one membership and one conflict", async () => {
    const store = seededStore();
    const results = await Promise.allSettled([
      joinCompany(store, verified, request()),
      joinCompany(store, verified, request({ joinCode: OTHER_CODE })),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.equal((rejected[0]!.reason as AccountsError).reason, "MEMBERSHIP_CONFLICT");
  });
});

describe("joinCompanyV1 transport", () => {
  test("identity comes from the Auth token only", () => {
    const identity = identityFromRequest({
      auth: { uid: "u1", token: { email: "a@example.invalid", email_verified: true } as never, rawToken: "" },
    });
    assert.deepEqual(identity, { uid: "u1", email: "a@example.invalid", emailVerified: true });
    assert.equal(identityFromRequest({ auth: undefined }), null);
    const unverified = identityFromRequest({ auth: { uid: "u2", token: { email: "b@example.invalid" } as never, rawToken: "" } });
    assert.equal(unverified?.emailVerified, false);
  });

  test("domain errors map to callable errors with reason/fields details", () => {
    const mapped = toHttpsError(new AccountsError("invalid-argument", "VALIDATION_FAILED", "Invalid join request.", ["joinCode"]));
    assert.ok(isHttpsError(mapped));
    assert.equal(mapped.code, "invalid-argument");
    assert.deepEqual(mapped.details, { reason: "VALIDATION_FAILED", fields: ["joinCode"] });
    const noFields = toHttpsError(new AccountsError("not-found", "INVALID_JOIN_CODE", "That join code is not valid."));
    assert.deepEqual(noFields.details, { reason: "INVALID_JOIN_CODE" });
  });

  test("unexpected failures become a generic internal error without internals", () => {
    const mapped = toHttpsError(new Error("Firestore exploded at companies/company-demo"));
    assert.equal(mapped.code, "internal");
    assert.doesNotMatch(mapped.message, /Firestore|company-demo/);
    assert.equal(mapped.details, undefined);
  });

  test("handler end to end over the fake store", async () => {
    const store = seededStore();
    const auth = { uid: "u9", token: { email: "u9@example.invalid", email_verified: true } as never, rawToken: "" };
    assert.deepEqual(await handleJoinCompany(store, { auth, data: request() }), {
      contractVersion: 1,
      companyId: "company-demo",
      role: "member",
    });
    await assert.rejects(handleJoinCompany(store, { auth: undefined, data: request() }), (error: unknown) => {
      assert.ok(isHttpsError(error));
      assert.equal(error.code, "unauthenticated");
      return true;
    });
  });
});
