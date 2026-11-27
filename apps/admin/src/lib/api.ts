import { createMockOps } from "./adminMock";
import type { AdminOpsApi } from "./adminApi";
import { type Role, can } from "./adminTypes";
import { LIVE_TAG_NAMES, type Tag, TAGS, liveTagsPreview, opaqueTagId, opaqueTagsPreview } from "./catalog";
import {
  THEME_REASONS, type ThemeCommandResult, type ThemeDraft, type WeeklyTheme, findOverlap, normalizeThemeDraft,
  validateThemeDraft, windowLocked,
} from "./challenge";
import { THEMES } from "./themes";
import { addDays, civilDateIn, mondayOf, weekEndIso, weekStartIso } from "./weeks";
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
  role: Role;
  /** The member's saved language (`users/{uid}.locale`, server-owned), when they chose one. */
  locale?: "en" | "es";
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
export interface AdminApi extends AdminOpsApi {
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
  /** Weekly themes (`challenges` with `type: "weekly"`) of the organizer's company, newest first. */
  listThemes(): Promise<WeeklyTheme[]>;
  getTheme(challengeId: string): Promise<WeeklyTheme>;
  /** createChallengeV1: a retry with the same requestId returns the same theme. */
  createTheme(requestId: string, draft: ThemeDraft): Promise<ThemeCommandResult>;
  /** updateChallengeV1: full-draft replacement guarded by expectedRevision. */
  updateTheme(challengeId: string, expectedRevision: number, draft: ThemeDraft): Promise<ThemeCommandResult>;
}

export type PersonaId = "admin" | "organizer" | "member" | "otherAdmin";

