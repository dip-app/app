import { describe, expect, it } from "vitest";
import { type KeyValueStore, createMockApi } from "../api";
import { can, isStaff } from "../adminTypes";
import { neutralizeFormula, parseCsv, toCsv } from "../csv";
import { planCounts, rowsFromTable, templateCsv, validRows } from "../importFile";
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
  it("gives organizers events, themes, albums, attendees and read-only people", () => {
    expect(can("organizer", "albums.moderate")).toBe(true);
    expect(can("organizer", "members.view")).toBe(true);
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
  it("keeps spreadsheet lines for the valid rows only", () => {
    const rows = [["email"], ...Array.from({ length: 3 }, (_, i) => [`u${i}@acme.com`]), ["nope"], ["u9@acme.com"]];
    const valid = validRows(rowsFromTable(rows, "acme.com"));
    expect(valid.rows).toHaveLength(4);
    expect(valid.lines).toEqual([2, 3, 4, 6]);
  });
  it("offers a template with the company domain", () => {
    expect(templateCsv("acme.com")).toContain("sam.rivera@acme.com");
  });
});

describe("import flow (mock callables)", () => {
  const sheet = [
    ["email", "displayName", "role", "teams", "department", "jobTitle", "workLocation"],
    ["new.person@acme.com", "New Person", "member", "Platform", "Eng", "Dev", "Remote"], // create
    ["pat@acme.com", "Pat Member", "", "", "", "", "Berlin"], // update location
    ["casey.novak@acme.com", "", "", "", "", "", ""], // blank cells keep everything: unchanged
    ["new.two@acme.com", "Two", "member", "Nope", "", "", ""], // unknown team
    ["bad-email", "X", "", "", "", "", ""], // rejected in the browser
  ];
  it("previews without writing, then applies chunk by chunk and idempotently", async () => {
    const api = await as("admin");
    const parsed = rowsFromTable(sheet, "acme.com");
    const plan = await planAll(api, parsed, "request-0001", "people.csv");
    expect(planCounts(plan.rows)).toEqual({ create: 1, update: 1, unchanged: 1, invalid: 2 });
    expect(plan.rows.find((r) => r.email === "pat@acme.com")).toMatchObject({ line: 3, changes: [{ field: "workLocation", after: "Berlin" }] });
    expect(plan.rows.find((r) => r.email === "new.two@acme.com")?.errors[0]).toMatch(/Unknown team/);
    expect((await api.listRoster()).some((r) => r.email === "new.person@acme.com")).toBe(false);
    // Same request and rows returns the same job; the same request with other rows is refused.
    expect((await planAll(api, parsed, "request-0001", "people.csv")).jobId).toBe(plan.jobId);
    await expect(planAll(api, rowsFromTable([["email", "name"], ["x@acme.com", "X"]], "acme.com"), "request-0001", "other.csv")).rejects.toMatchObject({ reason: "REQUEST_REUSED" });

    const steps: number[] = [];
    await applyAll(api, plan.jobId, plan.planHash, (step) => steps.push(step.results.length));
    expect(steps).toEqual([4]);
    const roster = await api.listRoster();
    expect(roster.find((r) => r.email === "new.person@acme.com")?.state).toBe("invited");
    expect((await api.getMember("uid-member")).workLocation).toBe("Berlin");
    const before = (await api.listAudit()).length;
    // A finished job is a no-op.
    expect((await api.applyImportStep(plan.jobId, plan.planHash)).done).toBe(true);
    expect((await api.listAudit()).length).toBe(before);
    await expect(api.applyImportStep(plan.jobId, "0".repeat(64))).rejects.toMatchObject({ reason: "IMPORT_PLAN_MISMATCH" });
  });
  it("processes large files in server-sized chunks", async () => {
    const api = await as("admin");
    const big = [["email", "name"], ...Array.from({ length: 250 }, (_, i) => [`bulk${i}@acme.com`, `Bulk ${i}`])];
    const plan = await planAll(api, rowsFromTable(big, "acme.com"), "request-0002", "big.csv");
    expect(plan.chunkCount).toBe(3);
    const sizes: number[] = [];
    await applyAll(api, plan.jobId, plan.planHash, (step) => sizes.push(step.results.length));
    expect(sizes).toEqual([100, 100, 50]);
  });
  it("blocks other companies and organizers", async () => {
    const other = await as("otherAdmin");
    await expect(other.applyImportStep("job-x", "0".repeat(64))).rejects.toMatchObject({ code: "not-found" });
    const organizer = await as("organizer");
    await expect(organizer.planImport({ requestId: "request-0003", fileName: "a.csv", rows: [] })).rejects.toMatchObject({ code: "permission-denied" });
  });
});

