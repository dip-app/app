import type { CreateChallengeResponse, UpdateChallengeResponse } from "../../../generated/models";
import {
  CHALLENGE_LIMITS, WEEKLY, challengeDraftHash, parseCreateChallengeRequest, parseUpdateChallengeRequest, rfc3339,
  toChallengeDto, windowChangeBlocked, windowsOverlap, type ParsedChallengeDraft, type StoredChallenge,
} from "../domain/challengeDraft";
import { auditEntry, change, diffFields, type AuditChange } from "../../admin/domain/audit";
import { isDeactivated } from "../../admin/domain/member";
import { ChallengeError } from "../domain/errors";
import type { ChallengeTransaction, ChallengeStore } from "./ports";

/** Trusted caller identity, derived only from the verified Auth token. */
export interface Caller {
  uid: string;
  emailVerified: boolean;
  signInProvider: string | null;
}

export interface Clock { now(): Date }
export interface ChallengeIdGenerator { challengeId(): string }

const systemClock: Clock = { now: () => new Date() };

/** Server timestamps are stored at whole-second precision so the response equals the stored value. */
function wholeSeconds(date: Date): Date {
  return new Date(Math.floor(date.getTime() / 1000) * 1000);
}

function requireCaller(caller: Caller | null): Caller {
  if (!caller) throw new ChallengeError("unauthenticated", "UNAUTHENTICATED", "Sign in to continue.");
  if (!caller.emailVerified || caller.signInProvider !== "google.com") {
    throw new ChallengeError("permission-denied", "NOT_ORGANIZER", "Only organizers can manage weekly themes.");
  }
  return caller;
}

/**
 * Authorization comes from the server-owned membership document, never from the payload: the caller must
 * have role "admin", and the supplied companyId must equal their own company.
 */
async function requireOrganizer(tx: ChallengeTransaction, caller: Caller, companyId: string) {
  const membership = await tx.getMembership(caller.uid);
  if (!membership || membership.role !== "admin") {
    throw new ChallengeError("permission-denied", "NOT_ORGANIZER", "Only organizers can manage weekly themes.");
  }
  if (isDeactivated(membership)) throw new ChallengeError("permission-denied", "ACCOUNT_DEACTIVATED", "This account is deactivated.");
  if (membership.companyId !== companyId) {
    throw new ChallengeError("permission-denied", "COMPANY_MISMATCH", "You can only manage your own company's weekly themes.");
  }
  return membership;
}

const iso = (date: Date) => date.toISOString();

/** The changed fields of a theme update. The description is only flagged as edited, never copied into the entry. */
export function challengeChanges(current: StoredChallenge, next: ParsedChallengeDraft): AuditChange[] {
  const pick = (c: { title: string; type: string; goal: number; goalUnit: string; tagIds: readonly string[]; coverImageURL: string; startDate: Date; endDate: Date; pointsReward: number }) => ({
    title: c.title, type: c.type, goal: c.goal, goalUnit: c.goalUnit, tagIds: [...c.tagIds], coverImageURL: c.coverImageURL,
    startDate: iso(c.startDate), endDate: iso(c.endDate), pointsReward: c.pointsReward,
  });
  const out = diffFields(pick(current), pick(next));
  if (current.description !== next.description) out.push(change("description", null, "edited"));
  return out;
}

async function requireKnownTags(tx: ChallengeTransaction, tagIds: readonly string[]) {
  const missing = await tx.missingTagIds(tagIds);
  if (missing.length > 0) throw new ChallengeError("invalid-argument", "TAG_NOT_FOUND", "Choose tags from the list.", ["tagIds"]);
}

/** One current weekly theme at a time: windows of two weekly challenges in a company must not overlap. */
async function requireFreeWindow(tx: ChallengeTransaction, companyId: string, draft: ParsedChallengeDraft, excludeId?: string) {
  const upper = new Date(draft.endDate.getTime() + CHALLENGE_LIMITS.maxSpanMs);
  const windows = await tx.windowsEndingBetween(companyId, draft.startDate, upper);
  const conflict = windows
    .filter((w) => w.challengeId !== excludeId && w.type === WEEKLY && windowsOverlap(w.startDate, w.endDate, draft.startDate, draft.endDate))
    .sort((a, b) => a.startDate.getTime() - b.startDate.getTime())[0];
  if (conflict) {
    throw new ChallengeError("failed-precondition", "CHALLENGE_WINDOW_OVERLAP",
      "Another weekly theme already runs during these dates.", ["startDate", "endDate"],
      { challengeId: conflict.challengeId, startDate: rfc3339(conflict.startDate), endDate: rfc3339(conflict.endDate) });
  }
}

/**
 * createChallengeV1: requestId makes retries return the same challenge (`replayed: true`, current stored
 * state); the same key with another draft fails REQUEST_REUSED. The window may already have started (an
 * organizer can publish this week's theme mid-week) but must not have ended.
 */
