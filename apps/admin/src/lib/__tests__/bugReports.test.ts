import { describe, expect, it } from "vitest";
import { type KeyValueStore, createMockApi } from "../api";
import { type BugReportQuery, can } from "../adminTypes";
import { badgeLabel } from "../bugBadge";
import { bugReportFromWire } from "../adminLive";
import { diagnosticRows, issueText } from "../bugReports";

const NOW = new Date("2026-11-11T12:00:00Z");
const store = (): KeyValueStore => {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
};
async function as(persona: "admin" | "organizer" | "member" | "otherAdmin") {
  const api = createMockApi(store(), () => NOW);
  await api.signIn(persona);
  return api;
}
const ALL: BugReportQuery = { query: "", status: "all", category: "all", from: "", to: "" };

describe("bug reports permissions", () => {
  it("are admin only", () => {
    expect(can("admin", "bugreports.manage")).toBe(true);
    expect(can("organizer", "bugreports.manage")).toBe(false);
    expect(can("member", "bugreports.manage")).toBe(false);
  });
  it("are refused for organizers and members by the mock like the backend", async () => {
    for (const persona of ["organizer", "member"] as const) {
      const api = await as(persona);
      await expect(api.listBugReports(ALL)).rejects.toMatchObject({ code: "permission-denied" });
      await expect(api.getBugReport("x")).rejects.toMatchObject({ code: "permission-denied" });
      await expect(api.updateBugReport("x", { status: "triaged" }, 0)).rejects.toMatchObject({ code: "permission-denied" });
    }
  });
});

describe("bug reports inbox (mock)", () => {
  it("lists newest first with counts on the first page only, and pages with a cursor", async () => {
    const api = await as("admin");
    const first = await api.listBugReports(ALL, null, 5);
    expect(first.reports).toHaveLength(5);
    expect(first.counts).toMatchObject({ all: 14, capped: false });
    expect(first.counts!.new + first.counts!.triaged + first.counts!.resolved).toBe(14);
    expect(first.nextCursor).toBeTruthy();
    const dates = first.reports.map((r) => Date.parse(r.createdAt));
    expect([...dates].sort((a, b) => b - a)).toEqual(dates);
    const second = await api.listBugReports(ALL, first.nextCursor, 5);
    expect(second.counts).toBeNull();
    expect(second.reports.map((r) => r.id)).not.toContain(first.reports[0].id);
    const rest = await api.listBugReports(ALL, second.nextCursor, 5);
    expect(rest.reports).toHaveLength(4);
    expect(rest.nextCursor).toBeNull();
  });

  it("filters by status, category, text and date, and never shows another company's reports", async () => {
    const api = await as("admin");
    const resolved = await api.listBugReports({ ...ALL, status: "resolved" });
    expect(resolved.reports.every((r) => r.status === "resolved")).toBe(true);
    expect(resolved.counts!.all).toBe(14);
    expect((await api.listBugReports({ ...ALL, category: "idea" })).reports.every((r) => r.category === "idea")).toBe(true);
    expect((await api.listBugReports({ ...ALL, query: "SPINNING" })).reports).toHaveLength(1);
    expect((await api.listBugReports({ ...ALL, from: "2099-01-01" })).reports).toHaveLength(0);
    const everything = await api.listBugReports(ALL, null, 100);
    expect(everything.reports.some((r) => r.description.includes("Globex only"))).toBe(false);
    const other = await as("otherAdmin");
    const theirs = await other.listBugReports(ALL);
    expect(theirs.reports).toHaveLength(1);
    expect(theirs.reports[0].description).toContain("Globex only");
    await expect(other.getBugReport(everything.reports[0].id)).rejects.toMatchObject({ code: "not-found" });
  });

  it("shows the reporter's email and diagnostics only in the detail", async () => {
    const api = await as("admin");
    const { reports } = await api.listBugReports({ ...ALL, query: "spinning" });
    expect(JSON.stringify(reports)).not.toContain("@acme.com");
    const detail = await api.getBugReport(reports[0].id);
    expect(detail.reporterEmail).toMatch(/@acme\.com$/);
    expect(detail.diagnostics?.osVersion).toBeTruthy();
    expect(detail.screenshotUrl).toBeTruthy();
  });

  it("saves status, note and assignee, bumps the revision, audits, and guards stale saves", async () => {
    const api = await as("admin");
    const target = (await api.listBugReports({ ...ALL, status: "new" })).reports[0];
    const before = await api.getBugReport(target.id);
    const saved = await api.updateBugReport(target.id, { status: "triaged", note: "  Repro on iOS 18  ", assigneeId: "uid-admin" }, before.revision);
    expect(saved).toMatchObject({ status: "triaged", note: "Repro on iOS 18", assigneeId: "uid-admin", revision: before.revision + 1, changed: true });
    const after = await api.getBugReport(target.id);
    expect([after.report.status, after.report.hasNote, after.report.assigneeName]).toEqual(["triaged", true, "Alex Admin"]);
    await expect(api.updateBugReport(target.id, { status: "resolved" }, before.revision)).rejects.toMatchObject({ code: "aborted", reason: "REVISION_CONFLICT" });
    const same = await api.updateBugReport(target.id, { status: "triaged" }, after.revision);
    expect(same.changed).toBe(false);
    expect(same.revision).toBe(after.revision);
    const cleared = await api.updateBugReport(target.id, { assigneeId: null }, after.revision);
    expect(cleared.assigneeId).toBeNull();
    await expect(api.updateBugReport(target.id, { assigneeId: "uid-member" }, cleared.revision)).rejects.toMatchObject({ reason: "ASSIGNEE_NOT_FOUND" });
    const audit = await api.listAudit();
    expect(audit.filter((a) => a.action === "bugreport.update")).toHaveLength(2);
    expect((await api.listBugReports({ ...ALL, status: "new" })).counts!.new).toBe((await api.listBugReports(ALL)).counts!.new);
  });
});

