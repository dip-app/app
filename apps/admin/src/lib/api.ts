import { type Tag, TAGS } from "./catalog";
import {
  ApiError,
  type AdminEvent,
  type EventDraft,
  type EventStatus,
  normalizeDraft,
  validateDraft,
} from "./contract";

export interface Session {
  uid: string;
  name: string;
  email: string;
  companyId: string;
  role: "member" | "admin";
}

export interface CommandResult {
  eventId: string;
  revision: number;
}

/**
 * Everything the portal needs from the backend. `createMockApi` below enforces the same rules as the
 * callables for the local preview; `createFirebaseApi` (firebaseAdapter.ts) talks to Auth, Firestore and
 * createEventV1/updateEventV1. The UI only depends on this interface.
 */
export interface AdminApi {
  /** "mock" keeps data in this browser; "live" uses Firebase. */
  readonly mode: "mock" | "live";
  session(): Promise<Session | null>;
  /** Mock mode picks a preview persona; live mode opens Google sign-in and ignores the argument. */
  signIn(persona?: PersonaId): Promise<Session>;
  /** The shared tags catalog (`tags/{tagId}`); events store tag IDs. */
  listTags(): Promise<Tag[]>;
  signOut(): Promise<void>;
  listEvents(): Promise<AdminEvent[]>;
  getEvent(eventId: string): Promise<AdminEvent>;
  createEvent(requestId: string, draft: EventDraft): Promise<CommandResult>;
  updateEvent(eventId: string, expectedRevision: number, draft: EventDraft, status: EventStatus): Promise<CommandResult>;
}

export type PersonaId = "admin" | "member" | "otherAdmin";

export const PERSONAS: Record<PersonaId, Session> = {
  admin: { uid: "uid-admin", name: "Alex Admin", email: "alex@acme.com", companyId: "acme", role: "admin" },
  otherAdmin: { uid: "uid-other-admin", name: "Gale Globex", email: "gale@globex.com", companyId: "globex", role: "admin" },
  member: { uid: "uid-member", name: "Pat Member", email: "pat@acme.com", companyId: "acme", role: "member" },
};

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface Receipt {
  hash: string;
  eventId: string;
  revision: number;
}

interface Persisted {
  events: AdminEvent[];
  receipts: Record<string, Receipt>;
  session: Session | null;
}

// v2: events store tag IDs (catalog records) instead of labels.
const KEY = "dip-admin-mock-v2";

function iso(offsetDays: number, hour: number, minutes = 0): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  d.setUTCHours(hour, minutes, 0, 0);
  return d.toISOString();
}

function seed(): Persisted {
  const base = {
    companyId: "acme",
    pointsValue: 0,
    createdBy: PERSONAS.admin.uid,
    createdAt: iso(-10, 15),
    revision: 1,
    isOutdoor: false,
    tagIds: [] as string[],
  };
  return {
    session: null,
    receipts: {},
    events: [
      {
        ...base, id: "puppy-yoga", title: "Puppy Yoga",
        description: "Stretch, relax and bond with adorable puppies.",
        coverImageURL: "catalog://default/fitness", tagIds: ["tag-fitness", "tag-energetic"],
        startTime: iso(6, 22), endTime: iso(6, 23, 30),
        venue: { name: "Lawrenceville Studio", address: "3200 Butler St", locality: "Lawrenceville, PA", latitude: 40.4655, longitude: -79.9606 },
        costCents: 1500, costNote: "Includes mat rental", capacity: 24, attendeeCount: 16, status: "scheduled",
      },
      {
        ...base, id: "kayaking", title: "Kayaking",
        description: "Paddle the Delaware River with coworkers.", isOutdoor: true,
        coverImageURL: "catalog://default/outdoors", tagIds: ["tag-outdoors"],
        startTime: iso(13, 14), endTime: iso(13, 18),
        venue: { name: "River Landing", address: "1 Riverside Dr", locality: "Delaware River, NJ", latitude: 40.22, longitude: -74.76 },
        costCents: 0, costNote: "", capacity: 12, attendeeCount: 12, status: "scheduled",
      },
      {
        ...base, id: "game-cafe", title: "Game Café Night",
        description: "Board games and snacks after work.",
        coverImageURL: "catalog://default/games", tagIds: ["tag-games", "tag-social"],
        startTime: iso(-14, 23), endTime: iso(-14, 25 - 1),
        venue: { name: "Meeple & Co", address: "55 Murray Ave", locality: "Squirrel Hill, PA", latitude: 40.4371, longitude: -79.9226 },
        costCents: 500, costNote: "", capacity: 30, attendeeCount: 21, status: "scheduled",
      },
      {
        ...base, id: "cooking", title: "Cooking Class",
        description: "Cook a three-course meal together.",
        coverImageURL: "catalog://default/cooking", tagIds: ["tag-cooking"],
        startTime: iso(20, 22), endTime: iso(20, 24 - 1),
        venue: { name: "Test Kitchen", address: "900 Penn Ave", locality: "Pittsburgh, PA", latitude: 40.4443, longitude: -79.9937 },
        costCents: 2500, costNote: "Ingredients included", capacity: 16, attendeeCount: 3, status: "cancelled",
      },
    ],
  };
}

