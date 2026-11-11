import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

// Event photo albums (finalizeEventPhotoV1). Inline examples keep the shared happy-path fixture untouched.
const schema = JSON.parse(readFileSync(new URL('../v1/models.schema.json', import.meta.url)));
const ajv = new Ajv({strict: true});
addFormats(ajv);
const validate = name => ajv.compile({...schema, $ref: `#/$defs/${name}`});
const photo = {companyId: 'c', eventId: 'e', eventTitle: 'Boat Ride', eventDate: '2026-11-01T10:00:00Z', uploaderId: 'u',
  uploaderName: 'Avery', uploaderAvatarId: 'a1', storagePath: 'companies/c/events/e/photos/u/0', downloadURL: '',
  caption: '', commentCount: 0, createdAt: '2026-11-01T14:00:00Z'};

test('EventPhoto accepts the optional server-owned size and type; legacy documents stay valid', () => {
  const check = validate('EventPhoto');
  assert.equal(check(photo), true, JSON.stringify(check.errors));
  assert.equal(check({...photo, sizeBytes: 1024, contentType: 'image/jpeg'}), true, JSON.stringify(check.errors));
  assert.equal(check({...photo, contentType: 'image/gif'}), false);
  assert.equal(check({...photo, sizeBytes: 10 * 1024 * 1024 + 1}), false);
  assert.equal(check({...photo, likes: 3}), false);
});

test('FinalizeEventPhotoRequest is strict and slot-addressed', () => {
  const check = validate('FinalizeEventPhotoRequest');
  const request = {contractVersion: 1, companyId: 'c', eventId: 'e', photoId: 'uid123_19',
    storagePath: 'companies/c/events/e/photos/uid123/19', caption: 'On the lake'};
  assert.equal(check(request), true, JSON.stringify(check.errors));
  const {caption, ...withoutCaption} = request;
  assert.equal(check(withoutCaption), true);
  for (const patch of [{photoId: 'uid123_20'}, {photoId: 'uid123'}, {photoId: 'uid123_01'}, {contractVersion: 2},
    {companyId: 'a/b'}, {uploaderId: 'x'}, {commentCount: 1}, {caption: 'x'.repeat(281)}]) {
    assert.equal(check({...request, ...patch}), false, JSON.stringify(patch));
  }
  const response = validate('FinalizeEventPhotoResponse');
  assert.equal(response({contractVersion: 1, photoId: 'uid123_19', created: true}), true);
  assert.equal(response({contractVersion: 1, photoId: 'uid123_19'}), false);
});

test('PhotoComment keeps the supplied shape (client-appended under rules)', () => {
  const check = validate('PhotoComment');
  const comment = {companyId: 'c', photoId: 'u_0', authorId: 'u', authorName: 'Avery', authorAvatarId: 'a1',
    text: 'Great day', createdAt: '2026-11-01T15:00:00Z'};
  assert.equal(check(comment), true, JSON.stringify(check.errors));
  assert.equal(check({...comment, eventId: 'e'}), false);
});