describe("member safety rules", () => {
  it("never leaves the company without an admin and needs reasons", async () => {
    const api = await as("admin");
    const me = await api.getMember("uid-admin");
    await expect(api.updateMember("uid-admin", me.revision, { role: "member" })).rejects.toMatchObject({ reason: "LAST_ADMIN" });
    await expect(api.setMemberStatus("uid-admin", "deactivated", "bye now")).rejects.toMatchObject({ reason: "CANNOT_DEACTIVATE_SELF" });
    await expect(api.setMemberStatus("uid-member", "deactivated", " ")).rejects.toMatchObject({ code: "invalid-argument" });
    const off = await api.setMemberStatus("uid-member", "deactivated", "left the company");
    expect(off.status).toBe("deactivated");
    expect((await api.listAudit())[0]).toMatchObject({ action: "member.status", reason: "left the company", actorRole: "admin" });
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
    const before = (await api.getMember("uid-member")).pointsBalance!;
    await api.adjustPoints("uid-member", "req-0001", 50, "bonus");
    await api.adjustPoints("uid-member", "req-0001", 50, "bonus");
    expect((await api.getMember("uid-member")).pointsBalance).toBe(before + 50);
    await expect(api.adjustPoints("uid-member", "req-0002", -100000, "oops")).rejects.toMatchObject({ reason: "INSUFFICIENT_POINTS" });
    await expect(api.adjustPoints("uid-member", "req-0003", 0, "nothing")).rejects.toMatchObject({ code: "invalid-argument" });
    const reset = await api.resetMemberProfile("uid-member", "requested by member");
    expect(reset).toMatchObject({ avatarId: "", city: "", pointsBalance: before + 50 });
  });
  it("lets organizers read people but hides balances and blocks edits", async () => {
    const organizer = await as("organizer");
    expect((await organizer.getMember("uid-member")).pointsBalance).toBeNull();
    await expect(organizer.updateMember("uid-member", 1, { jobTitle: "Boss" })).rejects.toMatchObject({ reason: "INSUFFICIENT_ROLE" });
    await expect(organizer.adjustPoints("uid-member", "req-0004", 5, "nope")).rejects.toMatchObject({ code: "permission-denied" });
  });
});

describe("albums and attendees", () => {
  it("removing a photo removes its comments and audits; removing it again converges", async () => {
    const api = await as("organizer");
    const photos = await api.listPhotos("game-cafe");
    const withComments = photos.find((p) => p.commentCount > 0)!;
    expect(await api.listPhotoComments("game-cafe", withComments.id)).toHaveLength(withComments.commentCount);
    await expect(api.removePhoto("game-cafe", withComments.id, "")).rejects.toMatchObject({ code: "invalid-argument" });
    await api.removePhoto("game-cafe", withComments.id, "off topic");
    await expect(api.removePhoto("game-cafe", withComments.id, "off topic")).resolves.toBeUndefined();
    expect(await api.listPhotoComments("game-cafe", withComments.id)).toHaveLength(0);
    expect(await api.listPhotos("game-cafe")).toHaveLength(photos.length - 1);
  });
  it("removes one comment and fixes the count", async () => {
    const api = await as("organizer");
    const photo = (await api.listPhotos("game-cafe")).find((p) => p.commentCount === 2)!;
    const [first] = await api.listPhotoComments("game-cafe", photo.id);
    await api.removePhotoComment("game-cafe", photo.id, first.id, "spam");
    expect((await api.listPhotos("game-cafe")).find((p) => p.id === photo.id)?.commentCount).toBe(1);
  });
  it("respects capacity with an audited override, idempotent adds and counts", async () => {
    const api = await as("organizer");
    const kayaking = await api.getEvent("kayaking"); // full: 12 of 12
    const members = await api.listMembers();
    const attendees = await api.listAttendees("kayaking");
    const outsider = members.find((m) => m.status === "active" && !attendees.some((a) => a.memberId === m.id))!;
    const base = { eventId: "kayaking", memberId: outsider.id, requestId: "r0000001", notify: true };
    await expect(api.addAttendee(base)).rejects.toMatchObject({ reason: "EVENT_FULL", code: "resource-exhausted" });
    await expect(api.addAttendee({ ...base, capacityOverrideReason: "x" })).rejects.toMatchObject({ code: "invalid-argument" });
    const added = await api.addAttendee({ ...base, capacityOverrideReason: "VIP guest" });
    expect(added).toEqual({ attendeeCount: kayaking.attendeeCount + 1, capacity: kayaking.capacity + 1 });
    expect((await api.addAttendee({ ...base, capacityOverrideReason: "VIP guest" })).attendeeCount).toBe(kayaking.attendeeCount + 1);
    expect((await api.getEvent("kayaking")).attendeeCount).toBe(kayaking.attendeeCount + 1);
    const removed = await api.removeAttendee("kayaking", outsider.id, false, "mistake");
    expect(removed.attendeeCount).toBe(kayaking.attendeeCount);
    expect(await api.removeAttendee("kayaking", outsider.id, false, "again")).toEqual({ attendeeCount: kayaking.attendeeCount });
  });
  it("refuses to add people to a closed event", async () => {
    const api = await as("organizer");
    const outsider = (await api.listMembers()).find((m) => m.status === "active")!;
    await expect(api.addAttendee({ eventId: "game-cafe", memberId: outsider.id, requestId: "r0000002", notify: false })).rejects.toMatchObject({ reason: "EVENT_CLOSED" });
  });
  it("records attendance, awards points once and locks undo afterwards", async () => {
    const api = await as("organizer");
    const target = (await api.listAttendees("game-cafe")).find((a) => !a.checkedIn)!;
    await expect(api.recordAttendance("puppy-yoga", "uid-admin", true)).rejects.toMatchObject({ reason: "EVENT_NOT_STARTED" });
    expect((await api.recordAttendance("game-cafe", target.memberId, true)).pointsAwarded).toBe(25);
    expect((await api.recordAttendance("game-cafe", target.memberId, true)).pointsAwarded).toBe(0);
    await expect(api.recordAttendance("game-cafe", target.memberId, false)).rejects.toMatchObject({ reason: "ATTENDANCE_LOCKED" });
  });
});
