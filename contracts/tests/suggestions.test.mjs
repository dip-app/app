import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

// Admin weekly ideas email types (docs/contracts/admin.md#weekly-ideas-email-aigenerate-admin-only). Inline examples keep the shared happy-path fixture untouched.
const schema = JSON.parse(readFileSync(new URL('../v1/models.schema.json', import.meta.url)));
const ajv = new Ajv({strict: true});
addFormats(ajv);
const validate = name => ajv.compile({...schema, $ref: `#/$defs/${name}`});

function accepts(name, value) {
  const check = validate(name);
  assert.equal(check(value), true, `${name}: ${JSON.stringify(check.errors)}`);
}
function rejects(name, value, label = '') {
  assert.equal(validate(name)(value), false, `${name} should reject ${label || JSON.stringify(value)}`);
}
function without(value, key) {
  const copy = {...value};
  delete copy[key];
  return copy;
}

const schedule = {weekday: 1, hour: 9};
const draft = {title: 'Lunch walk', description: 'A relaxed walk.', tagIds: ['hiking'], coverImageURL: 'catalog://default/outdoors', suggestedDaypart: 'weekday_lunch',
  durationMinutes: 60, venueType: 'park_or_outdoors', venueSearchHint: 'park near office', costCents: 0, costNote: 'Free', capacity: 20, isOutdoor: true, rationale: 'Many hikers.'};
const preview = {subject: 'Your event ideas for the week of Dec 1', preheader: 'Top pick: Winter trail walk', html: '<p>x</p>', text: 'x', engine: 'heuristic', ideaCount: 4, dataLevel: 'some'};
const status = {contractVersion: 1, subscribed: false, emailEnabled: true, aiEnabled: false, schedule, timeZone: 'America/New_York', nextSendAt: '2026-12-01T14:00:00Z'};

test('EmailCategoryPreferences accepts admin_suggestions as a boolean only', () => {
  accepts('EmailCategoryPreferences', {admin_suggestions: true});
  rejects('EmailCategoryPreferences', {admin_suggestions: 'yes'});
  rejects('PushCategoryPreferences', {admin_suggestions: true});
});

test('SuggestionsEmailAction and SuggestionsEmailSchedule are strict', () => {
  for (const action of ['status', 'preview', 'sendTest', 'subscribe', 'unsubscribe', 'setSchedule']) accepts('SuggestionsEmailAction', action);
  for (const action of ['send', 'Status', '']) rejects('SuggestionsEmailAction', action);
  accepts('SuggestionsEmailSchedule', {weekday: 7, hour: 0});
  accepts('SuggestionsEmailSchedule', {weekday: 1, hour: 23});
  for (const bad of [{weekday: 0, hour: 9}, {weekday: 8, hour: 9}, {weekday: 1, hour: -1}, {weekday: 1, hour: 24}, {weekday: 1.5, hour: 9}, {weekday: 1}, {hour: 9}, {...schedule, minute: 0}]) {
    rejects('SuggestionsEmailSchedule', bad);
  }
});

test('ManageSuggestionsEmailRequest', () => {
  const base = {contractVersion: 1, companyId: 'acme', action: 'status'};
  accepts('ManageSuggestionsEmailRequest', base);
  accepts('ManageSuggestionsEmailRequest', {...base, action: 'setSchedule', schedule});
  rejects('ManageSuggestionsEmailRequest', {...base, contractVersion: 2});
  rejects('ManageSuggestionsEmailRequest', without(base, 'action'), 'missing action');
  rejects('ManageSuggestionsEmailRequest', {...base, action: 'nope'});
  rejects('ManageSuggestionsEmailRequest', {...base, companyId: 'a/b'});
  rejects('ManageSuggestionsEmailRequest', {...base, schedule: {weekday: 9, hour: 9}});
  rejects('ManageSuggestionsEmailRequest', {...base, requestId: 'x'});
});

