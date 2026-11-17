import { describe, expect, it } from "vitest";
import { type KeyValueStore, createMockApi } from "../api";
import { ApiError } from "../contract";
import { AI_DRAFT_KEY, saveAiDraft, takeAiDraft } from "../ideas";
import {
  HOUR_OPTIONS, WEEKDAY_OPTIONS, engineLabel, hourLabel, linkProblem, manageFailureMessage, manageRequest, nextSendLabel, readToken,
  resolveRequest, scheduleValid, statusNotices, testMessage,
} from "../suggestions";
import { mockNextSend, suggestionsApiFor } from "../suggestionsApi";

const store = (): KeyValueStore => {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
};

describe("options and labels", () => {
  it("lists Monday to Sunday as 1..7 and 24 hours", () => {
    expect(WEEKDAY_OPTIONS.map((o) => o.value)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(WEEKDAY_OPTIONS[0].label).toBe("Monday");
    expect(WEEKDAY_OPTIONS[6].label).toBe("Sunday");
    expect(HOUR_OPTIONS).toHaveLength(24);
  });
  it("formats 12-hour labels", () => {
    expect(hourLabel(0)).toBe("12:00 AM");
    expect(hourLabel(9)).toBe("9:00 AM");
    expect(hourLabel(12)).toBe("12:00 PM");
    expect(hourLabel(23)).toBe("11:00 PM");
  });
  it("validates schedules", () => {
    expect(scheduleValid({ weekday: 1, hour: 9 })).toBe(true);
    expect(scheduleValid({ weekday: 0, hour: 9 })).toBe(false);
    expect(scheduleValid({ weekday: 8, hour: 9 })).toBe(false);
    expect(scheduleValid({ weekday: 1, hour: 24 })).toBe(false);
    expect(scheduleValid({ weekday: 1.5, hour: 9 })).toBe(false);
  });
  it("labels the next send in the company time zone", () => {
    expect(nextSendLabel("2026-11-30T17:00:00Z", "America/Los_Angeles")).toBe("Monday, Nov 30 at 9:00 AM PST");
    expect(nextSendLabel("2026-11-30T17:00:00Z", "Europe/Amsterdam")).toMatch(/^Monday, Nov 30 at 6:00 PM /);
    expect(nextSendLabel(null, "America/Los_Angeles")).toBe("");
    expect(nextSendLabel("not a date", "America/Los_Angeles")).toBe("");
    expect(nextSendLabel("2026-11-30T17:00:00Z", "Not/AZone")).toBe("");
  });
  it("names the engine", () => {
    expect(engineLabel("jev")).toBe("Ranked with Jev");
    expect(engineLabel("openai")).toBe("Ranked with OpenAI");
    expect(engineLabel("heuristic")).toBe("Ranked with the built-in heuristic");
  });
});

describe("messages", () => {
  it("maps test outcomes", () => {
    expect(testMessage({ testQueued: true }).text).toBe("Test queued. It should arrive in a minute.");
    expect(testMessage({ testQueued: false, testReason: "NOT_SUBSCRIBED" }).text).toBe("Turn on the weekly email first to get a test.");
    expect(testMessage({ testQueued: false, testReason: "TEST_LIMIT" }).text).toBe("A test was sent in the last hour. Try again later.");
    expect(testMessage({ testQueued: false, testReason: "EMAIL_DISABLED" }).text).toMatch(/not turned on/);
    expect(testMessage({ testQueued: false, testReason: "COMPANY_EMAIL_DISABLED" }).text).toMatch(/not turned on/);
    expect(testMessage({ testQueued: false }).tone).toBe("info");
  });
  it("shows notices for disabled email and AI", () => {
    expect(statusNotices({ emailEnabled: true, aiEnabled: true })).toEqual([]);
    expect(statusNotices({ emailEnabled: false, aiEnabled: true })).toHaveLength(1);
    expect(statusNotices({ emailEnabled: false, aiEnabled: false })).toHaveLength(2);
  });
  it("maps failures", () => {
    expect(manageFailureMessage(new ApiError("permission-denied", "x"))).toMatch(/Only admins/);
    expect(manageFailureMessage(new ApiError("failed-precondition", "Busy."))).toBe("Busy.");
    expect(manageFailureMessage(new Error("offline"))).toMatch(/couldn’t reach/);
  });
});

describe("requests", () => {
  it("builds the manage request, schedule only for setSchedule", () => {
    expect(manageRequest("c1", "status")).toEqual({ contractVersion: 1, companyId: "c1", action: "status" });
    expect(manageRequest("c1", "subscribe", { weekday: 2, hour: 8 })).toEqual({ contractVersion: 1, companyId: "c1", action: "subscribe" });
    expect(manageRequest("c1", "setSchedule", { weekday: 2, hour: 8 })).toEqual({ contractVersion: 1, companyId: "c1", action: "setSchedule", schedule: { weekday: 2, hour: 8 } });
    expect(resolveRequest("c1", "abc")).toEqual({ contractVersion: 1, companyId: "c1", token: "abc" });
  });
});

describe("deep link", () => {
  it("reads and validates the token", () => {
    expect(readToken("?t=abc.def-ghi_1")).toBe("abc.def-ghi_1");
    expect(readToken("t=abc")).toBe("abc");
    expect(readToken("")).toBeNull();
    expect(readToken("?t=")).toBeNull();
    expect(readToken("?t=has space")).toBeNull();
    expect(readToken("?t=%3Cscript%3E")).toBeNull();
    expect(readToken(`?t=${"a".repeat(1025)}`)).toBeNull();
    expect(readToken(`?t=${"a".repeat(1024)}`)).not.toBeNull();
  });
  it("classifies resolve failures", () => {
    expect(linkProblem(new ApiError("permission-denied", "x"))).toBe("forbidden");
    expect(linkProblem(new ApiError("failed-precondition", "x"))).toBe("expired");
    expect(linkProblem(new ApiError("invalid-argument", "x"))).toBe("expired");
    expect(linkProblem(new ApiError("not-found", "x"))).toBe("expired");
    expect(linkProblem(new Error("offline"))).toBe("unavailable");
  });
  it("hands a resolved draft to the editor through the AI draft store", async () => {
    const api = createMockApi(store());
    const session = await api.signIn("admin");
    const result = await suggestionsApiFor(api, session).resolveIdea("good-token");
    const kv = store();
    saveAiDraft(kv, result.draft);
    expect(kv.getItem(AI_DRAFT_KEY)).not.toBeNull();
    expect(takeAiDraft(kv)?.title).toBe(result.draft.title);
  });
});

describe("mock suggestions api", () => {
  it("subscribes, sets a schedule and limits tests (no window: in-memory defaults)", async () => {
    const api = createMockApi(store());
    const session = await api.signIn("admin");
    const sug = suggestionsApiFor(api, session);
    await expect(sug.resolveIdea("expired")).rejects.toMatchObject({ code: "failed-precondition" });
    await expect(sug.resolveIdea("other")).rejects.toMatchObject({ code: "permission-denied" });
    await expect(sug.manage("setSchedule", { weekday: 9, hour: 1 })).rejects.toMatchObject({ code: "invalid-argument" });
  });
  it("organizers are refused", async () => {
    const api = createMockApi(store());
    const session = await api.signIn("organizer");
    await expect(suggestionsApiFor(api, session).manage("status")).rejects.toMatchObject({ code: "permission-denied" });
  });
  it("computes the next send in the future on the right weekday", () => {
    const now = new Date("2026-11-17T12:00:00Z"); // Tuesday 04:00 PST
    const next = new Date(mockNextSend({ weekday: 1, hour: 9 }, now));
    expect(next.getTime()).toBeGreaterThan(now.getTime());
    expect(nextSendLabel(next.toISOString(), "America/Los_Angeles")).toBe("Monday, Nov 23 at 9:00 AM PST");
  });
});
