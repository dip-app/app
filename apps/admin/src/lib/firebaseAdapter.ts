import { type FirebaseApp, type FirebaseOptions, getApps, initializeApp } from "firebase/app";
import {
  type Auth, GoogleAuthProvider, connectAuthEmulator, getAuth, signInWithPopup, signOut as firebaseSignOut,
} from "firebase/auth";
import {
  type DocumentData, type Firestore, Timestamp, collection, connectFirestoreEmulator, doc, getDoc, getDocs,
  getFirestore, limit, orderBy, query,
} from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";
import { createLiveOps } from "./adminLive";
import { isStaff } from "./adminTypes";
import type { AdminApi, CommandResult, Session } from "./api";
import type { Tag } from "./catalog";
import {
  THEME_REASONS, type ThemeCommandResult, type ThemeDraft, type WeeklyTheme, normalizeThemeDraft,
} from "./challenge";
import {
  ApiError, type AdminEvent, type ApiErrorCode, type EventDraft, type EventStatus, type FieldErrors, type WindowConflict,
  normalizeDraft,
} from "./contract";

export interface LiveConfig {
  firebase: FirebaseOptions;
  /** Host of the local Firebase emulators (Auth 9099, Firestore 8080, Functions 5001). */
  emulatorHost?: string;
  /** reCAPTCHA Enterprise site key; production callables enforce App Check. */
  appCheckSiteKey?: string;
  /** Local-only App Check debug token (or `true` to print one). */
  appCheckDebugToken?: string | boolean;
}

/**
 * Live mode is chosen by build-time configuration, so the hosted preview stays on the mock until the
 * project's web app is registered. Variables are referenced statically so Next.js can inline them.
 */
export function readLiveConfig(): LiveConfig | null {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID;
  if (!apiKey || !projectId || !appId) return null;
  const debug = process.env.NEXT_PUBLIC_APPCHECK_DEBUG_TOKEN;
  return {
    firebase: {
      apiKey, projectId, appId,
      authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || `${projectId}.firebaseapp.com`,
    },
    emulatorHost: process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_HOST || undefined,
    appCheckSiteKey: process.env.NEXT_PUBLIC_APPCHECK_SITE_KEY || undefined,
    appCheckDebugToken: debug === "true" ? true : debug || undefined,
  };
}

const API_CODES: readonly ApiErrorCode[] = [
  "unauthenticated", "permission-denied", "invalid-argument", "not-found", "aborted", "failed-precondition",
];

/**
 * Maps a callable or Firestore failure to the portal's error model. Only definite server answers become
 * ApiErrors; transport failures (offline, timeout, internal) stay plain Errors so forms treat them as
 * ambiguous and reload before saving again.
 */
