import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

// Backend i18n (issue #259, docs/design/backend-i18n.md): every change is additive and optional.
const schema = JSON.parse(readFileSync(new URL('../v1/models.schema.json', import.meta.url)));
const ajv = new Ajv({strict: true});
addFormats(ajv);
const validate = name => ajv.compile({...schema, $ref: `#/$defs/${name}`});
const accepts = (name, value) => { const check = validate(name); assert.equal(check(value), true, `${name}: ${JSON.stringify(check.errors)}`); };
const rejects = (name, value, label = '') => assert.equal(validate(name)(value), false, `${name} should reject ${label || JSON.stringify(value)}`);

const user = {companyId: 'acme', displayName: 'Ada', email: 'a@acme.com', photoURL: '', avatarId: '', department: '', jobTitle: '', city: '', role: 'member',
  interestTagIds: [], travelRadiusMiles: 20, availability: [], friendIds: [], favoritePhotoIds: [], pointsBalance: 0, createdAt: '2026-11-10T12:00:00Z'};
const audit = {companyId: 'acme', actorId: 'u', actorName: 'Ada', actorRole: 'admin', action: 'roster.upsert', targetType: 'roster', targetId: 'r1',
  summary: 'Invited mia@acme.com', changes: [], createdAt: '2026-11-10T12:00:00Z'};

test('AppUser.locale is optional and limited to the supported languages', () => {
  accepts('AppUser', user);
  accepts('AppUser', {...user, locale: 'en'});
  accepts('AppUser', {...user, locale: 'es'});
  for (const locale of ['fr', 'ES', 'es-MX', '', null, 1]) rejects('AppUser', {...user, locale}, `locale ${JSON.stringify(locale)}`);
});

test('setMyLocaleV1 request and response are strict', () => {
  accepts('SetMyLocaleRequest', {contractVersion: 1, locale: 'es'});
  rejects('SetMyLocaleRequest', {contractVersion: 1, locale: 'fr'});
  rejects('SetMyLocaleRequest', {contractVersion: 2, locale: 'es'});
  rejects('SetMyLocaleRequest', {contractVersion: 1});
  rejects('SetMyLocaleRequest', {contractVersion: 1, locale: 'es', uid: 'someone-else'}, 'a supplied uid');
  rejects('SetMyLocaleRequest', {contractVersion: 1, locale: 'es', companyId: 'acme'}, 'a supplied companyId');
  accepts('SetMyLocaleResponse', {contractVersion: 1, locale: 'es', changed: true});
  rejects('SetMyLocaleResponse', {contractVersion: 1, locale: 'es'});
});

test('AuditEntry keeps old entries valid and accepts an optional summary key with params', () => {
  accepts('AuditEntry', audit);
  accepts('AuditEntry', {...audit, summaryKey: 'roster.invite', summaryParams: [{name: 'email', value: 'mia@acme.com'}]});
  accepts('AuditEntry', {...audit, summaryKey: 'import.apply', summaryParams: [{name: 'created', value: '3'}, {name: 'updated', value: '0'}]});
  rejects('AuditEntry', {...audit, summaryKey: 'Roster.Invite'}, 'an upper-case key');
  rejects('AuditEntry', {...audit, summaryKey: 'roster invite'}, 'a key with a space');
  rejects('AuditEntry', {...audit, summaryParams: [{name: 'count', value: 3}]}, 'a number value');
  rejects('AuditEntry', {...audit, summaryParams: [{name: 'x', value: 'y', extra: 1}]}, 'an extra param field');
  rejects('AuditEntry', {...audit, summaryParams: Array.from({length: 11}, (_, i) => ({name: `p${i}`, value: ''}))}, 'eleven params');
});
