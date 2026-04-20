#!/usr/bin/env node
/**
 * M7 tests — user-prefs storage.
 * Built-in `assert` only.
 *
 * Run:  node tests/test-user-prefs.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createUserPrefsStore,
  VALID_LANGUAGES,
  VALID_COLOR_MODES,
  DEFAULT_PREFS,
} from '../src/storage/user-prefs.js';

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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-userprefs-'));

try {
  const store = createUserPrefsStore(tmpDir);
  const aliceId = 'alice-uuid';
  const bobId   = 'bob-uuid';

  // ---------------------------------------------------------------------------
  console.log('Defaults + get');
  // ---------------------------------------------------------------------------

  await test('exposes the set of valid languages and color modes', () => {
    assert.deepEqual([...VALID_LANGUAGES], ['en', 'pt']);
    assert.deepEqual([...VALID_COLOR_MODES], ['light', 'dark', 'system']);
  });

  await test('get() returns DEFAULT_PREFS for an unknown user', () => {
    const p = store.get('never-existed');
    assert.deepEqual(p, DEFAULT_PREFS);
    assert.equal(p.language, 'en');
    assert.equal(p.colorMode, 'system');
  });

  await test('file is not created until first write', () => {
    assert.equal(fs.existsSync(store.path), false);
  });

  // ---------------------------------------------------------------------------
  console.log('\nUpdate + persistence');
  // ---------------------------------------------------------------------------

  await test('update() persists a partial patch', () => {
    const p = store.update(aliceId, { colorMode: 'dark' });
    assert.equal(p.colorMode, 'dark');
    assert.equal(p.language, 'en'); // default merged in
  });

  await test('file on disk is valid JSON keyed by user id', () => {
    const raw = fs.readFileSync(store.path, 'utf8');
    const parsed = JSON.parse(raw);
    assert.ok(parsed.prefs[aliceId]);
    assert.equal(parsed.prefs[aliceId].colorMode, 'dark');
  });

  await test('file has restrictive permissions (mode 0600)', () => {
    const stat = fs.statSync(store.path);
    // On some filesystems, mode bits beyond 0777 are irrelevant — mask to match.
    assert.equal(stat.mode & 0o777, 0o600);
  });

  await test('update() is additive — later patch preserves earlier keys', () => {
    store.update(aliceId, { language: 'pt' });
    const p = store.get(aliceId);
    assert.equal(p.language, 'pt');
    assert.equal(p.colorMode, 'dark'); // preserved
  });

  await test('second store instance reads the same data', () => {
    const s2 = createUserPrefsStore(tmpDir);
    const p = s2.get(aliceId);
    assert.equal(p.language, 'pt');
    assert.equal(p.colorMode, 'dark');
  });

  await test('one user\'s prefs do not leak into another\'s', () => {
    store.update(bobId, { colorMode: 'light' });
    const alice = store.get(aliceId);
    const bob = store.get(bobId);
    assert.equal(alice.colorMode, 'dark');
    assert.equal(bob.colorMode, 'light');
    assert.equal(bob.language, 'en'); // default, not alice's 'pt'
  });

  // ---------------------------------------------------------------------------
  console.log('\nValidation');
  // ---------------------------------------------------------------------------

  await test('rejects invalid language', () => {
    assert.throws(() => store.update(aliceId, { language: 'klingon' }), /language/);
  });

  await test('rejects invalid colorMode', () => {
    assert.throws(() => store.update(aliceId, { colorMode: 'neon' }), /colorMode/);
  });

  await test('rejects update with no userId', () => {
    assert.throws(() => store.update('', { language: 'en' }), /userId/);
  });

  await test('unknown patch keys are silently dropped', () => {
    store.update(aliceId, { nickname: 'Al', evil: true });
    const p = store.get(aliceId);
    assert.equal(p.nickname, undefined);
    assert.equal(p.evil, undefined);
  });

  // ---------------------------------------------------------------------------
  console.log('\nRemoveUser');
  // ---------------------------------------------------------------------------

  await test('removeUser() returns true when user had prefs', () => {
    const removed = store.removeUser(bobId);
    assert.equal(removed, true);
    // Subsequent get() returns defaults.
    const p = store.get(bobId);
    assert.deepEqual(p, DEFAULT_PREFS);
  });

  await test('removeUser() returns false for unknown user', () => {
    assert.equal(store.removeUser('never-existed'), false);
  });

  // ---------------------------------------------------------------------------
  console.log('\nInvalidate');
  // ---------------------------------------------------------------------------

  await test('invalidate() forces re-read from disk', () => {
    // Externally mutate the file.
    const raw = JSON.parse(fs.readFileSync(store.path, 'utf8'));
    raw.prefs[aliceId].colorMode = 'light';
    fs.writeFileSync(store.path, JSON.stringify(raw));

    // Without invalidate, cache returns the old value.
    const cached = store.get(aliceId);
    assert.equal(cached.colorMode, 'dark');

    // After invalidate, reads pick up the change.
    store.invalidate();
    const fresh = store.get(aliceId);
    assert.equal(fresh.colorMode, 'light');
  });

  // ---------------------------------------------------------------------------
  console.log('\nCorrupt file recovery');
  // ---------------------------------------------------------------------------

  await test('malformed prefs file throws on next access', () => {
    fs.writeFileSync(store.path, 'not-json{{');
    const s3 = createUserPrefsStore(tmpDir);
    assert.throws(() => s3.get(aliceId), /Failed to parse/);
  });

} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log('');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
