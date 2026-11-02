import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { resolveMembership } from "../../functions/src/modules/accounts/application/resolveMembership";
import type { MembershipStore, MembershipTransaction } from "../../functions/src/modules/accounts/application/ports";
import { isPersonalEmailDomain, PERSONAL_EMAIL_DOMAINS, rootDomainOfEmail } from "../../functions/src/modules/accounts/domain/emailDomain";
import { AccountsError } from "../../functions/src/modules/accounts/domain/errors";
import { displayNameFor, type AuthIdentity, type NewMemberProfile } from "../../functions/src/modules/accounts/domain/membership";
import { handleResolveMembership, identityFromRequest, toHttpsError } from "../../functions/src/modules/accounts/transport/resolveMembershipV1";

// In-memory store with optimistic transactions (reads record versions; commit
// retries if anything read changed or a create target already exists). A test
// double for concurrency semantics, not emulator evidence.
type Doc = Record<string, unknown>;
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

class FakeStore implements MembershipStore {
  docs = new Map<string, { data: Doc; version: number }>();
  transactions = 0;
  reads: string[] = [];
  private clock = 0;
  seed(path: string, data: Doc) { this.docs.set(path, { data: structuredClone(data), version: ++this.clock }); }
  get(path: string): Doc | undefined { return this.docs.get(path)?.data; }

  async runTransaction<T>(work: (tx: MembershipTransaction) => Promise<T>): Promise<T> {
    this.transactions += 1;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const seen = new Map<string, number>();
      const writes: Array<[string, Doc, "create" | "update"]> = [];
      const read = async (path: string) => {
        await tick();
        this.reads.push(path);
        const entry = this.docs.get(path);
        seen.set(path, entry?.version ?? 0);
        return entry?.data;
      };
      const tx: MembershipTransaction = {
        companyIdForDomain: async (domain) => {
          const data = await read(`companyDomains/${domain}`);
          return typeof data?.companyId === "string" ? data.companyId : null;
        },
        companyExists: async (id) => (await read(`companies/${id}`)) !== undefined,
        getMembership: async (uid) => {
          const data = await read(`users/${uid}`);
          return data ? { companyId: String(data.companyId), role: String(data.role), displayName: String(data.displayName ?? "") } : null;
        },
        createMember: (uid: string, profile: NewMemberProfile) => { writes.push([`users/${uid}`, { ...profile, createdAt: "SERVER_TIMESTAMP" }, "create"]); },
        updateDisplayName: (uid: string, displayName: string) => { writes.push([`users/${uid}`, { displayName }, "update"]); },
      };
      const result = await work(tx);
      await tick();
      const stale = [...seen].some(([path, version]) => (this.docs.get(path)?.version ?? 0) !== version);
      if (stale || writes.some(([path, , kind]) => kind === "create" && this.docs.has(path))) continue;
      for (const [path, data, kind] of writes) this.seed(path, kind === "update" ? { ...this.get(path), ...data } : data);
      return result;
    }
    throw new Error("transaction contention");
  }
}

function seededStore() {
  const store = new FakeStore();
  store.seed("companies/company-alpha", { name: "Alpha" });
  store.seed("companies/company-beta", { name: "Beta" });
  store.seed("companyDomains/alpha.test", { companyId: "company-alpha" });
  store.seed("companyDomains/beta.co.uk", { companyId: "company-beta" });
  store.seed("companyDomains/orphan.test", { companyId: "company-deleted" });
  return store;
}
const google = (overrides: Partial<AuthIdentity> = {}): AuthIdentity => ({
  uid: "user-1", email: "pat@alpha.test", emailVerified: true, signInProvider: "google.com", name: "Pat Lee", ...overrides,
});
const REQUEST = { contractVersion: 1 };
const member = (companyId = "company-alpha", role = "member") => ({ contractVersion: 1, companyId, role });

async function rejects(promise: Promise<unknown>, code: string, reason: string, fields?: string[]) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof AccountsError, `expected AccountsError, got ${String(error)}`);
    assert.equal(error.code, code);
    assert.equal(error.reason, reason);
    if (fields) assert.deepEqual([...error.fields], fields);
    return true;
  });
}

