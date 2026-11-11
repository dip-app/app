import type {
  ApproveChallengeRequest, ChallengeSubmission, ListChallengeSubmissionsRequest, RejectChallengeRequest, SubmitChallengeRequest,
} from "../../../generated/models";
import { validWireId } from "../../photos/domain/photoPolicy";
import { SubmissionError } from "./errors";

/**
 * Challenge submission policy (F3, V2-02). Mirrored by gcp/storage.rules for the evidence upload.
 *
 * - A submission is the caller's own document `{challengeId}_{uid}` under the company's challenge.
 * - Members submit only while the weekly window is open (startDate <= now <= endDate).
 * - Status machine: submitted -> approved (final) | rejected -> submitted again (resubmission, attempt + 1).
 *   While `submitted` the member may still edit; `approved` is locked.
 * - Evidence is optional: one create-only Storage object per slot (0..4), so at most 5 uploads per member
 *   per challenge; each 1 byte..10 MiB, jpeg/png/heic (validated like album photos).
 */
export const SUBMISSION_SLOTS = 5;
export const MAX_CAPTION_LENGTH = 280;
export const MAX_REASON_LENGTH = 280;
export const MAX_PROGRESS = 10000;
export const DEFAULT_LIST_LIMIT = 25;
export const MAX_LIST_LIMIT = 50;
export const SUBMISSION_STATUSES = ["submitted", "approved", "rejected"] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export function submissionId(challengeId: string, uid: string): string {
  return `${challengeId}_${uid}`;
}

/** Deterministic ledger document ID: a second approval can never create a second award. */
export function awardId(challengeId: string, uid: string): string {
  return `challenge_${challengeId}_${uid}`;
}

export function evidencePath(companyId: string, challengeId: string, uid: string, slot: number): string {
  return `companies/${companyId}/challenges/${challengeId}/submissions/${uid}/${slot}`;
}

export const iso = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, "Z");

function invalid(fields: string[]): never {
  throw new SubmissionError("invalid-argument", "VALIDATION_FAILED", "Invalid request.", [...new Set(fields)].sort());
}

function record(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== "object" || Array.isArray(data)) invalid([]);
  return data as Record<string, unknown>;
}

function unknownKeys(data: Record<string, unknown>, keys: readonly string[]): string[] {
  const fields = Object.keys(data).filter(key => !keys.includes(key));
  if (data.contractVersion !== 1) fields.push("contractVersion");
  return fields;
}

export interface ParsedSubmit {
  companyId: string;
  challengeId: string;
  progress: number;
  caption: string;
  storagePath: string | null;
}

/** Strict request validation. A storagePath outside the caller's own evidence folder fails before any read. */
export function parseSubmitRequest(data: unknown, uid: string): ParsedSubmit {
  const r = record(data);
  const fields = unknownKeys(r, ["contractVersion", "companyId", "challengeId", "progress", "caption", "storagePath"]);
  if (!validWireId(r.companyId)) fields.push("companyId");
  if (!validWireId(r.challengeId)) fields.push("challengeId");
  if (typeof r.progress !== "number" || !Number.isFinite(r.progress) || r.progress <= 0 || r.progress > MAX_PROGRESS) fields.push("progress");
  const caption = r.caption === undefined ? "" : r.caption;
  if (typeof caption !== "string" || caption.trim() !== caption || [...caption].length > MAX_CAPTION_LENGTH) fields.push("caption");
  if (r.storagePath !== undefined && typeof r.storagePath !== "string") fields.push("storagePath");
  if (fields.length) invalid(fields);
  const request = r as unknown as SubmitChallengeRequest;
  let storagePath: string | null = null;
  if (request.storagePath !== undefined) {
    const ok = [0, 1, 2, 3, 4].some(slot => request.storagePath === evidencePath(request.companyId, request.challengeId, uid, slot));
    if (!ok) invalid(["storagePath"]);
    storagePath = request.storagePath ?? null;
  }
  return { companyId: request.companyId, challengeId: request.challengeId, progress: request.progress, caption: caption as string, storagePath };
}

export type ParsedReview = Pick<ApproveChallengeRequest, "companyId" | "challengeId" | "userId"> & { expectedUpdatedAt: string | null };

