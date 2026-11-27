import { describe, expect, it } from "vitest";
import type { RosterRow } from "../adminTypes";
import { invitesCsv } from "../exports";

describe("invitesCsv", () => {
  it("lists invited or revoked people with team names and the date they were added", () => {
    const row: RosterRow = {
      entryId: "e1", email: "dee@acme.com", displayName: "Dee Invited", role: "member", teamIds: ["t1", "gone"], workLocation: "Lisbon",
      department: "Design", jobTitle: "", state: "revoked", invitedAt: "2026-11-02T10:00:00.000Z", revokedAt: "2026-11-05T10:00:00.000Z",
    };
    const lines = invitesCsv([row], [{ id: "t1", name: "Platform" } as never]).trim().split(/\r?\n/);
    expect(lines[0]).toBe("name,email,role,status,teams,department,job title,work location,added");
    expect(lines[1]).toBe("Dee Invited,dee@acme.com,member,revoked,\"Platform; gone\",Design,,Lisbon,2026-11-02");
  });
});