export async function createChallenge(
  store: ChallengeStore,
  caller: Caller | null,
  data: unknown,
  ids: ChallengeIdGenerator,
  clock: Clock = systemClock,
): Promise<CreateChallengeResponse> {
  const authenticated = requireCaller(caller);
  const request = parseCreateChallengeRequest(data);
  const hash = challengeDraftHash(request.draft);
  return store.runTransaction(async (tx) => {
    const membership = await requireOrganizer(tx, authenticated, request.companyId);
    const receipt = await tx.getReceipt(request.companyId, authenticated.uid, request.requestId);
    if (receipt) {
      if (receipt.kind !== "challenge" || !("hash" in receipt) || receipt.hash !== hash) {
        throw new ChallengeError("invalid-argument", "REQUEST_REUSED", "This request ID was already used with different details.", ["requestId"]);
      }
      const existing = await tx.getChallenge(request.companyId, receipt.challengeId);
      if (!existing) throw new ChallengeError("internal", "INVALID_STORED_CHALLENGE", "Receipt points at a missing challenge.");
      return { contractVersion: 1, challengeId: receipt.challengeId, revision: existing.revision, challenge: toChallengeDto(receipt.challengeId, existing), replayed: true };
    }
    const now = clock.now();
    if (request.draft.endDate.getTime() <= now.getTime()) {
      throw new ChallengeError("invalid-argument", "VALIDATION_FAILED", "This theme's dates have already passed.", ["endDate"]);
    }
    await requireKnownTags(tx, request.draft.tagIds);
    await requireFreeWindow(tx, request.companyId, request.draft);
    const challengeId = ids.challengeId();
    const stamp = wholeSeconds(now);
    const stored: StoredChallenge = {
      companyId: request.companyId,
      ...request.draft,
      tagIds: [...request.draft.tagIds],
      participantCount: 0,
      completedCount: 0,
      createdBy: authenticated.uid,
      createdAt: stamp,
      updatedAt: stamp,
      revision: 1,
    };
    tx.createChallenge(request.companyId, challengeId, stored);
    tx.createReceipt(request.companyId, authenticated.uid, request.requestId, { kind: "challenge", hash, challengeId });
    // Derived from the request; the receipt branch above returns first on a replay, so a retry never adds a second entry.
    const auditId = `challenge_create_${authenticated.uid}_${request.requestId}`;
    tx.writeAudit(request.companyId, auditId, auditEntry(request.companyId, { uid: authenticated.uid, ...membership }, {
      id: auditId, action: "challenge.create", targetType: "challenge", targetId: challengeId, requestId: request.requestId,
      summary: `Created the weekly theme "${request.draft.title}"`, summaryKey: "challenge.create", summaryParams: { title: request.draft.title },
      changes: [change("title", null, request.draft.title), change("startDate", null, iso(request.draft.startDate)), change("endDate", null, iso(request.draft.endDate)), change("pointsReward", null, request.draft.pointsReward)],
    }));
    return { contractVersion: 1, challengeId, revision: 1, challenge: toChallengeDto(challengeId, stored), replayed: false };
  });
}

/**
 * updateChallengeV1: full-draft replacement guarded by expectedRevision (mismatch -> aborted
 * REVISION_CONFLICT). participantCount/completedCount are server-owned and never written here. Once
 * anyone has joined or completed, the window lock in windowChangeBlocked applies.
 */
export async function updateChallenge(
  store: ChallengeStore,
  caller: Caller | null,
  data: unknown,
  clock: Clock = systemClock,
): Promise<UpdateChallengeResponse> {
  const authenticated = requireCaller(caller);
  const request = parseUpdateChallengeRequest(data);
  return store.runTransaction(async (tx) => {
    const membership = await requireOrganizer(tx, authenticated, request.companyId);
    const current = await tx.getChallenge(request.companyId, request.challengeId);
    if (!current) throw new ChallengeError("not-found", "CHALLENGE_NOT_FOUND", "That weekly theme doesn't exist.");
    if (current.revision !== request.expectedRevision) {
      throw new ChallengeError("aborted", "REVISION_CONFLICT", "Someone else changed this weekly theme. Reload it and try again.");
    }
    const now = clock.now();
    const blocked = windowChangeBlocked(current, request.draft, now);
    if (blocked.length > 0) {
      throw new ChallengeError("failed-precondition", "WINDOW_CHANGE_BLOCKED",
        "People have already joined, so the start can't move and the end can't be set in the past.", blocked);
    }
    await requireKnownTags(tx, request.draft.tagIds);
    await requireFreeWindow(tx, request.companyId, request.draft, request.challengeId);
    const nextRevision = current.revision + 1;
    const updatedAt = wholeSeconds(now);
    tx.updateChallenge(request.companyId, request.challengeId, request.draft, nextRevision, updatedAt);
    // expectedRevision makes this the only writer of revision N+1: one entry per saved change.
    const auditId = `challenge_update_${request.challengeId}_r${nextRevision}`;
    tx.writeAudit(request.companyId, auditId, auditEntry(request.companyId, { uid: authenticated.uid, ...membership }, {
      id: auditId, action: "challenge.update", targetType: "challenge", targetId: request.challengeId,
      summary: `Edited the weekly theme "${request.draft.title}"`, summaryKey: "challenge.update", summaryParams: { title: request.draft.title }, changes: challengeChanges(current, request.draft),
    }));
    const next: StoredChallenge = { ...current, ...request.draft, tagIds: [...request.draft.tagIds], revision: nextRevision, updatedAt };
    return { contractVersion: 1, challengeId: request.challengeId, revision: nextRevision, challenge: toChallengeDto(request.challengeId, next) };
  });
}
