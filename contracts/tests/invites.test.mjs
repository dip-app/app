import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

// Coworker invitations (sendInviteV1, respondToInviteV1, listCoworkersV1). Inline examples keep the shared fixture untouched.
const schema = JSON.parse(readFileSync(new URL('../v1/models.schema.json', import.meta.url)));
const ajv = new Ajv({strict: true});
addFormats(ajv);
const validate = name => ajv.compile({...schema, $ref: `#/$defs/${name}`});
const invite = {companyId: 'c', eventId: 'e', eventTitle: 'Pasta Night', eventStartTime: '2026-11-20T18:00:00Z',
  fromUserId: 'u1', fromUserName: 'Sam', toUserId: 'u2', message: '', status: 'pending', createdAt: '2026-11-11T10:00:00Z'};

test('EventInvite keeps its original required fields; the additive display fields are optional', () => {
  const check = validate('EventInvite');
  assert.equal(check(invite), true, JSON.stringify(check.errors));
  assert.equal(check({...invite, fromUserAvatarId: 'a', toUserName: 'Fran', toUserAvatarId: 'b', requestId: 'request-0001', respondedAt: '2026-11-11T11:00:00Z'}), true, JSON.stringify(check.errors));
  assert.equal(check({...invite, secret: 1}), false);
});

test('SendInviteRequest and Response are strict', () => {
  const check = validate('SendInviteRequest');
  const request = {contractVersion: 1, companyId: 'c', eventId: 'e', toUserId: 'u2', message: 'Come!', requestId: 'request-0001'};
  assert.equal(check(request), true, JSON.stringify(check.errors));
  const {message, ...withoutMessage} = request;
  assert.equal(check(withoutMessage), true);
  for (const patch of [{contractVersion: 2}, {toUserId: 'a/b'}, {requestId: 'short'}, {message: 'x'.repeat(201)}, {fromUserId: 'u1'}, {status: 'accepted'}]) {
    assert.equal(check({...request, ...patch}), false, JSON.stringify(patch));
  }
  const response = validate('SendInviteResponse');
  assert.equal(response({contractVersion: 1, inviteId: 'e_u2', status: 'pending', created: true}), true);
  assert.equal(response({contractVersion: 1, inviteId: 'e_u2', status: 'maybe', created: true}), false);
  assert.equal(response({contractVersion: 1, inviteId: 'e_u2', status: 'pending'}), false);
});

test('RespondToInviteRequest and Response are strict; RSVP fields appear only for acceptance', () => {
  const check = validate('RespondToInviteRequest');
  const request = {contractVersion: 1, companyId: 'c', inviteId: 'e_u2', response: 'accepted'};
  assert.equal(check(request), true, JSON.stringify(check.errors));
  for (const patch of [{response: 'maybe'}, {response: 'pending'}, {inviteId: 'a/b'}, {rsvpStatus: 'going'}, {contractVersion: 2}]) {
    assert.equal(check({...request, ...patch}), false, JSON.stringify(patch));
  }
  const response = validate('RespondToInviteResponse');
  assert.equal(response({contractVersion: 1, inviteId: 'e_u2', status: 'accepted', rsvpStatus: 'going', attendeeCount: 4}), true);
  assert.equal(response({contractVersion: 1, inviteId: 'e_u2', status: 'declined'}), true);
  assert.equal(response({contractVersion: 1, inviteId: 'e_u2', status: 'accepted', attendeeCount: -1}), false);
});

test('The coworker directory exposes only the minimal projection and requires a real query', () => {
  const coworker = validate('Coworker');
  const entry = {userId: 'u2', displayName: 'Fran Friend', avatarId: 'a', department: 'Ops', state: 'available'};
  assert.equal(coworker(entry), true, JSON.stringify(coworker.errors));
  for (const patch of [{email: 'x@y.com'}, {pointsBalance: 1}, {role: 'admin'}, {state: 'blocked'}]) {
    assert.equal(coworker({...entry, ...patch}), false, JSON.stringify(patch));
  }
  const request = validate('ListCoworkersRequest');
  const body = {contractVersion: 1, companyId: 'c', eventId: 'e', query: 'fr', limit: 10};
  assert.equal(request(body), true, JSON.stringify(request.errors));
  for (const patch of [{query: 'f'}, {query: 'x'.repeat(41)}, {limit: 26}, {limit: 0}, {companyWide: true}]) {
    assert.equal(request({...body, ...patch}), false, JSON.stringify(patch));
  }
  const response = validate('ListCoworkersResponse');
  assert.equal(response({contractVersion: 1, coworkers: [entry], truncated: false}), true);
  assert.equal(response({contractVersion: 1, coworkers: [{...entry, email: 'x'}], truncated: false}), false);
});
