import type {
  ApproveChallengeResponse, ListChallengeSubmissionsResponse, RejectChallengeResponse, SubmitChallengeResponse,
} from "../../../generated/models";
import type { PhotoObjects } from "../../photos/application/ports";
import { validWireId, validateUpload, type PhotoContentType } from "../../photos/domain/photoPolicy";
import { SubmissionError } from "../domain/errors";
import {
  awardId, iso, parseApproveRequest, parseListRequest, parseRejectRequest, parseSubmitRequest, submissionId, toSubmissionDto,
} from "../domain/submissionPolicy";
import type { SubmissionCaller, SubmissionStore, SubmissionTransaction, SubmissionWrite } from "./ports";

type Clock = () => Date;

function requireCaller(caller: SubmissionCaller | null): SubmissionCaller {
  if (!caller || !validWireId(caller.uid)) throw new SubmissionError("unauthenticated", "UNAUTHENTICATED", "Sign in again.");
  if (!caller.emailVerified) throw new SubmissionError("permission-denied", "EMAIL_NOT_VERIFIED", "Verified email required.");
  if (caller.signInProvider !== "google.com") throw new SubmissionError("permission-denied", "PROVIDER_NOT_ALLOWED", "Google sign-in required.");
  return caller;
}

const text = (value: unknown) => (typeof value === "string" ? value : "");
/** Server-owned account status (docs/contracts/admin.md): a deactivated account is refused everywhere. */
const deactivated = (member: Record<string, unknown> | null) => member?.status === "deactivated";

/**
 * submitChallengeV1: the caller's own submission `{challengeId}_{uid}`.
 *
 * Authorization (membership, window) and the idempotency read run in one transaction. Identical content for a
 * pending submission is a replay (`unchanged`, no writes); different content while pending updates it; a rejected
 * submission may be resubmitted (attempt + 1); an approved one is locked. Status, counters and points are never
 * taken from the client. An evidence object that fails validation is deleted afterwards, which frees its slot.
 */
export async function submitChallenge(store: SubmissionStore, objects: PhotoObjects, caller: SubmissionCaller | null,
  data: unknown, now: Clock = () => new Date()): Promise<SubmitChallengeResponse> {
  const { uid } = requireCaller(caller);
  const request = parseSubmitRequest(data, uid);
  const { companyId, challengeId, progress, caption, storagePath } = request;
  const id = submissionId(challengeId, uid);
  let invalidObject = false;
  try {
    return await store.runTransaction(async tx => {
      invalidObject = false;
      const member = await tx.getMember(uid);
      if (!member || member.companyId !== companyId || !["member", "organizer", "admin"].includes(member.role as string)) {
        throw new SubmissionError("permission-denied", "MEMBERSHIP_CONFLICT", "Company membership required.");
      }
      if (deactivated(member)) throw new SubmissionError("permission-denied", "ACCOUNT_DEACTIVATED", "This account is deactivated.");
      const challenge = await tx.getChallenge(companyId, challengeId);
      if (!challenge) throw new SubmissionError("not-found", "CHALLENGE_NOT_FOUND", "Weekly theme not found.");
      const existing = await tx.getSubmission(companyId, challengeId, id);
      const same = existing !== null && existing.progress === progress && existing.caption === caption
        && existing.storagePath === storagePath;
      if (existing && same && existing.status !== "rejected") {
        // Replay (a lost response, a double tap, or re-opening an approved entry): no writes, no window check.
        return { contractVersion: 1, submissionId: id, status: existing.status, outcome: "unchanged", attempt: existing.attempt } satisfies SubmitChallengeResponse;
      }
      if (existing?.status === "approved") {
        throw new SubmissionError("failed-precondition", "SUBMISSION_LOCKED", "This entry was already approved.");
      }
      const time = now().getTime();
      if (time < challenge.startDate.getTime()) throw new SubmissionError("failed-precondition", "CHALLENGE_NOT_OPEN", "This theme has not started yet.");
      if (time > challenge.endDate.getTime()) throw new SubmissionError("failed-precondition", "CHALLENGE_CLOSED", "This theme has ended.");
      if (progress > challenge.goal) throw new SubmissionError("invalid-argument", "VALIDATION_FAILED", "Invalid request.", ["progress"]);
      let contentType: PhotoContentType | null = existing && existing.storagePath === storagePath ? (existing.contentType as PhotoContentType | null) : null;
      let sizeBytes = existing && existing.storagePath === storagePath ? existing.sizeBytes : null;
      if (storagePath && (!existing || existing.storagePath !== storagePath)) {
        const object = await objects.inspect(storagePath);
        if (!object) throw new SubmissionError("failed-precondition", "UPLOAD_NOT_FOUND", "Upload the photo before submitting.");
        try {
          contentType = validateUpload(object);
        } catch {
          invalidObject = true;
          throw new SubmissionError("failed-precondition", "UPLOAD_INVALID", "The uploaded file is not an accepted photo.");
        }
        sizeBytes = object.size;
      }
      const write: SubmissionWrite = {
        companyId, challengeId, userId: uid, userName: text(member.displayName), userAvatarId: text(member.avatarId),
        caption, progress, status: "submitted", storagePath, contentType: storagePath ? contentType : null,
        sizeBytes: storagePath ? sizeBytes : null, attempt: existing ? existing.attempt : 1,
        reviewedBy: null, reviewedAt: null, reviewNote: null, pointsAwarded: 0,
      };
      if (!existing) {
        tx.createSubmission(companyId, challengeId, id, write);
        tx.incrementParticipants(companyId, challengeId);
        return { contractVersion: 1, submissionId: id, status: "submitted", outcome: "created", attempt: 1 } satisfies SubmitChallengeResponse;
      }
      const resubmitted = existing.status === "rejected";
      write.attempt = existing.attempt + (resubmitted ? 1 : 0);
      tx.replaceSubmission(companyId, challengeId, id, write);
      return { contractVersion: 1, submissionId: id, status: "submitted", outcome: resubmitted ? "resubmitted" : "updated", attempt: write.attempt } satisfies SubmitChallengeResponse;
    });
  } catch (error) {
    if (invalidObject && storagePath) await objects.remove(storagePath).catch(() => undefined);
    throw error;
  }
}

