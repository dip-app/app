import { randomBytes } from "node:crypto";
import { FieldValue, Timestamp, type DocumentSnapshot, type Firestore } from "firebase-admin/firestore";
import type { ChallengeReceipt, ChallengeStore, ChallengeTransaction } from "../application/ports";
import type { ChallengeIdGenerator } from "../application/challengeCommands";
import type { ParsedChallengeDraft, StoredChallenge } from "../domain/challengeDraft";
import { ChallengeError } from "../domain/errors";

/** Random opaque challenge IDs (base64url, matches the contract's ID pattern). */
export const randomChallengeIds: ChallengeIdGenerator = { challengeId: () => randomBytes(15).toString("base64url") };

/** Receipts share companies/{c}/commandReceipts with events; the prefix keeps the key spaces disjoint. */
export function challengeReceiptId(uid: string, requestId: string): string {
  return `challenge_${uid}_${requestId}`;
}

function draftFields(draft: Omit<ParsedChallengeDraft, "type"> & { type: string }) {
  return {
    title: draft.title,
    description: draft.description,
    tagIds: [...draft.tagIds],
    type: draft.type,
    goal: draft.goal,
    goalUnit: draft.goalUnit,
    coverImageURL: draft.coverImageURL,
    startDate: Timestamp.fromDate(draft.startDate),
    endDate: Timestamp.fromDate(draft.endDate),
    pointsReward: draft.pointsReward,
  };
}

function invalid(): never {
  // Server-side detail stays in logs; the caller sees a generic internal error.
  throw new ChallengeError("internal", "INVALID_STORED_CHALLENGE", "Stored challenge is invalid.");
}

function readChallenge(snap: DocumentSnapshot): StoredChallenge {
  const get = (key: string): unknown => snap.get(key);
  const startDate = get("startDate");
  const endDate = get("endDate");
  const revision = get("revision");
  const participantCount = get("participantCount");
  const completedCount = get("completedCount");
  if (!(startDate instanceof Timestamp) || !(endDate instanceof Timestamp)
    || !Number.isInteger(revision) || !Number.isInteger(participantCount) || !Number.isInteger(completedCount)) invalid();
  const tagIds = get("tagIds");
  const createdBy = get("createdBy");
  const createdAt = get("createdAt");
  const updatedAt = get("updatedAt");
  const str = (key: string) => { const value = get(key); return typeof value === "string" ? value : ""; };
  const num = (key: string) => { const value = get(key); return typeof value === "number" ? value : 0; };
  return {
    companyId: str("companyId"),
    title: str("title"),
    description: str("description"),
    tagIds: Array.isArray(tagIds) ? tagIds.filter((t): t is string => typeof t === "string") : [],
    type: str("type"),
    goal: num("goal"),
    goalUnit: str("goalUnit"),
    coverImageURL: str("coverImageURL"),
    startDate: (startDate as Timestamp).toDate(),
    endDate: (endDate as Timestamp).toDate(),
    pointsReward: num("pointsReward"),
    participantCount: participantCount as number,
    completedCount: completedCount as number,
    ...(typeof createdBy === "string" ? { createdBy } : {}),
    ...(createdAt instanceof Timestamp ? { createdAt: createdAt.toDate() } : {}),
    ...(updatedAt instanceof Timestamp ? { updatedAt: updatedAt.toDate() } : {}),
    revision: revision as number,
  };
}

/**
 * Admin SDK adapter. Admin access bypasses Security Rules, so authorization is enforced by the application
 * service before any write is queued here. Paths follow docs/contracts/data-ownership.md.
 */
export class FirestoreChallengeStore implements ChallengeStore {
  constructor(private readonly db: Firestore) {}

  runTransaction<T>(work: (tx: ChallengeTransaction) => Promise<T>): Promise<T> {
    return this.db.runTransaction(async (transaction) => {
      const db = this.db;
      const challenges = (companyId: string) => db.collection("companies").doc(companyId).collection("challenges");
      const receipts = (companyId: string) => db.collection("companies").doc(companyId).collection("commandReceipts");
      const tx: ChallengeTransaction = {
        async getMembership(uid) {
          const snap = await transaction.get(db.collection("users").doc(uid));
          if (!snap.exists) return null;
          const companyId: unknown = snap.get("companyId");
          const role: unknown = snap.get("role");
          return { companyId: typeof companyId === "string" ? companyId : "", role: typeof role === "string" ? role : "" };
        },
        async getChallenge(companyId, challengeId) {
          const snap = await transaction.get(challenges(companyId).doc(challengeId));
          return snap.exists ? readChallenge(snap) : null;
        },
        async getReceipt(companyId, uid, requestId) {
          const snap = await transaction.get(receipts(companyId).doc(challengeReceiptId(uid, requestId)));
          if (!snap.exists) return null;
          const kind = String(snap.get("kind"));
          if (kind !== "challenge") return { kind };
          const receipt: ChallengeReceipt = { kind: "challenge", hash: String(snap.get("hash")), challengeId: String(snap.get("challengeId")) };
          return receipt;
        },
        async missingTagIds(tagIds) {
          if (tagIds.length === 0) return [];
          const snaps = await transaction.getAll(...tagIds.map((id) => db.collection("tags").doc(id)));
          return snaps.filter((snap) => !snap.exists).map((snap) => snap.id);
        },
        async windowsEndingBetween(companyId, from, to) {
          // Single-field range on endDate: served by the automatic index, no composite index needed.
          const snap = await transaction.get(challenges(companyId)
            .where("endDate", ">=", Timestamp.fromDate(from))
            .where("endDate", "<=", Timestamp.fromDate(to)));
          return snap.docs.flatMap((doc) => {
            const startDate: unknown = doc.get("startDate");
            const endDate: unknown = doc.get("endDate");
            const type: unknown = doc.get("type");
            if (!(startDate instanceof Timestamp) || !(endDate instanceof Timestamp)) return [];
            return [{ challengeId: doc.id, type: typeof type === "string" ? type : "", startDate: startDate.toDate(), endDate: endDate.toDate() }];
          });
        },
        createChallenge(companyId, challengeId, challenge) {
          transaction.create(challenges(companyId).doc(challengeId), {
            companyId,
            ...draftFields(challenge),
            participantCount: 0,
            completedCount: 0,
            ...(challenge.createdBy !== undefined ? { createdBy: challenge.createdBy } : {}),
            createdAt: Timestamp.fromDate(challenge.createdAt ?? new Date()),
            updatedAt: Timestamp.fromDate(challenge.updatedAt ?? new Date()),
            revision: 1,
          });
        },
        createReceipt(companyId, uid, requestId, receipt) {
          transaction.create(receipts(companyId).doc(challengeReceiptId(uid, requestId)), {
            ...receipt,
            createdAt: FieldValue.serverTimestamp(),
          });
        },
        updateChallenge(companyId, challengeId, draft, nextRevision, updatedAt) {
          transaction.update(challenges(companyId).doc(challengeId), {
            ...draftFields(draft),
            updatedAt: Timestamp.fromDate(updatedAt),
            revision: nextRevision,
          });
        },
      };
      return work(tx);
    });
  }
}
