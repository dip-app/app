import type { BackfillRosterResponse } from "../../../generated/models";
import { change } from "../domain/audit";
import { emailHash, normalizeEmail } from "../domain/employee";
import { statusOf } from "../domain/member";
import { paths, SERVER_TIME } from "../domain/ops";
import { parseBackfillRoster } from "../domain/requests";
import { authorize, once, requireCaller, writeAudit } from "./context";
import type { AdminDeps, AdminStore, AdminTransaction, Caller, Doc } from "./ports";

export interface BackfillResult { scanned: number; created: number; existing: number; skipped: number }
export interface BackfillPage extends BackfillResult { nextPageToken?: string; done: boolean }

/** Members handled per call; keeps one transaction at 100 reads plus at most 100 creates. */
export const BACKFILL_PAGE = 100;

const text = (value: unknown) => (typeof value === "string" ? value : "");

/**
 * Gives the next page of members (document-id order after `afterId`) a claimed roster entry when they have none. An existing entry
 * (invited, claimed or revoked) is never touched, so re-running creates nothing. Members without an email are skipped. With
 * `dryRun` it only counts what it would create. Runs inside the caller's transaction.
 */
export async function backfillRosterPage(tx: AdminTransaction, companyId: string, options: { afterId?: string | undefined; dryRun: boolean; now: Date }): Promise<BackfillPage> {
  const members = await tx.list("users", { where: [["companyId", companyId]], limit: BACKFILL_PAGE, ...(options.afterId ? { afterId: options.afterId } : {}) });
  const result: BackfillPage = { scanned: members.length, created: 0, existing: 0, skipped: 0, done: members.length < BACKFILL_PAGE };
  const targets = members.map(member => ({ member, email: normalizeEmail(text(member.data.email)) }));
  const entries = await Promise.all(targets.map(t => (t.email ? tx.get(paths.rosterEntry(companyId, emailHash(t.email))) : Promise.resolve(null))));
  targets.forEach(({ member, email }, index) => {
    if (!email) { result.skipped += 1; return; }
    if (entries[index]) { result.existing += 1; return; }
    result.created += 1;
    if (options.dryRun) return;
    const data: Doc = member.data;
    tx.create(paths.rosterEntry(companyId, emailHash(email)), {
      companyId, email, displayName: text(data.displayName), role: text(data.role) || "member", teamIds: Array.isArray(data.teamIds) ? data.teamIds : [],
      workLocation: text(data.workLocation), department: text(data.department), jobTitle: text(data.jobTitle),
      ...(text(data.managerEmail) ? { managerEmail: text(data.managerEmail) } : {}), ...(text(data.startDate) ? { startDate: text(data.startDate) } : {}),
      status: "claimed", memberStatus: statusOf(data) === "deactivated" ? "deactivated" : "active", source: "signup", claimedBy: member.id,
      claimedAt: data.createdAt instanceof Date ? data.createdAt : options.now, createdAt: SERVER_TIME, updatedAt: SERVER_TIME, revision: 1,
    });
  });
  const last = members[members.length - 1];
  if (!result.done && last) result.nextPageToken = last.id;
  return result;
}

/**
 * backfillRosterV1 (admin): production-safe roster backfill. One call handles BACKFILL_PAGE members after the cursor; the portal
 * calls it with dryRun first (counts only, writes nothing) and then for real until `done`. Idempotent (existing entries are never
 * touched, a replayed requestId returns the stored response), rate limited and audited once per real call.
 */
export async function backfillRosterCallable(deps: AdminDeps, caller: Caller | null, data: unknown): Promise<BackfillRosterResponse> {
  const authenticated = requireCaller(caller);
  const req = parseBackfillRoster(data);
  await deps.limiter?.consume(authenticated.uid);
  const now = deps.now();
  const wire = (page: BackfillPage): BackfillRosterResponse => ({
    contractVersion: 1, dryRun: req.dryRun, scanned: page.scanned, created: page.created, existing: page.existing, skipped: page.skipped,
    ...(page.nextPageToken ? { nextPageToken: page.nextPageToken } : {}), done: page.done,
  });
  if (req.dryRun) {
    return deps.store.runReadOnly(async tx => {
      const actor = await authorize(tx, authenticated, req.companyId, "roster.manage");
      return wire(await backfillRosterPage(tx, actor.companyId, { afterId: req.pageToken, dryRun: true, now }));
    });
  }
  return (await deps.store.runTransaction(async tx => {
    const actor = await authorize(tx, authenticated, req.companyId, "roster.manage");
    return once(tx, actor, "backfillRosterV1", req.requestId, { dryRun: false, pageToken: req.pageToken ?? null }, async () => {
      const page = await backfillRosterPage(tx, actor.companyId, { afterId: req.pageToken, dryRun: false, now });
      writeAudit(tx, actor, {
        id: `${actor.uid}_${req.requestId}`, action: "roster.backfill", targetType: "roster", targetId: req.pageToken ?? "start",
        summary: `Added existing members to the roster: ${page.created} added, ${page.existing} already listed, ${page.skipped} skipped`,
        changes: [change("created", null, page.created), change("existing", null, page.existing), change("skipped", null, page.skipped)], requestId: req.requestId,
      });
      return wire(page);
    }, now);
  })).value;
}

/** Whole-company loop for the emulator script (gcp/scripts/backfill-roster.ts); production uses backfillRosterV1. */
export async function backfillRoster(store: AdminStore, companyId: string, now: Date = new Date()): Promise<BackfillResult> {
  const total: BackfillResult = { scanned: 0, created: 0, existing: 0, skipped: 0 };
  let afterId: string | undefined;
  for (;;) {
    const page = await store.runTransaction(tx => backfillRosterPage(tx, companyId, { afterId, dryRun: false, now }));
    total.scanned += page.scanned; total.created += page.created; total.existing += page.existing; total.skipped += page.skipped;
    if (page.done || !page.nextPageToken) return total;
    afterId = page.nextPageToken;
  }
}
