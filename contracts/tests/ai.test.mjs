import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

// AI event draft types (docs/contracts/admin.md#ai-event-drafts-aigenerate-admin-only). Inline examples keep the shared happy-path fixture untouched.
const schema = JSON.parse(readFileSync(new URL('../v1/models.schema.json', import.meta.url)));
const ajv = new Ajv({strict: true});
addFormats(ajv);
const validate = name => ajv.compile({...schema, $ref: `#/$defs/${name}`});
const uuid = '3f2b8c1e-5a4d-4e6f-9a7b-1c2d3e4f5a6b';

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

const choices = {focusTagIds: ['hiking'], goal: 'team_bonding', groupSize: 'team', setting: 'outdoors', budget: 'free', timing: 'after_work'};
const request = {contractVersion: 1, companyId: 'acme', requestId: uuid, choices, prompt: '', count: 2};
const draft = {title: 'Lunch walk', description: 'A relaxed walk.', tagIds: ['hiking'], coverImageURL: 'catalog://default/outdoors', suggestedDaypart: 'weekday_lunch',
  durationMinutes: 60, venueType: 'park_or_outdoors', venueSearchHint: 'park near office', costCents: 0, costNote: 'Free', capacity: 20, isOutdoor: true, rationale: 'Many hikers.'};
const usage = {monthlyGenerationLimit: 30, monthlyGenerationsUsed: 1, dailyGenerationLimit: 10, dailyGenerationsUsed: 1, generationsRemaining: 9};
const credits = {creditsAllowance: 500, creditsUsed: 88, creditsRemaining: 412, resetsAt: '2026-12-01T08:00:00.000Z', creditCost: {suggest: 1, generate: 10, regenerate: 10, weeklyEmail: 3}};
const context = {contractVersion: 1, enabled: true, interestDataAvailable: true, topInterests: [{tagId: 'hiking', bucket: '10-19'}], thinInterestTagIds: ['chess'], usage, credits};

test('AiInterestTag uses suppressed buckets only', () => {
  for (const bucket of ['5-9', '10-19', '20+']) accepts('AiInterestTag', {tagId: 'hiking', bucket});
  for (const bucket of ['1-4', '0', '7', 7, '']) rejects('AiInterestTag', {tagId: 'hiking', bucket});
  rejects('AiInterestTag', {tagId: 'hiking', bucket: '5-9', count: 7});
  rejects('AiInterestTag', {tagId: '', bucket: '5-9'});
});

test('AiIdeaTheme and AiUsageSummary are strict', () => {
  accepts('AiIdeaTheme', {title: 'Move more', tagIds: []});
  rejects('AiIdeaTheme', {title: '', tagIds: []});
  rejects('AiIdeaTheme', {title: 'x'.repeat(121), tagIds: []});
  rejects('AiIdeaTheme', {title: 'Move more', tagIds: Array(11).fill('t')});
  accepts('AiUsageSummary', usage);
  accepts('AiUsageSummary', {...usage, monthlyGenerationLimit: 0, generationsRemaining: 0});
  for (const key of ['monthlyGenerationLimit', 'monthlyGenerationsUsed', 'dailyGenerationLimit', 'dailyGenerationsUsed', 'generationsRemaining']) {
    rejects('AiUsageSummary', {...usage, [key]: -1}, `negative ${key}`);
  }
  rejects('AiUsageSummary', {...usage, budgetExhausted: false}, 'the budget flag is no longer part of the contract');
  rejects('AiUsageSummary', {...usage, extra: 1});
});

