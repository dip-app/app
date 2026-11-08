import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { Timestamp } from 'firebase/firestore';

// RSVP reads for attendees, own joined state and My Events. Writes stay with setRsvpV1.
let env: RulesTestEnvironment;
const company = 'rsvp-read-alpha';
const other = 'rsvp-read-beta';
const start = Timestamp.fromMillis(2_000_000_000_000);
const client = (uid = 'rsvp-me', verified = true) => env.authenticatedContext(uid, { email_verified: verified }).firestore();
const rsvp = (c: string, event: string, userId: string, status: string) => ({
  companyId: c, eventId: event, userId, status, userName: userId, userAvatarId: '', userDepartment: '',
  eventStartTime: start, checkedIn: false, checkedInAt: null,
});
const attendees = (db = client(), c = company, event = 'a') =>
  db.collection(`companies/${c}/events/${event}/rsvps`).where('companyId', '==', c).where('status', '==', 'going');
const myEvents = (db = client(), uid = 'rsvp-me', c = company) =>
  db.collectionGroup('rsvps').where('companyId', '==', c).where('userId', '==', uid).where('status', '==', 'going').orderBy('eventStartTime');

before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-dip', firestore: { host: '127.0.0.1', port: 8080, rules: readFileSync('gcp/firestore.rules', 'utf8') } });
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    for (const [uid, c] of [['rsvp-me', company], ['rsvp-coworker', company], ['rsvp-outsider', other]]) {
      await db.doc(`users/${uid}`).set({ companyId: c, role: 'member' });
    }
    await db.doc(`companies/${company}/events/a/rsvps/rsvp-me`).set(rsvp(company, 'a', 'rsvp-me', 'going'));
    await db.doc(`companies/${company}/events/a/rsvps/rsvp-coworker`).set(rsvp(company, 'a', 'rsvp-coworker', 'going'));
    await db.doc(`companies/${company}/events/b/rsvps/rsvp-coworker`).set(rsvp(company, 'b', 'rsvp-coworker', 'cancelled'));
    await db.doc(`companies/${company}/events/b/rsvps/rsvp-me`).set(rsvp(company, 'b', 'rsvp-me', 'cancelled'));
    await db.doc(`companies/${other}/events/x/rsvps/rsvp-outsider`).set(rsvp(other, 'x', 'rsvp-outsider', 'going'));
  });
});
after(async () => { await env?.cleanup(); });

test('own RSVP is readable in any state, and a missing own row is observable', async () => {
  assert.equal((await assertSucceeds(client().doc(`companies/${company}/events/a/rsvps/rsvp-me`).get())).get('status'), 'going');
  assert.equal((await assertSucceeds(client().doc(`companies/${company}/events/b/rsvps/rsvp-me`).get())).get('status'), 'cancelled');
  assert.equal((await assertSucceeds(client().doc(`companies/${company}/events/new/rsvps/rsvp-me`).get())).exists, false);
});

test('coworkers see going rows only; cancelled rows of others stay private', async () => {
  await assertSucceeds(client().doc(`companies/${company}/events/a/rsvps/rsvp-coworker`).get());
  await assertFails(client().doc(`companies/${company}/events/b/rsvps/rsvp-coworker`).get());
  await assertFails(client().doc(`companies/${company}/events/new/rsvps/rsvp-coworker`).get());
});

test('attendee list requires going status and a limit of at most 100', async () => {
  const list = await assertSucceeds(attendees().limit(100).get());
  assert.deepEqual(list.docs.map(d => d.id).sort(), ['rsvp-coworker', 'rsvp-me']);
  await assertFails(attendees().limit(101).get());
  await assertFails(attendees().get());
  await assertFails(client().collection(`companies/${company}/events/b/rsvps`).limit(10).get());
  // Without the tenant constraint the list cannot be proven safe.
  await assertFails(client().collection(`companies/${company}/events/a/rsvps`).where('status', '==', 'going').limit(10).get());
});

test('My Events lists only the caller\'s own going RSVPs in their company', async () => {
  const mine = await assertSucceeds(myEvents().limit(100).get());
  assert.deepEqual(mine.docs.map(d => d.ref.path), [`companies/${company}/events/a/rsvps/rsvp-me`]);
  await assertFails(myEvents(client(), 'rsvp-coworker').limit(100).get());
  await assertFails(myEvents(client(), 'rsvp-me', other).limit(100).get());
  await assertFails(myEvents().get());
});

test('signed-out, unverified, other-company and profile-less callers are denied', async () => {
  for (const db of [env.unauthenticatedContext().firestore(), client('rsvp-me', false), client('rsvp-outsider'), client('rsvp-nobody')]) {
    await assertFails(db.doc(`companies/${company}/events/a/rsvps/rsvp-coworker`).get());
    await assertFails(attendees(db).limit(10).get());
  }
  await assertFails(myEvents(client('rsvp-outsider'), 'rsvp-outsider', company).limit(10).get());
});

test('clients can never write RSVP rows or counts, even their own', async () => {
  const db = client();
  await assertFails(db.doc(`companies/${company}/events/a/rsvps/rsvp-me`).update({ status: 'cancelled' }));
  await assertFails(db.doc(`companies/${company}/events/new/rsvps/rsvp-me`).set(rsvp(company, 'new', 'rsvp-me', 'going')));
  await assertFails(db.doc(`companies/${company}/events/a/rsvps/rsvp-me`).delete());
  await assertFails(db.doc(`companies/${company}/events/a`).update({ attendeeCount: 5 }));
});
