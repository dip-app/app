import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { PhotoObjects } from "../../functions/src/modules/photos/application/ports";
import type { StoredObject } from "../../functions/src/modules/photos/domain/photoPolicy";
import type {
  Document, LedgerEntry, ReviewWrite, SubmissionCaller, SubmissionChallenge, SubmissionPage, SubmissionStore, SubmissionTransaction, SubmissionWrite,
} from "../../functions/src/modules/submissions/application/ports";
import { approveChallenge, listChallengeSubmissions, rejectChallenge, submitChallenge } from "../../functions/src/modules/submissions/application/submissionCommands";
import { SubmissionError } from "../../functions/src/modules/submissions/domain/errors";
import { awardId, evidencePath, parseSubmitRequest, submissionId, type StoredSubmission, type SubmissionStatus } from "../../functions/src/modules/submissions/domain/submissionPolicy";
import { handleSubmitChallenge, toHttpsError } from "../../functions/src/modules/submissions/transport/submissionCallables";

const NOW = new Date("2030-01-03T12:00:00Z");
const now = () => NOW;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1]);
const caller = (uid = "alice"): SubmissionCaller => ({ uid, emailVerified: true, signInProvider: "google.com" });
const path = (uid = "alice", slot = 0) => evidencePath("alpha", "week1", uid, slot);
const request = (overrides: Record<string, unknown> = {}) => ({ contractVersion: 1, companyId: "alpha", challengeId: "week1", progress: 3, caption: "Ran 3 times", ...overrides });
const review = (overrides: Record<string, unknown> = {}) => ({ contractVersion: 1, companyId: "alpha", challengeId: "week1", userId: "alice", ...overrides });
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

async function reason(promise: Promise<unknown>): Promise<string> {
  try { await promise; } catch (error) { assert.ok(error instanceof SubmissionError, String(error)); return error.reason; }
  throw new Error("expected failure");
}

/** Optimistic-concurrency double: reads record versions, commit retries when a read document changed. */
class Store implements SubmissionStore {
  docs = new Map<string, { data: Record<string, unknown>; version: number }>();
  writes = 0;
  private version = 0;
  private clock = 0;
  private stamp() { return new Date(Date.UTC(2030, 0, 3, 0, 0, ++this.clock)); }
  put(p: string, data: Record<string, unknown>) { this.docs.set(p, { data: structuredClone(data), version: ++this.version }); }
  get(p: string) { return this.docs.get(p)?.data; }
  async getMember(uid: string): Promise<Document | null> { return (this.get(`users/${uid}`) as Document) ?? null; }
  async list(companyId: string, challengeId: string, status: SubmissionStatus | null, limit: number, cursor: string | null): Promise<SubmissionPage> {
    const prefix = `companies/${companyId}/challenges/${challengeId}/submissions/`;
    const all = [...this.docs.keys()].filter(k => k.startsWith(prefix)).map(k => k.slice(prefix.length)).sort()
      .filter(id => (!cursor || id > cursor) && (!status || this.get(prefix + id)?.status === status));
    const page = all.slice(0, limit);
    return {
      items: page.map(id => ({ id, submission: this.get(prefix + id) as unknown as StoredSubmission })),
      nextCursor: all.length > limit ? page[page.length - 1] : null,
    };
  }
  async runTransaction<T>(work: (tx: SubmissionTransaction) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 20; attempt++) {
      const seen = new Map<string, number>();
      const pending: (() => void)[] = [];
      const read = async (p: string) => {
        await tick();
        const entry = this.docs.get(p); seen.set(p, entry?.version ?? 0);
        return entry ? structuredClone(entry.data) : null;
      };
      const ch = (c: string, id: string) => `companies/${c}/challenges/${id}`;
      const sub = (c: string, id: string, s: string) => `${ch(c, id)}/submissions/${s}`;
      const patch = (p: string, change: (d: Record<string, unknown>) => void) => pending.push(() => {
        const d = structuredClone(this.get(p) ?? {}); change(d); this.put(p, d); this.writes++;
      });
      const tx: SubmissionTransaction = {
        getMember: u => read(`users/${u}`),
        getChallenge: async (c, id) => (await read(ch(c, id))) as unknown as SubmissionChallenge | null,
        getSubmission: async (c, id, s) => (await read(sub(c, id, s))) as unknown as StoredSubmission | null,
        getAward: async (c, a) => (await read(`companies/${c}/pointTransactions/${a}`)) !== null,
        createSubmission: (c, id, s, data: SubmissionWrite) => pending.push(() => {
          if (this.docs.has(sub(c, id, s))) throw new Error("ALREADY_EXISTS");
          this.put(sub(c, id, s), { ...data, createdAt: this.stamp(), updatedAt: this.stamp() }); this.writes++;
        }),
        replaceSubmission: (c, id, s, data: SubmissionWrite) => patch(sub(c, id, s), d => Object.assign(d, data, { updatedAt: this.stamp() })),
        reviewSubmission: (c, id, s, data: ReviewWrite) => patch(sub(c, id, s), d => Object.assign(d, data, { reviewedAt: this.stamp(), updatedAt: this.stamp() })),
        incrementParticipants: (c, id) => patch(ch(c, id), d => { d.participantCount = Number(d.participantCount) + 1; }),
        incrementCompleted: (c, id) => patch(ch(c, id), d => { d.completedCount = Number(d.completedCount) + 1; }),
        createNotice: (u, id, notice) => pending.push(() => {
          if (this.docs.has(`users/${u}/notifications/${id}`)) throw new Error("ALREADY_EXISTS");
          this.put(`users/${u}/notifications/${id}`, { userId: u, ...notice, isRead: false }); this.writes++;
        }),
        createAward: (c, a, entry: LedgerEntry) => pending.push(() => {
          if (this.docs.has(`companies/${c}/pointTransactions/${a}`)) throw new Error("ALREADY_EXISTS");
          this.put(`companies/${c}/pointTransactions/${a}`, { ...entry }); this.writes++;
        }),
        incrementBalance: (u, amount) => patch(`users/${u}`, d => { d.pointsBalance = Number(d.pointsBalance) + amount; }),
      };
      const result = await work(tx); await tick();
      if ([...seen].some(([p, v]) => (this.docs.get(p)?.version ?? 0) !== v)) continue;
      for (const apply of pending) apply();
      return result;
    }
    throw new Error("contention");
  }
}