test('SuggestionsEmailPreview', () => {
  accepts('SuggestionsEmailPreview', preview);
  for (const engine of ['jev', 'openai', 'heuristic']) accepts('SuggestionsEmailPreview', {...preview, engine});
  for (const dataLevel of ['none', 'some', 'rich']) accepts('SuggestionsEmailPreview', {...preview, dataLevel});
  rejects('SuggestionsEmailPreview', {...preview, engine: 'gpt'});
  rejects('SuggestionsEmailPreview', {...preview, dataLevel: 'lots'});
  rejects('SuggestionsEmailPreview', {...preview, ideaCount: 6});
  rejects('SuggestionsEmailPreview', {...preview, ideaCount: -1});
  rejects('SuggestionsEmailPreview', {...preview, subject: 'x'.repeat(201)});
  rejects('SuggestionsEmailPreview', {...preview, html: 'x'.repeat(200001)});
  rejects('SuggestionsEmailPreview', {...preview, text: 'x'.repeat(50001)});
  rejects('SuggestionsEmailPreview', without(preview, 'html'), 'missing html');
});

test('ManageSuggestionsEmailResponse', () => {
  accepts('ManageSuggestionsEmailResponse', status);
  accepts('ManageSuggestionsEmailResponse', {...status, nextSendAt: null});
  accepts('ManageSuggestionsEmailResponse', {...status, preview});
  accepts('ManageSuggestionsEmailResponse', {...status, testQueued: false, testReason: 'TEST_LIMIT'});
  for (const testReason of ['EMAIL_DISABLED', 'NOT_SUBSCRIBED', 'TEST_LIMIT', 'COMPANY_EMAIL_DISABLED']) accepts('ManageSuggestionsEmailResponse', {...status, testReason});
  rejects('ManageSuggestionsEmailResponse', {...status, testReason: 'OTHER'});
  rejects('ManageSuggestionsEmailResponse', {...status, nextSendAt: 'tomorrow'});
  rejects('ManageSuggestionsEmailResponse', {...status, timeZone: 'x'.repeat(65)});
  rejects('ManageSuggestionsEmailResponse', {...status, preview: {...preview, engine: 'x'}});
  for (const key of ['subscribed', 'emailEnabled', 'aiEnabled', 'schedule', 'timeZone', 'nextSendAt']) rejects('ManageSuggestionsEmailResponse', without(status, key), `missing ${key}`);
  rejects('ManageSuggestionsEmailResponse', {...status, extra: 1});
});

test('ResolveSuggestedIdeaRequest and Response', () => {
  const request = {contractVersion: 1, companyId: 'acme', token: 'eyJ2IjoxfQ.c2ln-nature_1'};
  accepts('ResolveSuggestedIdeaRequest', request);
  rejects('ResolveSuggestedIdeaRequest', {...request, token: ''});
  rejects('ResolveSuggestedIdeaRequest', {...request, token: 'a b'});
  rejects('ResolveSuggestedIdeaRequest', {...request, token: 'a/b'});
  rejects('ResolveSuggestedIdeaRequest', {...request, token: 'x'.repeat(1025)});
  rejects('ResolveSuggestedIdeaRequest', without(request, 'companyId'), 'missing companyId');
  rejects('ResolveSuggestedIdeaRequest', {...request, contractVersion: 2});
  const response = {contractVersion: 1, ideaId: 'winter-trail-walk', draft};
  accepts('ResolveSuggestedIdeaResponse', response);
  rejects('ResolveSuggestedIdeaResponse', {...response, ideaId: 'Winter_Trail'});
  rejects('ResolveSuggestedIdeaResponse', {...response, ideaId: 'x'.repeat(65)});
  rejects('ResolveSuggestedIdeaResponse', {...response, draft: {...draft, title: ''}});
  rejects('ResolveSuggestedIdeaResponse', without(response, 'draft'), 'missing draft');
});
