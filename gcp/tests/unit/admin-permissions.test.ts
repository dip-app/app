import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { addEventAttendee, recordAttendance, removeEventAttendee } from "../../functions/src/modules/admin/application/attendees";
import { applyEmployeeImport, getEmployeeImport, importEmployees } from "../../functions/src/modules/admin/application/importEmployees";
import {
  adjustMemberPoints, getMember, listMembers, resetMemberProfile, setMemberStatus, updateMember, upsertTeam,
} from "../../functions/src/modules/admin/application/members";
import { removeEventPhoto, removeEventPhotoComment } from "../../functions/src/modules/admin/application/moderation";
import { backfillRosterCallable } from "../../functions/src/modules/admin/application/backfillRoster";
import { listRoster, resendRosterInvite, revokeRosterEntry, upsertRosterEntry } from "../../functions/src/modules/admin/application/roster";
import { AdminError } from "../../functions/src/modules/admin/domain/errors";
import { can, PERMISSION_MATRIX, type Permission } from "../../functions/src/modules/admin/domain/permissions";
import { handleAdminCommand, toHttpsError } from "../../functions/src/modules/admin/transport/adminCallables";
import { caller, makeDeps, rid, seedCompany } from "./helpers/adminFakes";

async function denied(promise: Promise<unknown>, code: string, reason: string) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof AdminError, String(error));
    assert.equal(error.code, code);
    assert.equal(error.reason, reason);
    return true;
  });
}

const base = () => ({ contractVersion: 1, companyId: "alpha" });
const HASH = "a".repeat(64);
/** Every admin command with a schema-valid minimal payload; auth is checked before any resource is read. */
const COMMANDS: Array<{ name: string; run: typeof removeEventPhoto; permission: Permission; payload: () => Record<string, unknown> }> = [
  { name: "removeEventPhotoV1", run: removeEventPhoto, permission: "album.moderate", payload: () => ({ ...base(), requestId: rid(), eventId: "past", photoId: "m1_0" }) },
  { name: "removeEventPhotoCommentV1", run: removeEventPhotoComment as never, permission: "album.moderate", payload: () => ({ ...base(), requestId: rid(), eventId: "past", photoId: "m1_0", commentId: "c1" }) },
  { name: "addEventAttendeeV1", run: addEventAttendee as never, permission: "attendee.manage", payload: () => ({ ...base(), requestId: rid(), eventId: "soon", userId: "m1" }) },
  { name: "removeEventAttendeeV1", run: removeEventAttendee as never, permission: "attendee.manage", payload: () => ({ ...base(), requestId: rid(), eventId: "soon", userId: "m1" }) },
  { name: "recordAttendanceV1", run: recordAttendance as never, permission: "attendance.record", payload: () => ({ ...base(), eventId: "live", userId: "m1" }) },
  { name: "listMembersV1", run: listMembers as never, permission: "member.read", payload: () => base() },
  { name: "getMemberV1", run: getMember as never, permission: "member.read", payload: () => ({ ...base(), userId: "m1" }) },
  { name: "updateMemberV1", run: updateMember as never, permission: "member.manage", payload: () => ({ ...base(), requestId: rid(), userId: "m1", workLocation: "HQ" }) },
  { name: "resetMemberProfileV1", run: resetMemberProfile as never, permission: "member.manage", payload: () => ({ ...base(), requestId: rid(), userId: "m1" }) },
  { name: "setMemberStatusV1", run: setMemberStatus as never, permission: "member.manage", payload: () => ({ ...base(), requestId: rid(), userId: "m1", status: "deactivated" }) },
  { name: "adjustMemberPointsV1", run: adjustMemberPoints as never, permission: "member.manage", payload: () => ({ ...base(), requestId: rid(), userId: "m1", delta: 5, reason: "Bonus" }) },
  { name: "upsertTeamV1", run: upsertTeam as never, permission: "team.manage", payload: () => ({ ...base(), requestId: rid(), name: "Platform" }) },
  { name: "upsertRosterEntryV1", run: upsertRosterEntry as never, permission: "roster.manage", payload: () => ({ ...base(), requestId: rid(), entry: { email: "new@alpha.test" } }) },
  { name: "revokeRosterEntryV1", run: revokeRosterEntry as never, permission: "roster.manage", payload: () => ({ ...base(), requestId: rid(), entryId: HASH }) },
  { name: "resendRosterInviteV1", run: resendRosterInvite as never, permission: "roster.manage", payload: () => ({ ...base(), requestId: rid(), entryId: HASH }) },
  { name: "listRosterV1", run: listRoster as never, permission: "roster.manage", payload: () => base() },
  { name: "backfillRosterV1", run: backfillRosterCallable as never, permission: "roster.manage", payload: () => ({ ...base(), requestId: rid(), dryRun: true }) },
  { name: "importEmployeesV1", run: importEmployees as never, permission: "import.run", payload: () => ({ ...base(), requestId: rid(), rows: [{ email: "new@alpha.test" }] }) },
  { name: "applyEmployeeImportV1", run: applyEmployeeImport as never, permission: "import.run", payload: () => ({ ...base(), jobId: "job1", planHash: HASH }) },
  { name: "getEmployeeImportV1", run: getEmployeeImport as never, permission: "import.run", payload: () => ({ ...base(), jobId: "job1" }) },
];

