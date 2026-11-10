import { createHash } from "node:crypto";
import type { Challenge, ChallengeDraft } from "../../../generated/models";
import { ChallengeError } from "./errors";

export const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RFC3339_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/;
const DAY_MS = 86_400_000;

export const CHALLENGE_LIMITS = {
  titleMax: 60,
  descriptionMax: 1000,
  goalUnitMax: 24,
  goalMax: 10_000,
  pointsRewardMax: 1000,
  maxTags: 10,
  /** Longest allowed window (endDate - startDate). */
  maxSpanMs: 14 * DAY_MS,
} as const;

/** The only challenge type in use; one current weekly theme per company at a time. */
export const WEEKLY = "weekly" as const;

/**
 * Theme illustration catalog. The URL selects a BUNDLED illustration + accent colour in each client
 * (iOS asset catalog, admin public/img/themes/<key>.png); never an https photo. Same pattern as
 * APPROVED_COVER_URLS for events. Add a key here only together with the client catalog entries.
 */
export const APPROVED_THEME_URLS: ReadonlySet<string> = new Set([
  "catalog://theme/fitness",
]);

type Record_ = Record<string, unknown>;

function fail(fields: string[], message = "Check the highlighted fields."): never {
  throw new ChallengeError("invalid-argument", "VALIDATION_FAILED", message, fields);
}

function asRecord(value: unknown, path: string): Record_ {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail([path]);
  return value as Record_;
}

function exactKeys(record: Record_, allowed: readonly string[], path: string) {
  const unknown = Object.keys(record).filter((key) => !allowed.includes(key)).map((key) => (path ? `${path}.${key}` : key));
  const missing = allowed.filter((key) => !(key in record)).map((key) => (path ? `${path}.${key}` : key));
  if (unknown.length || missing.length) fail([...unknown, ...missing].sort());
}

function text(record: Record_, key: string, min: number, max: number): string {
  const value = record[key];
  if (typeof value !== "string") fail([key]);
  const trimmed = (value as string).trim();
  if (trimmed.length < min || trimmed.length > max) fail([key]);
  return trimmed;
}

function utcInstant(record: Record_, key: string): Date {
  const value = record[key];
  if (typeof value !== "string" || !RFC3339_UTC.test(value)) fail([key]);
  const date = new Date(value as string);
  if (Number.isNaN(date.getTime())) fail([key]);
  return date;
}

export interface ParsedChallengeDraft extends Omit<ChallengeDraft, "startDate" | "endDate"> {
  startDate: Date;
  endDate: Date;
}

const DRAFT_KEYS = ["title", "description", "tagIds", "type", "goal", "goalUnit", "coverImageURL", "startDate", "endDate", "pointsReward"] as const;

/** Validates and normalizes an untrusted ChallengeDraft. Pure: no store access. */
export function parseChallengeDraft(data: unknown): ParsedChallengeDraft {
  const record = asRecord(data, "draft");
  exactKeys(record, DRAFT_KEYS, "draft");
  const title = text(record, "title", 1, CHALLENGE_LIMITS.titleMax);
  const description = text(record, "description", 1, CHALLENGE_LIMITS.descriptionMax);
  const goalUnit = text(record, "goalUnit", 1, CHALLENGE_LIMITS.goalUnitMax);

  const tags = record.tagIds;
  if (!Array.isArray(tags) || tags.length > CHALLENGE_LIMITS.maxTags) fail(["tagIds"]);
  const tagIds = (tags as unknown[]).map((tag) => {
    if (typeof tag !== "string" || !ID_PATTERN.test(tag)) fail(["tagIds"]);
    return tag as string;
  });
  if (new Set(tagIds).size !== tagIds.length) fail(["tagIds"]);

  if (record.type !== WEEKLY) fail(["type"]);

  const goal = record.goal;
  if (typeof goal !== "number" || !Number.isFinite(goal) || goal <= 0 || goal > CHALLENGE_LIMITS.goalMax) fail(["goal"]);

  const coverImageURL = record.coverImageURL;
  if (typeof coverImageURL !== "string" || !APPROVED_THEME_URLS.has(coverImageURL)) fail(["coverImageURL"]);

  const startDate = utcInstant(record, "startDate");
  const endDate = utcInstant(record, "endDate");
  if (endDate.getTime() <= startDate.getTime()) fail(["endDate"], "The end must be after the start.");
  if (endDate.getTime() - startDate.getTime() > CHALLENGE_LIMITS.maxSpanMs) fail(["endDate"], "A theme can last at most 14 days.");

  const pointsReward = record.pointsReward;
  if (!Number.isInteger(pointsReward) || (pointsReward as number) < 0 || (pointsReward as number) > CHALLENGE_LIMITS.pointsRewardMax) fail(["pointsReward"]);

  return {
    title, description, tagIds, type: WEEKLY, goal: goal as number, goalUnit,
    coverImageURL: coverImageURL as string, startDate, endDate, pointsReward: pointsReward as number,
  };
}

