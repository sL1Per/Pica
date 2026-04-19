#!/usr/bin/env node
/**
 * M3 smoke tests — employees storage layer.
 * Built-in `assert` only, no test framework.
 *
 * Run:  node tests/test-employees.mjs
 */

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createEmployeesStore,
  EMPLOYEE_EDITABLE,
  ALL_EDITABLE,
} from '../src/storage/employees.js';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-emp-'));
const masterKey = randomBytes(32);

try {
  const store = createEmployeesStore(tmpDir, masterKey);
  const aliceId = 'alice-uuid-12345';
  const bobId   = 'bob-uuid-67890';

  // --------------------------------------------------------------------------
  console.log('Construction');
  // --------------------------------------------------------------------------

  await test('requires a 32-byte master key', () => {
    assert.throws(() => createEmployeesStore(tmpDir, randomBytes(16)));
    assert.throws(() => createEmployeesStore(tmpDir, 'not-a-buffer'));
  });

  await test('creates employees directory under dataDir', () => {
    assert.ok(fs.existsSync(path.join(tmpDir, 'employees')));
  });

  // --------------------------------------------------------------------------
  console.log('\nProfile CRUD');
  // --------------------------------------------------------------------------

  await test('exists returns false before create', () => {
    assert.equal(store.exists(aliceId), false);
  });

  await test('readProfile returns null for missing id', () => {
    assert.equal(store.readProfile(aliceId), null);
  });

  await test('create writes an encrypted profile', () => {
    const p = store.create(aliceId, {
      fullName: 'Alice Lopes',
      age: 29,
      position: 'Engineer',
      contactEmail: 'alice@example.com',
      contactPhone: '+351 912 345 678',
      address: 'Rua X',
      comments: 'HR notes here',
    });
    assert.equal(p.id, aliceId);
    assert.equal(p.fullName, 'Alice Lopes');
    assert.equal(p.age, 29);
    assert.ok(p.createdAt);
    assert.ok(p.updatedAt);
  });

  await test('on-disk profile file is NOT plaintext JSON', () => {
    const filePath = path.join(tmpDir, 'employees', `${aliceId}.json`);
    const bytes = fs.readFileSync(filePath);
    // Can't parse as JSON — it's ciphertext.
    assert.throws(() => JSON.parse(bytes.toString('utf8')));
    // Also shouldn't contain the plaintext needle:
    assert.equal(bytes.includes(Buffer.from('Alice Lopes')), false);
  });

  await test('readProfile round-trips all fields', () => {
    const p = store.readProfile(aliceId);
    assert.equal(p.fullName, 'Alice Lopes');
    assert.equal(p.age, 29);
    assert.equal(p.position, 'Engineer');
    assert.equal(p.contactEmail, 'alice@example.com');
    assert.equal(p.contactPhone, '+351 912 345 678');
    assert.equal(p.address, 'Rua X');
    assert.equal(p.comments, 'HR notes here');
  });

  await test('create refuses duplicate ids', () => {
    assert.throws(() => store.create(aliceId, { fullName: 'x' }), /already exists/);
  });

  await test('update merges fields and bumps updatedAt', async () => {
    const before = store.readProfile(aliceId).updatedAt;
    await new Promise((r) => setTimeout(r, 5)); // ensure clock tick
    const p = store.update(aliceId, { fullName: 'Alice M. Lopes' });
    assert.equal(p.fullName, 'Alice M. Lopes');
    assert.equal(p.age, 29);               // other fields preserved
    assert.equal(p.position, 'Engineer');
    assert.notEqual(p.updatedAt, before);
  });

  await test('update with employee allowlist drops employer-only fields', () => {
    const before = store.readProfile(aliceId);
    store.update(aliceId, {
      fullName: 'Alice Self-Edit',
      position: 'Self-Promoted CEO',
      comments: 'I am the boss now',
    }, EMPLOYEE_EDITABLE);
    const after = store.readProfile(aliceId);
    assert.equal(after.fullName, 'Alice Self-Edit');
    assert.equal(after.position, before.position); // unchanged
    assert.equal(after.comments, before.comments); // unchanged
  });

  await test('update with employer allowlist allows all fields', () => {
    store.update(aliceId, {
      position: 'Senior Engineer',
      comments: 'Promoted',
    }, ALL_EDITABLE);
    const p = store.readProfile(aliceId);
    assert.equal(p.position, 'Senior Engineer');
    assert.equal(p.comments, 'Promoted');
  });

  await test('update on non-existent id creates the profile', () => {
    const p = store.update(bobId, { fullName: 'Bob Silva' });
    assert.equal(p.fullName, 'Bob Silva');
    assert.ok(p.createdAt);
  });

  await test('update ignores keys outside the allowlist (e.g. invented ones)', () => {
    store.update(aliceId, { isAdmin: true, salary: 99999 });
    const p = store.readProfile(aliceId);
    assert.equal(p.isAdmin, undefined);
    assert.equal(p.salary, undefined);
  });

  // --------------------------------------------------------------------------
  console.log('\nPictures');
  // --------------------------------------------------------------------------

  const fakeJpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff]), // JPEG magic
    randomBytes(1024),
  ]);

  await test('hasPicture is false before upload', () => {
    assert.equal(store.hasPicture(aliceId), false);
  });

  await test('readPicture returns null before upload', () => {
    assert.equal(store.readPicture(aliceId), null);
  });

  await test('writePicture + readPicture round-trips exact bytes', () => {
    store.writePicture(aliceId, fakeJpeg);
    const out = store.readPicture(aliceId);
    assert.deepEqual(out, fakeJpeg);
  });

  await test('picture file on disk is NOT the raw JPEG', () => {
    const filePath = path.join(tmpDir, 'employees', `${aliceId}.picture`);
    const bytes = fs.readFileSync(filePath);
    // Must NOT start with JPEG magic after encryption
    assert.notEqual(bytes[0], 0xff);
  });

  await test('writePicture rejects non-buffer', () => {
    assert.throws(() => store.writePicture(aliceId, 'not a buffer'));
  });

  await test('deletePicture removes the file', () => {
    store.deletePicture(aliceId);
    assert.equal(store.hasPicture(aliceId), false);
    assert.equal(store.readPicture(aliceId), null);
  });

  await test('deletePicture on missing picture is a no-op', () => {
    store.deletePicture('no-such-id'); // must not throw
  });

  // --------------------------------------------------------------------------
  console.log('\nAAD binding — ciphertext swap prevention');
  // --------------------------------------------------------------------------

  await test('swapping ciphertexts between records is detected', () => {
    // Write pictures to both alice and bob.
    const alicePic = Buffer.concat([Buffer.from([0xff, 0xd8]), randomBytes(64)]);
    const bobPic   = Buffer.concat([Buffer.from([0xff, 0xd8]), randomBytes(64)]);
    store.writePicture(aliceId, alicePic);
    store.writePicture(bobId, bobPic);

    // Swap the on-disk files.
    const aliceFile = path.join(tmpDir, 'employees', `${aliceId}.picture`);
    const bobFile   = path.join(tmpDir, 'employees', `${bobId}.picture`);
    const aliceBlob = fs.readFileSync(aliceFile);
    const bobBlob   = fs.readFileSync(bobFile);
    fs.writeFileSync(aliceFile, bobBlob);
    fs.writeFileSync(bobFile, aliceBlob);

    // Reading now fails due to AAD mismatch — the ciphertext was encrypted
    // with "employee:<bobId>" but we're trying to decrypt it as alice's.
    assert.throws(() => store.readPicture(aliceId));
    assert.throws(() => store.readPicture(bobId));

    // Clean up.
    store.deletePicture(aliceId);
    store.deletePicture(bobId);
  });

  // --------------------------------------------------------------------------
  console.log('\nList + remove');
  // --------------------------------------------------------------------------

  await test('list returns summary for every stored profile', () => {
    const rows = store.list();
    assert.equal(rows.length, 2);
    const ids = rows.map((r) => r.id).sort();
    assert.deepEqual(ids, [aliceId, bobId].sort());
  });

  await test('list entries include fullName, position, hasPicture', () => {
    const rows = store.list();
    const alice = rows.find((r) => r.id === aliceId);
    assert.equal(alice.fullName, 'Alice Self-Edit');
    assert.equal(alice.position, 'Senior Engineer');
    assert.equal(alice.hasPicture, false);
  });

  await test('list skips unreadable files without throwing', () => {
    // Drop a corrupt file into the dir.
    const bad = path.join(tmpDir, 'employees', 'corrupt-id.json');
    fs.writeFileSync(bad, 'not-actually-ciphertext');
    const rows = store.list();
    // Still returns the two good ones.
    assert.equal(rows.length, 2);
    fs.unlinkSync(bad);
  });

  await test('remove deletes profile and picture files', () => {
    // Re-attach a picture to alice first.
    store.writePicture(aliceId, fakeJpeg);
    store.remove(aliceId);
    assert.equal(store.exists(aliceId), false);
    assert.equal(store.hasPicture(aliceId), false);
    const empDir = path.join(tmpDir, 'employees');
    assert.equal(fs.existsSync(path.join(empDir, `${aliceId}.json`)), false);
    assert.equal(fs.existsSync(path.join(empDir, `${aliceId}.picture`)), false);
  });

  await test('remove on non-existent id is a no-op', () => {
    store.remove('never-existed'); // must not throw
  });

  // --------------------------------------------------------------------------
  console.log('\nPersistence across stores');
  // --------------------------------------------------------------------------

  await test('second store with same key can read existing profiles', () => {
    const fresh = createEmployeesStore(tmpDir, masterKey);
    const p = fresh.readProfile(bobId);
    assert.ok(p);
    assert.equal(p.fullName, 'Bob Silva');
  });

  await test('second store with DIFFERENT key cannot read profiles', () => {
    const otherKey = randomBytes(32);
    const wrong = createEmployeesStore(tmpDir, otherKey);
    assert.throws(() => wrong.readProfile(bobId));
  });

} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log('');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