describe("permission matrix", () => {
  test("members have no admin permission; organizers have only the operational ones; admins have all", () => {
    for (const [permission, roles] of Object.entries(PERMISSION_MATRIX)) {
      assert.equal(can("member", permission as Permission), false, permission);
      assert.equal(can("admin", permission as Permission), true, permission);
      assert.equal(roles.includes("organizer"), can("organizer", permission as Permission));
    }
    for (const allowed of ["event.manage", "attendee.manage", "attendance.record", "album.moderate", "member.read"] as const) assert.equal(can("organizer", allowed), true);
    for (const adminOnly of ["member.manage", "team.manage", "roster.manage", "import.run", "audit.read"] as const) assert.equal(can("organizer", adminOnly), false);
    assert.equal(can("superuser", "member.read"), false);
    assert.equal(can(undefined, "member.read"), false);
  });
});

describe("every admin command enforces authentication and role server-side", () => {
  for (const command of COMMANDS) {
    test(command.name, async () => {
      const { deps, store } = makeDeps();
      seedCompany(store);
      await denied(command.run(deps, null, command.payload()), "unauthenticated", "UNAUTHENTICATED");
      await denied(command.run(deps, caller("admin1", { emailVerified: false }), command.payload()), "permission-denied", "EMAIL_NOT_VERIFIED");
      await denied(command.run(deps, caller("admin1", { signInProvider: "password" }), command.payload()), "permission-denied", "PROVIDER_NOT_ALLOWED");
      await denied(command.run(deps, caller("m1"), command.payload()), "permission-denied", "INSUFFICIENT_ROLE");
      await denied(command.run(deps, caller("nobody"), command.payload()), "permission-denied", "MEMBERSHIP_CONFLICT");
      await denied(command.run(deps, caller("deact"), command.payload()), "permission-denied", "ACCOUNT_DEACTIVATED");
      // Another company's admin is refused for this company, whatever the payload claims.
      await denied(command.run(deps, caller("bo"), command.payload()), "permission-denied", "COMPANY_MISMATCH");
      assert.equal(store.writes, 0, "a denied call writes nothing");
      // An organizer is refused exactly the admin-only commands.
      const outcome = await command.run(deps, caller("org1"), command.payload()).then(() => "ok", (e: AdminError) => e.reason);
      if (can("organizer", command.permission)) assert.notEqual(outcome, "INSUFFICIENT_ROLE");
      else assert.equal(outcome, "INSUFFICIENT_ROLE");
    });
  }

  test("a deactivated admin is refused with ACCOUNT_DEACTIVATED", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    store.seed("users/gone-admin", { ...store.get("users/admin1")!, status: "deactivated" });
    await denied(updateMember(deps, caller("gone-admin"), { ...base(), requestId: rid(), userId: "m1", workLocation: "HQ" }), "permission-denied", "ACCOUNT_DEACTIVATED");
  });

  test("malformed and unknown fields fail validation with sorted field names before any read", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    await assert.rejects(updateMember(deps, caller("admin1"), { ...base(), requestId: "x", userId: "a/b", role: "root", bogus: 1 }),
      (e: AdminError) => e.reason === "VALIDATION_FAILED" && e.fields.join() === "bogus,requestId,role,userId");
    await assert.rejects(updateMember(deps, caller("admin1"), { contractVersion: 2, companyId: "alpha" }), (e: AdminError) => e.fields.includes("contractVersion"));
    await assert.rejects(updateMember(deps, caller("admin1"), "nope"), (e: AdminError) => e.reason === "VALIDATION_FAILED");
  });
});

describe("transport mapping", () => {
  test("maps domain errors to callable errors with reasons and hides internals", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    await assert.rejects(handleAdminCommand("x", updateMember, deps, { auth: undefined, data: {} }), (e: any) => e.code === "unauthenticated" && e.details.reason === "UNAUTHENTICATED");
    const auth = { uid: "m1", token: { email_verified: true, firebase: { sign_in_provider: "google.com" } } } as never;
    await assert.rejects(handleAdminCommand("x", updateMember, deps, { auth, data: { ...base(), requestId: rid(), userId: "m2" } }), (e: any) => e.code === "permission-denied" && e.details.reason === "INSUFFICIENT_ROLE");
    const internal = toHttpsError(new AdminError("internal", "INVALID_STORED_DATA", "secret detail"));
    assert.equal(internal.code, "internal");
    assert.ok(!internal.message.includes("secret"));
    assert.equal(toHttpsError(new Error("boom")).code, "internal");
    assert.deepEqual((toHttpsError(new AdminError("invalid-argument", "VALIDATION_FAILED", "m", ["a"])).details as any).fields, ["a"]);
  });

  test("the rate limiter is consulted for every command and can refuse", async () => {
    const { deps, store } = makeDeps();
    seedCompany(store);
    const calls: string[] = [];
    deps.limiter = { consume: async uid => { calls.push(uid); if (calls.length > 1) throw new AdminError("resource-exhausted", "RATE_LIMITED", "Slow down."); } };
    await getMember(deps, caller("admin1"), { ...base(), userId: "m1" });
    await denied(getMember(deps, caller("admin1"), { ...base(), userId: "m1" }), "resource-exhausted", "RATE_LIMITED");
    assert.deepEqual(calls, ["admin1", "admin1"]);
  });
});