describe("root domain coercion", () => {
  const cases: Array<[string, string | null]> = [
    ["pat@acme.com", "acme.com"],
    ["pat@eng.acme.com", "acme.com"],
    ["pat@a.b.c.acme.com", "acme.com"],
    ["Pat@ENG.Acme.COM", "acme.com"],
    ["pat@team.acme.co.uk", "acme.co.uk"],
    ["pat@acme.co.uk", "acme.co.uk"],
    ["pat@eng.alpha.test", "alpha.test"],
    ["pat@example.invalid", "example.invalid"],
    ["pat@acme.com.", "acme.com"],
    ["pat@127.0.0.1", null],
    ["pat@[10.0.0.1]", null],
    ["pat@localhost", null],
    ["no-at-sign", null],
    ["trailing@", null],
    ["@acme.com", null],
  ];
  for (const [email, root] of cases) {
    test(`${email} -> ${root}`, () => assert.equal(rootDomainOfEmail(email), root));
  }
  test("private-suffix hosts coerce to the ICANN root, not a shared platform subdomain", () => {
    assert.equal(rootDomainOfEmail("pat@team.github.io"), "github.io");
  });
});

describe("personal email domains", () => {
  test("common consumer providers are blocked, work domains are not", () => {
    for (const domain of ["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com", "proton.me"]) {
      assert.ok(isPersonalEmailDomain(domain), domain);
    }
    assert.equal(isPersonalEmailDomain("acme.com"), false);
    assert.equal(isPersonalEmailDomain("GMAIL.com"), true);
  });
  test("the list contains only lowercase root domains", () => {
    for (const domain of PERSONAL_EMAIL_DOMAINS) assert.equal(rootDomainOfEmail(`x@${domain}`), domain);
  });
  test("the shared seed never maps a personal domain and only maps root domains", () => {
    const fixture = JSON.parse(readFileSync(join(__dirname, "../../sample-data/v1.json"), "utf8")) as {
      firestoreDocuments: Array<{ path: string; data: Doc }>;
    };
    const domains = fixture.firestoreDocuments.filter((d) => d.path.startsWith("companyDomains/")).map((d) => d.path.split("/")[1]!);
    assert.ok(domains.length > 0);
    for (const domain of domains) {
      assert.equal(rootDomainOfEmail(`x@${domain}`), domain);
      assert.equal(isPersonalEmailDomain(domain), false);
    }
  });
});

describe("display name from OAuth", () => {
  test("uses the token name, collapsing whitespace", () => assert.equal(displayNameFor("  Pat \n  Lee ", "p@alpha.test"), "Pat Lee"));
  test("falls back to the email local part", () => assert.equal(displayNameFor(null, "pat.lee@alpha.test"), "pat.lee"));
  test("blank name falls back too", () => assert.equal(displayNameFor("   ", "pat@alpha.test"), "pat"));
  test("is at most 80 characters with no trailing space", () => {
    assert.equal(displayNameFor(`${"a".repeat(79)} b`, "x@alpha.test"), "a".repeat(79));
    assert.equal(Array.from(displayNameFor("é".repeat(100), "x@alpha.test")).length, 80);
  });
});

describe("resolveMembershipV1 rejects before touching data", () => {
  test("unauthenticated caller", async () => {
    const store = seededStore();
    await rejects(resolveMembership(store, null, REQUEST), "unauthenticated", "UNAUTHENTICATED");
    assert.equal(store.transactions, 0);
  });

  const invalid: Array<[string, unknown, string[]]> = [
    ["non-object payload", "x", []],
    ["array payload", [1], []],
    ["null payload", null, []],
    ["wrong contract version", { contractVersion: 2 }, ["contractVersion"]],
    ["missing contract version", {}, ["contractVersion"]],
    ["client-supplied domain", { contractVersion: 1, domain: "beta.co.uk" }, ["domain"]],
    ["client-supplied company, role, name", { contractVersion: 1, companyId: "company-beta", role: "admin", displayName: "X" }, ["companyId", "displayName", "role"]],
  ];
  for (const [name, payload, fields] of invalid) {
    test(`invalid-argument: ${name}`, async () => {
      const store = seededStore();
      await rejects(resolveMembership(store, google(), payload), "invalid-argument", "VALIDATION_FAILED", fields);
      assert.equal(store.transactions, 0);
    });
  }

  const ineligible: Array<[string, Partial<AuthIdentity>, string, string]> = [
    ["email/password account", { signInProvider: "password" }, "permission-denied", "PROVIDER_NOT_ALLOWED"],
    ["Apple account", { signInProvider: "apple.com" }, "permission-denied", "PROVIDER_NOT_ALLOWED"],
    ["missing provider", { signInProvider: null }, "permission-denied", "PROVIDER_NOT_ALLOWED"],
    ["unverified email", { emailVerified: false }, "permission-denied", "EMAIL_NOT_VERIFIED"],
    ["no email", { email: null }, "permission-denied", "EMAIL_NOT_VERIFIED"],
    ["personal gmail", { email: "pat@gmail.com" }, "permission-denied", "PERSONAL_EMAIL_DOMAIN"],
    ["personal provider subdomain", { email: "pat@MAIL.Outlook.com" }, "permission-denied", "PERSONAL_EMAIL_DOMAIN"],
    ["unusable domain", { email: "pat@127.0.0.1" }, "not-found", "NO_COMPANY_FOR_DOMAIN"],
  ];
  for (const [name, overrides, code, reason] of ineligible) {
    test(`${reason}: ${name}`, async () => {
      const store = seededStore();
      let consumed = 0;
      await rejects(resolveMembership(store, google(overrides), REQUEST, { consume: async () => { consumed += 1; } }), code, reason);
      assert.equal(store.transactions, 0, "no data read");
      assert.equal(consumed, 0, "no rate budget consumed");
    });
  }
});