class Objects implements PhotoObjects {
  objects = new Map<string, StoredObject>();
  removed: string[] = [];
  async inspect(p: string) { return this.objects.get(p) ?? null; }
  async remove(p: string) { this.removed.push(p); this.objects.delete(p); }
}

function world() {
  const store = new Store();
  const objects = new Objects();
  store.put("users/alice", { companyId: "alpha", role: "member", displayName: "Alice", avatarId: "a1", pointsBalance: 10 });
  store.put("users/bob", { companyId: "alpha", role: "member", displayName: "Bob", avatarId: "a2", pointsBalance: 0 });
  store.put("users/boss", { companyId: "alpha", role: "admin", displayName: "Boss", avatarId: "a3", pointsBalance: 0 });
  store.put("users/otherboss", { companyId: "beta", role: "admin", displayName: "Other", avatarId: "a4", pointsBalance: 0 });
  store.put("users/stranger", { companyId: "beta", role: "member", displayName: "Stranger", avatarId: "a5", pointsBalance: 0 });
  store.put("companies/alpha/challenges/week1", {
    companyId: "alpha", goal: 5, pointsReward: 50, participantCount: 0, completedCount: 0,
    startDate: new Date("2030-01-01T00:00:00Z"), endDate: new Date("2030-01-07T23:59:59Z"),
  });
  return { store, objects };
}
const subDoc = (store: Store, uid = "alice") => store.get(`companies/alpha/challenges/week1/submissions/${submissionId("week1", uid)}`);

test("submit creates the member's own submission with server-owned fields and counts the participant once", async () => {
  const { store, objects } = world();
  const result = await submitChallenge(store, objects, caller(), request(), now);
  assert.deepEqual(result, { contractVersion: 1, submissionId: "week1_alice", status: "submitted", outcome: "created", attempt: 1 });
  const doc = subDoc(store)!;
  assert.equal(doc.userId, "alice");
  assert.equal(doc.userName, "Alice");
  assert.equal(doc.status, "submitted");
  assert.equal(doc.pointsAwarded, 0);
  assert.equal(doc.storagePath, null);
  assert.equal(store.get("companies/alpha/challenges/week1")!.participantCount, 1);
  assert.equal(store.get("users/alice")!.pointsBalance, 10);
});

