// Pure helpers for the "Weekly ideas email" page and the email deep link. No React and no network, so they are
// unit tested directly. Wire types mirror gcp/functions/src/generated/models.ts (manageSuggestionsEmailV1,
// resolveSuggestedIdeaV1).

import type { GeneratedEventDraft } from "./adminTypes";
import { ApiError } from "./contract";

export type SuggestionsAction = "status" | "preview" | "sendTest" | "subscribe" | "unsubscribe" | "setSchedule";
export type SuggestionsEngine = "jev" | "openai" | "heuristic";
export type TestReason = "EMAIL_DISABLED" | "NOT_SUBSCRIBED" | "TEST_LIMIT" | "COMPANY_EMAIL_DISABLED";

export interface SuggestionsSchedule { weekday: number; hour: number }
export interface SuggestionsPreview {
  subject: string;
  preheader: string;
  html: string;
  text: string;
  engine: SuggestionsEngine;
  ideaCount: number;
  dataLevel: "none" | "some" | "rich";
}
export interface ManageSuggestionsRequest {
  contractVersion: 1;
  companyId: string;
  action: SuggestionsAction;
  schedule?: SuggestionsSchedule;
}
export interface ManageSuggestionsResponse {
  contractVersion: 1;
  subscribed: boolean;
  emailEnabled: boolean;
  aiEnabled: boolean;
  schedule: SuggestionsSchedule;
  timeZone: string;
  nextSendAt: string | null;
  preview?: SuggestionsPreview;
  testQueued?: boolean;
  testReason?: TestReason;
}
export interface ResolveSuggestedIdeaRequest { contractVersion: 1; companyId: string; token: string }
export interface ResolveSuggestedIdeaResponse { contractVersion: 1; ideaId: string; draft: GeneratedEventDraft }

// ---------- Options

/** 1 = Monday ... 7 = Sunday, like the contract. */
export const WEEKDAY_OPTIONS: { value: number; label: string }[] = [
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
].map((label, i) => ({ value: i + 1, label }));

export function hourLabel(hour: number): string {
  const h = ((Math.trunc(hour) % 24) + 24) % 24;
  return `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? "AM" : "PM"}`;
}
export const HOUR_OPTIONS: { value: number; label: string }[] = Array.from({ length: 24 }, (_, hour) => ({ value: hour, label: hourLabel(hour) }));

export function scheduleValid(s: SuggestionsSchedule): boolean {
  return Number.isInteger(s.weekday) && s.weekday >= 1 && s.weekday <= 7 && Number.isInteger(s.hour) && s.hour >= 0 && s.hour <= 23;
}
export const sameSchedule = (a: SuggestionsSchedule, b: SuggestionsSchedule) => a.weekday === b.weekday && a.hour === b.hour;

// ---------- Labels

/** "Monday, Dec 1 at 9:00 AM PST" in the company time zone. Empty when there is no valid time. */
export function nextSendLabel(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone, weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
    }).formatToParts(date);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    return `${get("weekday")}, ${get("month")} ${get("day")} at ${get("hour")}:${get("minute")} ${get("dayPeriod")} ${get("timeZoneName")}`.replace(/\s+/g, " ").trim();
  } catch {
    return "";
  }
}

export function engineLabel(engine: SuggestionsEngine): string {
  return engine === "jev" ? "Ranked with Jev" : engine === "openai" ? "Ranked with OpenAI" : "Ranked with the built-in heuristic";
}

export const PREVIEW_WIDTHS = { desktop: 600, mobile: 390 } as const;

/** Result message for "Send me a test". Every outcome is a calm status, never an alarm. */
export function testMessage(response: Pick<ManageSuggestionsResponse, "testQueued" | "testReason">): { tone: "ok" | "info"; text: string } {
  if (response.testQueued) return { tone: "ok", text: "Test queued. It should arrive in a minute." };
  switch (response.testReason) {
    case "NOT_SUBSCRIBED": return { tone: "info", text: "Turn on the weekly email first to get a test." };
    case "TEST_LIMIT": return { tone: "info", text: "A test was sent in the last hour. Try again later." };
    case "EMAIL_DISABLED":
    case "COMPANY_EMAIL_DISABLED": return { tone: "info", text: "Email is not turned on for your company yet, so no test was sent." };
    default: return { tone: "info", text: "No test was sent. Try again in a moment." };
  }
}

export function statusNotices(s: Pick<ManageSuggestionsResponse, "emailEnabled" | "aiEnabled">): string[] {
  const notes: string[] = [];
  if (!s.emailEnabled) notes.push("Email is not turned on for your company yet. Your choice is saved and takes effect when it is.");
  if (!s.aiEnabled) notes.push("AI event ideas are off for this company, so no weekly email is sent.");
  return notes;
}

// ---------- Requests

export function manageRequest(companyId: string, action: SuggestionsAction, schedule?: SuggestionsSchedule): ManageSuggestionsRequest {
  return { contractVersion: 1, companyId, action, ...(action === "setSchedule" && schedule ? { schedule: { weekday: schedule.weekday, hour: schedule.hour } } : {}) };
}
export function resolveRequest(companyId: string, token: string): ResolveSuggestedIdeaRequest {
  return { contractVersion: 1, companyId, token };
}

// ---------- Deep link

const TOKEN = /^[A-Za-z0-9_.-]{1,1024}$/;
/** The `t` query value of `?t=<token>`, or null when missing or malformed. Accepts a leading "?". */
export function readToken(search: string): string | null {
  const value = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get("t");
  return value !== null && TOKEN.test(value) ? value : null;
}

export type LinkProblem = "expired" | "forbidden" | "unavailable";
export const LINK_MESSAGES: Record<LinkProblem, string> = {
  expired: "This link has expired. Open Event ideas to get fresh suggestions.",
  forbidden: "This idea belongs to another company or needs an admin account.",
  unavailable: "We couldn’t open this idea. Check your connection and try again.",
};

/** Maps a resolveSuggestedIdeaV1 failure to the message class shown on the deep link page. */
export function linkProblem(error: unknown): LinkProblem {
  if (error instanceof ApiError) {
    if (error.code === "permission-denied") return "forbidden";
    if (error.code === "invalid-argument" || error.code === "not-found" || error.code === "failed-precondition" || error.code === "aborted") return "expired";
  }
  return "unavailable";
}

/** Failure text for the weekly email page. */
export function manageFailureMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "permission-denied") return "Only admins can manage the weekly ideas email.";
    return error.message;
  }
  return "We couldn’t reach the server. Check your connection and try again.";
}
