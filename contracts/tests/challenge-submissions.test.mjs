import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

// Challenge submissions (submitChallengeV1, approve/reject/list). Inline examples keep the shared fixture untouched.
const schema = JSON.parse(readFileSync(new URL('../v1/models.schema.json', import.meta.url)));
const ajv = new Ajv({strict: true});
addFormats(ajv);
const validate = name => ajv.compile({...schema, $ref: `#/$defs/${name}`});
const submission = {companyId: 'c', challengeId: 'w1', userId: 'u', userName: 'Avery', userAvatarId: 'a1', caption: '',
  progress: 3, status: 'submitted', createdAt: '2026-11-11T10:00:00Z', updatedAt: '2026-11-11T10:00:00Z'};

test('ChallengeSubmission keeps legacy documents valid and accepts the server-owned review fields', () => {
  const check = validate('ChallengeSubmission');
  assert.equal(check(submission), true, JSON.stringify(check.errors));
  const full = {...submission, photoURL: null, storagePath: 'companies/c/challenges/w1/submissions/u/0', contentType: 'image/jpeg',
    sizeBytes: 2048, attempt: 2, reviewedBy: 'boss', reviewedAt: '2026-11-12T10:00:00Z', reviewNote: 'Blurry', pointsAwarded: 0};
  assert.equal(check(full), true, JSON.stringify(check.errors));
  assert.equal(check({...submission, storagePath: null, reviewedBy: null, reviewedAt: null, reviewNote: null}), true);
  for (const patch of [{status: 'pending'}, {contentType: 'image/gif'}, {pointsAwarded: -1}, {attempt: 0}, {likes: 1}]) {
    assert.equal(check({...submission, ...patch}), false, JSON.stringify(patch));
  }
});

test('SubmitChallengeRequest is strict: no status, points or user from the client', () => {
  const check = validate('SubmitChallengeRequest');
  const request = {contractVersion: 1, companyId: 'c', challengeId: 'w1', progress: 3.5, caption: 'Ran', storagePath: 'companies/c/challenges/w1/submissions/u/0'};
  assert.equal(check(request), true, JSON.stringify(check.errors));
  const {caption, storagePath, ...minimal} = request;
  assert.equal(check(minimal), true);
  for (const patch of [{progress: 0}, {progress: 10001}, {status: 'approved'}, {pointsAwarded: 5}, {userId: 'x'}, {caption: 'x'.repeat(281)}, {contractVersion: 2}, {challengeId: 'a/b'}]) {
    assert.equal(check({...request, ...patch}), false, JSON.stringify(patch));
  }
  const response = validate('SubmitChallengeResponse');
  assert.equal(response({contractVersion: 1, submissionId: 'w1_u', status: 'submitted', outcome: 'resubmitted', attempt: 2}), true);
  assert.equal(response({contractVersion: 1, submissionId: 'w1_u', status: 'submitted', outcome: 'maybe', attempt: 2}), false);
});

test('review requests and the organizer list are strict', () => {
  const approve = validate('ApproveChallengeRequest');
  assert.equal(approve({contractVersion: 1, companyId: 'c', challengeId: 'w1', userId: 'u'}), true);
  assert.equal(approve({contractVersion: 1, companyId: 'c', challengeId: 'w1', userId: 'u', points: 9999}), false);
  assert.equal(approve({contractVersion: 1, companyId: 'c', challengeId: 'w1', userId: 'u', expectedUpdatedAt: '2026-11-12T10:00:00Z'}), true);
  assert.equal(approve({contractVersion: 1, companyId: 'c', challengeId: 'w1', userId: 'u', expectedUpdatedAt: 'yesterday'}), false);
  assert.equal(validate('ApproveChallengeResponse')({contractVersion: 1, submissionId: 'w1_u', pointsAwarded: 0, replayed: true}), true);
  const reject = validate('RejectChallengeRequest');
  assert.equal(reject({contractVersion: 1, companyId: 'c', challengeId: 'w1', userId: 'u', reason: 'Blurry'}), true);
  assert.equal(reject({contractVersion: 1, companyId: 'c', challengeId: 'w1', userId: 'u', reason: ''}), false);
  assert.equal(reject({contractVersion: 1, companyId: 'c', challengeId: 'w1', userId: 'u'}), false);
  assert.equal(validate('RejectChallengeResponse')({contractVersion: 1, submissionId: 'w1_u', status: 'rejected', replayed: false}), true);
  const list = validate('ListChallengeSubmissionsRequest');
  assert.equal(list({contractVersion: 1, companyId: 'c', challengeId: 'w1', status: 'submitted', limit: 50, cursor: 'w1_u'}), true);
  assert.equal(list({contractVersion: 1, companyId: 'c', challengeId: 'w1', limit: 51}), false);
  const response = validate('ListChallengeSubmissionsResponse');
  assert.equal(response({contractVersion: 1, submissions: [submission], nextCursor: null}), true);
  assert.equal(response({contractVersion: 1, submissions: [{...submission, status: 'x'}], nextCursor: null}), false);
});