test("a retry or concurrent double tap is idempotent: one submission, one participant", async () => {
  const { store, objects } = world();
  const results = await Promise.all([1, 2, 3].map(() => submitChallenge(store, objects, caller(), request(), now)));
  assert.equal(results.filter(r => r.outcome === "created").length, 1);
  assert.equal(results.filter(r => r.outcome === "unchanged").length, 2);
  assert.equal(store.get("companies/alpha/challenges/week1")!.participantCount, 1);
  const writes = store.writes;
  assert.equal((await submitChallenge(store, objects, caller(), request(), now)).outcome, "unchanged");
  assert.equal(store.writes, writes);
});

test("evidence is verified, referenced and kept on identical retries", async () => {
  const { store, objects } = world();
  assert.equal(await reason(submitChallenge(store, objects, caller(), request({ storagePath: path() }), now)), "UPLOAD_NOT_FOUND");
  objects.objects.set(path(), { size: 2048, contentType: "image/jpeg", head: JPEG });
  const result = await submitChallenge(store, objects, caller(), request({ storagePath: path() }), now);
  assert.equal(result.outcome, "created");
  assert.equal(subDoc(store)!.contentType, "image/jpeg");
  assert.equal(subDoc(store)!.sizeBytes, 2048);
  objects.objects.delete(path());
  assert.equal((await submitChallenge(store, objects, caller(), request({ storagePath: path() }), now)).outcome, "unchanged");
});

test("an invalid evidence object is rejected and deleted, which frees the slot", async () => {
  const { store, objects } = world();
  objects.objects.set(path(), { size: 10, contentType: "image/jpeg", head: new Uint8Array([1, 2, 3, 4]) });
  assert.equal(await reason(submitChallenge(store, objects, caller(), request({ storagePath: path() }), now)), "UPLOAD_INVALID");
  assert.deepEqual(objects.removed, [path()]);
  assert.equal(subDoc(store), undefined);
});

test("evidence paths of other members, challenges, companies or slots fail before any read", async () => {
  const { store, objects } = world();
  for (const storagePath of [path("bob"), evidencePath("beta", "week1", "alice", 0), evidencePath("alpha", "week2", "alice", 0), evidencePath("alpha", "week1", "alice", 5), "x"]) {
    assert.equal(await reason(submitChallenge(store, objects, caller(), request({ storagePath }), now)), "VALIDATION_FAILED");
  }
  assert.equal(store.writes, 0);
});

test("validation: unknown keys, status/points/user spoofing, bad progress and captions", async () => {
  const { store, objects } = world();
  for (const patch of [{ status: "approved" }, { pointsAwarded: 50 }, { userId: "bob" }, { progress: 0 }, { progress: -1 }, { progress: NaN },
    { progress: "3" }, { progress: 10001 }, { caption: " padded " }, { caption: "x".repeat(281) }, { contractVersion: 2 }, { companyId: "a/b" }]) {
    assert.equal(await reason(submitChallenge(store, objects, caller(), request(patch), now)), "VALIDATION_FAILED", JSON.stringify(patch));
  }
  assert.equal(await reason(submitChallenge(store, objects, caller(), request({ progress: 6 }), now)), "VALIDATION_FAILED");
  assert.throws(() => parseSubmitRequest(null, "alice"));
  assert.equal(parseSubmitRequest(request({ caption: undefined }), "alice").caption, "");
});

test("authorization: signed out, unverified, non-Google, other company, missing challenge", async () => {
  const { store, objects } = world();
  assert.equal(await reason(submitChallenge(store, objects, null, request(), now)), "UNAUTHENTICATED");
  assert.equal(await reason(submitChallenge(store, objects, { ...caller(), emailVerified: false }, request(), now)), "EMAIL_NOT_VERIFIED");
  assert.equal(await reason(submitChallenge(store, objects, { ...caller(), signInProvider: "password" }, request(), now)), "PROVIDER_NOT_ALLOWED");
  assert.equal(await reason(submitChallenge(store, objects, caller("stranger"), request(), now)), "MEMBERSHIP_CONFLICT");
  assert.equal(await reason(submitChallenge(store, objects, caller("nobody"), request(), now)), "MEMBERSHIP_CONFLICT");
  assert.equal(await reason(submitChallenge(store, objects, caller(), request({ challengeId: "nope" }), now)), "CHALLENGE_NOT_FOUND");
  assert.equal(store.writes, 0);
});

test("the window must be open: before the start and after the end are refused", async () => {
  const { store, objects } = world();
  assert.equal(await reason(submitChallenge(store, objects, caller(), request(), () => new Date("2029-12-31T23:59:59Z"))), "CHALLENGE_NOT_OPEN");
  assert.equal(await reason(submitChallenge(store, objects, caller(), request(), () => new Date("2030-01-08T00:00:00Z"))), "CHALLENGE_CLOSED");
  assert.equal(store.writes, 0);
});

