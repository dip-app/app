import { emailHash, normalizeEmail } from "../domain/employee";
import { statusOf } from "../domain/member";
import { paths, SERVER_TIME } from "../domain/ops";
import type { AdminStore, Doc } from "./ports";

export interface BackfillResult { scanned: number; created: number; existing: number; skipped: number }

const text = (value: unknown) => (typeof value === "string" ? value : "");

/**
 * One-off helper (emulator/test only, see gcp/scripts/backfill-roster.ts): gives every existing member of a company a claimed
 * roster entry so the roster lists everyone. Idempotent: an existing entry (invited, claimed or revoked) is never touched, and a
 * re-run creates nothing. Members without an email are skipped. Not a callable; nothing in production calls it.
 */
export async function backfillRoster(store: AdminStore, companyId: string, now: Date = new Date()): Promise<BackfillResult> {
  const result: BackfillResult = { scanned: 0, created: 0, existing: 0, skipped: 0 };
  let afterId: string | undefined;
  for (;;) {
    const page = await store.runReadOnly(tx => tx.list("users", { where: [["companyId", companyId]], limit: 200, ...(afterId ? { afterId } : {}) }));
    for (const member of page) {
      result.scanned += 1;
      const email = normalizeEmail(text(member.data.email));
      if (!email) { result.skipped += 1; continue; }
      const entryPath = paths.rosterEntry(companyId, emailHash(email));
      const created = await store.runTransaction(async tx => {
        if (await tx.get(entryPath)) return false;
        const data: Doc = member.data;
        tx.create(entryPath, {
          companyId, email, displayName: text(data.displayName), role: text(data.role) || "member", teamIds: Array.isArray(data.teamIds) ? data.teamIds : [],
          workLocation: text(data.workLocation), department: text(data.department), jobTitle: text(data.jobTitle),
          ...(text(data.managerEmail) ? { managerEmail: text(data.managerEmail) } : {}), ...(text(data.startDate) ? { startDate: text(data.startDate) } : {}),
          status: "claimed", memberStatus: statusOf(data) === "deactivated" ? "deactivated" : "active", source: "signup", claimedBy: member.id,
          claimedAt: data.createdAt instanceof Date ? data.createdAt : now, createdAt: SERVER_TIME, updatedAt: SERVER_TIME, revision: 1,
        });
        return true;
      });
      if (created) result.created += 1; else result.existing += 1;
    }
    if (page.length < 200) return result;
    afterId = page[page.length - 1]!.id;
  }
}