test('GetEventIdeaContextRequest and Response', () => {
  accepts('GetEventIdeaContextRequest', {contractVersion: 1, companyId: 'acme'});
  rejects('GetEventIdeaContextRequest', {contractVersion: 1, companyId: 'acme', requestId: uuid});
  rejects('GetEventIdeaContextRequest', {contractVersion: 2, companyId: 'acme'});
  rejects('GetEventIdeaContextRequest', {contractVersion: 1});
  accepts('GetEventIdeaContextResponse', context);
  accepts('GetEventIdeaContextResponse', {...context, currentTheme: {title: 'Move more', tagIds: ['hiking']}});
  accepts('GetEventIdeaContextResponse', {...context, enabled: false, interestDataAvailable: false, topInterests: [], thinInterestTagIds: []});
  rejects('GetEventIdeaContextResponse', {...context, topInterests: Array(9).fill({tagId: 'hiking', bucket: '5-9'})});
  rejects('GetEventIdeaContextResponse', {...context, thinInterestTagIds: Array(51).fill('t')});
  rejects('GetEventIdeaContextResponse', {...context, currentTheme: {title: 'Move more'}});
  rejects('GetEventIdeaContextResponse', without(context, 'usage'), 'missing usage');
  rejects('GetEventIdeaContextResponse', without(context, 'credits'), 'missing credits');
  rejects('GetEventIdeaContextResponse', {...context, extra: true});
});

test('AiEventChoices accepts every enum value and rejects others', () => {
  accepts('AiEventChoices', choices);
  accepts('AiEventChoices', {...choices, focusTagIds: []});
  accepts('AiEventChoices', {...choices, focusTagIds: ['a', 'b', 'c']});
  rejects('AiEventChoices', {...choices, focusTagIds: ['a', 'b', 'c', 'd']}, 'four focus tags');
  rejects('AiEventChoices', {...choices, focusTagIds: ['a', 'a']}, 'duplicate focus tags');
  const enums = {
    goal: ['team_bonding', 'wellness', 'learning', 'give_back', 'celebrate', 'competition'],
    groupSize: ['small', 'team', 'company'],
    setting: ['indoors', 'outdoors', 'offsite'],
    budget: ['free', 'under_15', 'from_15_to_50', 'over_50'],
    timing: ['weekday_lunch', 'after_work', 'weekend'],
  };
  for (const [key, values] of Object.entries(enums)) {
    for (const value of values) accepts('AiEventChoices', {...choices, [key]: value});
    rejects('AiEventChoices', {...choices, [key]: 'other'}, `${key} outside enum`);
    rejects('AiEventChoices', without(choices, key), `missing ${key}`);
  }
  rejects('AiEventChoices', {...choices, note: 'free text'});
});

test('GenerateEventDraftsRequest bounds', () => {
  accepts('GenerateEventDraftsRequest', request);
  for (const count of [1, 2, 3]) accepts('GenerateEventDraftsRequest', {...request, count});
  for (const count of [0, 4, 1.5, '2']) rejects('GenerateEventDraftsRequest', {...request, count});
  accepts('GenerateEventDraftsRequest', {...request, prompt: 'x'.repeat(500)});
  rejects('GenerateEventDraftsRequest', {...request, prompt: 'x'.repeat(501)});
  for (const requestId of ['req-12345678', 'not-a-uuid', '']) rejects('GenerateEventDraftsRequest', {...request, requestId});
  rejects('GenerateEventDraftsRequest', {...request, extra: 1});
  rejects('GenerateEventDraftsRequest', {...request, choices: {...choices, focusTagIds: ['a', 'a']}});
  for (const key of ['companyId', 'requestId', 'choices', 'prompt', 'count']) {
    rejects('GenerateEventDraftsRequest', without(request, key), `missing ${key}`);
  }
});