const RFC3339_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
function expected(value: unknown, fields: string[]): string | null {
  if (value === undefined) return null;
  if (typeof value !== "string" || !RFC3339_UTC.test(value) || !Number.isFinite(Date.parse(value))) { fields.push("expectedUpdatedAt"); return null; }
  return iso(new Date(value));
}

export function parseApproveRequest(data: unknown): ParsedReview {
  const r = record(data);
  const fields = unknownKeys(r, ["contractVersion", "companyId", "challengeId", "userId", "expectedUpdatedAt"]);
  for (const key of ["companyId", "challengeId", "userId"]) if (!validWireId(r[key])) fields.push(key);
  const expectedUpdatedAt = expected(r.expectedUpdatedAt, fields);
  if (fields.length) invalid(fields);
  return { companyId: r.companyId as string, challengeId: r.challengeId as string, userId: r.userId as string, expectedUpdatedAt };
}

export function parseRejectRequest(data: unknown): ParsedReview & { reason: string } {
  const r = record(data);
  const fields = unknownKeys(r, ["contractVersion", "companyId", "challengeId", "userId", "reason", "expectedUpdatedAt"]);
  for (const key of ["companyId", "challengeId", "userId"]) if (!validWireId(r[key])) fields.push(key);
  const reason = r.reason;
  if (typeof reason !== "string" || reason.trim() !== reason || reason.length < 1 || [...reason].length > MAX_REASON_LENGTH) fields.push("reason");
  const expectedUpdatedAt = expected(r.expectedUpdatedAt, fields);
  if (fields.length) invalid(fields);
  const request = r as unknown as RejectChallengeRequest;
  return { companyId: request.companyId, challengeId: request.challengeId, userId: request.userId, reason: request.reason, expectedUpdatedAt };
}

export interface ParsedList {
  companyId: string;
  challengeId: string;
  status: SubmissionStatus | null;
  limit: number;
  cursor: string | null;
}

export function parseListRequest(data: unknown): ParsedList {
  const r = record(data);
  const fields = unknownKeys(r, ["contractVersion", "companyId", "challengeId", "status", "limit", "cursor"]);
  if (!validWireId(r.companyId)) fields.push("companyId");
  if (!validWireId(r.challengeId)) fields.push("challengeId");
  if (r.status !== undefined && !SUBMISSION_STATUSES.includes(r.status as SubmissionStatus)) fields.push("status");
  if (r.limit !== undefined && (!Number.isInteger(r.limit) || (r.limit as number) < 1 || (r.limit as number) > MAX_LIST_LIMIT)) fields.push("limit");
  if (r.cursor !== undefined && !validWireId(r.cursor)) fields.push("cursor");
  if (fields.length) invalid(fields);
  const request = r as unknown as ListChallengeSubmissionsRequest;
  return {
    companyId: request.companyId, challengeId: request.challengeId, status: request.status ?? null,
    limit: request.limit ?? DEFAULT_LIST_LIMIT, cursor: request.cursor ?? null,
  };
}

/** A stored submission with Timestamps already converted to Date by the adapter. */
export interface StoredSubmission {
  companyId: string;
  challengeId: string;
  userId: string;
  userName: string;
  userAvatarId: string;
  caption: string;
  progress: number;
  status: SubmissionStatus;
  storagePath: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  attempt: number;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  reviewNote: string | null;
  pointsAwarded: number;
  createdAt: Date;
  updatedAt: Date;
}

export function toSubmissionDto(id: string, s: StoredSubmission): ChallengeSubmission {
  return {
    id, companyId: s.companyId, challengeId: s.challengeId, userId: s.userId, userName: s.userName,
    userAvatarId: s.userAvatarId, photoURL: null, caption: s.caption, progress: s.progress, status: s.status,
    storagePath: s.storagePath, ...(s.contentType ? { contentType: s.contentType as NonNullable<ChallengeSubmission["contentType"]> } : {}),
    ...(s.sizeBytes ? { sizeBytes: s.sizeBytes } : {}), attempt: s.attempt, reviewedBy: s.reviewedBy,
    reviewedAt: s.reviewedAt ? iso(s.reviewedAt) : null, reviewNote: s.reviewNote, pointsAwarded: s.pointsAwarded,
    createdAt: iso(s.createdAt), updatedAt: iso(s.updatedAt),
  };
}
