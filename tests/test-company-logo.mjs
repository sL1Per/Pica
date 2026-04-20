#!/usr/bin/env node
/**
 * M8a tests — company-logo storage.
 *
 * Run:  node tests/test-company-logo.mjs
 */

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createCompanyLogoStore } from '../src/storage/company-logo.js';

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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-logo-'));
const masterKey = randomBytes(32);

try {
  const store = createCompanyLogoStore(tmpDir, masterKey);

  // --------------------------------------------------------------------------
  console.log('Construction');
  // --------------------------------------------------------------------------

  await test('requires a 32-byte master key', () => {
    assert.throws(() => createCompanyLogoStore(tmpDir, randomBytes(16)));
    assert.throws(() => createCompanyLogoStore(tmpDir, 'not-a-buffer'));
  });

  // --------------------------------------------------------------------------
  console.log('\nRead / write / delete');
  // --------------------------------------------------------------------------

  await test('exists() is false before upload', () => {
    assert.equal(store.exists(), false);
  });

  await test('read() returns null before upload', () => {
    assert.equal(store.read(), null);
  });

  const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const logo = Buffer.concat([pngMagic, randomBytes(512)]);

  await test('write() then read() round-trips exact bytes', () => {
    store.write(logo);
    const out = store.read();
    assert.deepEqual(out, logo);
  });

  await test('exists() is true after write', () => {
    assert.equal(store.exists(), true);
  });

  await test('on-disk file is NOT the raw PNG', () => {
    const bytes = fs.readFileSync(store.path);
    // First byte should not be PNG magic after encryption.
    assert.notEqual(bytes[0], 0x89);
  });

  await test('on-disk file has mode 0600', () => {
    const stat = fs.statSync(store.path);
    assert.equal(stat.mode & 0o777, 0o600);
  });

  await test('write() rejects non-buffer', () => {
    assert.throws(() => store.write('not a buffer'));
    assert.throws(() => store.write(null));
  });

  await test('write() overwrites existing logo', () => {
    const second = Buffer.concat([pngMagic, randomBytes(1024)]);
    store.write(second);
    const out = store.read();
    assert.equal(out.length, second.length);
    assert.deepEqual(out, second);
  });

  await test('remove() deletes the file', () => {
    store.remove();
    assert.equal(store.exists(), false);
    assert.equal(store.read(), null);
  });

  await test('remove() is idempotent', () => {
    store.remove(); // no-op, must not throw
    store.remove();
  });

  // --------------------------------------------------------------------------
  console.log('\nAAD binding — key mismatch prevents decryption');
  // --------------------------------------------------------------------------

  await test('reading with the wrong master key fails', () => {
    store.write(logo);
    const wrong = createCompanyLogoStore(tmpDir, randomBytes(32));
    assert.throws(() => wrong.read());
  });

  await test('reading with the correct master key still succeeds', () => {
    const out = store.read();
    assert.deepEqual(out, logo);
  });

  // --------------------------------------------------------------------------
  console.log('\nPersistence across instances');
  // --------------------------------------------------------------------------

  await test('second store with same key reads the logo', () => {
    const fresh = createCompanyLogoStore(tmpDir, masterKey);
    const out = fresh.read();
    assert.deepEqual(out, logo);
  });

} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log('');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
