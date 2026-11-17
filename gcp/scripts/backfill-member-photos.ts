// One-time backfill of users/{uid}.photoURL from the Google profile photo Firebase Auth holds, for members whose photoURL is
// empty (new sign-ins are filled by resolveMembershipV1). A non-empty photoURL is never overwritten. DRY RUN by default: nothing
// is written without --apply. Prints counts only (never URLs, uids or emails). Idempotent; a rerun fills nothing more.
//
//   Emulator:   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
//               node --import tsx gcp/scripts/backfill-member-photos.ts --company <ID> [--apply]
//   Production: node --import tsx gcp/scripts/backfill-member-photos.ts --project <ID> --company <ID>                              (dry run)
//               node --import tsx gcp/scripts/backfill-member-photos.ts --project <ID> --company <ID> --apply --yes-owner-approved  (needs owner approval)
//
// Credentials: Application Default Credentials for a live project. Reads Auth with getUsers in batches of 100; writes use a
// transaction that re-checks the field is still empty.
import { createRequire } from "node:module";
import { backfillMemberPhotos, type PhotoBackfillPorts } from "../functions/src/modules/accounts/application/backfillPhotos";

// firebase-admin lives in the Functions workspace; load it from there (docs/ops/seed-data.md).
const req = createRequire(require.resolve("../functions/package.json"));
const { getApps, initializeApp } = req("firebase-admin/app") as typeof import("firebase-admin/app");
const { getFirestore, FieldPath } = req("firebase-admin/firestore") as typeof import("firebase-admin/firestore");
const { getAuth } = req("firebase-admin/auth") as typeof import("firebase-admin/auth");

const args = process.argv.slice(2);
const valuesOf = (flag: string) => args.flatMap((a, i) => (a === flag && args[i + 1] && !args[i + 1]!.startsWith("--") ? [args[i + 1]!] : []));
const companies = valuesOf("--company");
const project = valuesOf("--project")[0];
const apply = args.includes("--apply");
const ownerApproved = args.includes("--yes-owner-approved");

const host = process.env.FIRESTORE_EMULATOR_HOST ?? "";
const localEmulator = /^(127\.0\.0\.1|localhost):[0-9]+$/.test(host);
if (host && !localEmulator) {
  console.error("Refusing to run: FIRESTORE_EMULATOR_HOST must point at 127.0.0.1 or localhost.");
  process.exit(2);
}
if (localEmulator && !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.error("Refusing to run: with the Firestore emulator also set FIREBASE_AUTH_EMULATOR_HOST so Auth is not read from production.");
  process.exit(2);
}
if (companies.length === 0) {
  console.error("Usage: backfill-member-photos.ts [--project <ID>] --company <ID> [--company <ID> ...] [--apply [--yes-owner-approved]]");
  process.exit(2);
}
if (!localEmulator && !project) {
  console.error("Refusing to run: set FIRESTORE_EMULATOR_HOST to a local emulator, or pass --project <id> explicitly (production needs owner approval).");
  process.exit(2);
}
if (!localEmulator) {
  console.log(`*** LIVE PROJECT ${project}: production use needs owner approval (docs/ops/seed-data.md). ***`);
  if (apply && !ownerApproved) {
    console.error("Refusing to apply to a live project without --yes-owner-approved.");
    process.exit(2);
  }
}
console.log(`${apply ? "APPLY" : "DRY-RUN"} ${localEmulator ? `emulator ${host}` : `LIVE project ${project}`} companies=${companies.join(",")}`);

const app = getApps()[0] ?? initializeApp({ projectId: project ?? process.env.GCLOUD_PROJECT ?? "demo-dip" });
const db = getFirestore(app);
const auth = getAuth(app);

const ports: PhotoBackfillPorts = {
  async listMembers(companyId, after, limit) {
    let query = db.collection("users").where("companyId", "==", companyId).orderBy(FieldPath.documentId()).limit(limit);
    if (after) query = query.startAfter(after);
    const snap = await query.get();
    return snap.docs.map((doc) => {
      const photo: unknown = doc.get("photoURL");
      return { uid: doc.id, photoURL: typeof photo === "string" ? photo : "" };
    });
  },
  async authPhotos(uids) {
    const result = await auth.getUsers(uids.map((uid) => ({ uid })));
    const photos = new Map<string, string>();
    for (const user of result.users) {
      const google = user.providerData.find((p) => p.providerId === "google.com")?.photoURL;
      const photo = google || user.photoURL;
      if (photo) photos.set(user.uid, photo);
    }
    return photos;
  },
  fillIfEmpty(uid, photoURL) {
    const ref = db.collection("users").doc(uid);
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const current: unknown = snap.get("photoURL");
      if (!snap.exists || (typeof current === "string" && current !== "")) return false;
      tx.update(ref, { photoURL });
      return true;
    });
  },
};

async function main(): Promise<void> {
  for (const companyId of companies) {
    const r = await backfillMemberPhotos(ports, companyId, apply);
    console.log(`company ${companyId}: scanned=${r.scanned} alreadyHavePhoto=${r.alreadyHavePhoto} noAuthPhoto=${r.noAuthPhoto} ` +
      `invalidAuthPhoto=${r.invalidAuthPhoto} ${apply ? "filled" : "wouldFill"}=${r.filled} skippedConcurrent=${r.skippedConcurrent}`);
  }
  if (!apply) console.log("Dry run: nothing was written. Re-run with --apply to write.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "unknown error");
  process.exit(1);
});
