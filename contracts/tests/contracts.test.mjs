import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
const schema = JSON.parse(readFileSync(new URL('../v1/models.schema.json', import.meta.url)));
const fixtures = JSON.parse(readFileSync(new URL('../v1/fixtures/happy-path.json', import.meta.url)));
const ajv = new Ajv({strict: true});
addFormats(ajv);
const validate = name => ajv.compile({...schema, $ref: `#/$defs/${name}`});
for (const [key, fixture] of Object.entries(fixtures)) {
  const name = key[0].toUpperCase() + key.slice(1);
  test(`${name} shared fixture satisfies the wire schema`, () => {
    const check = validate(name);
    assert.equal(check(fixture), true, JSON.stringify(check.errors));
  });
}
test('RSVP boundary rejects spoofed identity, invalid enum, path injection and version', () => {
  const check = validate('SetRsvpRequest');
  for (const patch of [{userId:'someone-else'}, {status:'approved'}, {companyId:'a/b'}, {contractVersion:2}, {eventId:''}]) {
    assert.equal(check({...fixtures.setRsvpRequest, ...patch}), false);
  }
});
test('event command rejects server-owned fields and malformed dates', () => {
  const check = validate('CreateEventRequest');
  assert.equal(check({...fixtures.createEventRequest, event:{...fixtures.createEventRequest.event, attendeeCount:999}}), false);
  assert.equal(check({...fixtures.createEventRequest, event:{...fixtures.createEventRequest.event, startTime:'tomorrow'}}), false);
});