describe("resolveMembershipV1 domain resolution", () => {
  test("unmapped domain is NO_COMPANY_FOR_DOMAIN with no writes", async () => {
    const store = seededStore();
    const before = store.docs.size;
    await rejects(resolveMembership(store, google({ email: "pat@unknown.test" }), REQUEST), "not-found", "NO_COMPANY_FOR_DOMAIN");
    assert.equal(store.docs.size, before);
  });

  test("a mapping to a missing company is the same error", async () => {
    const store = seededStore();
    await rejects(resolveMembership(store, google({ email: "pat@orphan.test" }), REQUEST), "not-found", "NO_COMPANY_FOR_DOMAIN");
    assert.equal(store.get("users/user-1"), undefined);
  });

  test("subdomain and case are coerced to the mapped root", async () => {
    const store = seededStore();
    assert.deepEqual(await resolveMembership(store, google({ email: "Pat@Eng.ALPHA.test" }), REQUEST), member());
    assert.ok(store.reads.includes("companyDomains/alpha.test"));
  });

  test("multi-part public suffixes resolve to the registrable root", async () => {
    const store = seededStore();
    assert.deepEqual(await resolveMembership(store, google({ email: "pat@london.beta.co.uk" }), REQUEST), member("company-beta"));
  });

  test("a subdomain record is never consulted", async () => {
    const store = seededStore();
    store.seed("companyDomains/eng.gamma.test", { companyId: "company-alpha" });
    await rejects(resolveMembership(store, google({ email: "pat@eng.gamma.test" }), REQUEST), "not-found", "NO_COMPANY_FOR_DOMAIN");
    assert.ok(store.reads.includes("companyDomains/gamma.test"));
  });
});