export function apiErrorFrom(error: unknown): unknown {
  if (error instanceof ApiError) return error;
  if (typeof error !== "object" || error === null) return error;
  const raw = (error as { code?: unknown }).code;
  if (typeof raw !== "string") return error;
  const code = raw.replace(/^functions\//, "").replace(/^firestore\//, "");
  if (!API_CODES.includes(code as ApiErrorCode)) return error;
  const message = String((error as { message?: unknown }).message ?? "Request failed.");
  const details = (error as { details?: { fields?: unknown; reason?: unknown; conflict?: unknown } }).details;
  const fields: FieldErrors = {};
  if (Array.isArray(details?.fields)) {
    // Field names are draft-relative ("title", "venue.name"); a "draft."/"event." prefix is tolerated.
    for (const field of details.fields) if (typeof field === "string") fields[field.replace(/^(draft|event)\./, "")] = message;
  }
  // The stable reason (e.g. CHALLENGE_WINDOW_OVERLAP) lets screens react precisely; unknown reasons fall back to the code.
  const reason = typeof details?.reason === "string" ? details.reason : undefined;
  const given = details?.conflict as Partial<WindowConflict> | undefined;
  const conflict = given && typeof given.challengeId === "string" && typeof given.startDate === "string" && typeof given.endDate === "string"
    ? { challengeId: given.challengeId, startDate: given.startDate, endDate: given.endDate }
    : undefined;
  return new ApiError(code as ApiErrorCode, message, fields, reason, conflict);
}

function iso(value: unknown): string {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  // Tolerate RFC 3339 strings (fixtures, older seeds); Timestamps are the stored form.
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
  return "";
}

/** Maps a `challenges` document (Firestore Timestamps) to the portal's theme shape (ISO strings). */
export function themeFromDoc(id: string, data: DocumentData): WeeklyTheme {
  return {
    id,
    companyId: String(data.companyId ?? ""),
    title: String(data.title ?? ""),
    description: String(data.description ?? ""),
    tagIds: Array.isArray(data.tagIds) ? data.tagIds.filter((t: unknown): t is string => typeof t === "string") : [],
    type: "weekly",
    goal: Number(data.goal ?? 0),
    goalUnit: String(data.goalUnit ?? ""),
    coverImageURL: String(data.coverImageURL ?? ""),
    startDate: iso(data.startDate),
    endDate: iso(data.endDate),
    pointsReward: Number(data.pointsReward ?? 0),
    participantCount: Number(data.participantCount ?? 0),
    completedCount: Number(data.completedCount ?? 0),
    createdBy: String(data.createdBy ?? ""),
    createdAt: iso(data.createdAt),
    updatedAt: iso(data.updatedAt),
    revision: Number(data.revision ?? 1),
  };
}

/** Maps an `events` document (Firestore Timestamps) to the portal's event shape (ISO strings). */
export function eventFromDoc(id: string, data: DocumentData): AdminEvent {
  const venue = (data.venue ?? {}) as Record<string, unknown>;
  return {
    id,
    companyId: String(data.companyId ?? ""),
    title: String(data.title ?? ""),
    description: String(data.description ?? ""),
    tagIds: Array.isArray(data.tagIds) ? data.tagIds.filter((t: unknown): t is string => typeof t === "string") : [],
    coverImageURL: String(data.coverImageURL ?? ""),
    startTime: iso(data.startTime),
    endTime: iso(data.endTime),
    venue: {
      name: String(venue.name ?? ""), address: String(venue.address ?? ""), locality: String(venue.locality ?? ""),
      latitude: Number(venue.latitude ?? 0), longitude: Number(venue.longitude ?? 0),
    },
    costCents: Number(data.costCents ?? 0),
    costNote: String(data.costNote ?? ""),
    capacity: Number(data.capacity ?? 0),
    isOutdoor: data.isOutdoor === true,
    pointsValue: Number(data.pointsValue ?? 0),
    status: data.status === "cancelled" ? "cancelled" : "scheduled",
    attendeeCount: Number(data.attendeeCount ?? 0),
    createdBy: String(data.createdBy ?? ""),
    createdAt: iso(data.createdAt),
    revision: Number(data.revision ?? 1),
  };
}

export interface FirebaseApiDeps {
  /** Replaces the Google popup (tests sign in with an emulator credential). */
  signInWithGoogle?: (auth: Auth) => Promise<void>;
}

async function popupSignIn(auth: Auth) {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  await signInWithPopup(auth, provider);
}

export function createFirebaseApi(config: LiveConfig, deps: FirebaseApiDeps = {}): AdminApi {
  const name = "dip-admin";
  const existing = getApps().find((app) => app.name === name);
  const app: FirebaseApp = existing ?? initializeApp(config.firebase, name);
  const auth = getAuth(app);
  const db: Firestore = getFirestore(app);
  const functions = getFunctions(app, "us-central1");
  if (!existing) {
    if (config.emulatorHost) {
      connectAuthEmulator(auth, `http://${config.emulatorHost}:9099`, { disableWarnings: true });
      connectFirestoreEmulator(db, config.emulatorHost, 8080);
      connectFunctionsEmulator(functions, config.emulatorHost, 5001);
    } else if (config.appCheckSiteKey && typeof window !== "undefined") {
      if (config.appCheckDebugToken) {
        (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: string | boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN = config.appCheckDebugToken;
      }
      void import("firebase/app-check").then(({ initializeAppCheck, ReCaptchaEnterpriseProvider }) => {
        initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(config.appCheckSiteKey!), isTokenAutoRefreshEnabled: true });
      });
    }
  }
  const resolveMembership = httpsCallable(functions, "resolveMembershipV1");
  const createCallable = httpsCallable<unknown, CommandResult & { contractVersion: number }>(functions, "createEventV1");
  const updateCallable = httpsCallable<unknown, CommandResult & { contractVersion: number }>(functions, "updateEventV1");
  // T1 responses: create {contractVersion, challengeId, revision, challenge, replayed}; update has no `replayed`.
  const createThemeCallable = httpsCallable<unknown, ThemeCommandResult & { contractVersion: number }>(functions, "createChallengeV1");
  const updateThemeCallable = httpsCallable<unknown, ThemeCommandResult & { contractVersion: number }>(functions, "updateChallengeV1");

  async function loadSession(): Promise<Session | null> {
    await auth.authStateReady();
    const user = auth.currentUser;
    if (!user) return null;
    const read = () => getDoc(doc(db, "users", user.uid));
    let profile = await read().catch(() => null);
    if (!profile?.exists()) {
      // First sign-in: the server places the user in the company mapped to their email domain.
      try {
        await resolveMembership({ contractVersion: 1 });
        profile = await read();
      } catch {
        profile = null; // personal domain or a company that isn't on DIP: no portal access
      }
    }
    const data = profile?.exists() ? profile.data() : null;
    return {
      uid: user.uid,
      name: user.displayName ?? String(data?.displayName ?? user.email ?? ""),
      email: user.email ?? "",
      companyId: typeof data?.companyId === "string" ? data.companyId : "",
      role: data?.role === "admin" ? "admin" : data?.role === "organizer" ? "organizer" : "member",
    };
  }

  async function organizer(): Promise<Session> {
    const session = await loadSession();
    if (!session) throw new ApiError("unauthenticated", "Sign in to continue.");
    if (!isStaff(session.role)) throw new ApiError("permission-denied", "Only organizers can manage events.");
    return session;
  }

  async function run<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      throw apiErrorFrom(error);
    }
  }

  return {
    ...createLiveOps({ app, db, functions, organizer, run }),
    mode: "live",
    session: loadSession,
    async signIn() {
      await (deps.signInWithGoogle ?? popupSignIn)(auth);
      const session = await loadSession();
      if (!session) throw new ApiError("unauthenticated", "Sign in to continue.");
      return session;
    },
    async signOut() {
      await firebaseSignOut(auth);
    },
    listTags: () => run(async () => {
      const snap = await getDocs(collection(db, "tags"));
      return snap.docs
        .map((d): Tag & { order: number } => ({ id: d.id, name: String(d.get("name") ?? d.id), order: Number(d.get("sortOrder") ?? 0) }))
        .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
        .map(({ id, name }) => ({ id, name }));
    }),
    listEvents: () => run(async () => {
      const session = await organizer();
      const snap = await getDocs(query(collection(db, "companies", session.companyId, "events"), orderBy("startTime", "desc")));
      return snap.docs.map((d) => eventFromDoc(d.id, d.data()));
    }),
    getEvent: (eventId) => run(async () => {
      const session = await organizer();
      const snap = await getDoc(doc(db, "companies", session.companyId, "events", eventId));
      if (!snap.exists()) throw new ApiError("not-found", "That event doesn’t exist.");
      return eventFromDoc(snap.id, snap.data());
    }),
    createEvent: (requestId: string, draft: EventDraft) => run(async () => {
      const session = await organizer();
      const result = await createCallable({ contractVersion: 1, companyId: session.companyId, requestId, event: normalizeDraft(draft) });
      return { eventId: result.data.eventId, revision: result.data.revision };
    }),
    updateEvent: (eventId: string, expectedRevision: number, draft: EventDraft, status: EventStatus) => run(async () => {
      const session = await organizer();
      const result = await updateCallable({ contractVersion: 1, companyId: session.companyId, eventId, expectedRevision, event: normalizeDraft(draft), status });
      return { eventId: result.data.eventId, revision: result.data.revision };
    }),
    listThemes: () => run(async () => {
      const session = await organizer();
      // Themes are `challenges` of type weekly; filtered here so later challenge types need no new index.
      const snap = await getDocs(query(collection(db, "companies", session.companyId, "challenges"), orderBy("startDate", "desc"), limit(200)));
      return snap.docs.filter((d) => d.get("type") === "weekly").map((d) => themeFromDoc(d.id, d.data()));
    }),
    getTheme: (challengeId: string) => run(async () => {
      const session = await organizer();
      const snap = await getDoc(doc(db, "companies", session.companyId, "challenges", challengeId));
      if (!snap.exists()) throw new ApiError("not-found", "That weekly theme doesn’t exist.", {}, THEME_REASONS.notFound);
      return themeFromDoc(snap.id, snap.data());
    }),
    createTheme: (requestId: string, draft: ThemeDraft) => run(async () => {
      const session = await organizer();
      const result = await createThemeCallable({ contractVersion: 1, companyId: session.companyId, requestId, draft: normalizeThemeDraft(draft) });
      return { challengeId: result.data.challengeId, revision: result.data.revision, replayed: result.data.replayed === true };
    }),
    updateTheme: (challengeId: string, expectedRevision: number, draft: ThemeDraft) => run(async () => {
      const session = await organizer();
      const result = await updateThemeCallable({ contractVersion: 1, companyId: session.companyId, challengeId, expectedRevision, draft: normalizeThemeDraft(draft) });
      return { challengeId: result.data.challengeId, revision: result.data.revision };
    }),
  };
}
