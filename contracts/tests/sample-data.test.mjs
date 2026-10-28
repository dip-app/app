import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
const schema = JSON.parse(readFileSync(new URL('../v1/models.schema.json', import.meta.url)));
const fixture = JSON.parse(readFileSync(new URL('../../gcp/sample-data/v1.json', import.meta.url)));
const ajv = new Ajv({strict:true});
addFormats(ajv);
test('synthetic public seed documents satisfy the shared DTOs', () => {
  for (const doc of fixture.firestoreDocuments) {
    const name = doc.path.startsWith('companyAccess/') ? null : doc.path.includes('/rsvps/') ? 'RSVP' : doc.path.includes('/events/') ? 'Event' : doc.path.startsWith('users/') ? 'AppUser' : doc.path.startsWith('tags/') ? 'Tag' : 'Company';
    if (!name) continue;
    const validate = ajv.compile({...schema, $ref:`#/$defs/${name}`});
    assert.equal(validate(doc.data), true, `${doc.path}: ${JSON.stringify(validate.errors)}`);
  }
  assert.equal(fixture.projectId, 'demo-dip');
});
test('seed refuses missing or unsafe destination settings before connecting', () => {
  const allowed = {GCLOUD_PROJECT:'demo-dip', GOOGLE_CLOUD_PROJECT:'demo-dip', FIRESTORE_EMULATOR_HOST:'127.0.0.1:8080', FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9099'};
  for (const patch of [{GCLOUD_PROJECT:'live-project'}, {GOOGLE_CLOUD_PROJECT:'live-project'}, {FIRESTORE_EMULATOR_HOST:'example.com:8080'}, {FIREBASE_AUTH_EMULATOR_HOST:'example.com:9099'}, {GCLOUD_PROJECT:'',GOOGLE_CLOUD_PROJECT:''}]) {
    const result = spawnSync(process.execPath, ['gcp/scripts/seed.mjs'], {encoding:'utf8', env:{...process.env,...allowed,...patch}});
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Refusing to seed/);
  }
});
