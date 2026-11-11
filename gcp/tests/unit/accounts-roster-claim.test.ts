import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { describe, test } from "node:test";
import { resolveMembership } from "../../functions/src/modules/accounts/application/resolveMembership";
import type { MembershipStore, MembershipTransaction } from "../../functions/src/modules/accounts/application/ports";
import { AccountsError } from "../../functions/src/modules/accounts/domain/errors";
import type { AuthIdentity, MembershipMode, NewMemberProfile, RosterClaim, StoredMembership } from "../../functions/src/modules/accounts/domain/membership";

// Roster claiming and deactivation in resolveMembershipV1 (docs/contracts/admin.md#roster-pre-provisioning).
const hash = (email: string) => createHash("sha256").update(email.toLowerCase()).digest("hex");

class Store implements MembershipStore {
  members = new Map<string, StoredMembership>();
  mode: MembershipMode = "open";
  roster = new Map<string, RosterClaim>();
  created: Array<[string, NewMemberProfile]> = [];
  claimed: Array<[string, string]> = [];
  async runTransaction<T>(work: (tx: MembershipTransaction) => Promise<T>): Promise<T> {
    const tx: MembershipTransaction = {
      companyIdForDomain: async domain => (domain === "alpha.test" ? "alpha" : null),
      getMembership: async uid => this.members.get(uid) ?? null,
      getMembershipMode: async () => this.mode,
      getRosterEntry: async (_company, email) => this.roster.get(hash(email)) ?? null,
      claimRosterEntry: (_company, entryId, uid) => { this.claimed.push([entryId, uid]); },
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

describe("roster claim on first sign-in", () => {
  test("an invited entry creates the member with its role, teams, location, department and title, and is marked claimed", async () => {
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
    assert.deepEqual(store.claimed, [[hash("pat@alpha.test"), "u1"]]);
  });

  test("the roster name is only a fallback when the token has no name", async () => {
    const store = new Store();
    store.invite("pat@alpha.test");
    await resolveMembership(store, identity({ name: null }), request);
    assert.equal(store.created[0]![1].displayName, "Roster Name");
  });

  test("the entry is found by the verified email, case-insensitively, including subdomain addresses of the same mailbox only", async () => {
    const store = new Store();
    store.invite("pat@alpha.test");
    await resolveMembership(store, identity({ email: "Pat@Alpha.Test" }), request);
    assert.equal(store.created.length, 1);
    assert.equal(store.created[0]![1].role, "organizer");
  });

  test("a spoofed address gains nothing: an entry for another email or an unverified email never applies", async () => {
    const store = new Store();
    store.invite("boss@alpha.test", { role: "admin" });
    await resolveMembership(store, identity(), request);
    assert.equal(store.created[0]![1].role, "member");
    assert.equal(store.claimed.length, 0);
    await assert.rejects(resolveMembership(new Store(), identity({ emailVerified: false }), request), (e: AccountsError) => e.reason === "EMAIL_NOT_VERIFIED");
    store.roster.set(hash("pat@alpha.test"), { ...store.roster.get(hash("boss@alpha.test"))!, entryId: hash("pat@alpha.test"), email: "someone-else@alpha.test" });
    await resolveMembership(store, identity({ uid: "u2" }), request);
    assert.equal(store.created[1]![1].role, "member", "an entry whose stored email differs from the token email is ignored");
  });

  test("a second sign-in claims nothing and an already claimed or revoked entry is not applied", async () => {
    const store = new Store();
    store.invite("pat@alpha.test", { status: "revoked" });
    await resolveMembership(store, identity(), request);
    assert.equal(store.created[0]![1].role, "member");
    store.members.set("u1", { companyId: "alpha", role: "member", displayName: "Pat Lee" });
    store.invite("pat@alpha.test");
    const again = await resolveMembership(store, identity(), request);
    assert.equal(again.role, "member");
    assert.equal(store.created.length, 1);
    assert.equal(store.claimed.length, 0);
  });

  test("an open company keeps today's default for people not on the roster", async () => {
    const store = new Store();
    const response = await resolveMembership(store, identity(), request);
    assert.equal(response.role, "member");
    assert.deepEqual(Object.keys(store.created[0]![1]).sort(), ["availability", "avatarId", "city", "companyId", "department", "displayName", "email", "favoritePhotoIds",
      "friendIds", "interestTagIds", "jobTitle", "photoURL", "pointsBalance", "role", "travelRadiusMiles"]);
  });

  test("a roster-only company refuses people without an invited entry, but admits invited ones and existing members", async () => {
    const store = new Store();
    store.mode = "rosterOnly";
    await assert.rejects(resolveMembership(store, identity(), request), (e: AccountsError) => e.code === "permission-denied" && e.reason === "NOT_ON_ROSTER");
    store.invite("pat@alpha.test", { status: "revoked" });
    await assert.rejects(resolveMembership(store, identity(), request), (e: AccountsError) => e.reason === "NOT_ON_ROSTER");
    store.invite("pat@alpha.test", { role: "member" });
    assert.equal((await resolveMembership(store, identity(), request)).role, "member");
    store.members.set("u9", { companyId: "alpha", role: "admin", displayName: "Old Admin" });
    assert.equal((await resolveMembership(store, identity({ uid: "u9", email: "old@alpha.test" }), request)).role, "admin");
  });

  test("a deactivated member is refused with ACCOUNT_DEACTIVATED; an organizer role resolves", async () => {
    const store = new Store();
    store.members.set("u1", { companyId: "alpha", role: "member", displayName: "Pat Lee", status: "deactivated" });
    await assert.rejects(resolveMembership(store, identity(), request), (e: AccountsError) => e.code === "permission-denied" && e.reason === "ACCOUNT_DEACTIVATED");
    store.members.set("u1", { companyId: "alpha", role: "organizer", displayName: "Pat Lee", status: "active" });
    assert.equal((await resolveMembership(store, identity(), request)).role, "organizer");
  });
});