function hashOf(draft: EventDraft): string {
  return JSON.stringify(normalizeDraft(draft));
}

export function createMockApi(store: KeyValueStore, now: () => Date = () => new Date()): AdminApi {
  function load(): Persisted {
    const raw = store.getItem(KEY);
    if (raw) {
      try {
        return JSON.parse(raw) as Persisted;
      } catch {
        // Fall through to a fresh seed when stored data is unreadable.
      }
    }
    const fresh = seed();
    store.setItem(KEY, JSON.stringify(fresh));
    return fresh;
  }
  const save = (data: Persisted) => store.setItem(KEY, JSON.stringify(data));

  function requireAdmin(data: Persisted): Session {
    if (!data.session) throw new ApiError("unauthenticated", "Sign in to continue.");
    if (data.session.role !== "admin") {
      throw new ApiError("permission-denied", "Only organizers can manage events.");
    }
    return data.session;
  }

  return {
    mode: "mock",
    async session() {
      return load().session;
    },
    async listTags() {
      return TAGS;
    },
    async signIn(persona = "admin") {
      const data = load();
      data.session = PERSONAS[persona];
      save(data);
      return data.session;
    },
    async signOut() {
      const data = load();
      data.session = null;
      save(data);
    },
    async listEvents() {
      const data = load();
      const session = requireAdmin(data);
      return data.events
        .filter((event) => event.companyId === session.companyId)
        .sort((a, b) => Date.parse(b.startTime) - Date.parse(a.startTime));
    },
    async getEvent(eventId) {
      const data = load();
      const session = requireAdmin(data);
      const event = data.events.find((item) => item.id === eventId && item.companyId === session.companyId);
      if (!event) throw new ApiError("not-found", "That event doesn’t exist.");
      return event;
    },
    async createEvent(requestId, draft) {
      const data = load();
      const session = requireAdmin(data);
      const hash = hashOf(draft);
      const receipt = data.receipts[`${session.companyId}:${session.uid}:${requestId}`];
      if (receipt) {
        if (receipt.hash !== hash) {
          throw new ApiError("invalid-argument", "This request ID was already used with different details.");
        }
        return { eventId: receipt.eventId, revision: receipt.revision };
      }
      const errors = validateDraft(draft, { requireFuture: true, now: now() });
      if (Object.keys(errors).length) throw new ApiError("invalid-argument", "Check the highlighted fields.", errors);
      const event: AdminEvent = {
        ...normalizeDraft(draft),
        id: `evt-${requestId.slice(0, 8)}`,
        companyId: session.companyId,
        status: "scheduled",
        attendeeCount: 0,
        pointsValue: 0,
        createdBy: session.uid,
        createdAt: now().toISOString(),
        revision: 1,
      };
      data.events.push(event);
      data.receipts[`${session.companyId}:${session.uid}:${requestId}`] = { hash, eventId: event.id, revision: 1 };
      save(data);
      return { eventId: event.id, revision: 1 };
    },
    async updateEvent(eventId, expectedRevision, draft, status) {
      const data = load();
      const session = requireAdmin(data);
      const index = data.events.findIndex((item) => item.id === eventId && item.companyId === session.companyId);
      if (index < 0) throw new ApiError("not-found", "That event doesn’t exist.");
      const current = data.events[index];
      if (current.revision !== expectedRevision) {
        throw new ApiError("aborted", "Someone else changed this event. Reload to see their changes.");
      }
      const timesChanged = draft.startTime !== current.startTime || draft.endTime !== current.endTime;
      if (timesChanged && current.attendeeCount > 0) {
        // Mirrors the server: once anyone has responded, both times are locked (issue #14).
        throw new ApiError("failed-precondition", "The times can’t be changed once anyone has responded. Cancel and recreate the event instead.", {
          startTime: "Locked: people have responded.", endTime: "Locked: people have responded.",
        });
      }
      const errors = validateDraft(draft, { requireFuture: false, minCapacity: current.attendeeCount });
      if (Object.keys(errors).length) throw new ApiError("invalid-argument", "Check the highlighted fields.", errors);
      data.events[index] = { ...current, ...normalizeDraft(draft), status, revision: current.revision + 1 };
      save(data);
      return { eventId, revision: current.revision + 1 };
    },
  };
}

export function browserStore(): KeyValueStore {
  try {
    const probe = "__probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    const memory = new Map<string, string>();
    return {
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => void memory.set(key, value),
      removeItem: (key) => void memory.delete(key),
    };
  }
}