test("pending submissions can be edited; approved ones are locked", async () => {
  const { store, objects } = world();
  await submitChallenge(store, objects, caller(), request(), now);
  const edited = await submitChallenge(store, objects, caller(), request({ progress: 4, caption: "More" }), now);
  assert.equal(edited.outcome, "updated");
  assert.equal(subDoc(store)!.progress, 4);
  assert.equal(store.get("companies/alpha/challenges/week1")!.participantCount, 1);
  await approveChallenge(store, caller("boss"), review());
  assert.equal(await reason(submitChallenge(store, objects, caller(), request({ progress: 5 }), now)), "SUBMISSION_LOCKED");
  // Re-opening the approved entry with identical content is a harmless replay.
  assert.equal((await submitChallenge(store, objects, caller(), request({ progress: 4, caption: "More" }), now)).outcome, "unchanged");
});

test("approval and rejection leave one create-only in-app notice for the member (never on replay)", async () => {
  const { store, objects } = world();
  await submitChallenge(store, objects, caller(), request(), now);
  await approveChallenge(store, caller("boss"), review());
  await approveChallenge(store, caller("boss"), review());
  const notice = store.get("users/alice/notifications/challenge_approved_week1")!;
  assert.equal(notice.type, "challenge_approved");
  assert.equal(notice.body, "You earned 50 points.");
  assert.equal(notice.targetId, "week1");
  assert.equal(notice.isRead, false);
});

test("approval awards points once through the ledger, balance, submission and completed count atomically", async () => {
  const { store, objects } = world();
  await submitChallenge(store, objects, caller(), request(), now);
  const result = await approveChallenge(store, caller("boss"), review());
  assert.deepEqual(result, { contractVersion: 1, submissionId: "week1_alice", pointsAwarded: 50, replayed: false });
  assert.equal(store.get("users/alice")!.pointsBalance, 60);
  assert.equal(subDoc(store)!.status, "approved");
  assert.equal(subDoc(store)!.pointsAwarded, 50);
  assert.equal(subDoc(store)!.reviewedBy, "boss");
  assert.equal(store.get("companies/alpha/challenges/week1")!.completedCount, 1);
  assert.deepEqual(store.get(`companies/alpha/pointTransactions/${awardId("week1", "alice")}`), {
    companyId: "alpha", userId: "alice", amount: 50, reason: "challenge_approved", sourceId: "week1",
  });
});

test("concurrent and repeated approvals award exactly once", async () => {
  const { store, objects } = world();
  await submitChallenge(store, objects, caller(), request(), now);
  const results = await Promise.all([1, 2, 3].map(() => approveChallenge(store, caller("boss"), review())));
  assert.equal(results.filter(r => !r.replayed).length, 1);
  assert.equal(results.reduce((sum, r) => sum + r.pointsAwarded, 0), 50);
  const again = await approveChallenge(store, caller("boss"), review());
  assert.deepEqual([again.pointsAwarded, again.replayed], [0, true]);
  assert.equal(store.get("users/alice")!.pointsBalance, 60);
  assert.equal(store.get("companies/alpha/challenges/week1")!.completedCount, 1);
});

test("an existing ledger entry never double-awards even if the submission looks pending", async () => {
  const { store, objects } = world();
  await submitChallenge(store, objects, caller(), request(), now);
  store.put(`companies/alpha/pointTransactions/${awardId("week1", "alice")}`, { amount: 50 });
  const result = await approveChallenge(store, caller("boss"), review());
  assert.equal(result.pointsAwarded, 0);
  assert.equal(store.get("users/alice")!.pointsBalance, 10);
});

test("a zero-point theme approves without a ledger entry", async () => {
  const { store, objects } = world();
  store.put("companies/alpha/challenges/week1", { ...store.get("companies/alpha/challenges/week1")!, pointsReward: 0 });
  await submitChallenge(store, objects, caller(), request(), now);
  assert.equal((await approveChallenge(store, caller("boss"), review())).pointsAwarded, 0);
  assert.equal(store.get(`companies/alpha/pointTransactions/${awardId("week1", "alice")}`), undefined);
  assert.equal(subDoc(store)!.status, "approved");
});

