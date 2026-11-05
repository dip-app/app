import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { Timestamp } from 'firebase/firestore';
let env: RulesTestEnvironment;
const company = 'event-read-alpha';
const start = Timestamp.fromMillis(2_000_000_000_000);
const client = (uid = 'event-reader', verified = true) => env.authenticatedContext(uid, { email_verified: verified }).firestore();
function feed(db = client(), companyID = company) {
  return db.collection(`companies/${companyID}/events`).where('companyId', '==', companyID)
    .where('status', '==', 'scheduled').where('startTime', '>=', start)
    .orderBy('startTime').orderBy('__name__');
}
before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-dip', firestore: { host: '127.0.0.1', port: 8080, rules: readFileSync('gcp/firestore.rules', 'utf8') } });
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    for (const [uid, c, role] of [['event-reader', company, 'member'], ['event-admin', company, 'admin'], ['event-outsider', 'event-read-beta', 'member']]) {
      await db.doc(`users/${uid}`).set({ companyId: c, role });
    }
    for (const id of ['a', 'b', 'c']) await db.doc(`companies/${company}/events/${id}`).set({ companyId: company, title: id, status: 'scheduled', startTime: start });
    await db.doc(`companies/${company}/events/cancelled`).set({ companyId: company, status: 'cancelled', startTime: start });
    await db.doc(`companies/${company}/events/malformed`).set({ companyId: 'event-read-beta', status: 'scheduled', startTime: start });
    await db.doc(`companies/${company}/events/a/rsvps/member`).set({ companyId: company });
    await db.doc(`companies/${company}/commandReceipts/private`).set({ eventId: 'a' });
  });
});
after(async () => { await env?.cleanup(); });
test('verified company member reads ordered bounded feed and cursor pages', async () => {
  const first = await assertSucceeds(feed().limit(2).get());
  assert.deepEqual(first.docs.map(d => d.id), ['a', 'b']);
  const second = await assertSucceeds(feed().startAfter(start, 'b').limit(2).get());
  assert.deepEqual(second.docs.map(d => d.id), ['c']);
});
test('cancelled detail remains organizer-only; same-company missing documents are observable', async () => {
  for (const uid of ['event-reader', 'event-admin']) {
    const cancelled = client(uid).doc(`companies/${company}/events/cancelled`).get();
    if (uid === 'event-admin') await assertSucceeds(cancelled); else await assertFails(cancelled);
    const missing = await assertSucceeds(client(uid).doc(`companies/${company}/events/missing`).get());
    assert.equal(missing.exists, false);
  }
});
test('signed-out, unverified, other-tenant and absent memberships cannot read or list', async () => {
  for (const db of [env.unauthenticatedContext().firestore(), client('event-reader', false), client('event-outsider'), client('event-no-profile')]) {
    await assertFails(db.doc(`companies/${company}/events/a`).get());
    await assertFails(feed(db).limit(20).get());
    await assertFails(db.doc(`companies/${company}/events/missing`).get());
  }
});
test('payload-tenant mismatches are denied and feed requires a tenant constraint', async () => {
  await assertFails(client().doc(`companies/${company}/events/malformed`).get());
  await assertFails(client().collection(`companies/${company}/events`).where('status', '==', 'scheduled').orderBy('startTime').limit(20).get());
  await assertFails(client().collectionGroup('events').where('companyId', '==', company).limit(20).get());
});
test('list requires explicit maximum of 100', async () => {
  await assertSucceeds(feed().limit(100).get());
  await assertFails(feed().limit(101).get()); await assertFails(feed().get());
});
test('read permission never opens writes, RSVP access or private receipts, including for admins', async () => {
  for (const uid of ['event-reader', 'event-admin']) {
    const db = client(uid);
    await assertFails(db.doc(`companies/${company}/events/new`).set({ companyId: company }));
    await assertFails(db.doc(`companies/${company}/events/a`).update({ attendeeCount: 99, revision: 2 }));
    await assertFails(db.doc(`companies/${company}/events/a`).delete());
    await assertFails(db.doc(`companies/${company}/events/a/rsvps/member`).get());
    await assertFails(db.doc(`companies/${company}/commandReceipts/private`).get());
    await assertFails(db.doc(`companies/${company}/events/a/rsvps/member`).set({ status: 'going' }));
  }
});