describe("bug report helpers", () => {
  const detail = {
    report: { id: "r1", category: "bug" as const, description: "The join button keeps spinning\nand then the app freezes", source: "shake" as const, screen: "event", createdAt: "2026-11-11T09:30:00.000Z",
      reporterId: "u1", reporterName: "Pat", hasScreenshot: false, status: "new" as const, hasNote: true },
    reporterEmail: "pat@acme.com", diagnostics: { appVersion: "2.1", appBuild: "418", osVersion: "iOS 18.1", deviceModel: "iPhone17,1", locale: "en_US", screen: "event", installId: "abc" },
    screenshotUrl: null, note: "Seen twice", revision: 1, updatedAt: null, updatedByName: null,
  };
  it("formats issue text without the reporter's identity", () => {
    const text = issueText(detail);
    expect(text).toContain("## The join button keeps spinning");
    expect(text).toContain("- App version: 2.1 (418)");
    expect(text).toContain("- OS: iOS 18.1");
    expect(text).toContain("- Report ID: r1");
    expect(text).toContain("**Internal note**\nSeen twice");
    expect(text).not.toContain("pat@acme.com");
    expect(text).not.toContain("Pat");
    expect(text).not.toContain("abc");
  });
  it("titles an empty description by category and truncates long first lines", () => {
    expect(issueText({ ...detail, report: { ...detail.report, description: "" } })).toContain("## Bug report from the app");
    expect(issueText({ ...detail, report: { ...detail.report, description: "x".repeat(200) } }).split("\n")[0].length).toBeLessThanOrEqual(84);
  });
  it("lists diagnostics in order and skips empty ones", () => {
    expect(diagnosticRows(null)).toEqual([]);
    expect(diagnosticRows({ osVersion: "iOS 18", appVersion: "2.1" }).map((r) => r.label)).toEqual(["App version", "OS"]);
  });
  it("maps wire reports defensively", () => {
    const r = bugReportFromWire({ id: "a", category: "weird", status: "nope", createdAt: "2026-11-11T09:30:00Z", reporterId: "u", reporterName: "N" });
    expect([r.category, r.status, r.source, r.hasScreenshot]).toEqual(["unspecified", "new", "shake", false]);
  });
  it("labels the sidebar badge", () => {
    expect(badgeLabel({ count: 3, capped: false })).toBe("3");
    expect(badgeLabel({ count: 3, capped: true })).toBe("3+");
    expect(badgeLabel({ count: 120, capped: false })).toBe("99+");
  });
});
