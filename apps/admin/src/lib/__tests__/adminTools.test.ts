import { describe, expect, it } from "vitest";
import { type KeyValueStore, createMockApi } from "../api";
import { can, isStaff } from "../adminTypes";
import { neutralizeFormula, parseCsv, toCsv } from "../csv";
import { chunkRows, planCounts, rowsFromTable, templateCsv } from "../importFile";
import { applyAll, planAll } from "../importRun";
import { columnIndex } from "../xlsx";

const NOW = new Date("2026-11-03T12:00:00Z");
const store = (): KeyValueStore => {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
};
async function as(persona: "admin" | "organizer" | "member" | "otherAdmin") {
  const api = createMockApi(store(), () => NOW);
  await api.signIn(persona);
  return api;
}

describe("permissions", () => {
  it("gives organizers events, themes, albums and attendees only", () => {
    expect(can("organizer", "albums.moderate")).toBe(true);
    expect(can("organizer", "members.edit")).toBe(false);
    expect(can("organizer", "import.run")).toBe(false);
    expect(can("admin", "audit.view")).toBe(true);
    expect(can("member", "events.manage")).toBe(false);
    expect(isStaff("member")).toBe(false);
  });
  it("is enforced by the mock like the backend", async () => {
    const organizer = await as("organizer");
    await expect(organizer.listAudit()).rejects.toMatchObject({ code: "permission-denied" });
    await expect(organizer.listRoster()).rejects.toMatchObject({ code: "permission-denied" });
    await expect(organizer.listPhotos("game-cafe")).resolves.toBeTruthy();
    const member = await as("member");
    await expect(member.listPhotos("game-cafe")).rejects.toMatchObject({ code: "permission-denied" });
  });
});

