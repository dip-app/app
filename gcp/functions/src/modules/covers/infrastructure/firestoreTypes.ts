/**
 * Minimal structural views of the Firestore Admin SDK and the Storage bucket that the cover adapters use, so unit tests can
 * inject in-memory fakes. The real `Firestore` and `Bucket` objects satisfy these (see the `as` casts in the transport wiring).
 */
export interface SnapshotLike {
  readonly exists: boolean;
  readonly id: string;
  data(): Record<string, unknown> | undefined;
}
export interface DocRefLike {
  get(): Promise<SnapshotLike>;
  create(data: Record<string, unknown>): Promise<unknown>;
  set(data: Record<string, unknown>): Promise<unknown>;
  update(data: Record<string, unknown>): Promise<unknown>;
}
export interface QueryLike {
  orderBy(field: string, direction?: "asc" | "desc"): QueryLike;
  limit(n: number): QueryLike;
  get(): Promise<{ docs: SnapshotLike[] }>;
}
export interface CollectionLike extends QueryLike { doc(id: string): DocRefLike }
export interface TransactionLike {
  get(ref: DocRefLike): Promise<SnapshotLike>;
  set(ref: DocRefLike, data: Record<string, unknown>): unknown;
}
export interface FirestoreLike {
  collection(name: string): CollectionLike;
  runTransaction<T>(fn: (tx: TransactionLike) => Promise<T>): Promise<T>;
}
export interface BucketFileLike {
  save(data: Buffer, options: { resumable: boolean; contentType: string; metadata: { cacheControl: string } }): Promise<unknown>;
  download(): Promise<[Buffer]>;
}
export interface BucketLike { file(path: string): BucketFileLike }

/** Firestore Timestamp, Date or epoch millis to Date (null when it is none of them). */
export function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === "object" && value !== null && "toDate" in value && typeof (value as { toDate: unknown }).toDate === "function") {
    const d: unknown = (value as { toDate(): unknown }).toDate();
    return d instanceof Date ? d : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value);
  return null;
}

export const DAY_MS = 24 * 60 * 60 * 1000;
