import { normalizeGooglePhotoUrl } from "../domain/photoUrl";

/** Firebase Auth getUsers accepts at most 100 identifiers per call. */
export const AUTH_BATCH_SIZE = 100;

export interface PhotoBackfillPorts {
  /** One page of a company's members: uid and the stored photoURL ("" when none). Ordered by uid; `after` is the last uid of the previous page. */
  listMembers(companyId: string, after: string | null, limit: number): Promise<Array<{ uid: string; photoURL: string }>>;
  /** The Google profile photo Firebase Auth holds for each uid (absent when the user has none or no longer exists). */
  authPhotos(uids: string[]): Promise<Map<string, string>>;
  /** Writes photoURL only if the stored value is still empty; returns whether it wrote. */
  fillIfEmpty(uid: string, photoURL: string): Promise<boolean>;
}

export interface PhotoBackfillReport {
  scanned: number;
  alreadyHavePhoto: number;
  noAuthPhoto: number;
  invalidAuthPhoto: number;
  filled: number;
  skippedConcurrent: number;
}

/**
 * One-time backfill of users/{uid}.photoURL from Firebase Auth for a company's members whose photoURL is empty.
 * A non-empty stored value is never touched. Dry run (apply=false) reads everything and writes nothing; the report
 * holds counts only (URLs and uids are personal data and are never reported). Idempotent: a rerun finds nothing to fill.
 */
export async function backfillMemberPhotos(
  ports: PhotoBackfillPorts, companyId: string, apply: boolean, pageSize = 500,
): Promise<PhotoBackfillReport> {
  const report: PhotoBackfillReport = { scanned: 0, alreadyHavePhoto: 0, noAuthPhoto: 0, invalidAuthPhoto: 0, filled: 0, skippedConcurrent: 0 };
  let after: string | null = null;
  for (;;) {
    const page = await ports.listMembers(companyId, after, pageSize);
    if (page.length === 0) break;
    after = page[page.length - 1]!.uid;
    report.scanned += page.length;
    const empty = page.filter((member) => member.photoURL === "").map((member) => member.uid);
    report.alreadyHavePhoto += page.length - empty.length;
    for (let i = 0; i < empty.length; i += AUTH_BATCH_SIZE) {
      const batch = empty.slice(i, i + AUTH_BATCH_SIZE);
      const photos = await ports.authPhotos(batch);
      for (const uid of batch) {
        const raw = photos.get(uid);
        if (!raw) { report.noAuthPhoto += 1; continue; }
        const url = normalizeGooglePhotoUrl(raw);
        if (!url) { report.invalidAuthPhoto += 1; continue; }
        if (!apply) { report.filled += 1; continue; }
        if (await ports.fillIfEmpty(uid, url)) report.filled += 1; else report.skippedConcurrent += 1;
      }
    }
    if (page.length < pageSize) break;
  }
  return report;
}