/** Organizer authorization from the server-owned membership; the supplied companyId must be the caller's own. */
async function requireOrganizer(getMember: (uid: string) => Promise<Record<string, unknown> | null>, uid: string, companyId: string) {
  const member = await getMember(uid);
  if (!member || member.role !== "admin") throw new SubmissionError("permission-denied", "NOT_ORGANIZER", "Only organizers can review submissions.");
  if (deactivated(member)) throw new SubmissionError("permission-denied", "ACCOUNT_DEACTIVATED", "This account is deactivated.");
  if (member.companyId !== companyId) throw new SubmissionError("permission-denied", "COMPANY_MISMATCH", "You can only review your own company's submissions.");
}

async function loadForReview(tx: SubmissionTransaction, caller: SubmissionCaller, companyId: string, challengeId: string, userId: string) {
  await requireOrganizer(uid => tx.getMember(uid), caller.uid, companyId);
  if (userId === caller.uid) throw new SubmissionError("permission-denied", "SELF_REVIEW", "You cannot review your own submission.");
  const challenge = await tx.getChallenge(companyId, challengeId);
  if (!challenge) throw new SubmissionError("not-found", "CHALLENGE_NOT_FOUND", "Weekly theme not found.");
  const id = submissionId(challengeId, userId);
  const submission = await tx.getSubmission(companyId, challengeId, id);
  if (!submission) throw new SubmissionError("not-found", "SUBMISSION_NOT_FOUND", "Submission not found.");
  return { challenge, id, submission };
}

/** The organizer decides on what they saw: a pending entry the member edited since (updatedAt differs) is refused. */
function requireUnchanged(submission: { updatedAt: Date }, expectedUpdatedAt: string | null) {
  if (expectedUpdatedAt !== null && iso(submission.updatedAt) !== expectedUpdatedAt) {
    throw new SubmissionError("failed-precondition", "SUBMISSION_CHANGED", "The member changed this entry. Reload it and review again.");
  }
}

/**
 * approveChallengeV1: pending -> approved, awarding the challenge's points once. The ledger entry ID is
 * deterministic (`challenge_{challengeId}_{uid}`), and the entry, the balance, the submission and the
 * completed count change in one transaction; a repeat approval awards 0 and reports `replayed`.
 */
