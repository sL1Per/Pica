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
  VALID_LOCALES,
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

  await test('exposes the set of valid locales and color modes', () => {
    assert.deepEqual([...VALID_LOCALES], ['en-US', 'pt-PT']);
    assert.deepEqual([...VALID_COLOR_MODES], ['light', 'dark', 'system']);
  });

  await test('get() returns DEFAULT_PREFS for an unknown user', () => {
    const p = store.get('never-existed');
    assert.deepEqual(p, DEFAULT_PREFS);
    assert.equal(p.locale, 'en-US');
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
    assert.equal(p.locale, 'en-US'); // default merged in
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
    store.update(aliceId, { locale: 'pt-PT' });
    const p = store.get(aliceId);
    assert.equal(p.locale, 'pt-PT');
    assert.equal(p.colorMode, 'dark'); // preserved
  });

  await test('second store instance reads the same data', () => {
    const s2 = createUserPrefsStore(tmpDir);
    const p = s2.get(aliceId);
    assert.equal(p.locale, 'pt-PT');
    assert.equal(p.colorMode, 'dark');
  });

  await test('one user\'s prefs do not leak into another\'s', () => {
    store.update(bobId, { colorMode: 'light' });
    const alice = store.get(aliceId);
    const bob = store.get(bobId);
    assert.equal(alice.colorMode, 'dark');
    assert.equal(bob.colorMode, 'light');
    assert.equal(bob.locale, 'en-US'); // default, not alice's 'pt'
  });

  // ---------------------------------------------------------------------------
  console.log('\nValidation');
  // ---------------------------------------------------------------------------

  await test('rejects invalid locale', () => {
    assert.throws(() => store.update(aliceId, { locale: 'klingon' }), /locale/);
  });

  await test('rejects invalid colorMode', () => {
    assert.throws(() => store.update(aliceId, { colorMode: 'neon' }), /colorMode/);
  });

  await test('rejects update with no userId', () => {
    assert.throws(() => store.update('', { locale: 'en-US' }), /userId/);
  });

  await test('unknown patch keys are silently dropped', () => {
    store.update(aliceId, { nickname: 'Al', evil: true });
    const p = store.get(aliceId);
    assert.equal(p.nickname, undefined);
    assert.equal(p.evil, undefined);
  });

  // ---------------------------------------------------------------------------
  // Backward-compat: legacy `language` field migration
  // ---------------------------------------------------------------------------

  await test('legacy language="en" reads back as locale="en-US"', () => {
    // Simulate a pre-0.15 stored prefs file by writing the raw JSON.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-prefs-legacy-'));
    try {
      const filePath = path.join(dir, 'user-prefs.json');
      fs.writeFileSync(filePath, JSON.stringify({
        prefs: { 'old-user': { language: 'en', colorMode: 'dark' } },
      }));
      const s = createUserPrefsStore(dir);
      const p = s.get('old-user');
      assert.equal(p.locale, 'en-US');
      assert.equal(p.colorMode, 'dark');
      // The legacy field itself is stripped from the read result.
      assert.equal(p.language, undefined);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('legacy language="pt" reads back as locale="pt-PT"', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-prefs-legacy2-'));
    try {
      const filePath = path.join(dir, 'user-prefs.json');
      fs.writeFileSync(filePath, JSON.stringify({
        prefs: { 'old-user': { language: 'pt' } },
      }));
      const s = createUserPrefsStore(dir);
      assert.equal(s.get('old-user').locale, 'pt-PT');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('writing locale strips the stale language field on disk', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-prefs-legacy3-'));
    try {
      const filePath = path.join(dir, 'user-prefs.json');
      fs.writeFileSync(filePath, JSON.stringify({
        prefs: { 'old-user': { language: 'en' } },
      }));
      const s = createUserPrefsStore(dir);
      s.update('old-user', { locale: 'pt-PT' });
      const written = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      assert.equal(written.prefs['old-user'].locale, 'pt-PT');
      assert.equal(written.prefs['old-user'].language, undefined);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
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
