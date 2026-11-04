import { createRequire } from "node:module";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { GoogleAuthProvider, signInWithCredential, signOut } from "firebase/auth";
import { ApiError, type EventDraft } from "../contract";

// Run: firebase emulators:exec --project demo-dip --only auth,functions,firestore \
//        "LIVE_EMULATORS=1 npm --prefix apps/admin test"   (root script: npm run test:admin:live)
const live = process.env.LIVE_EMULATORS === "1";

describe.skipIf(!live)("Firebase adapter against the Auth, Firestore and Functions emulators", () => {
  it("signs in, loads tags, creates and edits events, and maps server answers", async () => {
    const { createFirebaseApi } = await import("../firebaseAdapter");
    const req = createRequire(resolve(process.cwd(), "../../gcp/functions/package.json"));
    // firebase-admin lives in gcp/functions and is only installed where the emulator suite runs, so the
    // test describes the few calls it needs instead of importing its types.
    interface DocRef { set(data: object): Promise<unknown>; update(data: object): Promise<unknown>; collection(name: string): CollectionRef }
    interface CollectionRef { doc(id: string): DocRef }
    const adminApp = req("firebase-admin/app") as { initializeApp(options: object, name: string): unknown };
    const adminFirestore = req("firebase-admin/firestore") as { getFirestore(app: unknown): { collection(name: string): CollectionRef } };
    const db = adminFirestore.getFirestore(adminApp.initializeApp({ projectId: "demo-dip" }, "adapter-test"));

    const stamp = Date.now();
    const domain = `adapter-${stamp}.test`;
    const companyId = `adapter-co-${stamp}`;
    await db.collection("companies").doc(companyId).set({ name: "Adapter Co", emailDomain: domain });
    await db.collection("tags").doc("adapter-tag").set({ name: "Adapter Tag", icon: "x", sortOrder: 1 });

    let nextEmail = "";
    const api = createFirebaseApi(
      { firebase: { apiKey: "demo-key", projectId: "demo-dip", appId: "demo-app" }, emulatorHost: "127.0.0.1" },
      {
        signInWithGoogle: async (auth) => {
          await signOut(auth);
          const idToken = JSON.stringify({ sub: `google-${nextEmail}`, email: nextEmail, email_verified: true, name: nextEmail.split("@")[0] });
          await signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
        },
      },
    );
    expect(api.mode).toBe("live");
    expect(await api.session()).toBeNull();

    // An ordinary member signs in (the server places them in the company) but is not an organizer.
    nextEmail = `member@${domain}`;
    const member = await api.signIn();
    expect(member).toMatchObject({ companyId, role: "member" });
    await expect(api.listEvents()).rejects.toMatchObject({ code: "permission-denied" });

    // Organizer assignment is a trusted server-side action.
    nextEmail = `organizer@${domain}`;
    const first = await api.signIn();
    expect(first.role).toBe("member");
    await db.collection("users").doc(first.uid).update({ role: "admin" });
    const organizer = (await api.session())!;
    expect(organizer).toMatchObject({ companyId, role: "admin" });

    expect((await api.listTags()).find((tag) => tag.id === "adapter-tag")).toEqual({ id: "adapter-tag", name: "Adapter Tag" });

    const start = new Date(Date.now() + 7 * 86_400_000);
    const draft: EventDraft = {
      title: "Adapter trivia", description: "Teams of four.", tagIds: ["adapter-tag"], coverImageURL: "catalog://default/games",
      startTime: start.toISOString(), endTime: new Date(start.getTime() + 5_400_000).toISOString(),
      venue: { name: "Pub", address: "1 Main St", locality: "Pittsburgh, PA", latitude: 40.44, longitude: -79.99 },
      costCents: 500, costNote: "", capacity: 10, isOutdoor: false,
    };

    const requestId = crypto.randomUUID();
    const created = await api.createEvent(requestId, draft);
    expect(created.revision).toBe(1);
    expect(await api.createEvent(requestId, draft)).toEqual(created); // retry returns the same event

    const stored = await api.getEvent(created.eventId);
    expect(stored).toMatchObject({ companyId, title: "Adapter trivia", startTime: draft.startTime, endTime: draft.endTime, revision: 1, status: "scheduled", attendeeCount: 0 });
    expect((await api.listEvents()).map((event) => event.id)).toContain(created.eventId);

    // Edits send a full event object (id, revision...) from the form; only draft fields reach the wire.
    const edited = await api.updateEvent(created.eventId, 1, { ...stored, title: "Adapter trivia!" }, "scheduled");
    expect(edited.revision).toBe(2);
    await expect(api.updateEvent(created.eventId, 1, { ...stored, title: "Stale" }, "scheduled")).rejects.toMatchObject({ code: "aborted" });

    // Validation answers carry field-level errors the form can show.
    const bad = await api.createEvent(crypto.randomUUID(), { ...draft, capacity: 0 }).catch((error: unknown) => error);
    expect(bad).toBeInstanceOf(ApiError);
    expect((bad as ApiError).code).toBe("invalid-argument");
    expect(Object.keys((bad as ApiError).fields)).toEqual(["capacity"]);

    // Any RSVP record, even a cancelled one, locks both times (issue #14).
    await db.collection("companies").doc(companyId).collection("events").doc(created.eventId)
      .collection("rsvps").doc("someone").set({ status: "cancelled", userId: "someone" });
    const shifted = { ...stored, revision: 2, startTime: new Date(start.getTime() + 3_600_000).toISOString(), endTime: new Date(start.getTime() + 9_000_000).toISOString() };
    const locked = await api.updateEvent(created.eventId, 2, shifted, "scheduled").catch((error: unknown) => error);
    expect(locked).toBeInstanceOf(ApiError);
    expect((locked as ApiError).code).toBe("failed-precondition");
    expect(Object.keys((locked as ApiError).fields).sort()).toEqual(["endTime", "startTime"]);

    // Cancel and restore; the event is never deleted.
    expect((await api.updateEvent(created.eventId, 2, { ...stored, title: "Adapter trivia!" }, "cancelled")).revision).toBe(3);
    expect((await api.getEvent(created.eventId)).status).toBe("cancelled");

    await api.signOut();
    expect(await api.session()).toBeNull();
  }, 60_000);
});
