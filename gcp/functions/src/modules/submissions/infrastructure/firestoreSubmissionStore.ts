import { FieldValue, FieldPath, Timestamp, type DocumentData, type Firestore } from "firebase-admin/firestore";
import type { Document, SubmissionChallenge, SubmissionPage, SubmissionStore, SubmissionTransaction } from "../application/ports";
import { SubmissionError } from "../domain/errors";
import { SUBMISSION_STATUSES, type StoredSubmission, type SubmissionStatus } from "../domain/submissionPolicy";

const toDate = (value: unknown): Date | null => (value instanceof Timestamp ? value.toDate() : null);

function invalid(): never {
  throw new SubmissionError("internal", "INVALID_STORED_DATA", "Invalid stored submission data.");
}

/** Reads a stored submission defensively; a malformed document is a server fault, never a client error. */
export function readSubmission(data: DocumentData | undefined): StoredSubmission | null {
  if (!data) return null;
  const status = data.status;
  const createdAt = toDate(data.createdAt);
  const updatedAt = toDate(data.updatedAt);
  if (!SUBMISSION_STATUSES.includes(status) || !createdAt || !updatedAt || typeof data.progress !== "number") invalid();
  const str = (key: string) => (typeof data[key] === "string" ? (data[key] as string) : "");
  const optionalString = (key: string) => (typeof data[key] === "string" ? (data[key] as string) : null);
  return {
    companyId: str("companyId"), challengeId: str("challengeId"), userId: str("userId"), userName: str("userName"),
    userAvatarId: str("userAvatarId"), caption: str("caption"), progress: data.progress as number, status: status as SubmissionStatus,
    storagePath: optionalString("storagePath"), contentType: optionalString("contentType"),
    sizeBytes: typeof data.sizeBytes === "number" ? data.sizeBytes : null,
    attempt: Number.isInteger(data.attempt) && data.attempt >= 1 ? data.attempt : 1,
    reviewedBy: optionalString("reviewedBy"), reviewedAt: toDate(data.reviewedAt), reviewNote: optionalString("reviewNote"),
    pointsAwarded: Number.isInteger(data.pointsAwarded) ? data.pointsAwarded : 0, createdAt, updatedAt,
  };
}

export class FirestoreSubmissionStore implements SubmissionStore {
  constructor(private readonly db: Firestore) {}

  private challenge(companyId: string, challengeId: string) {
    return this.db.collection("companies").doc(companyId).collection("challenges").doc(challengeId);
  }

  private submissions(companyId: string, challengeId: string) {
    return this.challenge(companyId, challengeId).collection("submissions");
  }

  private award(companyId: string, awardId: string) {
    return this.db.collection("companies").doc(companyId).collection("pointTransactions").doc(awardId);
  }

  async getMember(uid: string): Promise<Document | null> {
    return (await this.db.collection("users").doc(uid).get()).data() ?? null;
  }

  runTransaction<T>(work: (tx: SubmissionTransaction) => Promise<T>): Promise<T> {
    return this.db.runTransaction(async transaction => {
      const tx: SubmissionTransaction = {
        getMember: async uid => (await transaction.get(this.db.collection("users").doc(uid))).data() ?? null,
        getChallenge: async (companyId, challengeId): Promise<SubmissionChallenge | null> => {
          const data = (await transaction.get(this.challenge(companyId, challengeId))).data();
          if (!data) return null;
          const startDate = toDate(data.startDate);
          const endDate = toDate(data.endDate);
          if (data.companyId !== companyId || !startDate || !endDate || typeof data.goal !== "number" || !Number.isInteger(data.pointsReward)) invalid();
          return { companyId, startDate, endDate, goal: data.goal, pointsReward: data.pointsReward };
        },
        getSubmission: async (companyId, challengeId, id) =>
          readSubmission((await transaction.get(this.submissions(companyId, challengeId).doc(id))).data()),
        getAward: async (companyId, awardId) => (await transaction.get(this.award(companyId, awardId))).exists,
        createSubmission: (companyId, challengeId, id, data) => {
          transaction.create(this.submissions(companyId, challengeId).doc(id),
            { ...data, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
        },
        replaceSubmission: (companyId, challengeId, id, data) => {
          // Merge keeps createdAt; every other field is written explicitly.
          transaction.set(this.submissions(companyId, challengeId).doc(id), { ...data, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        },
        reviewSubmission: (companyId, challengeId, id, data) => {
          transaction.update(this.submissions(companyId, challengeId).doc(id), {
            status: data.status, reviewedBy: data.reviewedBy, reviewedAt: FieldValue.serverTimestamp(),
            reviewNote: data.reviewNote, pointsAwarded: data.pointsAwarded, updatedAt: FieldValue.serverTimestamp(),
          });
        },
        incrementParticipants: (companyId, challengeId) => {
          transaction.update(this.challenge(companyId, challengeId), { participantCount: FieldValue.increment(1) });
        },
        incrementCompleted: (companyId, challengeId) => {
          transaction.update(this.challenge(companyId, challengeId), { completedCount: FieldValue.increment(1) });
        },
        createNotice: (uid, id, notice) => {
          // Create-only inside the review transaction: a replay never gets here, and an existing notice is never reset to unread.
          transaction.create(this.db.collection("users").doc(uid).collection("notifications").doc(id),
            { userId: uid, ...notice, isRead: false, createdAt: FieldValue.serverTimestamp() });
        },
        createAward: (companyId, awardId, entry) => {
          transaction.create(this.award(companyId, awardId), { ...entry, createdAt: FieldValue.serverTimestamp() });
        },
        incrementBalance: (uid, amount) => {
          transaction.update(this.db.collection("users").doc(uid), { pointsBalance: FieldValue.increment(amount) });
        },
      };
      return work(tx);
    });
  }

  async list(companyId: string, challengeId: string, status: SubmissionStatus | null, limit: number, cursor: string | null): Promise<SubmissionPage> {
    let query = this.submissions(companyId, challengeId).orderBy(FieldPath.documentId());
    if (status) query = query.where("status", "==", status);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.limit(limit + 1).get();
    const docs = snapshot.docs.slice(0, limit);
    // One malformed document must not block the whole review queue: it is skipped (and left for tooling).
    const items: { id: string; submission: StoredSubmission }[] = [];
    for (const doc of docs) {
      try { items.push({ id: doc.id, submission: readSubmission(doc.data()) as StoredSubmission }); } catch { /* skipped */ }
    }
    return { items, nextCursor: snapshot.docs.length > limit ? docs[docs.length - 1]!.id : null };
  }
}
