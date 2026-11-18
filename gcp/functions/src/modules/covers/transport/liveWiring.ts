import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { defaultAdminApp } from "../../accounts/transport/resolveMembershipV1";
import type { ImageProcessor, LiveCoverConfig, LiveCoverDeps } from "../application/livePorts";
import { StorageCoverReader } from "../infrastructure/coverImageHandler";
import { FirestoreCoverSearchCache } from "../infrastructure/firestoreCoverCache";
import { FirestoreDynamicCoverCatalog, FirestoreDynamicCoverWriter } from "../infrastructure/firestoreDynamicCovers";
import { FirestoreLiveQuota } from "../infrastructure/firestoreLiveQuota";
import type { BucketLike, FirestoreLike } from "../infrastructure/firestoreTypes";
import { PixabayImageDownloader } from "../infrastructure/imageDownloader";
import { PixabayHttpClient } from "../infrastructure/pixabayHttpClient";

/**
 * Production wiring of the live cover fallback. Everything with in-memory state (catalog cache, search limiter and
 * rate-limit block, quota window) is a module-level singleton, so it is shared by all requests of one instance.
 * The Pixabay API key is passed in per call (read from the secret inside the handler) and never stored here.
 */
const firestore = () => getFirestore(defaultAdminApp()) as unknown as FirestoreLike;
const bucket = () => getStorage(defaultAdminApp()).bucket() as unknown as BucketLike;

let catalog: FirestoreDynamicCoverCatalog | null = null;
/** The dynamic cover catalog (also validates dynamic keys in createEventV1 and updateEventV1). */
export function dynamicCoverCatalog(): FirestoreDynamicCoverCatalog {
  catalog ??= new FirestoreDynamicCoverCatalog(firestore());
  return catalog;
}

/** Storage reader of coverImageV1. */
export const coverObjectReader = (): StorageCoverReader => new StorageCoverReader(bucket());

interface Singletons {
  search: PixabayHttpClient;
  cache: FirestoreCoverSearchCache;
  quota: FirestoreLiveQuota;
  downloader: PixabayImageDownloader;
  writer: FirestoreDynamicCoverWriter;
}
let singletons: Singletons | null = null;
let processor: ImageProcessor | null = null;
let currentKey = "";

/** Builds the live deps. `sharp` is loaded on first use so the other functions' cold starts do not pay for it. */
export async function buildLiveCoverDeps(config: LiveCoverConfig, apiKey: string): Promise<LiveCoverDeps> {
  currentKey = apiKey;
  const db = firestore();
  singletons ??= {
    search: new PixabayHttpClient({ apiKey: () => currentKey }),
    cache: new FirestoreCoverSearchCache(db),
    quota: new FirestoreLiveQuota(db, { companyDaily: config.companyDaily, platformDaily: config.platformDaily, instancePerMinute: config.instancePerMinute }),
    downloader: new PixabayImageDownloader(),
    writer: new FirestoreDynamicCoverWriter(db, bucket()),
  };
  if (!processor) {
    const { SharpImageProcessor } = await import("../infrastructure/sharpImageProcessor");
    processor = new SharpImageProcessor();
  }
  return { ...singletons, processor, catalog: dynamicCoverCatalog(), config };
}
