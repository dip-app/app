import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { backfillMemberPhotos, type PhotoBackfillPorts } from "../../functions/src/modules/accounts/application/backfillPhotos";
import { resolveMembership } from "../../functions/src/modules/accounts/application/resolveMembership";
import type { MembershipStore, MembershipTransaction } from "../../functions/src/modules/accounts/application/ports";
import type { AuthIdentity, StoredMembership } from "../../functions/src/modules/accounts/domain/membership";
import { MAX_PHOTO_URL_LENGTH, normalizeGooglePhotoUrl } from "../../functions/src/modules/accounts/domain/photoUrl";
import { identityFromRequest } from "../../functions/src/modules/accounts/transport/resolveMembershipV1";

const BASE = "https://lh3.googleusercontent.com/a/ACg8ocJabc123_-xyz";

describe("normalizeGooglePhotoUrl", () => {
  test("accepts Google image hosts and stores the size-less base form", () => {
    assert.equal(normalizeGooglePhotoUrl(`${BASE}=s96-c`), BASE);
    assert.equal(normalizeGooglePhotoUrl(BASE), BASE);
    assert.equal(normalizeGooglePhotoUrl(`${BASE}=w128-h128-p-k-no`), BASE);
    assert.equal(normalizeGooglePhotoUrl("https://lh4.ggpht.com/abc123=s64-c"), "https://lh4.ggpht.com/abc123");
    assert.equal(normalizeGooglePhotoUrl("https://LH3.GoogleUserContent.com/a/x=s96-c"), "https://lh3.googleusercontent.com/a/x");
  });
  test("handles the old path-segment size form and drops query and fragment", () => {
    assert.equal(normalizeGooglePhotoUrl("https://lh3.googleusercontent.com/-AbC/AAAAAAAAAAI/AAAAAAAAAAA/xyz/s96-c/photo.jpg?sz=50#top"),
      "https://lh3.googleusercontent.com/-AbC/AAAAAAAAAAI/AAAAAAAAAAA/xyz/photo.jpg");
  });
  const rejected: Array<[string, unknown]> = [
    ["http", "http://lh3.googleusercontent.com/a/x=s96-c"],
    ["javascript", "javascript:alert(1)"],
    ["data URL", "data:image/png;base64,AAAA"],
    ["other host", "https://example.com/a/x=s96-c"],
    ["look-alike suffix", "https://evilgoogleusercontent.com/a/x"],
    ["look-alike prefix", "https://lh3.googleusercontent.com.evil.test/a/x"],
    ["bare apex", "https://googleusercontent.com/a/x"],
    ["credentials", "https://user:pw@lh3.googleusercontent.com/a/x"],
    ["port", "https://lh3.googleusercontent.com:8443/a/x"],
    ["no path", "https://lh3.googleusercontent.com/"],
    ["whitespace", " https://lh3.googleusercontent.com/a/x"],
    ["empty", ""],
    ["not a string", 42],
    ["null", null],
    ["overlong", `https://lh3.googleusercontent.com/${"a".repeat(MAX_PHOTO_URL_LENGTH)}`],
  ];
  for (const [name, value] of rejected) test(`rejects ${name}`, () => assert.equal(normalizeGooglePhotoUrl(value), null));
});

describe("identityFromRequest picture claim", () => {
  test("reads a string picture and ignores other types", () => {
    const withToken = (token: Record<string, unknown>) => identityFromRequest({ auth: { uid: "u", rawToken: "", token: token as never } });
    assert.equal(withToken({ picture: `${BASE}=s96-c` })?.picture, `${BASE}=s96-c`);
    assert.equal(withToken({ picture: 5 })?.picture, null);
    assert.equal(withToken({})?.picture, null);
  });
});

// Minimal store: a company, an optional existing profile, and the writes made.
function store(existing: (StoredMembership & { photoURL?: string }) | null) {
  const writes: Array<[string, ...unknown[]]> = [];
  const impl: MembershipStore = {
    async runTransaction<T>(work: (tx: MembershipTransaction) => Promise<T>) {
      return work({
        companyIdForDomain: async () => "co",
        getMembership: async () => existing,
        getRosterEntry: async () => null,
        recordRosterJoin: () => undefined,
        createMember: (_uid, profile) => { writes.push(["create", profile.photoURL]); },
        updateDisplayName: (_uid, name) => { writes.push(["name", name]); },
        fillPhotoURL: (_uid, url) => { writes.push(["photo", url]); },
      });
    },
  };
  return { impl, writes };
}
const identity = (picture: string | null | undefined): AuthIdentity => ({
  uid: "u1", email: "pat@alpha.test", emailVerified: true, signInProvider: "google.com", name: "Pat Lee", picture,
});
const REQUEST = { contractVersion: 1 };

