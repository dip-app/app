import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { getCompanyInsights } from "../../functions/src/modules/admin/application/insights";
import { listBugReports } from "../../functions/src/modules/admin/application/bugReports";
import { listRoster } from "../../functions/src/modules/admin/application/roster";
import { caller, makeDeps, seedCompany } from "./helpers/adminFakes";

const base = { contractVersion: 1, companyId: "alpha" };
const PHOTO = "https://lh3.googleusercontent.com/a/ACg8ocJabc";

describe("avatar fields on admin lists (additive, same company only)", () => {
  test("top members carry photoURL and avatarId only when stored", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    store.seed("users/m1", { ...store.get("users/m1")!, photoURL: PHOTO, avatarId: "" });
    store.seed("users/m2", { ...store.get("users/m2")!, pointsBalance: 50, photoURL: "", avatarId: "" });
    const top = (await getCompanyInsights(deps, caller("admin1"), base)).points!.topMembers;
    const mia = top.find(m => m.userId === "m1")!;
    assert.equal(mia.photoURL, PHOTO);
    assert.ok(!("avatarId" in mia), "an empty avatar id is left out so the portal generates one from the user id");
    const max = top.find(m => m.userId === "m2")!;
    assert.ok(!("photoURL" in max) && !("avatarId" in max));
    assert.ok(top.every(m => m.userId !== "bea" && m.userId !== "bo"), "never another company's members");
  });

  test("bug report reporters carry their stored photo and avatar id", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    store.seed("users/m1", { ...store.get("users/m1")!, photoURL: PHOTO, avatarId: "teal" });
    store.seed("users/m2", { ...store.get("users/m2")!, photoURL: "", avatarId: "" });
    for (const [i, uid] of ["m1", "m2"].entries()) {
      store.seed(`bugReports/00000000-0000-4000-8000-00000000000${i + 1}`, {
        uid, category: "bug", description: "x", source: "shake", screen: "home", createdAt: new Date(Date.UTC(2030, 0, 1, i)),
      });
    }
    const { reports } = await listBugReports(deps, caller("admin1"), base);
    const mia = reports.find(r => r.reporterId === "m1")!;
    assert.equal(mia.reporterPhotoURL, PHOTO);
    assert.equal(mia.reporterAvatarId, "teal");
    const max = reports.find(r => r.reporterId === "m2")!;
    assert.ok(!("reporterPhotoURL" in max) && !("reporterAvatarId" in max));
  });

  test("claimed roster entries carry their member's profile; invited ones and other companies' users do not", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    store.seed("users/m1", { ...store.get("users/m1")!, photoURL: PHOTO, avatarId: "" });
    const entry = (extra: Record<string, unknown>) => ({
      companyId: "alpha", displayName: "x", role: "member", teamIds: [], workLocation: "", department: "", jobTitle: "", source: "manual",
      createdAt: new Date(Date.UTC(2030, 0, 1)), updatedAt: new Date(Date.UTC(2030, 0, 1)), revision: 1, ...extra,
    });
    store.seed("companies/alpha/roster/a", entry({ email: "mia@alpha.test", status: "claimed", claimedBy: "m1", memberStatus: "active" }));
    store.seed("companies/alpha/roster/b", entry({ email: "new@alpha.test", status: "invited" }));
    // A claim that points at another company's user must not leak that user's profile.
    store.seed("users/bea", { ...store.get("users/bea")!, photoURL: PHOTO, avatarId: "red" });
    store.seed("companies/alpha/roster/c", entry({ email: "odd@alpha.test", status: "claimed", claimedBy: "bea", memberStatus: "active" }));
    const { entries } = await listRoster(deps, caller("admin1"), base);
    const byEmail = (email: string) => entries.find(e => e.email === email)!;
    assert.equal(byEmail("mia@alpha.test").memberPhotoURL, PHOTO);
    assert.ok(!("memberAvatarId" in byEmail("mia@alpha.test")));
    assert.ok(!("memberPhotoURL" in byEmail("new@alpha.test")));
    assert.ok(!("memberPhotoURL" in byEmail("odd@alpha.test")) && !("memberAvatarId" in byEmail("odd@alpha.test")));
  });
});
