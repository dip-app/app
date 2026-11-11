import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

// Admin backend types (docs/contracts/admin.md). Inline examples keep the shared happy-path fixture untouched.
const schema = JSON.parse(readFileSync(new URL('../v1/models.schema.json', import.meta.url)));
const fixtures = JSON.parse(readFileSync(new URL('../v1/fixtures/happy-path.json', import.meta.url)));
const ajv = new Ajv({strict: true});
addFormats(ajv);
const validate = name => ajv.compile({...schema, $ref: `#/$defs/${name}`});
const base = {contractVersion: 1, companyId: 'acme'};
const rid = 'req-12345678';

function accepts(name, value) {
  const check = validate(name);
  assert.equal(check(value), true, `${name}: ${JSON.stringify(check.errors)}`);
}
function rejects(name, value, label = '') {
  assert.equal(validate(name)(value), false, `${name} should reject ${label || JSON.stringify(value)}`);
}

const user = {companyId: 'acme', displayName: 'Ada', email: 'a@acme.com', photoURL: '', avatarId: '', department: '', jobTitle: '', city: '', role: 'member',
  interestTagIds: [], travelRadiusMiles: 20, availability: [], friendIds: [], favoritePhotoIds: [], pointsBalance: 0, createdAt: '2026-11-10T12:00:00Z'};
const company = {name: 'Acme', logoURL: '', emailDomain: 'acme.com', city: 'Pittsburgh', officeLatitude: 40.4, officeLongitude: -80, createdAt: '2026-11-10T12:00:00Z'};
const rsvp = {companyId: 'acme', eventId: 'e', userId: 'u', userName: 'Ada', userAvatarId: '', userDepartment: '', eventStartTime: '2026-11-10T12:00:00Z',
  status: 'going', checkedIn: false, createdAt: '2026-11-10T12:00:00Z'};

test('additive fields keep existing AppUser, Company, RSVP and attendance documents valid', () => {
  accepts('AppUser', user);
  accepts('AppUser', {...user, workLocation: 'HQ', teamIds: ['t1'], status: 'deactivated', revision: 3, managerEmail: 'boss@acme.com', startDate: '2026-01-05', statusUpdatedAt: '2026-11-10T12:00:00Z'});
  rejects('AppUser', {...user, status: 'banned'});
  rejects('AppUser', {...user, teamIds: Array(21).fill('t')});
  accepts('Company', company);
  rejects('Company', {...company, membershipMode: 'rosterOnly'}, 'there is no roster-only mode');
  accepts('RSVP', rsvp);
  accepts('RSVP', {...rsvp, source: 'admin', managedBy: 'admin-uid'});
  rejects('RSVP', {...rsvp, source: 'bot'});
  accepts('RecordAttendanceRequest', {...base, eventId: 'e', userId: 'u'});
  accepts('RecordAttendanceRequest', {...base, eventId: 'e', userId: 'u', checkedIn: false});
  rejects('RecordAttendanceRequest', {...base, eventId: 'e', userId: 'u', checkedIn: 'no'});
  accepts('ResolveMembershipResponse', {contractVersion: 1, companyId: 'acme', role: 'organizer'});
  rejects('ResolveMembershipResponse', {contractVersion: 1, companyId: 'acme', role: 'owner'});
});

test('UpdateEventRequest accepts the completed status with an optional statusReason', () => {
  const request = fixtures.updateEventRequest;
  accepts('UpdateEventRequest', request);
  for (const status of ['scheduled', 'cancelled', 'completed']) accepts('UpdateEventRequest', {...request, status});
  accepts('UpdateEventRequest', {...request, status: 'scheduled', statusReason: 'Wrong event'});
  rejects('UpdateEventRequest', {...request, status: 'done'});
  rejects('UpdateEventRequest', {...request, statusReason: 'ab'});
  rejects('UpdateEventRequest', {...request, statusReason: 'x'.repeat(201)});
});

