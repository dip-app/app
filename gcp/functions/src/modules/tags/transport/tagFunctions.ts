import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { defaultAdminApp } from "../../accounts/transport/resolveMembershipV1";
import { applyUserInterestWrite, type ApplyResult } from "../application/applyUserWrite";
import type { TagCatalog, TagStatsStore } from "../application/ports";
import { FirestoreTagCatalog, FirestoreTagStatsStore } from "../infrastructure/firestoreTagStats";

const REGION = "us-central1";

/** Pure handler for tests: no Firebase runtime. Logs counts only (never uids, tag ids or names). */
export async function handleUserInterestsWritten(
  deps: { catalog: TagCatalog; store: TagStatsStore },
  event: { id: string; data?: { before: { data(): unknown }; after: { data(): unknown } } | undefined },
): Promise<ApplyResult | null> {
  if (!event.data) return null;
  const outcome = await applyUserInterestWrite(deps, { eventId: event.id, before: event.data.before.data(), after: event.data.after.data() });
  if (outcome.result !== "skipped") logger.info("tag counts applied", outcome);
  return outcome;
}

// Module-level so the catalog cache survives across invocations of a warm instance.
let catalog: FirestoreTagCatalog | null = null;

/** users/{uid} written: keep companies/{c}/tagStats in sync. retry:true is safe because applyDeltas is receipt-guarded. */
export const onUserInterestsWritten = onDocumentWritten({ document: "users/{uid}", region: REGION, retry: true }, async (event) => {
  const db = getFirestore(defaultAdminApp());
  catalog ??= new FirestoreTagCatalog(db);
  await handleUserInterestsWritten({ catalog, store: new FirestoreTagStatsStore(db) }, event);
});