function companyIdOf(record: Record_): string {
  const value = record.companyId;
  if (typeof value !== "string" || !ID_PATTERN.test(value)) fail(["companyId"]);
  return value as string;
}

export interface ParsedCreateChallenge { companyId: string; requestId: string; draft: ParsedChallengeDraft }
export interface ParsedUpdateChallenge { companyId: string; challengeId: string; expectedRevision: number; draft: ParsedChallengeDraft }

export function parseCreateChallengeRequest(data: unknown): ParsedCreateChallenge {
  const record = asRecord(data, "request");
  exactKeys(record, ["contractVersion", "companyId", "requestId", "draft"], "");
  if (record.contractVersion !== 1) fail(["contractVersion"]);
  const requestId = record.requestId;
  if (typeof requestId !== "string" || !UUID_PATTERN.test(requestId)) fail(["requestId"]);
  return { companyId: companyIdOf(record), requestId: (requestId as string).toLowerCase(), draft: parseChallengeDraft(record.draft) };
}

export function parseUpdateChallengeRequest(data: unknown): ParsedUpdateChallenge {
  const record = asRecord(data, "request");
  exactKeys(record, ["contractVersion", "companyId", "challengeId", "expectedRevision", "draft"], "");
  if (record.contractVersion !== 1) fail(["contractVersion"]);
  const challengeId = record.challengeId;
  if (typeof challengeId !== "string" || !ID_PATTERN.test(challengeId)) fail(["challengeId"]);
  const expected = record.expectedRevision;
  if (!Number.isInteger(expected) || (expected as number) < 1) fail(["expectedRevision"]);
  return {
    companyId: companyIdOf(record),
    challengeId: challengeId as string,
    expectedRevision: expected as number,
    draft: parseChallengeDraft(record.draft),
  };
}

/** Stable digest of the normalized draft, so a reused requestId with different content is detectable. */
export function challengeDraftHash(draft: ParsedChallengeDraft): string {
  const canonical = JSON.stringify([
    draft.title, draft.description, draft.tagIds, draft.type, draft.goal, draft.goalUnit, draft.coverImageURL,
    draft.startDate.toISOString(), draft.endDate.toISOString(), draft.pointsReward,
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}

/** Half-open overlap test: [aStart, aEnd] and [bStart, bEnd] share at least one instant. */
export function windowsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() <= bEnd.getTime() && bStart.getTime() <= aEnd.getTime();
}

/** Server-owned and persisted challenge state, as the application service sees it. */
export interface StoredChallenge {
  companyId: string;
  title: string;
  description: string;
  tagIds: string[];
  type: string;
  goal: number;
  goalUnit: string;
  coverImageURL: string;
  startDate: Date;
  endDate: Date;
  pointsReward: number;
  participantCount: number;
  completedCount: number;
  createdBy?: string;
  createdAt?: Date;
  updatedAt?: Date;
  revision: number;
}

/**
 * Window lock once anyone has joined or completed (V1 decision): the start date is fixed, and the end
 * date may move (longer or shorter) only to an instant that is not in the past. Unchanged dates always
 * pass, so text/goal/reward edits on an older theme stay possible. Returns the blocked fields.
 */
export function windowChangeBlocked(current: StoredChallenge, draft: ParsedChallengeDraft, now: Date): string[] {
  if (current.participantCount <= 0 && current.completedCount <= 0) return [];
  const blocked: string[] = [];
  if (draft.startDate.getTime() !== current.startDate.getTime()) blocked.push("startDate");
  if (draft.endDate.getTime() !== current.endDate.getTime() && draft.endDate.getTime() < now.getTime()) blocked.push("endDate");
  return blocked;
}

/** RFC3339 UTC; whole seconds omit the fractional part so Swift's `.iso8601` strategy decodes it. */
export function rfc3339(date: Date): string {
  return date.toISOString().replace(".000Z", "Z");
}

/** Wire DTO (contracts/v1 Challenge). `id` is snapshot metadata, never persisted. */
export function toChallengeDto(id: string, stored: StoredChallenge): Challenge {
  const dto: Challenge = {
    id,
    companyId: stored.companyId,
    title: stored.title,
    description: stored.description,
    tagIds: [...stored.tagIds],
    type: stored.type,
    goal: stored.goal,
    goalUnit: stored.goalUnit,
    coverImageURL: stored.coverImageURL,
    startDate: rfc3339(stored.startDate),
    endDate: rfc3339(stored.endDate),
    pointsReward: stored.pointsReward,
    participantCount: stored.participantCount,
    completedCount: stored.completedCount,
    revision: stored.revision,
  };
  if (stored.createdBy !== undefined) dto.createdBy = stored.createdBy;
  if (stored.createdAt !== undefined) dto.createdAt = rfc3339(stored.createdAt);
  if (stored.updatedAt !== undefined) dto.updatedAt = rfc3339(stored.updatedAt);
  return dto;
}