describe("resolveMembershipV1 Google photo", () => {
  test("first sign-in stores the normalized photo", async () => {
    const s = store(null);
    await resolveMembership(s.impl, identity(`${BASE}=s96-c`), REQUEST);
    assert.deepEqual(s.writes, [["create", BASE]]);
  });
  test("first sign-in with no or an invalid picture stores an empty photoURL", async () => {
    for (const picture of [null, undefined, "http://lh3.googleusercontent.com/a/x", "https://example.com/x"]) {
      const s = store(null);
      await resolveMembership(s.impl, identity(picture), REQUEST);
      assert.deepEqual(s.writes, [["create", ""]]);
    }
  });
  test("a later sign-in fills an empty photoURL", async () => {
    const s = store({ companyId: "co", role: "member", displayName: "Pat Lee", photoURL: "" });
    await resolveMembership(s.impl, identity(`${BASE}=s96-c`), REQUEST);
    assert.deepEqual(s.writes, [["photo", BASE]]);
  });
  test("a missing stored photoURL counts as empty", async () => {
    const s = store({ companyId: "co", role: "member", displayName: "Pat Lee" });
    await resolveMembership(s.impl, identity(`${BASE}=s96-c`), REQUEST);
    assert.deepEqual(s.writes, [["photo", BASE]]);
  });
  test("never overwrites a non-empty stored photoURL, and is idempotent", async () => {
    const chosen = "https://example.com/my-own.png";
    const s = store({ companyId: "co", role: "member", displayName: "Pat Lee", photoURL: chosen });
    await resolveMembership(s.impl, identity(`${BASE}=s96-c`), REQUEST);
    assert.deepEqual(s.writes, []);
    const filled = store({ companyId: "co", role: "member", displayName: "Pat Lee", photoURL: BASE });
    await resolveMembership(filled.impl, identity(`${BASE}=s96-c`), REQUEST);
    assert.deepEqual(filled.writes, []);
  });
  test("an invalid picture leaves an empty photoURL empty", async () => {
    const s = store({ companyId: "co", role: "member", displayName: "Pat Lee", photoURL: "" });
    await resolveMembership(s.impl, identity("javascript:alert(1)"), REQUEST);
    assert.deepEqual(s.writes, []);
  });
});

describe("backfillMemberPhotos", () => {
  function ports(users: Array<{ uid: string; photoURL: string }>, auth: Record<string, string>) {
    const writes: string[] = [];
    const authCalls: number[] = [];
    const impl: PhotoBackfillPorts = {
      listMembers: async (_c, after, limit) => users.filter((u) => after === null || u.uid > after).slice(0, limit),
      authPhotos: async (uids) => { authCalls.push(uids.length); return new Map(uids.flatMap((u) => (auth[u] ? [[u, auth[u]!] as [string, string]] : []))); },
      fillIfEmpty: async (uid) => { writes.push(uid); return true; },
    };
    return { impl, writes, authCalls };
  }
  const users = [
    { uid: "a", photoURL: "" }, { uid: "b", photoURL: "https://example.com/own.png" }, { uid: "c", photoURL: "" },
    { uid: "d", photoURL: "" }, { uid: "e", photoURL: "" },
  ];
  const auth = { a: `${BASE}=s96-c`, c: "http://lh3.googleusercontent.com/x", e: `${BASE}2=s96-c` };

  test("dry run counts and writes nothing", async () => {
    const p = ports(users, auth);
    const report = await backfillMemberPhotos(p.impl, "co", false, 2);
    assert.deepEqual(report, { scanned: 5, alreadyHavePhoto: 1, noAuthPhoto: 1, invalidAuthPhoto: 1, filled: 2, skippedConcurrent: 0 });
    assert.deepEqual(p.writes, []);
  });
  test("apply fills only empty members with a valid Auth photo", async () => {
    const p = ports(users, auth);
    const report = await backfillMemberPhotos(p.impl, "co", true, 2);
    assert.equal(report.filled, 2);
    assert.deepEqual(p.writes, ["a", "e"]);
  });
  test("looks users up in Auth in batches of at most 100", async () => {
    const many = Array.from({ length: 250 }, (_, i) => ({ uid: `u${String(i).padStart(3, "0")}`, photoURL: "" }));
    const p = ports(many, {});
    const report = await backfillMemberPhotos(p.impl, "co", false, 1000);
    assert.deepEqual(p.authCalls, [100, 100, 50]);
    assert.equal(report.noAuthPhoto, 250);
  });
  test("a concurrent fill is skipped, not overwritten", async () => {
    const p = ports(users, auth);
    p.impl.fillIfEmpty = async () => false;
    const report = await backfillMemberPhotos(p.impl, "co", true);
    assert.deepEqual([report.filled, report.skippedConcurrent], [0, 2]);
  });
});
