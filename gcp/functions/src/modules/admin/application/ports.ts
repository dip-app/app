export type Doc = Record<string, unknown>;

export interface Entry { id: string; data: Doc }
export type Where = ReadonlyArray<readonly [field: string, value: unknown]>;

export interface ListQuery {
  /** Equality filters. */
  where?: Where;
  limit: number;
  /** Continue after this document id (ordered by document id). */
  afterId?: string;
}

/**
 * Operations inside one atomic admin transaction. Timestamps read are converted to Date; writes may carry the
 * markers from domain/ops (server time, increment, delete). Writes are applied at commit, so a service may
 * read after queueing a write; the adapter never reorders reads after writes against the database.
 */
export interface AdminTransaction {
  get(path: string): Promise<Doc | null>;
  list(collectionPath: string, query: ListQuery): Promise<Entry[]>;
  /** Aggregate count of a collection, optionally narrowed by equality filters (no documents are read). */
  count(collectionPath: string, where?: Where): Promise<number>;
  /** Fails if the document exists. */
  create(path: string, data: Doc): void;
  /** Merges fields into an existing document (fails if it is missing). */
  update(path: string, data: Doc): void;
  delete(path: string): void;
}

export interface GroupQuery {
  where: ReadonlyArray<readonly [field: string, op: "==" | ">" | ">=", value: unknown]>;
  orderBy?: string;
  limit: number;
}

/** Where an insights read looks: one collection, or every collection with this id (collection group). */
export type QuerySource = { readonly collection: string } | { readonly group: string };
export type Filter = readonly [field: string, op: "==" | ">" | ">=" | "<" | "<=", value: unknown];
export interface DocQuery {
  where: ReadonlyArray<Filter>;
  orderBy?: string;
  descending?: boolean;
  /** Only these fields are fetched (a bandwidth saver; every matching document is still a billed read). */
  select?: readonly string[];
  limit: number;
}

export interface AdminStore {
  /** Server-side aggregation (count, optional sum of one numeric field); no documents are returned. */
  aggregate(source: QuerySource, where: ReadonlyArray<Filter>, sumField?: string): Promise<{ count: number; sum: number }>;
  /** Bounded, non-transactional query returning documents with their paths. */
  queryDocs(source: QuerySource, query: DocQuery): Promise<Array<{ path: string; data: Doc }>>;
  /** Single document read outside a transaction (null when missing). */
  getDoc(path: string): Promise<Doc | null>;
  /** Overwrites a server-owned document (caches); never used for user data. */
  setDoc(path: string, data: Doc): Promise<void>;
  runTransaction<T>(work: (tx: AdminTransaction) => Promise<T>): Promise<T>;
  /** Read-only snapshot for directory and report reads; writes through it throw. */
  runReadOnly<T>(work: (tx: AdminTransaction) => Promise<T>): Promise<T>;
  /** Non-transactional collection-group read (paths included). */
  queryGroup(group: string, query: GroupQuery): Promise<Array<{ path: string; data: Doc }>>;
  /** Deletes up to `limit` documents of a collection (non-transactional, idempotent); returns how many. */
  deletePage(collectionPath: string, limit: number): Promise<number>;
}

/** Storage objects removed through the Admin SDK (bypasses storage.rules; callers authorize first). */
export interface ObjectStore {
  /** Deletes the object; resolves true when it is gone afterwards (including already absent). */
  remove(path: string): Promise<boolean>;
}

/** Firebase Auth session control. */
export interface SessionRevoker {
  revoke(uid: string): Promise<void>;
}

export interface RateLimiter {
  consume(uid: string): Promise<void>;
}

export interface AdminDeps {
  store: AdminStore;
  objects: ObjectStore;
  sessions: SessionRevoker;
  limiter?: RateLimiter;
  now: () => Date;
  /** Random opaque id (teams, import jobs, leases). */
  newId: () => string;
}

/** Trusted caller identity, derived only from the verified Auth token. */
export interface Caller {
  uid: string;
  emailVerified: boolean;
  signInProvider: string | null;
}
