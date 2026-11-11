import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { describe, test } from "node:test";
import { resolveMembership } from "../../functions/src/modules/accounts/application/resolveMembership";
import type { MembershipStore, MembershipTransaction } from "../../functions/src/modules/accounts/application/ports";
import { AccountsError } from "../../functions/src/modules/accounts/domain/errors";
import type { AuthIdentity, NewMemberProfile, RosterAction, RosterClaim, StoredMembership } from "../../functions/src/modules/accounts/domain/membership";

// Roster claiming/recording and deactivation in resolveMembershipV1 (docs/contracts/admin.md#roster-pre-provisioning).
// There is no roster-only mode: anyone with a verified company-domain email joins, and every join is on the roster.
const hash = (email: string) => createHash("sha256").update(email.toLowerCase()).digest("hex");

class Store implements MembershipStore {
  members = new Map<string, StoredMembership>();
  roster = new Map<string, RosterClaim>();
  created: Array<[string, NewMemberProfile]> = [];
  joins: Array<{ entryId: string; action: RosterAction; uid: string; profile: NewMemberProfile }> = [];
  async runTransaction<T>(work: (tx: MembershipTransaction) => Promise<T>): Promise<T> {
    const tx: MembershipTransaction = {
      companyIdForDomain: async domain => (domain === "alpha.test" ? "alpha" : null),
      getMembership: async uid => this.members.get(uid) ?? null,
      getRosterEntry: async (_company, email) => this.roster.get(hash(email)) ?? null,
      recordRosterJoin: (_company, entryId, action, uid, profile) => { this.joins.push({ entryId, action, uid, profile }); },
      createMember: (uid, profile) => { this.created.push([uid, profile]); },
      updateDisplayName: () => undefined,
    };
    return work(tx);
  }
  invite(email: string, extra: Partial<RosterClaim> = {}) {
    this.roster.set(hash(email), { entryId: hash(email), email, status: "invited", displayName: "Roster Name", role: "organizer", teamIds: ["t1"], workLocation: "HQ",
      department: "Ops", jobTitle: "Lead", ...extra });
  }
}

const identity = (overrides: Partial<AuthIdentity> = {}): AuthIdentity => ({ uid: "u1", email: "pat@alpha.test", emailVerified: true, signInProvider: "google.com", name: "Pat Lee", ...overrides });
const request = { contractVersion: 1 };

describe("roster on first sign-in", () => {
  test("an invited entry creates the member with its role, teams, location, department and title, and is claimed", async () => {
    const store = new Store();
    store.invite("pat@alpha.test", { managerEmail: "boss@alpha.test", startDate: "2030-03-01" });
    const response = await resolveMembership(store, identity(), request);
    assert.deepEqual(response, { contractVersion: 1, companyId: "alpha", role: "organizer" });
    const [, profile] = store.created[0]!;
    assert.equal(profile.role, "organizer");
    assert.deepEqual(profile.teamIds, ["t1"]);
    assert.equal(profile.workLocation, "HQ");
    assert.equal(profile.department, "Ops");
    assert.equal(profile.jobTitle, "Lead");
    assert.equal(profile.status, "active");
    assert.equal(profile.managerEmail, "boss@alpha.test");
    assert.equal(profile.pointsBalance, 0, "points always start at zero");
    assert.equal(profile.displayName, "Pat Lee", "Google's name wins over the roster hint");
    assert.deepEqual(store.joins.map(j => [j.entryId, j.action, j.uid]), [[hash("pat@alpha.test"), "claim", "u1"]]);
  });

  test("the roster name is only a fallback when the token has no name", async () => {
    const store = new Store();
    store.invite("pat@alpha.test");
    await resolveMembership(store, identity({ name: null }), request);
    assert.equal(store.created[0]![1].displayName, "Roster Name");
  });

  test("the entry is found by the verified email, case-insensitively", async () => {
    const store = new Store();
    store.invite("pat@alpha.test");
    await resolveMembership(store, identity({ email: "Pat@Alpha.Test" }), request);
    assert.equal(store.created[0]![1].role, "organizer");
    assert.equal(store.joins[0]!.action, "claim");
  });

  test("someone who was never pre-imported joins as a default member and gets a new claimed roster entry", async () => {
    const store = new Store();
    const response = await resolveMembership(store, identity(), request);
    assert.equal(response.role, "member");
    assert.deepEqual(store.joins.map(j => [j.entryId, j.action, j.uid]), [[hash("pat@alpha.test"), "create", "u1"]]);
    assert.deepEqual(Object.keys(store.created[0]![1]).sort(), ["availability", "avatarId", "city", "companyId", "department", "displayName", "email", "favoritePhotoIds",
      "friendIds", "interestTagIds", "jobTitle", "photoURL", "pointsBalance", "role", "travelRadiusMiles"], "today's default profile is unchanged");
  });

  test("a revoked entry never applies its role: the person joins as a default member and the entry is overwritten", async () => {
    const store = new Store();
    store.invite("pat@alpha.test", { status: "revoked", role: "admin" });
    assert.equal((await resolveMembership(store, identity(), request)).role, "member");
    assert.equal(store.joins[0]!.action, "overwrite");
    assert.equal(store.joins[0]!.profile.role, "member");
  });

  test("a spoofed address gains nothing: an entry for another email or with a different stored email never applies", async () => {
    const store = new Store();
    store.invite("boss@alpha.test", { role: "admin" });
    await resolveMembership(store, identity(), request);
    assert.equal(store.created[0]![1].role, "member");
    assert.equal(store.joins[0]!.action, "create");
    store.roster.set(hash("pat@alpha.test"), { ...store.roster.get(hash("boss@alpha.test"))!, entryId: hash("pat@alpha.test"), email: "someone-else@alpha.test" });
    await resolveMembership(store, identity({ uid: "u2" }), request);
    assert.equal(store.created[1]![1].role, "member", "an entry whose stored email differs from the token email is ignored");
    await assert.rejects(resolveMembership(new Store(), identity({ emailVerified: false }), request), (e: AccountsError) => e.reason === "EMAIL_NOT_VERIFIED");
    await assert.rejects(resolveMembership(new Store(), identity({ email: "pat@elsewhere.test" }), request), (e: AccountsError) => e.reason === "NO_COMPANY_FOR_DOMAIN");
  });

  test("a returning member records nothing on the roster and changes nothing", async () => {
    const store = new Store();
    store.members.set("u1", { companyId: "alpha", role: "member", displayName: "Pat Lee" });
    store.invite("pat@alpha.test");
    assert.equal((await resolveMembership(store, identity(), request)).role, "member");
    assert.equal(store.created.length, 0);
    assert.equal(store.joins.length, 0);
  });

  test("a deactivated member is refused with ACCOUNT_DEACTIVATED; an organizer role resolves", async () => {
    const store = new Store();
    store.members.set("u1", { companyId: "alpha", role: "member", displayName: "Pat Lee", status: "deactivated" });
    await assert.rejects(resolveMembership(store, identity(), request), (e: AccountsError) => e.code === "permission-denied" && e.reason === "ACCOUNT_DEACTIVATED");
    store.members.set("u1", { companyId: "alpha", role: "organizer", displayName: "Pat Lee", status: "active" });
    assert.equal((await resolveMembership(store, identity(), request)).role, "organizer");
  });
});