test('documents: Team, AuditEntry, RosterEntry and ImportJob are strict', () => {
  accepts('Team', {companyId: 'acme', name: 'Platform', archived: false, createdAt: '2026-11-10T12:00:00Z', updatedAt: '2026-11-10T12:00:00Z', revision: 1});
  rejects('Team', {companyId: 'acme', name: '', archived: false, createdAt: '2026-11-10T12:00:00Z', updatedAt: '2026-11-10T12:00:00Z', revision: 1});
  const audit = {companyId: 'acme', actorId: 'u', actorName: 'Ada', actorRole: 'admin', action: 'member.update', targetType: 'member', targetId: 'm1',
    summary: 'Updated Mia', changes: [{field: 'role', before: 'member', after: 'organizer'}, {field: 'x', before: null, after: null}], createdAt: '2026-11-10T12:00:00Z'};
  accepts('AuditEntry', audit);
  accepts('AuditEntry', {...audit, reason: 'why', requestId: rid});
  rejects('AuditEntry', {...audit, targetType: 'planet'});
  rejects('AuditEntry', {...audit, actorRole: 'root'});
  rejects('AuditEntry', {...audit, extra: 1});
  const entry = {companyId: 'acme', email: 'a@acme.com', displayName: '', role: 'member', teamIds: [], workLocation: '', department: '', jobTitle: '',
    status: 'invited', source: 'manual', invitedBy: 'u', createdAt: '2026-11-10T12:00:00Z', updatedAt: '2026-11-10T12:00:00Z', revision: 1};
  accepts('RosterEntry', entry);
  rejects('RosterEntry', {...entry, status: 'pending'});
  const {invitedBy, ...signup} = entry;
  accepts('RosterEntry', {...signup, status: 'claimed', source: 'signup', memberStatus: 'deactivated', claimedBy: 'u'});
  rejects('RosterEntry', {...entry, memberStatus: 'invited'});
  const job = {companyId: 'acme', status: 'planned', totals: {total: 1, create: 1, update: 0, unchanged: 0, invalid: 0},
    progress: {processed: 0, total: 1, created: 0, updated: 0, unchanged: 0, failed: 0}, planHash: 'a'.repeat(64), chunkCount: 1, nextChunk: 0,
    errors: [], errorsTruncated: false, createdBy: 'u', createdAt: '2026-11-10T12:00:00Z', updatedAt: '2026-11-10T12:00:00Z'};
  accepts('ImportJob', job);
  accepts('ImportJob', {...job, errors: [{rowNumber: 2, email: 'x@acme.com', outcome: 'failed', errorCode: 'TEAM_NOT_FOUND', message: 'Unknown team'}]});
  rejects('ImportJob', {...job, planHash: 'short'});
});

test('every mutating admin request needs a requestId and rejects unknown fields', () => {
  const mutating = {
    RemoveEventPhotoRequest: {eventId: 'e', photoId: 'u_0'},
    RemoveEventPhotoCommentRequest: {eventId: 'e', photoId: 'u_0', commentId: 'c'},
    AddEventAttendeeRequest: {eventId: 'e', userId: 'u'},
    RemoveEventAttendeeRequest: {eventId: 'e', userId: 'u'},
    UpdateMemberRequest: {userId: 'u', role: 'organizer'},
    ResetMemberProfileRequest: {userId: 'u'},
    SetMemberStatusRequest: {userId: 'u', status: 'deactivated'},
    AdjustMemberPointsRequest: {userId: 'u', delta: -5, reason: 'Correction'},
    UpsertTeamRequest: {name: 'Platform'},
    UpsertRosterEntryRequest: {entry: {email: 'a@acme.com', teamIds: ['Platform']}},
    RevokeRosterEntryRequest: {entryId: 'a'.repeat(64)},
    ImportEmployeesRequest: {rows: [{email: 'a@acme.com'}]},
  };
  for (const [name, fields] of Object.entries(mutating)) {
    accepts(name, {...base, requestId: rid, ...fields});
    rejects(name, {...base, ...fields}, 'a missing requestId');
    rejects(name, {...base, requestId: 'short', ...fields}, 'a short requestId');
    rejects(name, {...base, requestId: rid, ...fields, bogus: true}, 'an unknown field');
    rejects(name, {...base, requestId: rid, ...fields, contractVersion: 2}, 'another contract version');
  }
});

