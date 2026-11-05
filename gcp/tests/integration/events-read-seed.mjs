import { createRequire } from 'node:module';
const require = createRequire(new URL('../../functions/package.json', import.meta.url));
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
if (process.env.GCLOUD_PROJECT !== 'demo-dip' || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099') throw new Error('Local demo-dip Auth/Firestore emulators required.');
const app = initializeApp({ projectId: 'demo-dip' });
try {
 const auth = getAuth(app); const db = getFirestore(app);
 try { await auth.deleteUser('event-read-member'); } catch (error) { if (error.code !== 'auth/user-not-found') throw error; }
 await auth.createUser({ uid: 'event-read-member', email: 'event-reader@example.test', emailVerified: true, password: 'emulator-only-password' });
 await db.doc('users/event-read-member').set({ companyId: 'read-demo', role: 'member', displayName: 'Event Reader' });
 await db.doc('companies/read-demo').set({ name: 'Synthetic Event Company' });
 const start = Date.now() + 86400000;
 for (const id of ['event-a', 'event-b']) {
  await db.doc(`companies/read-demo/events/${id}`).set({ companyId: 'read-demo', title: id === 'event-a' ? 'Emulator lunch' : 'Emulator walk', description: 'Synthetic emulator-only event', tagIds: [], coverImageURL: '', startTime: Timestamp.fromMillis(start), endTime: Timestamp.fromMillis(start + 3600000), venue: { name: 'Cafe', address: '1 Main', locality: 'Pittsburgh', latitude: 40, longitude: -79 }, costCents: 0, costNote: '', capacity: 20, attendeeCount: 0, pointsValue: 0, isOutdoor: false, status: 'scheduled', revision: 1, createdBy: 'synthetic-host', createdAt: Timestamp.now() });
 }
 await db.doc('testRuns/member-event-reads').set({ kind: 'member-event-read-e2e' });
 console.log('Seeded synthetic member event-read test data in demo-dip emulators only.');
} finally { await deleteApp(app); }