export const PERSONAS: Record<PersonaId, Session> = {
  admin: { uid: "uid-admin", name: "Alex Admin", email: "alex@acme.com", companyId: "acme", role: "admin" },
  otherAdmin: { uid: "uid-other-admin", name: "Gale Globex", email: "gale@globex.com", companyId: "globex", role: "admin" },
  organizer: { uid: "uid-casey-novak", name: "Casey Novak", email: "casey.novak@acme.com", companyId: "acme", role: "organizer" },
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

interface ThemeReceipt {
  hash: string;
  challengeId: string;
  revision: number;
}

interface Persisted {
  events: AdminEvent[];
  receipts: Record<string, Receipt>;
  session: Session | null;
  /** Added after v2 shipped; seeded on first load so stored preview data keeps its events. */
  themes?: WeeklyTheme[];
  themeReceipts?: Record<string, ThemeReceipt>;
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
        ...base, id: "game-cafe", title: "Game Café Night", pointsValue: 25,
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

/**
 * The hosted preview's extra events (never the unit tests): enough rows across past and future, with varied fill,
 * prices, one full and one nearly empty, that lists need search and sorting and the Overview has a busy week.
 */
function showcaseEvents(): AdminEvent[] {
  const base = { companyId: "acme", pointsValue: 0, createdBy: PERSONAS.admin.uid, createdAt: iso(-30, 15), revision: 1, isOutdoor: false, costNote: "", status: "scheduled" as const };
  const venue = (name: string, address: string, locality: string) => ({ name, address, locality, latitude: 40.44, longitude: -79.99 });
  const row = (id: string, title: string, description: string, cover: string, tagIds: string[], day: number, hour: number, hours: number, where: ReturnType<typeof venue>, costCents: number, capacity: number, attendeeCount: number, extra: Partial<AdminEvent> = {}): AdminEvent =>
    ({ ...base, id, title, description, coverImageURL: cover, tagIds, startTime: iso(day, hour), endTime: iso(day, hour + Math.floor(hours), (hours % 1) * 60), venue: where, costCents, capacity, attendeeCount, ...extra });
  const office = venue("Acme HQ, 4th floor", "500 Grant St", "Downtown, Pittsburgh, PA");
  return [
    row("trivia-night", "Trivia Night", "Teams of four, three rounds, one very competitive host.", "catalog://default/games", ["tag-games", "tag-social"], 1, 22, 2, venue("The Pub on Penn", "1700 Penn Ave", "Strip District, PA"), 0, 40, 31),
    row("lunch-learn-ai", "Lunch & Learn: AI at Work", "A practical hour on using AI tools safely, with lunch.", "catalog://cover/theme-learning", ["tag-learning"], 2, 16, 1, office, 0, 60, 44),
    row("sunrise-hike", "Sunrise Hike", "An easy 5 km loop with coffee at the top.", "catalog://default/hiking", ["tag-outdoors", "tag-fitness"], 3, 11, 3, venue("Frick Park", "Beechwood Blvd", "Squirrel Hill, PA"), 0, 20, 7, { isOutdoor: true }),
    row("pottery-wheel", "Pottery on the Wheel", "Make a mug or a bowl; the studio fires and glazes it.", "catalog://cover/theme-arts", ["tag-arts", "tag-chill"], 4, 22, 2.5, venue("Clay Studio", "2600 Smallman St", "Strip District, PA"), 3500, 12, 12),
    row("food-drive", "Holiday Food Drive", "Sort and pack donations for the regional food bank.", "catalog://default/cooking", ["tag-volunteering"], 9, 14, 4, venue("Food Bank Warehouse", "1 N Linden St", "Duquesne, PA"), 0, 30, 18),
    row("karaoke", "Karaoke Night", "Private room, songs in every language, snacks included.", "catalog://cover/theme-music", ["tag-music", "tag-hype"], 16, 23, 3, venue("Echo Lounge", "1501 E Carson St", "South Side, PA"), 1000, 25, 3),
    row("climbing", "Bouldering Intro", "Shoes and a coach included; no experience needed.", "catalog://default/fitness", ["tag-fitness", "tag-energetic"], 27, 22, 2, venue("Climb North", "1000 Ridge Ave", "North Shore, PA"), 2000, 16, 9),
    row("wellness-walk", "Lunchtime Wellness Walk", "A 30 minute walk along the river.", "catalog://default/outdoors", ["tag-wellness", "tag-outdoors"], -3, 16, 1, office, 0, 30, 22, { isOutdoor: true }),
    row("bake-off", "Office Bake-Off", "Bring a bake, taste them all, vote for the best.", "catalog://default/cooking", ["tag-food", "tag-social"], -7, 19, 2, office, 0, 50, 46, { pointsValue: 20 }),
    row("escape-room", "Escape Room Challenge", "Two rooms, sixty minutes, teams of six.", "catalog://default/games", ["tag-games", "tag-hype"], -21, 22, 1.5, venue("Locked In", "300 Liberty Ave", "Downtown, PA"), 2800, 24, 24, { pointsValue: 30 }),
    row("park-cleanup", "Riverfront Park Cleanup", "Gloves and bags provided; lunch after.", "catalog://default/outdoors", ["tag-volunteering", "tag-outdoors"], -28, 14, 3, venue("Point State Park", "601 Commonwealth Pl", "Downtown, PA"), 0, 40, 27, { isOutdoor: true, pointsValue: 25 }),
    row("wine-tasting", "Wine & Cheese Tasting", "Six pairings with a sommelier.", "catalog://default/cooking", ["tag-food"], 11, 23, 2, venue("Vine Cellar", "211 Fort Pitt Blvd", "Downtown, PA"), 4500, 20, 6, { status: "cancelled" }),
  ];
}

function hashOf(draft: EventDraft): string {
  return JSON.stringify(normalizeDraft(draft));
}

/** Last week, this week (both Fitness, like the seed script) and one Globex theme for tenant isolation. */
export function seedThemes(now: Date, showcase = false): WeeklyTheme[] {
  const thisMonday = mondayOf(civilDateIn(now));
  const theme = (key: string, companyId: string, monday: string, counts: { participantCount: number; completedCount: number }): WeeklyTheme => {
    const option = THEMES.find((item) => item.key === key) ?? THEMES[0];
    return {
      id: `weekly-${key}-${monday.replaceAll("-", "")}`, companyId, title: option.displayName, description: option.defaultDescription,
      tagIds: TAGS.filter((tag) => tag.name === option.defaultTagName).map((tag) => tag.id), type: "weekly",
      goal: option.defaultGoal, goalUnit: option.goalUnits[0], coverImageURL: option.url,
      startDate: weekStartIso(monday), endDate: weekEndIso(addDays(monday, 6)), pointsReward: 50, ...counts,
      createdBy: PERSONAS.admin.uid, createdAt: weekStartIso(addDays(monday, -7)), updatedAt: weekStartIso(addDays(monday, -7)), revision: 1,
    };
  };
  const weeksFrom = (n: number) => addDays(thisMonday, 7 * n);
  // This week and last week are Fitness like the seed script. The showcase (the hosted preview only, never the
  // unit tests) adds an upcoming week and older weeks with other themes so the Challenges list has variety.
  const extras = showcase ? [
    theme("outdoors", "acme", weeksFrom(1), { participantCount: 0, completedCount: 0 }),
    theme("food", "acme", weeksFrom(-2), { participantCount: 84, completedCount: 52 }),
    theme("music", "acme", weeksFrom(-3), { participantCount: 71, completedCount: 40 }),
    theme("learning", "acme", weeksFrom(-4), { participantCount: 58, completedCount: 29 }),
  ] : [];
  return [
    theme("fitness", "acme", thisMonday, { participantCount: 128, completedCount: 41 }),
    theme("fitness", "acme", weeksFrom(-1), { participantCount: 96, completedCount: 63 }),
    ...extras,
    theme("fitness", "globex", thisMonday, { participantCount: 5, completedCount: 0 }),
  ];
}

export function createMockApi(store: KeyValueStore, now: () => Date = () => new Date(), showcase = false): AdminApi {
  function load(): Persisted {
    const raw = store.getItem(KEY);
    if (raw) {
      try {
        const stored = JSON.parse(raw) as Persisted;
        if (!stored.themes) {
          stored.themes = seedThemes(now());
          stored.themeReceipts = {};
          store.setItem(KEY, JSON.stringify(stored));
        }
        return stored;
      } catch {
        // Fall through to a fresh seed when stored data is unreadable.
      }
    }
    const seeded = seed();
    const fresh: Persisted = { ...seeded, events: showcase ? [...seeded.events, ...showcaseEvents()] : seeded.events, themes: seedThemes(now(), showcase), themeReceipts: {} };
    store.setItem(KEY, JSON.stringify(fresh));
    return fresh;
  }
  const save = (data: Persisted) => store.setItem(KEY, JSON.stringify(data));

  function requireAdmin(data: Persisted): Session {
    if (!data.session) throw new ApiError("unauthenticated", "Sign in to continue.");
    if (!can(data.session.role, "events.manage")) {
      throw new ApiError("permission-denied", "Only organizers can manage events.");
    }
    return data.session;
  }

  const ops = createMockOps({
    store, now,
    themes: (companyId) => (load().themes ?? []).filter((t) => t.companyId === companyId).map((t) => ({
      id: t.id, title: t.title, coverImageURL: t.coverImageURL, pointsReward: t.pointsReward, startDate: t.startDate, endDate: t.endDate, participantCount: t.participantCount, completedCount: t.completedCount,
    })),
    events: (companyId) => load().events.filter((e) => e.companyId === companyId),
    session: () => load().session,
    findEvent: (companyId, eventId) => load().events.find((e) => e.id === eventId && e.companyId === companyId),
    bumpAttendees: (companyId, eventId, delta, minCapacity) => {
      const data = load();
      const event = data.events.find((e) => e.id === eventId && e.companyId === companyId);
      if (!event) return { attendeeCount: 0, capacity: 0 };
      event.attendeeCount = Math.max(0, event.attendeeCount + delta);
      if (minCapacity) event.capacity = Math.max(event.capacity, minCapacity);
      save(data);
      return { attendeeCount: event.attendeeCount, capacity: event.capacity };
    },
  });

  return {
    ...ops,
    mode: "mock",
    async session() {
      return load().session;
    },
    async listTags() {
      if (liveTagsPreview()) return LIVE_TAG_NAMES.map((name) => ({ id: opaqueTagId(`live:${name}`), name }));
      return opaqueTagsPreview() ? TAGS.map((tag) => ({ ...tag, id: opaqueTagId(tag.id) })) : TAGS;
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
    async listThemes() {
      const data = load();
      const session = requireAdmin(data);
      return (data.themes ?? [])
        .filter((theme) => theme.companyId === session.companyId && theme.type === "weekly")
        .sort((a, b) => Date.parse(b.startDate) - Date.parse(a.startDate));
    },
    async getTheme(challengeId) {
      const data = load();
      const session = requireAdmin(data);
      const theme = data.themes?.find((item) => item.id === challengeId && item.companyId === session.companyId);
      if (!theme) throw new ApiError("not-found", "That weekly theme doesn’t exist.", {}, THEME_REASONS.notFound);
      return theme;
    },
    async createTheme(requestId, draft) {
      const data = load();
      const session = requireAdmin(data);
      const themes = (data.themes ??= []);
      const receipts = (data.themeReceipts ??= {});
      const normalized = normalizeThemeDraft(draft);
      const hash = JSON.stringify(normalized);
      const key = `${session.companyId}:${session.uid}:${requestId}`;
      const receipt = receipts[key];
      if (receipt) {
        if (receipt.hash !== hash) {
          throw new ApiError("invalid-argument", "This request ID was already used with different details.", {}, THEME_REASONS.requestReused);
        }
        return { challengeId: receipt.challengeId, revision: receipt.revision, replayed: true };
      }
      checkTheme(normalized, themes.filter((theme) => theme.companyId === session.companyId), undefined, now());
      const at = now().toISOString();
      const theme: WeeklyTheme = {
        ...normalized, id: `chl-${requestId.slice(0, 8)}`, companyId: session.companyId,
        participantCount: 0, completedCount: 0, createdBy: session.uid, createdAt: at, updatedAt: at, revision: 1,
      };
      themes.push(theme);
      receipts[key] = { hash, challengeId: theme.id, revision: 1 };
      save(data);
      return { challengeId: theme.id, revision: 1, replayed: false };
    },
    async updateTheme(challengeId, expectedRevision, draft) {
      const data = load();
      const session = requireAdmin(data);
      const themes = (data.themes ??= []);
      const index = themes.findIndex((item) => item.id === challengeId && item.companyId === session.companyId);
      if (index < 0) throw new ApiError("not-found", "That weekly theme doesn’t exist.", {}, THEME_REASONS.notFound);
      const current = themes[index];
      if (current.revision !== expectedRevision) {
        throw new ApiError("aborted", "Someone else changed this theme. Reload to see their changes.", {}, THEME_REASONS.revisionConflict);
      }
      const normalized = normalizeThemeDraft(draft);
      // Once anyone has joined or completed, the start stays put and the end can't move into the past
      // (mirrors updateChallengeV1's WINDOW_CHANGE_BLOCKED).
      if (windowLocked(current)) {
        const startMoved = normalized.startDate !== current.startDate;
        const endPast = normalized.endDate !== current.endDate && Date.parse(normalized.endDate) < now().getTime();
        if (startMoved || endPast) {
          throw new ApiError("failed-precondition", "People have already joined this theme, so its start can’t move and it can’t end in the past.", {
            ...(startMoved ? { startDate: "Locked: people have joined." } : {}),
            ...(endPast ? { endDate: "Can’t end in the past once people have joined." } : {}),
          }, THEME_REASONS.windowLocked);
        }
      }
      checkTheme(normalized, themes.filter((theme) => theme.companyId === session.companyId), challengeId);
      // Counts, author and creation time are server-owned: the draft can't carry them.
      themes[index] = { ...current, ...normalized, updatedAt: now().toISOString(), revision: current.revision + 1 };
      save(data);
      return { challengeId, revision: current.revision + 1 };
    },
  };
}

/** The server-side checks the callables run after authorization: validation, then the one-theme-per-week rule. */
function checkTheme(draft: ThemeDraft, companyThemes: WeeklyTheme[], excludeId?: string, createdAt?: Date) {
  const errors = validateThemeDraft(draft, { knownTagIds: TAGS.map((tag) => tag.id), now: createdAt });
  if (Object.keys(errors).length) throw new ApiError("invalid-argument", "Check the highlighted fields.", errors, "VALIDATION_FAILED");
  const conflict = findOverlap(draft, companyThemes, excludeId);
  if (conflict) {
    const message = "Another weekly theme already runs during these dates.";
    throw new ApiError("failed-precondition", message, { startDate: message, endDate: message }, THEME_REASONS.overlap, {
      challengeId: conflict.id, startDate: conflict.startDate, endDate: conflict.endDate,
    });
  }
}

export { browserStore } from "./browserStore";