export async function approveChallenge(store: SubmissionStore, caller: SubmissionCaller | null, data: unknown): Promise<ApproveChallengeResponse> {
  const reviewer = requireCaller(caller);
  const { companyId, challengeId, userId, expectedUpdatedAt } = parseApproveRequest(data);
  return store.runTransaction(async tx => {
    const { challenge, id, submission } = await loadForReview(tx, reviewer, companyId, challengeId, userId);
    if (submission.status === "approved") return { contractVersion: 1, submissionId: id, pointsAwarded: 0, replayed: true } satisfies ApproveChallengeResponse;
    if (submission.status !== "submitted") throw new SubmissionError("failed-precondition", "SUBMISSION_NOT_PENDING", "Only pending submissions can be approved.");
    requireUnchanged(submission, expectedUpdatedAt);
    const submitter = await tx.getMember(userId);
    if (!submitter || submitter.companyId !== companyId || deactivated(submitter)) throw new SubmissionError("not-found", "SUBMITTER_NOT_FOUND", "The member is no longer in this company.");
    const alreadyAwarded = await tx.getAward(companyId, awardId(challengeId, userId));
    const points = alreadyAwarded ? 0 : challenge.pointsReward;
    tx.reviewSubmission(companyId, challengeId, id, { status: "approved", reviewedBy: reviewer.uid, reviewNote: null, pointsAwarded: points });
    tx.incrementCompleted(companyId, challengeId);
    tx.createNotice(userId, `challenge_approved_${challengeId}`, {
      companyId, type: "challenge_approved", title: "Challenge approved",
      body: points > 0 ? `You earned ${points} ${points === 1 ? "point" : "points"}.` : "Your entry was approved.",
      targetType: "challenge", targetId: challengeId,
    });
    if (points > 0) {
      tx.createAward(companyId, awardId(challengeId, userId), { companyId, userId, amount: points, reason: "challenge_approved", sourceId: challengeId });
      tx.incrementBalance(userId, points);
    }
    return { contractVersion: 1, submissionId: id, pointsAwarded: points, replayed: false } satisfies ApproveChallengeResponse;
  });
}

/** rejectChallengeV1: pending -> rejected with a reason. Approved entries are final; a repeat is a replay. */
export async function rejectChallenge(store: SubmissionStore, caller: SubmissionCaller | null, data: unknown): Promise<RejectChallengeResponse> {
  const reviewer = requireCaller(caller);
  const { companyId, challengeId, userId, reason, expectedUpdatedAt } = parseRejectRequest(data);
  return store.runTransaction(async tx => {
    const { id, submission } = await loadForReview(tx, reviewer, companyId, challengeId, userId);
    if (submission.status === "rejected") return { contractVersion: 1, submissionId: id, status: "rejected", replayed: true } satisfies RejectChallengeResponse;
    if (submission.status === "approved") throw new SubmissionError("failed-precondition", "SUBMISSION_LOCKED", "This entry was already approved.");
    requireUnchanged(submission, expectedUpdatedAt);
    tx.reviewSubmission(companyId, challengeId, id, { status: "rejected", reviewedBy: reviewer.uid, reviewNote: reason, pointsAwarded: 0 });
    // One notice per attempt (a resubmission that is rejected again gets its own).
    tx.createNotice(userId, `challenge_changes_${challengeId}_${submission.attempt}`, {
      companyId, type: "challenge_changes_requested", title: "Changes needed",
      body: [...reason].slice(0, 200).join("") || "Your reviewer asked for changes.", targetType: "challenge", targetId: challengeId,
    });
    return { contractVersion: 1, submissionId: id, status: "rejected", replayed: false } satisfies RejectChallengeResponse;
  });
}

/** listChallengeSubmissionsV1: the organizer's review queue (own company only), paged by submission ID. */
export async function listChallengeSubmissions(store: SubmissionStore, caller: SubmissionCaller | null, data: unknown): Promise<ListChallengeSubmissionsResponse> {
  const reviewer = requireCaller(caller);
  const { companyId, challengeId, status, limit, cursor } = parseListRequest(data);
  await requireOrganizer(uid => store.getMember(uid), reviewer.uid, companyId);
  const page = await store.list(companyId, challengeId, status, limit, cursor);
  return { contractVersion: 1, submissions: page.items.map(item => toSubmissionDto(item.id, item.submission)), nextCursor: page.nextCursor };
}
