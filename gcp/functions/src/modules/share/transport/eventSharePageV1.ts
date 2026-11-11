import { getFirestore } from "firebase-admin/firestore";
import { onRequest, type Request } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { defaultAdminApp } from "../../accounts/transport/resolveMembershipV1";
import { getSharePage, type ShareEventStore } from "../application/getSharePage";
import { FirestoreShareEventStore } from "../infrastructure/firestoreShareStore";

export interface ShareResponse {
  status(code: number): ShareResponse;
  set(headers: Record<string, string>): ShareResponse;
  send(body: string): unknown;
}

const OK_CACHE = "public, max-age=300, s-maxage=600";
const TRANSIENT_CACHE = "public, max-age=30, s-maxage=30";

/** Thin HTTP adapter: GET/HEAD only, no auth, no cookies, one rendered page. Testable without Firebase. */
export async function handleSharePage(store: ShareEventStore, req: Pick<Request, "method" | "path">, res: ShareResponse, timeoutMs?: number): Promise<void> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.status(405).set({ Allow: "GET, HEAD", "Cache-Control": "no-store" }).send("Method Not Allowed");
    return;
  }
  const result = await getSharePage(store, req.path, timeoutMs);
  if (result.transientFailure) logger.warn("eventSharePageV1 lookup failed; served the generic page");
  // Always 200 with the same shape so an id's existence is not observable. Express omits the body for HEAD.
  res
    .status(200)
    .set({
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": result.transientFailure ? TRANSIENT_CACHE : OK_CACHE,
      "X-Robots-Tag": "noindex",
      "X-Content-Type-Options": "nosniff",
    })
    .send(result.html);
}

/** Public preview page for `/e/**` (Firebase Hosting rewrite). No App Check: crawlers cannot attest. */
export const eventSharePageV1 = onRequest(
  { region: "us-central1", invoker: "public", cors: false, timeoutSeconds: 10, memory: "256MiB", maxInstances: 10 },
  (req, res) => handleSharePage(new FirestoreShareEventStore(getFirestore(defaultAdminApp())), req, res as unknown as ShareResponse),
);