describe("csv", () => {
  it("parses quotes, CRLF, BOM and semicolons", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","he said ""hi"""\r\n\r\n')).toEqual([["a", "b"], ["x, y", 'he said "hi"']]);
    expect(parseCsv("a;b\n1;2")).toEqual([["a", "b"], ["1", "2"]]);
  });
  it("round-trips and neutralizes formulas", () => {
    expect(parseCsv(toCsv([["n", "t"], ["Ann, B", 'q"q']]))).toEqual([["n", "t"], ["Ann, B", 'q"q']]);
    expect(neutralizeFormula("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(toCsv([["@x"]])).toBe("'@x\r\n");
  });
  it("maps xlsx column letters", () => {
    expect([columnIndex("A1"), columnIndex("Z9"), columnIndex("AA2")]).toEqual([0, 25, 26]);
  });
});

describe("import file", () => {
  const header = ["Email", "Name", "Role", "Teams", "Department", "Job title", "Location"];
  it("reads aliases, flags bad rows locally and keeps spreadsheet lines", () => {
    const parsed = rowsFromTable([header, ["Sam@Acme.com", "Sam", "", "Platform;Design", "Eng", "Dev", "Remote"], ["bad", "X", "", "", "", "", ""], ["sam@acme.com", "Dup", "", "", "", "", ""], ["x@other.com", "Out", "", "", "", "", ""]], "acme.com");
    expect(parsed.rows[0]).toMatchObject({ email: "sam@acme.com", role: "", teams: ["Platform", "Design"], workLocation: "Remote" });
    expect(parsed.localErrors.get(3)).toBeTruthy();
    expect(parsed.localErrors.get(4)?.join()).toContain("Duplicate of line 2");
    expect(parsed.localErrors.get(5)?.join()).toContain("@acme.com");
    expect(parsed.localErrors.has(2)).toBe(false);
  });
  it("rejects files without an email column or over the row limit", () => {
    expect(rowsFromTable([["Name"], ["a"]], "acme.com").fatal).toMatch(/Email/);
    expect(rowsFromTable([["Email"], ...Array.from({ length: 2001 }, (_, i) => [`u${i}@acme.com`])], "acme.com").fatal).toMatch(/2000/);
    expect(rowsFromTable([], "acme.com").fatal).toBeTruthy();
  });
  it("chunks only valid rows", () => {
    const rows = [["email"], ...Array.from({ length: 5 }, (_, i) => [`u${i}@acme.com`]), ["nope"]];
    const chunks = chunkRows(rowsFromTable(rows, "acme.com"), 2);
    expect(chunks.map((c) => c.rows.length)).toEqual([2, 2, 1]);
    expect(chunks[1].lines).toEqual([4, 5]);
  });
  it("offers a template with the company domain", () => {
    expect(templateCsv("acme.com")).toContain("sam.rivera@acme.com");
  });
});

describe("import flow (mock callables)", () => {
  const sheet = [
    ["email", "displayName", "role", "teams", "department", "jobTitle", "workLocation"],
    ["new.person@acme.com", "New Person", "member", "Platform", "Eng", "Dev", "Remote"], // create
    ["pat@acme.com", "Pat Member", "member", "", "", "", "Berlin"], // update location
    ["casey.novak@acme.com", "", "", "", "", "", ""], // blank role keeps the current role: unchanged
    ["new.two@acme.com", "Two", "member", "Nope", "", "", ""], // unknown team
  ];
  it("previews without writing, then applies idempotently", async () => {
    const api = await as("admin");
    const parsed = rowsFromTable(sheet, "acme.com");
    const { rows, chunkCount } = await planAll(api, parsed, "job-1");
    expect(planCounts(rows)).toMatchObject({ create: 1, invalid: 1 });
    expect(rows.find((r) => r.email === "pat@acme.com")?.changes).toEqual([{ field: "workLocation", before: expect.any(String), after: "Berlin" }]);
    expect((await api.listRoster()).some((r) => r.email === "new.person@acme.com")).toBe(false);

    const results: string[] = [];
    await applyAll(api, "job-1", chunkCount, 0, (_, chunk) => results.push(...chunk.map((r) => `${r.email}:${r.outcome}`)));
    expect(results).toContain("new.person@acme.com:created");
    expect(results).toContain("new.two@acme.com:failed");
    const roster = await api.listRoster();
    expect(roster.find((r) => r.email === "new.person@acme.com")?.state).toBe("invited");
    expect((await api.getMember("uid-member")).workLocation).toBe("Berlin");

    // Retrying a finished chunk returns the same result and does not repeat the change.
    const again = await api.applyImportChunk("job-1", 0);
    expect(again.map((r) => r.outcome)).toEqual(results.map((r) => r.split(":")[1]));
    const audit = await api.listAudit();
    expect(audit.filter((a) => a.action === "import.apply")).toHaveLength(1);
  });
  it("blocks other companies and organizers", async () => {
    const other = await as("otherAdmin");
    await expect(other.applyImportChunk("job-x", 0)).rejects.toMatchObject({ code: "not-found" });
    const organizer = await as("organizer");
    await expect(organizer.planImportChunk({ jobId: "j", chunkIndex: 0, chunkCount: 1, rows: [], lines: [] })).rejects.toMatchObject({ code: "permission-denied" });
  });
});

describe("member safety rules", () => {
  it("never leaves the company without an admin and needs reasons", async () => {
    const api = await as("admin");
    const me = await api.getMember("uid-admin");
    await expect(api.updateMember("uid-admin", me.revision, { role: "member" })).rejects.toMatchObject({ reason: "LAST_ADMIN" });
    await expect(api.setMemberStatus("uid-admin", "deactivated", "bye")).rejects.toMatchObject({ code: "failed-precondition" });
    await expect(api.setMemberStatus("uid-member", "deactivated", " ")).rejects.toMatchObject({ code: "invalid-argument" });
    const off = await api.setMemberStatus("uid-member", "deactivated", "left the company");
    expect(off.status).toBe("deactivated");
    expect((await api.listAudit())[0]).toMatchObject({ action: "member.deactivate", reason: "left the company" });
  });
  it("rejects stale revisions and keeps tenants apart", async () => {
    const api = await as("admin");
    const m = await api.getMember("uid-member");
    await api.updateMember("uid-member", m.revision, { jobTitle: "Lead" });
    await expect(api.updateMember("uid-member", m.revision, { jobTitle: "Other" })).rejects.toMatchObject({ reason: "REVISION_CONFLICT" });
    await expect(api.getMember("uid-other-admin")).rejects.toMatchObject({ code: "not-found" });
  });
  it("adjusts points once per request and resets the profile but keeps points", async () => {
    const api = await as("admin");
    const before = (await api.getMember("uid-member")).pointsBalance;
    await api.adjustPoints("uid-member", "req-1", { delta: 50 }, "bonus");
    await api.adjustPoints("uid-member", "req-1", { delta: 50 }, "bonus");
    expect((await api.getMember("uid-member")).pointsBalance).toBe(before + 50);
    await expect(api.adjustPoints("uid-member", "req-2", { delta: -100000 }, "oops")).rejects.toMatchObject({ code: "invalid-argument" });
    const reset = await api.resetMemberProfile("uid-member", "requested by member");
    expect(reset).toMatchObject({ interestTagIds: [], favoriteCount: 0, pointsBalance: before + 50 });
  });
});

describe("albums and attendees", () => {
  it("removing a photo removes its comments and audits; double removal is not-found", async () => {
    const api = await as("organizer");
    const photos = await api.listPhotos("game-cafe");
    const withComments = photos.find((p) => p.commentCount > 0)!;
    expect(await api.listPhotoComments("game-cafe", withComments.id)).toHaveLength(withComments.commentCount);
    await expect(api.removePhoto("game-cafe", withComments.id, "")).rejects.toMatchObject({ code: "invalid-argument" });
    await api.removePhoto("game-cafe", withComments.id, "off topic");
    await expect(api.removePhoto("game-cafe", withComments.id, "off topic")).rejects.toMatchObject({ code: "not-found" });
    expect(await api.listPhotoComments("game-cafe", withComments.id)).toHaveLength(0);
  });
  it("respects capacity, idempotent adds and updates counts", async () => {
    const api = await as("organizer");
    const kayaking = await api.getEvent("kayaking"); // full: 12 of 12
    const members = await api.listMembers();
    const attendees = await api.listAttendees("kayaking");
    const outsider = members.find((m) => m.status === "active" && !attendees.some((a) => a.memberId === m.id))!;
    const base = { eventId: "kayaking", memberId: outsider.id, requestId: "r1", overrideCapacity: false, notify: true };
    await expect(api.addAttendee(base)).rejects.toMatchObject({ reason: "EVENT_FULL" });
    await expect(api.addAttendee({ ...base, overrideCapacity: true })).rejects.toMatchObject({ code: "invalid-argument" });
    const added = await api.addAttendee({ ...base, overrideCapacity: true, reason: "VIP" });
    expect(added.attendeeCount).toBe(kayaking.attendeeCount + 1);
    expect((await api.addAttendee({ ...base, overrideCapacity: true, reason: "VIP" })).attendeeCount).toBe(kayaking.attendeeCount + 1);
    expect((await api.getEvent("kayaking")).attendeeCount).toBe(kayaking.attendeeCount + 1);
    const removed = await api.removeAttendee("kayaking", outsider.id, false, "mistake");
    expect(removed.attendeeCount).toBe(kayaking.attendeeCount);
  });
  it("awards points once on check-in", async () => {
    const api = await as("organizer");
    const target = (await api.listAttendees("puppy-yoga")).find((a) => a.attendance === "unmarked")!;
    expect((await api.setAttendance("puppy-yoga", target.memberId, "checkedIn")).pointsAwarded).toBeGreaterThan(0);
    expect((await api.setAttendance("puppy-yoga", target.memberId, "checkedIn")).pointsAwarded).toBe(0);
  });
});