test("review authorization: members, other-company organizers, self review and unknown targets", async () => {
  const { store, objects } = world();
  await submitChallenge(store, objects, caller(), request(), now);
  assert.equal(await reason(approveChallenge(store, null, review())), "UNAUTHENTICATED");
  assert.equal(await reason(approveChallenge(store, caller("bob"), review())), "NOT_ORGANIZER");
  assert.equal(await reason(approveChallenge(store, caller("alice"), review())), "NOT_ORGANIZER");
  assert.equal(await reason(approveChallenge(store, caller("otherboss"), review())), "COMPANY_MISMATCH");
  assert.equal(await reason(approveChallenge(store, caller("boss"), review({ userId: "bob" }))), "SUBMISSION_NOT_FOUND");
  assert.equal(await reason(approveChallenge(store, caller("boss"), review({ challengeId: "nope" }))), "CHALLENGE_NOT_FOUND");
  assert.equal(await reason(approveChallenge(store, caller("boss"), review({ points: 1000 }))), "VALIDATION_FAILED");
  store.put("companies/alpha/challenges/week1/submissions/week1_boss", { ...subDoc(store)!, userId: "boss" });
  assert.equal(await reason(approveChallenge(store, caller("boss"), review({ userId: "boss" }))), "SELF_REVIEW");
  assert.equal(subDoc(store)!.status, "submitted");
  assert.equal(store.get("users/alice")!.pointsBalance, 10);
});

test("rejection records a reason, allows resubmission as a new attempt, then approval pays once", async () => {
  const { store, objects } = world();
  await submitChallenge(store, objects, caller(), request(), now);
  assert.equal(await reason(rejectChallenge(store, caller("boss"), review({ reason: "" }))), "VALIDATION_FAILED");
  const rejected = await rejectChallenge(store, caller("boss"), review({ reason: "Photo is blurry" }));
  assert.deepEqual(rejected, { contractVersion: 1, submissionId: "week1_alice", status: "rejected", replayed: false });
  assert.equal(subDoc(store)!.reviewNote, "Photo is blurry");
  assert.equal((await rejectChallenge(store, caller("boss"), review({ reason: "Photo is blurry" }))).replayed, true);
  assert.equal(await reason(approveChallenge(store, caller("boss"), review())), "SUBMISSION_NOT_PENDING");
  objects.objects.set(path("alice", 1), { size: 2048, contentType: "image/jpeg", head: JPEG });
  const again = await submitChallenge(store, objects, caller(), request({ storagePath: path("alice", 1) }), now);
  assert.deepEqual([again.outcome, again.attempt, again.status], ["resubmitted", 2, "submitted"]);
  assert.equal(subDoc(store)!.reviewNote, null);
  assert.equal(store.get("companies/alpha/challenges/week1")!.participantCount, 1);
  assert.equal((await approveChallenge(store, caller("boss"), review())).pointsAwarded, 50);
  assert.equal(await reason(rejectChallenge(store, caller("boss"), review({ reason: "late" }))), "SUBMISSION_LOCKED");
});

test("rejecting requires an organizer of the same company", async () => {
  const { store, objects } = world();
  await submitChallenge(store, objects, caller(), request(), now);
  assert.equal(await reason(rejectChallenge(store, caller("bob"), review({ reason: "no" }))), "NOT_ORGANIZER");
  assert.equal(await reason(rejectChallenge(store, caller("otherboss"), review({ reason: "no" }))), "COMPANY_MISMATCH");
  assert.equal(subDoc(store)!.status, "submitted");
});

test("the review queue lists only the organizer's company, filtered and paged", async () => {
  const { store, objects } = world();
  for (const uid of ["alice", "bob"]) await submitChallenge(store, objects, caller(uid), request(), now);
  await approveChallenge(store, caller("boss"), review({ userId: "bob" }));
  const all = await listChallengeSubmissions(store, caller("boss"), { contractVersion: 1, companyId: "alpha", challengeId: "week1", limit: 1 });
  assert.equal(all.submissions.length, 1);
  assert.equal(all.submissions[0].id, "week1_alice");
  assert.equal(all.nextCursor, "week1_alice");
  const next = await listChallengeSubmissions(store, caller("boss"), { contractVersion: 1, companyId: "alpha", challengeId: "week1", limit: 1, cursor: all.nextCursor! });
  assert.deepEqual([next.submissions[0].id, next.submissions[0].status, next.nextCursor], ["week1_bob", "approved", null]);
  const pending = await listChallengeSubmissions(store, caller("boss"), { contractVersion: 1, companyId: "alpha", challengeId: "week1", status: "submitted" });
  assert.deepEqual(pending.submissions.map(s => s.userId), ["alice"]);
  assert.equal(pending.submissions[0].photoURL, null);
  assert.equal(await reason(listChallengeSubmissions(store, caller("bob"), { contractVersion: 1, companyId: "alpha", challengeId: "week1" })), "NOT_ORGANIZER");
  assert.equal(await reason(listChallengeSubmissions(store, caller("otherboss"), { contractVersion: 1, companyId: "alpha", challengeId: "week1" })), "COMPANY_MISMATCH");
  assert.equal(await reason(listChallengeSubmissions(store, caller("boss"), { contractVersion: 1, companyId: "alpha", challengeId: "week1", limit: 51 })), "VALIDATION_FAILED");
});