test('GeneratedEventDraft bounds', () => {
  accepts('GeneratedEventDraft', draft);
  accepts('GeneratedEventDraft', {...draft, title: 'x'.repeat(120), description: 'x'.repeat(2000), rationale: 'x'.repeat(160)});
  rejects('GeneratedEventDraft', {...draft, title: ''});
  rejects('GeneratedEventDraft', {...draft, title: 'x'.repeat(121)});
  rejects('GeneratedEventDraft', {...draft, description: 'x'.repeat(2001)});
  rejects('GeneratedEventDraft', {...draft, tagIds: []});
  accepts('GeneratedEventDraft', {...draft, tagIds: ['a', 'b', 'c', 'd', 'e']});
  rejects('GeneratedEventDraft', {...draft, tagIds: ['a', 'b', 'c', 'd', 'e', 'f']});
  accepts('GeneratedEventDraft', {...draft, coverImageURL: 'catalog://default/lunch'});
  for (const coverImageURL of ['https://example.com/a.jpg', 'gs://bucket/a.jpg', 'catalog://other/a', 'catalog://default/', 'catalog://default/A1', 'events/a.jpg']) {
    rejects('GeneratedEventDraft', {...draft, coverImageURL});
  }
  for (const durationMinutes of [15, 720]) accepts('GeneratedEventDraft', {...draft, durationMinutes});
  for (const durationMinutes of [14, 721]) rejects('GeneratedEventDraft', {...draft, durationMinutes});
  for (const costCents of [0, 100000]) accepts('GeneratedEventDraft', {...draft, costCents});
  for (const costCents of [-1, 100001]) rejects('GeneratedEventDraft', {...draft, costCents});
  rejects('GeneratedEventDraft', {...draft, rationale: ''});
  rejects('GeneratedEventDraft', {...draft, rationale: 'x'.repeat(161)});
  rejects('GeneratedEventDraft', {...draft, capacity: 0});
  rejects('GeneratedEventDraft', {...draft, capacity: 10001});
  rejects('GeneratedEventDraft', {...draft, suggestedDaypart: 'midnight'});
  rejects('GeneratedEventDraft', {...draft, venueType: 'castle'});
  rejects('GeneratedEventDraft', {...draft, venueSearchHint: 'x'.repeat(121)});
  rejects('GeneratedEventDraft', {...draft, costNote: 'x'.repeat(201)});
  rejects('GeneratedEventDraft', {...draft, venueName: 'The Pub'}, 'specific venue');
  rejects('GeneratedEventDraft', {...draft, startTime: '2026-11-10T12:00:00Z'}, 'exact times');
  for (const suggestedDaypart of ['weekday_morning', 'weekday_lunch', 'weekday_afternoon', 'after_work', 'weekend_daytime', 'weekend_evening']) {
    accepts('GeneratedEventDraft', {...draft, suggestedDaypart});
  }
  for (const venueType of ['office', 'park_or_outdoors', 'restaurant_or_cafe', 'activity_venue', 'community_site']) {
    accepts('GeneratedEventDraft', {...draft, venueType});
  }
});

test('GenerateEventDraftsResponse holds 1 to 3 drafts', () => {
  const response = {contractVersion: 1, drafts: [draft], usage, credits, replay: false};
  accepts('GenerateEventDraftsResponse', response);
  accepts('GenerateEventDraftsResponse', {...response, drafts: [draft, draft, draft], replay: true});
  rejects('GenerateEventDraftsResponse', {...response, drafts: []});
  rejects('GenerateEventDraftsResponse', {...response, drafts: [draft, draft, draft, draft]});
  rejects('GenerateEventDraftsResponse', {...response, drafts: [{...draft, title: ''}]});
  rejects('GenerateEventDraftsResponse', {...response, usage: {...usage, dailyGenerationsUsed: -1}});
  rejects('GenerateEventDraftsResponse', without(response, 'replay'), 'missing replay');
  rejects('GenerateEventDraftsResponse', {...response, extra: 1});
});

test('AiCredits carries credits and prices only, never money', () => {
  accepts('AiCredits', credits);
  accepts('AiCredits', {...credits, creditsRemaining: 0, creditsUsed: 500});
  for (const key of ['creditsAllowance', 'creditsUsed', 'creditsRemaining']) rejects('AiCredits', {...credits, [key]: -1}, `negative ${key}`);
  for (const key of Object.keys(credits)) rejects('AiCredits', without(credits, key), `missing ${key}`);
  rejects('AiCredits', {...credits, costUsd: 0.12}, 'no money fields');
  rejects('AiCredits', {...credits, creditCost: {...credits.creditCost, generate: 0.5}});
  rejects('AiCredits', {...credits, creditCost: {...credits.creditCost, extra: 1}});
  accepts('GetEventIdeaSuggestionsResponse', {contractVersion: 1, provider: 'jev', suggestions: [], credits, cached: false});
  rejects('GetEventIdeaSuggestionsResponse', {contractVersion: 1, provider: 'jev', suggestions: [], cached: false}, 'missing credits');
});

