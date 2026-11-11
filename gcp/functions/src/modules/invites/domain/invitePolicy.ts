import { InviteError } from "./errors";

export const MESSAGE_MAX = 200;
export const SEND_LIMIT = 20;
export const SEND_WINDOW_MS = 60 * 60_000;
export const SEARCH_LIMIT = 120;
export const SEARCH_WINDOW_MS = 10 * 60_000;
/** Most members read per directory search (a bounded scan; the response says when it truncated). */
export const DIRECTORY_SCAN_CAP = 1000;
export const DEFAULT_RESULTS = 20;
export const MAX_RESULTS = 25;

const WIRE_ID = /^[A-Za-z0-9_-]+$/;
const REQUEST_ID = /^[A-Za-z0-9_-]{8,128}$/;

export const validWireId = (value: unknown): value is string =>
  typeof value === "string" && value.length >= 1 && value.length <= 128 && WIRE_ID.test(value);

/** One invitation per person per event: the id is deterministic, so a second inviter cannot duplicate it. */
export const inviteIdFor = (eventId: string, toUserId: string) => `${eventId}_${toUserId}`;
export const notificationIdFor = (inviteId: string) => `invite_${inviteId}`;

export interface SendInviteInput { companyId: string; eventId: string; toUserId: string; message: string; requestId: string }
export interface RespondInput { companyId: string; inviteId: string; response: "accepted" | "declined" }
export interface SearchInput { companyId: string; eventId: string; query: string; limit: number }

/** Returns the record and the names of unknown keys / a wrong contractVersion. */
function strict(data: unknown, allowed: readonly string[]): { record: Record<string, unknown>; bad: string[] } {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new InviteError("invalid-argument", "VALIDATION_FAILED", "Invalid request.");
  }
  const record = data as Record<string, unknown>;
  const bad = Object.keys(record).filter((key) => !allowed.includes(key));
  if (record.contractVersion !== 1) bad.push("contractVersion");
  return { record, bad };
}

function reject(fields: string[]): never {
  throw new InviteError("invalid-argument", "VALIDATION_FAILED", "Invalid request.", [...new Set(fields)].sort());
}

export function parseSend(data: unknown): SendInviteInput {
  const { record, bad: fields } = strict(data, ["contractVersion", "companyId", "eventId", "toUserId", "message", "requestId"]);
  for (const key of ["companyId", "eventId", "toUserId"]) if (!validWireId(record[key])) fields.push(key);
  if (typeof record.requestId !== "string" || !REQUEST_ID.test(record.requestId)) fields.push("requestId");
  let message = "";
  if (record.message !== undefined) {
    if (typeof record.message !== "string") fields.push("message");
    else {
      message = record.message.trim();
      if (message.length > MESSAGE_MAX || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(message)) fields.push("message");
    }
  }
  if (fields.length) reject(fields);
  return {
    companyId: record.companyId as string, eventId: record.eventId as string,
    toUserId: record.toUserId as string, message, requestId: record.requestId as string,
  };
}

export function parseRespond(data: unknown): RespondInput {
  const { record, bad: fields } = strict(data, ["contractVersion", "companyId", "inviteId", "response"]);
  if (!validWireId(record.companyId)) fields.push("companyId");
  if (typeof record.inviteId !== "string" || record.inviteId.length > 260 || !WIRE_ID.test(record.inviteId)) fields.push("inviteId");
  if (record.response !== "accepted" && record.response !== "declined") fields.push("response");
  if (fields.length) reject(fields);
  return { companyId: record.companyId as string, inviteId: record.inviteId as string, response: record.response as "accepted" | "declined" };
}

export function parseSearch(data: unknown): SearchInput {
  const { record, bad: fields } = strict(data, ["contractVersion", "companyId", "eventId", "query", "limit"]);
  if (!validWireId(record.companyId)) fields.push("companyId");
  if (!validWireId(record.eventId)) fields.push("eventId");
  const query = typeof record.query === "string" ? record.query.trim() : "";
  if (query.length < 2 || query.length > 40) fields.push("query");
  let limit = DEFAULT_RESULTS;
  if (record.limit !== undefined) {
    if (typeof record.limit !== "number" || !Number.isInteger(record.limit) || record.limit < 1 || record.limit > MAX_RESULTS) fields.push("limit");
    else limit = record.limit;
  }
  if (fields.length) reject(fields);
  return { companyId: record.companyId as string, eventId: record.eventId as string, query, limit };
}

/** Case- and diacritic-insensitive form used for name matching. */
export function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Every query word must start a word of the display name or appear inside it. */
export function nameMatches(displayName: string, query: string): boolean {
  const name = fold(displayName);
  const parts = name.split(/[\s-]+/);
  const words = fold(query).split(/\s+/).filter(Boolean);
  return words.length > 0 && words.every((word) => parts.some((part) => part.startsWith(word)) || name.includes(word));
}

export interface BudgetState { windowStart: number; count: number }

/**
 * Fixed-window budget. Returns the next state, or null when the budget is exhausted. A stored window in the
 * future or a corrupt record fails closed (null) until the window passes, like the membership limiter.
 */
export function nextBudget(stored: unknown, nowMs: number, limit: number, windowMs: number): BudgetState | null {
  const windowStart = Math.floor(nowMs / windowMs) * windowMs;
  if (stored === null || stored === undefined) return { windowStart, count: 1 };
  const record = stored as Record<string, unknown>;
  const startValue = record.windowStart;
  const countValue = record.count;
  if (typeof startValue !== "number" || typeof countValue !== "number" || !Number.isInteger(countValue) ||
    countValue < 0 || startValue > windowStart) return null;
  const count = startValue === windowStart ? countValue : 0;
  if (count >= limit) return null;
  return { windowStart, count: count + 1 };
}

const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

export function inviteNotificationText(fromName: string, eventTitle: string): { title: string; body: string } {
  return { title: "New invitation", body: `${clip(fromName || "A coworker", 40)} invited you to ${clip(eventTitle, 60)}.` };
}