describe("resolveMembershipV1 membership", () => {
  test("first resolution creates a member profile with defaults and the OAuth name", async () => {
    const store = seededStore();
    assert.deepEqual(await resolveMembership(store, google({ name: "  Pat   Lee " }), REQUEST), member());
    assert.deepEqual(store.get("users/user-1"), {
      companyId: "company-alpha", displayName: "Pat Lee", email: "pat@alpha.test", photoURL: "", avatarId: "",
      department: "", jobTitle: "", city: "", role: "member", interestTagIds: [], travelRadiusMiles: 20,
      availability: [], friendIds: [], favoritePhotoIds: [], pointsBalance: 0, createdAt: "SERVER_TIMESTAMP",
    });
  });

  test("replay returns the stored membership without rewriting when nothing changed", async () => {
    const store = seededStore();
    await resolveMembership(store, google(), REQUEST);
    const version = store.docs.get("users/user-1")!.version;
    assert.deepEqual(await resolveMembership(store, google(), REQUEST), member());
    assert.equal(store.docs.get("users/user-1")!.version, version, "no write");
  });

  test("replay refreshes a changed OAuth display name and nothing else", async () => {
    const store = seededStore();
    await resolveMembership(store, google(), REQUEST);
    const before = structuredClone(store.get("users/user-1"));
    await resolveMembership(store, google({ name: "Patricia Lee" }), REQUEST);
    assert.deepEqual(store.get("users/user-1"), { ...before, displayName: "Patricia Lee" });
  });

  test("an existing admin stays admin", async () => {
    const store = seededStore();
    store.seed("users/admin-1", { companyId: "company-alpha", role: "admin", displayName: "Pat Lee", pointsBalance: 40 });
    assert.deepEqual(await resolveMembership(store, google({ uid: "admin-1" }), REQUEST), member("company-alpha", "admin"));
    assert.equal(store.get("users/admin-1")!.pointsBalance, 40);
  });

  test("a member of another company cannot switch tenants", async () => {
    const store = seededStore();
    store.seed("users/user-1", { companyId: "company-beta", role: "member", displayName: "Pat Lee" });
    await rejects(resolveMembership(store, google(), REQUEST), "failed-precondition", "MEMBERSHIP_CONFLICT");
    assert.equal(store.get("users/user-1")!.companyId, "company-beta");
  });

  test("an unknown stored role is not echoed", async () => {
    const store = seededStore();
    store.seed("users/user-1", { companyId: "company-alpha", role: "owner", displayName: "Pat Lee" });
    await rejects(resolveMembership(store, google(), REQUEST), "internal", "INVALID_STORED_MEMBERSHIP");
  });

  test("concurrent first resolutions create exactly one profile", async () => {
    const store = seededStore();
    const results = await Promise.all([1, 2, 3, 4].map(() => resolveMembership(store, google(), REQUEST)));
    for (const result of results) assert.deepEqual(result, member());
    assert.deepEqual([...store.docs.keys()].filter((p) => p.startsWith("users/")), ["users/user-1"]);
  });

  test("the rate limit is consumed once per eligible request and can refuse", async () => {
    const store = seededStore();
    let consumed = 0;
    const limiter = { consume: async () => { consumed += 1; if (consumed > 2) throw new AccountsError("resource-exhausted", "RATE_LIMITED", "Too many requests."); } };
    await resolveMembership(store, google(), REQUEST, limiter);
    await rejects(resolveMembership(store, google({ email: "pat@unknown.test" }), REQUEST, limiter), "not-found", "NO_COMPANY_FOR_DOMAIN");
    await rejects(resolveMembership(store, google(), REQUEST, limiter), "resource-exhausted", "RATE_LIMITED");
    assert.equal(consumed, 3);
  });
});

describe("resolveMembershipV1 transport", () => {
  test("identity, provider and name come only from the Auth token", () => {
    const identity = identityFromRequest({
      auth: { uid: "u1", rawToken: "", token: { email: "a@alpha.test", email_verified: true, name: "A", firebase: { sign_in_provider: "google.com" } } as never },
    });
    assert.deepEqual(identity, { uid: "u1", email: "a@alpha.test", emailVerified: true, signInProvider: "google.com", name: "A" });
    assert.equal(identityFromRequest({}), null);
    const bare = identityFromRequest({ auth: { uid: "u2", rawToken: "", token: {} as never } });
    assert.deepEqual(bare, { uid: "u2", email: null, emailVerified: false, signInProvider: null, name: null });
  });

  test("domain errors map to callable errors with reason/fields details", () => {
    const mapped = toHttpsError(new AccountsError("permission-denied", "PERSONAL_EMAIL_DOMAIN", "Sign in with your work Google account."));
    assert.equal(mapped.code, "permission-denied");
    assert.deepEqual(mapped.details, { reason: "PERSONAL_EMAIL_DOMAIN" });
    const withFields = toHttpsError(new AccountsError("invalid-argument", "VALIDATION_FAILED", "Invalid request.", ["domain"]));
    assert.deepEqual(withFields.details, { reason: "VALIDATION_FAILED", fields: ["domain"] });
  });

  test("internal failures hide detail", () => {
    const domainInternal = toHttpsError(new AccountsError("internal", "INVALID_STORED_MEMBERSHIP", "Stored membership has an unknown role."));
    assert.equal(domainInternal.message, "Something went wrong. Try again later.");
    assert.deepEqual(domainInternal.details, { reason: "INVALID_STORED_MEMBERSHIP" });
    const unexpected = toHttpsError(new Error("Firestore exploded at companies/company-alpha"));
    assert.equal(unexpected.code, "internal");
    assert.doesNotMatch(unexpected.message, /Firestore|company-alpha/);
  });

  test("handler round trip over the fake store", async () => {
    const store = seededStore();
    const auth = { uid: "u9", rawToken: "", token: { email: "u9@alpha.test", email_verified: true, name: "U Nine", firebase: { sign_in_provider: "google.com" } } as never };
    assert.deepEqual(await handleResolveMembership(store, { auth, data: REQUEST }), member());
    await assert.rejects(handleResolveMembership(store, { data: REQUEST }), (error: any) => error.code === "unauthenticated");
  });
});