test('request limits: enums, ranges and row caps', () => {
  rejects('UpdateMemberRequest', {...base, requestId: rid, userId: 'u', role: 'owner'});
  rejects('UpdateMemberRequest', {...base, requestId: rid, userId: 'u', teamIds: Array(21).fill('t')});
  rejects('SetMemberStatusRequest', {...base, requestId: rid, userId: 'u', status: 'invited'});
  rejects('AdjustMemberPointsRequest', {...base, requestId: rid, userId: 'u', delta: 100001, reason: 'abc'});
  rejects('AdjustMemberPointsRequest', {...base, requestId: rid, userId: 'u', delta: 1, reason: 'ab'});
  rejects('AddEventAttendeeRequest', {...base, requestId: rid, eventId: 'e', userId: 'u', capacityOverrideReason: 'x'});
  accepts('AddEventAttendeeRequest', {...base, requestId: rid, eventId: 'e', userId: 'u', notify: true, capacityOverrideReason: 'VIP guest'});
  rejects('ImportEmployeesRequest', {...base, requestId: rid, rows: Array(2001).fill({email: 'a@acme.com'})}, '2001 rows');
  rejects('ImportEmployeesRequest', {...base, requestId: rid, rows: [{displayName: 'No email'}]}, 'a row without email');
  rejects('ListMembersRequest', {...base, pageSize: 101});
  accepts('ListMembersRequest', {...base, query: 'mia', role: 'member', status: 'active', teamId: 't1', workLocation: 'HQ', pageSize: 100, pageToken: 'abc'});
  rejects('ApplyEmployeeImportRequest', {...base, jobId: 'j', planHash: 'zz'});
  accepts('ApplyEmployeeImportRequest', {...base, jobId: 'j', planHash: 'f'.repeat(64)});
});

test('responses', () => {
  accepts('RemoveEventPhotoResponse', {contractVersion: 1, photoId: 'u_0', removed: true, commentsRemoved: 2, objectRemoved: true});
  accepts('RemoveEventPhotoCommentResponse', {contractVersion: 1, commentId: 'c', removed: true, commentCount: 1});
  accepts('AddEventAttendeeResponse', {contractVersion: 1, eventId: 'e', userId: 'u', added: true, attendeeCount: 3, capacity: 3, capacityOverridden: true, notified: false});
  accepts('RemoveEventAttendeeResponse', {contractVersion: 1, eventId: 'e', userId: 'u', removed: true, attendeeCount: 2, notified: false});
  accepts('RecordAttendanceResponse', {contractVersion: 1, eventId: 'e', userId: 'u', pointsAwarded: 0, checkedIn: true, changed: false});
  accepts('UpdateMemberResponse', {contractVersion: 1, userId: 'u', revision: 0, changedFields: []});
  accepts('SetMemberStatusResponse', {contractVersion: 1, userId: 'u', status: 'deactivated', changed: true, rsvpsCancelled: 2, revision: 4});
  accepts('ImportEmployeesResponse', {contractVersion: 1, jobId: 'j', status: 'planned', planHash: 'a'.repeat(64), chunkCount: 1,
    totals: {total: 1, create: 1, update: 0, unchanged: 0, invalid: 0},
    rows: [{rowNumber: 1, email: 'a@acme.com', action: 'create', target: 'roster', changes: [{field: 'role', before: null, after: 'member'}], errors: []}]});
  accepts('ApplyEmployeeImportResponse', {contractVersion: 1, jobId: 'j', status: 'running', done: false,
    progress: {processed: 100, total: 250, created: 90, updated: 5, unchanged: 3, failed: 2}, results: [{rowNumber: 1, email: 'a@acme.com', outcome: 'created'}]});
  const member = {userId: 'u', email: 'a@acme.com', displayName: 'Ada', avatarId: '', photoURL: '', role: 'admin', status: 'active', department: '', jobTitle: '', city: '',
    workLocation: 'HQ', teamIds: [], revision: 0, createdAt: '2026-11-10T12:00:00Z'};
  accepts('AdminMemberSummary', member);
  accepts('AdminMemberSummary', {...member, pointsBalance: 10});
  rejects('AdminMemberSummary', {...member, interestTagIds: []}, 'private profile data');
  accepts('ListMembersResponse', {contractVersion: 1, members: [member], nextPageToken: 'abc'});
  accepts('GetEmployeeImportResponse', {contractVersion: 1, job: {companyId: 'acme', status: 'completed', totals: {total: 0, create: 0, update: 0, unchanged: 0, invalid: 0},
    progress: {processed: 0, total: 0, created: 0, updated: 0, unchanged: 0, failed: 0}, planHash: 'a'.repeat(64), chunkCount: 0, nextChunk: 0, errors: [], errorsTruncated: false,
    createdBy: 'u', createdAt: '2026-11-10T12:00:00Z', updatedAt: '2026-11-10T12:00:00Z'}});
});
