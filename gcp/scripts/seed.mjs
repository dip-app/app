#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const expectedProject = "demo-dip";
const expectedFirestoreHost = "127.0.0.1:8080";
const expectedAuthHost = "127.0.0.1:9099";

// Check every destination before loading the Admin SDK or creating any client.
const project = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT;
if (
  project !== expectedProject ||
  (process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT !== expectedProject) ||
  (process.env.GOOGLE_CLOUD_PROJECT && process.env.GOOGLE_CLOUD_PROJECT !== expectedProject) ||
  process.env.FIRESTORE_EMULATOR_HOST !== expectedFirestoreHost ||
  process.env.FIREBASE_AUTH_EMULATOR_HOST !== expectedAuthHost
) {
  throw new Error(
    "Refusing to seed. Set GCLOUD_PROJECT=demo-dip, " +
    "FIRESTORE_EMULATOR_HOST=127.0.0.1:8080, and " +
    "FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099. Only these local emulators are allowed.",
  );
}

const fixture = JSON.parse(await readFile(new URL("../sample-data/v1.json", import.meta.url), "utf8"));
if (fixture.formatVersion !== 1 || fixture.projectId !== expectedProject) {
  throw new Error("Unsupported seed fixture or project.");
}

const normalizedCode = fixture.joinCode.trim().toUpperCase();
const accessPath = "companyAccess/" + createHash("sha256").update(normalizedCode, "utf8").digest("hex");
const paths = new Set();
for (const document of fixture.firestoreDocuments) {
  const allowed = /^(companies\/company-demo(?:\/events\/event-demo(?:\/rsvps\/member-demo)?)?|users\/(?:member-demo|admin-demo)|tags\/tag-social)$/.test(document.path)
    || document.path === accessPath;
  if (!allowed || paths.has(document.path) || typeof document.data !== "object" || document.data === null) {
    throw new Error(`Unexpected or duplicate fixture document: ${document.path}`);
  }
  if (document.path.startsWith("companies/") && Object.hasOwn(document.data, "joinCode")) {
    throw new Error("Company data must not expose a join code.");
  }
  paths.add(document.path);
}
if (!paths.has(accessPath)) {
  throw new Error("The fixture's private companyAccess hash does not match its normalized join code.");
}
for (const user of fixture.authUsers) {
  if (!["member-demo", "admin-demo"].includes(user.uid) || !user.email.endsWith("@example.invalid")) {
    throw new Error("Only reserved synthetic emulator users may be seeded.");
  }
}

// Resolve from the Functions workspace: npm may install Admin there rather than hoist it.
const workspaceRequire = createRequire(new URL("../functions/package.json", import.meta.url));
const { initializeApp, deleteApp } = workspaceRequire("firebase-admin/app");
const { getAuth } = workspaceRequire("firebase-admin/auth");
const { getFirestore, Timestamp } = workspaceRequire("firebase-admin/firestore");

const dateFields = new Set([
  "createdAt", "updatedAt", "startTime", "endTime", "eventStartTime", "checkedInAt",
  "startDate", "endDate", "expiresAt", "redeemedAt", "drawDate", "enteredAt", "eventDate",
]);
function firestoreValue(value, field = "") {
  if (value === null) return null;
  if (dateFields.has(field)) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) {
      throw new Error(`Expected an ISO 8601 UTC timestamp for ${field}.`);
    }
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) throw new Error(`Invalid timestamp for ${field}.`);
    return Timestamp.fromDate(date);
  }
  if (Array.isArray(value)) return value.map((item) => firestoreValue(item));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, firestoreValue(child, key)]));
  }
  return value;
}

// Fully validate/convert documents before any writes. No reset, delete, or global clear occurs.
const documents = fixture.firestoreDocuments.map((document) => ({
  path: document.path,
  data: firestoreValue(document.data),
}));
const app = initializeApp({ projectId: expectedProject });
try {
  const auth = getAuth(app);
  // Check all existing reserved users before updating either one.
  const existingUsers = new Map();
  for (const user of fixture.authUsers) {
    try {
      const existing = await auth.getUser(user.uid);
      if (existing.email !== user.email) {
        throw new Error(`Reserved UID ${user.uid} belongs to a different emulator account; refusing to overwrite it.`);
      }
      existingUsers.set(user.uid, existing);
    } catch (error) {
      if (error.code !== "auth/user-not-found") throw error;
    }
  }
  for (const user of fixture.authUsers) {
    const { uid, ...properties } = user;
    if (existingUsers.has(uid)) await auth.updateUser(uid, properties);
    else await auth.createUser(user);
  }
  const firestore = getFirestore(app);
  const batch = firestore.batch();
  for (const document of documents) batch.set(firestore.doc(document.path), document.data);
  await batch.commit();
  console.log(`Seeded ${fixture.authUsers.length} synthetic Auth users and ${documents.length} Firestore documents into ${expectedProject}.`);
  console.log("Re-running restores only these reserved fixture IDs; unrelated emulator data is untouched.");
} finally {
  await deleteApp(app);
}
