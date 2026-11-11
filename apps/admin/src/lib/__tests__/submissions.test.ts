import { describe, expect, it } from "vitest";
import { type KeyValueStore, createMockApi } from "../api";

const NOW = new Date("2026-11-03T12:00:00Z");
const store = (): KeyValueStore => {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
};
async function as(persona: "admin" | "organizer" | "member" | "otherAdmin") {
  const api = createMockApi(store(), () => NOW);
  await api.signIn(persona);
  const themeId = (await api.listThemes().catch(() => []))[0]?.id ?? "";
  return { api, themeId };
}

describe("challenge submission review (mock callables)", () => {
  it("is admin only, like the callables", async () => {
    const { api: organizer, themeId } = await as("organizer");
    await expect(organizer.listSubmissions(themeId, "submitted")).rejects.toMatchObject({ code: "permission-denied" });
    const { api: member } = await as("member");
    await expect(member.listSubmissions("x", "submitted")).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("lists each status and pages with a cursor", async () => {
    const { api, themeId } = await as("admin");
    const pending = await api.listSubmissions(themeId, "submitted");
    expect(pending.submissions.length).toBeGreaterThan(5);
    expect(pending.submissions.every((s) => s.status === "submitted")).toBe(true);
    expect((await api.listSubmissions(themeId, "rejected")).submissions[0].reviewNote).toBeTruthy();
    expect((await api.listSubmissions(themeId, "approved")).submissions[0].pointsAwarded).toBe(50);
    await expect(api.listSubmissions("no-such-theme", "submitted")).rejects.toMatchObject({ reason: "CHALLENGE_NOT_FOUND", code: "not-found" });
  });

  it("approves once, awards the theme's points and replays safely", async () => {
    const { api, themeId } = await as("admin");
    const second = (await api.listSubmissions(themeId, "submitted")).submissions.filter((s) => s.userId !== "uid-casey-novak")[1];
    const before = (await api.getMember(second.userId)).pointsBalance!;
    const result = await api.approveSubmission(second);
    expect(result).toEqual({ pointsAwarded: 50, replayed: false });
    expect((await api.getMember(second.userId)).pointsBalance).toBe(before + 50);
    expect(await api.approveSubmission(second)).toEqual({ pointsAwarded: 0, replayed: true });
    expect((await api.getMember(second.userId)).pointsBalance).toBe(before + 50);
    await expect(api.rejectSubmission(second, "too late")).rejects.toMatchObject({ reason: "SUBMISSION_LOCKED" });
  });

  it("rejects with a required note; approving a sent-back entry is refused", async () => {
    const { api, themeId } = await as("admin");
    const first = (await api.listSubmissions(themeId, "submitted")).submissions.filter((s) => s.userId !== "uid-casey-novak")[0];
    await expect(api.rejectSubmission(first, "  ")).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(api.rejectSubmission(first, "x".repeat(281))).rejects.toMatchObject({ code: "invalid-argument" });
    expect(await api.rejectSubmission(first, "Please add a clearer photo.")).toEqual({ replayed: false });
    expect(await api.rejectSubmission(first, "again")).toEqual({ replayed: true });
    await expect(api.approveSubmission(first)).rejects.toMatchObject({ reason: "SUBMISSION_NOT_PENDING" });
    expect((await api.listSubmissions(themeId, "rejected")).submissions.find((s) => s.id === first.id)?.reviewNote).toBe("Please add a clearer photo.");
  });

  it("refuses a review when the member changed the entry meanwhile, and works after reloading", async () => {
    const { api, themeId } = await as("admin");
    const listed = (await api.listSubmissions(themeId, "submitted")).submissions;
    const edited = listed.find((s) => s.userId === "uid-casey-novak")!; // the demo entry the member edits as you review it
    await expect(api.approveSubmission(edited)).rejects.toMatchObject({ reason: "SUBMISSION_CHANGED", code: "failed-precondition" });
    const fresh = (await api.listSubmissions(themeId, "submitted")).submissions.find((s) => s.id === edited.id)!;
    expect(fresh.updatedAt).not.toBe(edited.updatedAt);
    expect(fresh.caption).toContain("edited just now");
    expect((await api.approveSubmission(fresh)).replayed).toBe(false);
  });
});