test('AiStepSuggestion carries an honest reasonBasis', () => {
  const suggestion = {question: 'goal', value: 'wellness', probability: 0.7, reason: 'A good fit for most workplace groups', reasonBasis: 'generic'};
  accepts('AiStepSuggestion', suggestion);
  accepts('AiStepSuggestion', {...suggestion, reasonBasis: 'company_data'});
  rejects('AiStepSuggestion', {...suggestion, reasonBasis: 'personal'});
  rejects('AiStepSuggestion', without(suggestion, 'reasonBasis'), 'missing reasonBasis');
});

test('GeneratedEventDraft cover accepts legacy defaults and library covers only', () => {
  for (const coverImageURL of ['catalog://default/hiking', 'catalog://cover/kayaking-lake', 'catalog://cover/theme-arts', 'catalog://cover/a1']) {
    accepts('GeneratedEventDraft', {...draft, coverImageURL});
  }
  for (const coverImageURL of ['catalog://cover/', 'catalog://cover/Kayak', 'catalog://cover/a--b', 'catalog://cover/-a', 'catalog://cover/a/b', 'https://example.com/a.jpg', 'catalog://other/x']) {
    rejects('GeneratedEventDraft', {...draft, coverImageURL});
  }
});

test('PickEventCoverRequest and Response bounds', () => {
  const pick = {contractVersion: 1, companyId: 'acme', requestId: uuid, title: 'Sunset kayak trip'};
  accepts('PickEventCoverRequest', pick);
  accepts('PickEventCoverRequest', {...pick, description: 'x'.repeat(5000), tagIds: ['tag-outdoors'], theme: 'outdoors', excludeCoverImageURLs: ['catalog://cover/kayaking-lake', 'catalog://default/games']});
  rejects('PickEventCoverRequest', {...pick, title: ''});
  rejects('PickEventCoverRequest', {...pick, title: 'x'.repeat(121)});
  rejects('PickEventCoverRequest', {...pick, description: 'x'.repeat(5001)});
  rejects('PickEventCoverRequest', {...pick, tagIds: Array.from({length: 11}, (_, i) => `t${i}`)});
  rejects('PickEventCoverRequest', {...pick, theme: 'sports'});
  rejects('PickEventCoverRequest', {...pick, excludeCoverImageURLs: Array(11).fill('catalog://default/games')});
  rejects('PickEventCoverRequest', {...pick, excludeCoverImageURLs: ['https://example.com/a.jpg']});
  rejects('PickEventCoverRequest', {...pick, extra: 1});
  for (const key of ['companyId', 'requestId', 'title']) rejects('PickEventCoverRequest', without(pick, key), `missing ${key}`);

  const response = {contractVersion: 1, coverImageURL: 'catalog://cover/kayaking-lake', source: 'dipbot', provider: 'jev', alternatives: ['catalog://default/outdoors']};
  accepts('PickEventCoverResponse', response);
  for (const source of ['match', 'default']) accepts('PickEventCoverResponse', {...response, source});
  for (const provider of ['openai', 'heuristic', null]) accepts('PickEventCoverResponse', {...response, provider});
  rejects('PickEventCoverResponse', {...response, provider: 'gemini'});
  rejects('PickEventCoverResponse', {...response, source: 'random'});
  rejects('PickEventCoverResponse', {...response, alternatives: Array(5).fill('catalog://default/games')});
  rejects('PickEventCoverResponse', {...response, coverImageURL: 'https://x.test/a.jpg'});
  rejects('PickEventCoverResponse', without(response, 'alternatives'), 'missing alternatives');
});
