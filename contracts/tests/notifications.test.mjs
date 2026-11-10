import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

// Chat, push and change-history types. Inline examples keep the shared happy-path fixture untouched.
const schema = JSON.parse(readFileSync(new URL('../v1/models.schema.json', import.meta.url)));
const fixtures = JSON.parse(readFileSync(new URL('../v1/fixtures/happy-path.json', import.meta.url)));
const ajv = new Ajv({strict: true});
addFormats(ajv);
const validate = name => ajv.compile({...schema, $ref: `#/$defs/${name}`});
const token = 'fcm-token-' + 'a'.repeat(140);
const entry = {at: '2026-11-10T12:00:00Z', by: 'organizer-uid', revision: 2,
  changes: [{field: 'venue.name', from: 'Park', to: 'Lake'}, {field: 'costNote', from: null, to: 'Bring water'}]};

test('Event accepts an optional server-owned changeLog and updatedBy; old events stay valid', () => {
  const check = validate('Event');
  assert.equal(check(fixtures.event), true, JSON.stringify(check.errors));
  assert.equal(check({...fixtures.event, updatedBy: 'organizer-uid', changeLog: [entry]}), true, JSON.stringify(check.errors));
  assert.equal(check({...fixtures.event, changeLog: [{...entry, changes: [{field: 'attendeeCount', from: '1', to: '2'}]}]}), false);
  assert.equal(check({...fixtures.event, changeLog: [{...entry, changes: []}]}), false);
  assert.equal(check({...fixtures.event, changeLog: Array(51).fill(entry)}), false);
});

test('EventMessage, EventSubscription and DeviceRegistration document shapes', () => {
  assert.equal(validate('EventMessage')({companyId: 'c', eventId: 'e', authorId: 'u', authorName: 'Avery', authorAvatarId: 'a1',
    text: 'On my way', createdAt: '2026-11-10T12:00:00Z'}), true);
  const subscription = validate('EventSubscription');
  for (const level of ['all', 'changes', 'reminders', 'none']) assert.equal(subscription({level, updatedAt: '2026-11-10T12:00:00Z'}), true);
  assert.equal(subscription({level: 'everything', updatedAt: '2026-11-10T12:00:00Z'}), false);
  assert.equal(subscription({level: 'all', updatedAt: '2026-11-10T12:00:00Z', unread: 3}), false);
  assert.equal(validate('DeviceRegistration')({token, tokenHash: 'f'.repeat(64), platform: 'ios', appVersion: '1.0 (1)',
    updatedAt: '2026-11-10T12:00:00Z'}), true);
});

test('device callables reject spoofed identity, unknown platforms and bad tokens', () => {
  const register = validate('RegisterDeviceRequest');
  const request = {contractVersion: 1, token, platform: 'ios', appVersion: '1.0 (1)'};
  assert.equal(register(request), true, JSON.stringify(register.errors));
  for (const patch of [{userId: 'x'}, {platform: 'android'}, {contractVersion: 2}, {token: 'short'}, {token: `${token}/x`}]) {
    assert.equal(register({...request, ...patch}), false);
  }
  assert.equal(validate('RegisterDeviceResponse')({contractVersion: 1, deviceId: 'a'.repeat(64)}), true);
  assert.equal(validate('UnregisterDeviceRequest')({contractVersion: 1, token}), true);
  assert.equal(validate('UnregisterDeviceResponse')({contractVersion: 1, removed: true}), true);
});

test('push data payload keys and deep links', () => {
  const check = validate('PushNotificationData');
  assert.equal(check({type: 'chat', companyId: 'c', eventId: 'e1', deepLink: 'dip://events/e1/chat', messageId: 'm'}), true);
  assert.equal(check({type: 'event_changed', companyId: 'c', eventId: 'e1', deepLink: 'dip://events/e1', revision: '3'}), true);
  assert.equal(check({type: 'reminder', companyId: 'c', eventId: 'e1', deepLink: 'dip://events/e1', window: '1h'}), true);
  assert.equal(check({type: 'chat', companyId: 'c', eventId: 'e1', deepLink: 'https://evil.example'}), false);
  assert.equal(check({type: 'chat', companyId: 'c', eventId: 'e1', deepLink: 'dip://events/e1', text: 'full message'}), false);
});