test("transport maps domain errors to callable errors and hides internals", async () => {
  const { store, objects } = world();
  const missing = toHttpsError(new SubmissionError("permission-denied", "NOT_ORGANIZER", "Only organizers."));
  assert.equal(missing.code, "permission-denied");
  assert.deepEqual(missing.details, { reason: "NOT_ORGANIZER" });
  const generic = toHttpsError(new Error("secret db path"));
  assert.equal(generic.code, "internal");
  assert.ok(!generic.message.includes("secret"));
  await assert.rejects(handleSubmitChallenge(store, objects, { auth: undefined, data: request() } as never, now), (e: unknown) => (e as { code: string }).code === "unauthenticated");
  const ok = await handleSubmitChallenge(store, objects, {
    auth: { uid: "alice", token: { email_verified: true, firebase: { sign_in_provider: "google.com" } } }, data: request(),
  } as never, now);
  assert.equal(ok.outcome, "created");
});

test("approval and rejection are refused when the member changed the entry after the organizer's list", async () => {
  const { store, objects } = world();
  await submitChallenge(store, objects, caller(), request(), now);
  const queue = await listChallengeSubmissions(store, caller("boss"), { contractVersion: 1, companyId: "alpha", challengeId: "week1" });
  const seen = queue.submissions[0].updatedAt;
  await submitChallenge(store, objects, caller(), request({ progress: 4, caption: "Edited after listing" }), now);
  assert.equal(await reason(approveChallenge(store, caller("boss"), review({ expectedUpdatedAt: seen }))), "SUBMISSION_CHANGED");
  assert.equal(await reason(rejectChallenge(store, caller("boss"), review({ reason: "no", expectedUpdatedAt: seen }))), "SUBMISSION_CHANGED");
  assert.equal(subDoc(store)!.status, "submitted");
  assert.equal(store.get("users/alice")!.pointsBalance, 10);
  const fresh = (await listChallengeSubmissions(store, caller("boss"), { contractVersion: 1, companyId: "alpha", challengeId: "week1" })).submissions[0].updatedAt;
  assert.equal((await approveChallenge(store, caller("boss"), review({ expectedUpdatedAt: fresh }))).pointsAwarded, 50);
  assert.equal(await reason(approveChallenge(store, caller("boss"), review({ expectedUpdatedAt: "not a date" }))), "VALIDATION_FAILED");
});

test("deactivated members and reviewers are refused; the organizer role may submit", async () => {
  const { store, objects } = world();
  store.put("users/gone", { companyId: "alpha", role: "member", status: "deactivated", displayName: "Gone", avatarId: "a", pointsBalance: 0 });
  store.put("users/orga", { companyId: "alpha", role: "organizer", displayName: "Orga", avatarId: "a", pointsBalance: 0 });
  assert.equal(await reason(submitChallenge(store, objects, caller("gone"), request(), now)), "ACCOUNT_DEACTIVATED");
  assert.equal((await submitChallenge(store, objects, caller("orga"), request(), now)).outcome, "created");
  await submitChallenge(store, objects, caller("alice"), request(), now);
  store.put("users/boss", { ...store.get("users/boss")!, status: "deactivated" });
  assert.equal(await reason(approveChallenge(store, caller("boss"), review())), "ACCOUNT_DEACTIVATED");
  assert.equal(await reason(listChallengeSubmissions(store, caller("boss"), { contractVersion: 1, companyId: "alpha", challengeId: "week1" })), "ACCOUNT_DEACTIVATED");
  store.put("users/boss", { ...store.get("users/boss")!, status: "active" });
  store.put("users/alice", { ...store.get("users/alice")!, status: "deactivated" });
  assert.equal(await reason(approveChallenge(store, caller("boss"), review())), "SUBMITTER_NOT_FOUND");
  assert.equal(store.get("users/alice")!.pointsBalance, 10);
});
